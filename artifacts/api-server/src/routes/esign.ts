import { Router, type IRouter, type Request, type Response } from "express";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import {
  generateReviewToken,
  isSignwellConfigured,
  generateSignatureCertificate,
  type EsignSigner,
} from "../lib/esign.js";
import { sendEsignNotification, sendEsignInvite } from "../lib/email.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router: IRouter = Router();

// Public e-sign capability URLs are time-bound. After this many days from the
// most recent send/resend the per-signer signing token must be considered dead
// regardless of the envelope's status, eliminating indefinite-replay risk on
// leaked or forwarded invitation emails.
const ESIGN_LINK_TTL_DAYS = 30;
function esignLinkExpiry(): Date {
  return new Date(Date.now() + ESIGN_LINK_TTL_DAYS * 86400000);
}
function isEsignExpired(expiresAt: Date | string | null | undefined): boolean {
  // Fail closed. A missing or unparseable expiry means we cannot prove the
  // capability URL is still inside its intended window, so treat it as
  // expired. This guards against partial migrations, manual DB inserts, or
  // any future code path that forgets to set expires_at.
  if (!expiresAt) return true;
  const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return true;
  return d.getTime() < Date.now();
}

// ─── Admin: System status ─────────────────────────────────────────────────────

router.get("/admin/esign/status", requireAdmin, (_req, res) => {
  res.json({
    configured: true,
    testMode: false,
    provider: "Built-in",
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
// node-postgres + drizzle 0.45 returns { rows: [...] } from db.execute()

async function execRows(query: Parameters<typeof db.execute>[0]): Promise<any[]> {
  const result = await db.execute(query);
  return ((result as any).rows ?? result) as any[];
}

// ─── Admin: List envelopes ────────────────────────────────────────────────────

router.get("/admin/esign/envelopes", requireAdmin, async (_req, res) => {
  try {
    const rows = await execRows(sql`
      SELECT e.*,
             d.name        AS document_name,
             d.filename    AS document_filename,
             p.company_name AS partner_company
      FROM esign_envelopes e
      LEFT JOIN documents  d ON e.document_id  = d.id
      LEFT JOIN partners   p ON e.partner_id   = p.id
      ORDER BY e.created_at DESC
    `);
    res.json(rows.map(parseEnvelope));
  } catch (err) {
    console.error("[esign] list error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to list envelopes" });
  }
});

// ─── Admin: Get single envelope ───────────────────────────────────────────────

router.get("/admin/esign/envelopes/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const rows = await execRows(sql`
      SELECT e.*,
             d.name        AS document_name,
             d.filename    AS document_filename,
             p.company_name AS partner_company
      FROM esign_envelopes e
      LEFT JOIN documents  d ON e.document_id  = d.id
      LEFT JOIN partners   p ON e.partner_id   = p.id
      WHERE e.id = ${id}
      LIMIT 1
    `);
    if (!rows.length) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(parseEnvelope(rows[0]));
  } catch (err) {
    console.error("[esign] get error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to get envelope" });
  }
});

// ─── Admin: Send document for signature (built-in) ───────────────────────────

router.post("/admin/esign/envelopes", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { documentId, signers, subject, message, initiatedByEmail, initiatedByName } = req.body;

    if (!documentId || !signers || !Array.isArray(signers) || signers.length === 0) {
      res.status(400).json({ error: "validation_error", message: "documentId and signers are required" });
      return;
    }
    for (const s of signers) {
      if (!s.name || !s.email) {
        res.status(400).json({ error: "validation_error", message: "Each signer needs name and email" });
        return;
      }
    }

    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
    if (!doc) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const baseUrl = (process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners").replace(/\/$/, "");

    // Generate a unique per-signer token so each recipient receives an exclusive URL.
    // This prevents cross-signer impersonation in multi-signer envelopes.
    const esignSigners: EsignSigner[] = signers.map((s: any, i: number) => ({
      id: `signer_${i + 1}`,
      name: s.name,
      email: s.email,
      role: s.role || undefined,
      signingOrder: s.signingOrder ?? i + 1,
      signingToken: generateReviewToken(),
      signedAt: null,
    }));

    // Envelope-level token is kept for admin route lookups only.
    // Public signing flows use per-signer tokens stored in signers_json.
    const reviewToken = generateReviewToken();

    const initialEvents = [
      {
        type: "document_sent",
        timestamp: new Date().toISOString(),
        recipientEmail: null,
        recipientName: null,
      },
    ];

    const expiresAt = esignLinkExpiry();
    await db.execute(sql`
      INSERT INTO esign_envelopes
        (document_id, partner_id, provider_envelope_id, review_token,
         document_name, signers_json, status, subject, message,
         initiated_by_email, initiated_by_name, events_json, sent_at, expires_at)
      VALUES
        (${documentId}, ${doc.partnerId ?? null},
         ${reviewToken}, ${reviewToken},
         ${doc.name}, ${JSON.stringify(esignSigners)}, ${"sent"},
         ${subject || `Please sign: ${doc.name}`},
         ${message || null},
         ${initiatedByEmail || null}, ${initiatedByName || null},
         ${JSON.stringify(initialEvents)},
         NOW(), ${expiresAt})
    `);

    const insertedRows = await execRows(sql`
      SELECT id FROM esign_envelopes WHERE review_token = ${reviewToken} LIMIT 1
    `);
    const envelopeId = insertedRows[0]?.id;

    // Send per-signer invitation emails with their exclusive signing URL.
    const emailErrors: string[] = [];
    for (const signer of esignSigners) {
      const signerUrl = `${baseUrl}/esign/${signer.signingToken}`;
      try {
        await sendEsignInvite({
          to: signer.email,
          signerName: signer.name,
          documentName: doc.name,
          subject: subject || undefined,
          message: message || undefined,
          signingUrl: signerUrl,
        });
      } catch (emailErr: any) {
        console.error(`[esign] invite email failed for ${signer.email}:`, emailErr);
        emailErrors.push(signer.email);
      }
    }

    res.status(201).json({
      id: envelopeId,
      reviewToken,
      status: "sent",
      emailErrors: emailErrors.length ? emailErrors : undefined,
    });
  } catch (err: any) {
    console.error("[esign] send error:", err);
    res.status(500).json({ error: "server_error", message: err.message || "Failed to send envelope" });
  }
});

// ─── Admin: Resend invitation email ──────────────────────────────────────────

router.post("/admin/esign/envelopes/:id/resend", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const envRows = await execRows(sql`SELECT * FROM esign_envelopes WHERE id = ${id} LIMIT 1`);
    const env = envRows[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }

    if (env.status === "completed" || env.status === "declined") {
      res.status(409).json({ error: "already_resolved", message: `Cannot resend — envelope is ${env.status}` });
      return;
    }

    const signers: EsignSigner[] = tryParse(env.signers_json, []);
    const baseUrl = (process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners").replace(/\/$/, "");

    // Always rotate signing tokens for every signer who has not yet acted.
    // Reusing an outstanding token would leave the previously delivered URL
    // valid, defeating the purpose of a "resend" if the original email was
    // misdelivered, forwarded, or retained by an unauthorized party.
    for (const signer of signers) {
      if (signer.signedAt) continue;
      signer.signingToken = generateReviewToken();
    }
    // Refresh the envelope-level expiry so the rotated URLs have a full
    // standard TTL, not the residue of the original send window.
    const newExpiresAt = esignLinkExpiry();
    await db.execute(sql`
      UPDATE esign_envelopes
      SET signers_json = ${JSON.stringify(signers)},
          expires_at   = ${newExpiresAt},
          updated_at   = NOW()
      WHERE id = ${id}
    `);

    for (const signer of signers) {
      if (signer.signedAt) continue; // skip signers who have already acted
      const signerUrl = `${baseUrl}/esign/${signer.signingToken}`;
      await sendEsignInvite({
        to: signer.email,
        signerName: signer.name,
        documentName: env.document_name,
        subject: env.subject || undefined,
        message: env.message || undefined,
        signingUrl: signerUrl,
      });
    }

    res.json({ sent: true, expiresAt: newExpiresAt });
  } catch (err: any) {
    console.error("[esign] resend error:", err);
    res.status(500).json({ error: "server_error", message: err.message || "Failed to resend" });
  }
});

// ─── Admin: "Refresh" — no-op for built-in (status tracked in real time) ─────

router.post("/admin/esign/envelopes/:id/refresh", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const refreshRows = await execRows(sql`SELECT status, signers_json FROM esign_envelopes WHERE id = ${id} LIMIT 1`);
    const env = refreshRows[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ status: env.status, recipients: tryParse(env.signers_json, []) });
  } catch (err: any) {
    console.error("[esign] refresh error:", err);
    res.status(500).json({ error: "server_error", message: err.message || "Failed to refresh" });
  }
});

// ─── Public: Get document for signing ────────────────────────────────────────

router.get("/public/esign/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };

    // Look up the envelope by matching the per-signer token stored inside signers_json.
    // This ensures each URL is exclusively bound to one invited recipient.
    const envData = await execRows(sql`
      SELECT e.*,
             d.name     AS document_name,
             d.filename AS document_filename,
             d.content  AS document_content,
             d.storage_path AS document_storage_path
      FROM esign_envelopes e
      LEFT JOIN documents d ON e.document_id = d.id
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(e.signers_json::jsonb) AS s
        WHERE s->>'signingToken' = ${token}
      )
      LIMIT 1
    `);
    const env = envData[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }

    // Capability URL must respect the per-envelope expiry window. After this
    // deadline the link is dead even if the signer never acted, so that
    // leaked, forwarded, or long-retained invitation emails cannot be used
    // to read or sign the document indefinitely.
    if (isEsignExpired(env.expires_at)) {
      res.status(410).json({ error: "expired", message: "This signing link has expired." });
      return;
    }

    // Identify the specific signer this token belongs to.
    const allSigners: EsignSigner[] = tryParse(env.signers_json, []);
    const requestingSigner = allSigners.find((s) => s.signingToken === token);
    if (!requestingSigner) { res.status(404).json({ error: "not_found" }); return; }

    // Token has already been consumed (signer has already acted).
    if (requestingSigner.signedAt) {
      res.status(410).json({ error: "already_signed", message: "This signing link has already been used." });
      return;
    }

    if (env.status === "sent") {
      await db.execute(sql`
        UPDATE esign_envelopes
        SET status = 'viewed', viewed_at = NOW(), updated_at = NOW()
        WHERE id = ${env.id} AND status = 'sent'
      `);
    }

    // Do not serve document contents once the envelope has been resolved.
    // Completed/declined envelopes must be accessed through authenticated admin routes.
    const resolved = env.status === "completed" || env.status === "declined";
    let fileBase64: string | null = null;
    if (!resolved) {
      if (env.document_content) {
        fileBase64 = env.document_content;
      } else if (env.document_storage_path) {
        try {
          const objStorage = new ObjectStorageService();
          const buf = await objStorage.downloadBuffer(env.document_storage_path);
          fileBase64 = buf.toString("base64");
        } catch {
          fileBase64 = null;
        }
      }
    }

    // Strip signingToken from all signers before responding — never expose other signers' tokens.
    const publicSigners = allSigners.map(({ signingToken: _st, ...rest }) => rest);

    res.json({
      envelope: {
        id: env.id,
        status: env.status,
        documentName: env.document_name,
        documentFilename: env.document_filename,
        subject: env.subject,
        message: env.message,
        signers: publicSigners,
        sentAt: env.sent_at,
        completedAt: env.completed_at,
        signerName: env.signer_name,
      },
      // Only expose the requesting signer's identity (no cross-signer leakage).
      requestingSigner: {
        id: requestingSigner.id,
        name: requestingSigner.name,
        email: requestingSigner.email,
        role: requestingSigner.role,
      },
      fileBase64,
    });
  } catch (err) {
    console.error("[esign public] get error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ─── Public: Submit signature ─────────────────────────────────────────────────

router.post("/public/esign/:token/sign", async (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };
    // signerTitle is accepted from the body for display; signerName identity comes from
    // the server-side bound signer to prevent impersonation.
    const { signerTitle, signatureImage } = req.body;

    if (!signatureImage || !signatureImage.startsWith("data:image/png;base64,")) {
      res.status(400).json({ error: "validation_error", message: "signatureImage must be a PNG data URL" });
      return;
    }
    if (Buffer.byteLength(signatureImage, "utf8") > 5 * 1024 * 1024) {
      res.status(400).json({ error: "validation_error", message: "Signature image too large" });
      return;
    }

    // Look up the envelope by the per-signer token — the token itself proves the signer's identity.
    const signEnvRows = await execRows(sql`
      SELECT * FROM esign_envelopes
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(signers_json::jsonb) AS s
        WHERE s->>'signingToken' = ${token}
      )
      LIMIT 1
    `);
    const env = signEnvRows[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }
    if (isEsignExpired(env.expires_at)) {
      res.status(410).json({ error: "expired", message: "This signing link has expired." });
      return;
    }
    if (env.status === "completed" || env.status === "declined") {
      res.status(409).json({ error: "already_resolved", message: `Envelope already ${env.status}` });
      return;
    }

    // Identify the specific signer bound to this token.
    const allSigners: EsignSigner[] = tryParse(env.signers_json, []);
    const boundSigner = allSigners.find((s) => s.signingToken === token);
    if (!boundSigner) { res.status(404).json({ error: "not_found" }); return; }
    if (boundSigner.signedAt) {
      res.status(409).json({ error: "already_signed", message: "This signing link has already been used." });
      return;
    }

    // Enforce signing order: all signers with a lower signingOrder must have already signed.
    const pendingPrior = allSigners.some(
      (s) => s.signingOrder < boundSigner.signingOrder && !s.signedAt,
    );
    if (pendingPrior) {
      res.status(409).json({
        error: "signing_order_not_met",
        message: "A prior required signer has not yet completed their signature.",
      });
      return;
    }

    // Identity is bound server-side to the invited signer; do not accept caller-asserted names.
    const canonicalSignerName = boundSigner.name;
    const canonicalSignerTitle =
      signerTitle && typeof signerTitle === "string" && signerTitle.trim().length <= 200
        ? signerTitle.trim() || null
        : null;

    const signedAt = new Date();
    const events: any[] = tryParse(env.events_json, []);
    events.push({
      type: "document_signed",
      timestamp: signedAt.toISOString(),
      recipientEmail: boundSigner.email,
      recipientName: canonicalSignerName,
    });

    // Consume this signer's token and record their completion timestamp.
    const updatedSigners = allSigners.map((s) =>
      s.signingToken === token
        ? { ...s, signingToken: null, signedAt: signedAt.toISOString() }
        : s,
    );
    // Envelope is complete only when every signer has acted.
    const allSigned = updatedSigners.every((s) => s.signedAt != null);

    // Only append the envelope-level "completed" event when all signers are done.
    if (allSigned) {
      events.push({
        type: "document_completed",
        timestamp: new Date().toISOString(),
        recipientEmail: boundSigner.email,
        recipientName: canonicalSignerName,
      });
    }

    // Atomic UPDATE: the WHERE clause re-verifies the token is still present in
    // signers_json, acting as a compare-and-swap guard. If two concurrent
    // requests both passed the pre-check above, only one will match the EXISTS
    // condition and the other will receive an empty RETURNING result → 409.
    const atomicUpdateRows = await execRows(sql`
      UPDATE esign_envelopes
      SET status          = ${allSigned ? "completed" : env.status},
          signer_name     = ${canonicalSignerName},
          signer_title    = ${canonicalSignerTitle},
          signature_image = ${signatureImage},
          completed_at    = ${allSigned ? signedAt : null},
          events_json     = ${JSON.stringify(events)},
          signers_json    = ${JSON.stringify(updatedSigners)},
          updated_at      = NOW()
      WHERE id = ${env.id}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(signers_json::jsonb) AS s
          WHERE s->>'signingToken' = ${token}
        )
      RETURNING id
    `);
    if (atomicUpdateRows.length === 0) {
      res.status(409).json({ error: "already_signed", message: "This signing link has already been used." });
      return;
    }

    // Generate signature certificate PDF after atomically claiming the token.
    let executedDocumentId: number | null = null;
    try {
      const certBuffer = await generateSignatureCertificate({
        documentName: env.document_name,
        signerName: canonicalSignerName,
        signerTitle: canonicalSignerTitle,
        signatureImage,
        signedAt,
        envelopeId: env.id,
      });

      const certBase64 = certBuffer.toString("base64");
      const certFilename = `certificate_${env.document_name.replace(/\s+/g, "_")}_${Date.now()}.pdf`;

      const inserted = await db.insert(documentsTable).values({
        name: `[Signed] ${env.document_name}`,
        description: `Signature certificate — signed by ${canonicalSignerName} on ${signedAt.toLocaleDateString()}`,
        filename: certFilename,
        mimeType: "application/pdf",
        size: certBuffer.length,
        content: certBase64,
        category: "contract",
        partnerId: env.partner_id ?? null,
        uploadedBy: "esign",
        tags: JSON.stringify(["executed", "esigned", "certificate"]),
      }).returning({ id: documentsTable.id });

      executedDocumentId = inserted[0]?.id ?? null;

      if (executedDocumentId !== null) {
        await db.execute(sql`
          UPDATE esign_envelopes
          SET executed_document_id = ${executedDocumentId},
              updated_at           = NOW()
          WHERE id = ${env.id}
        `);
      }
    } catch (pdfErr) {
      console.error("[esign sign] certificate generation failed:", pdfErr);
    }

    // Notify initiating admin only when the envelope reaches completed state.
    if (allSigned && env.initiated_by_email) {
      sendEsignNotification({
        to: env.initiated_by_email,
        adminName: env.initiated_by_name || "Admin",
        documentName: env.document_name,
        envelopeId: env.id,
        eventType: "completed",
        recipientName: canonicalSignerName,
      }).catch(e => console.error("[esign sign] admin notification failed:", e));
    }

    res.json({
      success: true,
      executedDocumentId,
      certificateUrl: executedDocumentId ? `/api/admin/documents/${executedDocumentId}/download` : null,
    });
  } catch (err: any) {
    console.error("[esign sign] error:", err);
    res.status(500).json({ error: "server_error", message: err.message || "Failed to sign" });
  }
});

// ─── Public: Decline ──────────────────────────────────────────────────────────

router.post("/public/esign/:token/decline", async (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };
    const { reason, note } = req.body;

    // Look up by per-signer token.
    const declineRows = await execRows(sql`
      SELECT * FROM esign_envelopes
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(signers_json::jsonb) AS s
        WHERE s->>'signingToken' = ${token}
      )
      LIMIT 1
    `);
    const env = declineRows[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }
    if (isEsignExpired(env.expires_at)) {
      res.status(410).json({ error: "expired", message: "This signing link has expired." });
      return;
    }
    if (env.status === "completed" || env.status === "declined") {
      res.status(409).json({ error: "already_resolved", message: `Envelope already ${env.status}` });
      return;
    }

    // Identify and validate the specific signer.
    const allSigners: EsignSigner[] = tryParse(env.signers_json, []);
    const boundSigner = allSigners.find((s) => s.signingToken === token);
    if (!boundSigner) { res.status(404).json({ error: "not_found" }); return; }
    if (boundSigner.signedAt) {
      res.status(409).json({ error: "already_signed", message: "This signing link has already been used." });
      return;
    }

    const declinedAt = new Date().toISOString();
    const events: any[] = tryParse(env.events_json, []);
    events.push({ type: "document_declined", timestamp: declinedAt, reason, note });

    // Consume this signer's token.
    const updatedSigners = allSigners.map((s) =>
      s.signingToken === token ? { ...s, signingToken: null, signedAt: declinedAt } : s,
    );

    // Atomic UPDATE: re-check token presence in WHERE to prevent concurrent
    // decline/sign races from both succeeding on the same bearer link.
    const declineUpdateRows = await execRows(sql`
      UPDATE esign_envelopes
      SET status       = 'declined',
          events_json  = ${JSON.stringify(events)},
          signers_json = ${JSON.stringify(updatedSigners)},
          updated_at   = NOW()
      WHERE id = ${env.id}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(signers_json::jsonb) AS s
          WHERE s->>'signingToken' = ${token}
        )
      RETURNING id
    `);
    if (declineUpdateRows.length === 0) {
      res.status(409).json({ error: "already_signed", message: "This signing link has already been used." });
      return;
    }

    if (env.initiated_by_email) {
      sendEsignNotification({
        to: env.initiated_by_email,
        adminName: env.initiated_by_name || "Admin",
        documentName: env.document_name,
        envelopeId: env.id,
        eventType: "declined",
      }).catch(e => console.error("[esign decline] admin notification failed:", e));
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[esign decline] error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to decline" });
  }
});

// ─── Admin: Download signature certificate ────────────────────────────────────
// Access requires admin authentication; signers receive their certificate via the
// executed document URL (/api/admin/documents/:id/download) returned at sign-time.

router.get("/admin/esign/envelopes/:id/certificate", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "invalid_id" }); return; }
    const certEnvRows = await execRows(sql`
      SELECT e.*, d.content AS cert_content, d.filename AS cert_filename
      FROM esign_envelopes e
      LEFT JOIN documents d ON e.executed_document_id = d.id
      WHERE e.id = ${id}
      LIMIT 1
    `);
    const env = certEnvRows[0];
    if (!env || env.status !== "completed") {
      res.status(404).json({ error: "not_found", message: "Signed certificate not available" });
      return;
    }

    if (env.cert_content) {
      const buf = Buffer.from(env.cert_content, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${env.cert_filename || "certificate.pdf"}"`);
      res.send(buf);
      return;
    }

    // Regenerate on the fly if stored copy is missing
    const certBuffer = await generateSignatureCertificate({
      documentName: env.document_name,
      signerName: env.signer_name || "Unknown",
      signerTitle: env.signer_title,
      signatureImage: env.signature_image || "",
      signedAt: env.completed_at ? new Date(env.completed_at) : new Date(),
      envelopeId: env.id,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="certificate.pdf"`);
    res.send(certBuffer);
  } catch (err: any) {
    console.error("[esign certificate] error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEnvelope(row: any) {
  return {
    ...row,
    signers: tryParse(row.signers_json, []),
    events: tryParse(row.events_json, []),
  };
}

function tryParse(str: string | null, fallback: any) {
  try { return JSON.parse(str || ""); } catch { return fallback; }
}

export default router;
