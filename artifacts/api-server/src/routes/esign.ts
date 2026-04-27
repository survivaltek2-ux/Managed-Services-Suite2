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

// ─── Admin: System status ─────────────────────────────────────────────────────

router.get("/admin/esign/status", requireAdmin, (_req, res) => {
  res.json({
    configured: true,
    testMode: false,
    provider: "Built-in",
  });
});

// ─── Admin: List envelopes ────────────────────────────────────────────────────

router.get("/admin/esign/envelopes", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT e.*,
             d.name        AS document_name,
             d.filename    AS document_filename,
             p.company_name AS partner_company
      FROM esign_envelopes e
      LEFT JOIN documents  d ON e.document_id  = d.id
      LEFT JOIN partners   p ON e.partner_id   = p.id
      ORDER BY e.created_at DESC
    `);
    res.json((rows as any[]).map(parseEnvelope));
  } catch (err) {
    console.error("[esign] list error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to list envelopes" });
  }
});

// ─── Admin: Get single envelope ───────────────────────────────────────────────

router.get("/admin/esign/envelopes/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const rows = await db.execute(sql`
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
    if (!(rows as any[]).length) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(parseEnvelope((rows as any[])[0]));
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

    const esignSigners: EsignSigner[] = signers.map((s: any, i: number) => ({
      id: `signer_${i + 1}`,
      name: s.name,
      email: s.email,
      role: s.role || undefined,
      signingOrder: s.signingOrder ?? i + 1,
    }));

    // Generate a unique token per envelope (supports multi-signer in future)
    const reviewToken = generateReviewToken();
    const baseUrl = process.env.PUBLIC_URL || process.env.PORTAL_URL || "";
    const signingUrl = `${baseUrl}/esign/${reviewToken}`;

    const initialEvents = [
      {
        type: "document_sent",
        timestamp: new Date().toISOString(),
        recipientEmail: null,
        recipientName: null,
      },
    ];

    await db.execute(sql`
      INSERT INTO esign_envelopes
        (document_id, partner_id, provider_envelope_id, review_token,
         document_name, signers_json, status, subject, message,
         initiated_by_email, initiated_by_name, events_json, sent_at)
      VALUES
        (${documentId}, ${doc.partnerId ?? null},
         ${reviewToken}, ${reviewToken},
         ${doc.name}, ${JSON.stringify(esignSigners)}, ${"sent"},
         ${subject || `Please sign: ${doc.name}`},
         ${message || null},
         ${initiatedByEmail || null}, ${initiatedByName || null},
         ${JSON.stringify(initialEvents)},
         NOW())
    `);

    const inserted = await db.execute(sql`
      SELECT id FROM esign_envelopes WHERE review_token = ${reviewToken} LIMIT 1
    `);
    const envelopeId = (inserted as any[])[0]?.id;

    // Send email invitation to each signer
    const emailErrors: string[] = [];
    for (const signer of esignSigners) {
      try {
        await sendEsignInvite({
          to: signer.email,
          signerName: signer.name,
          documentName: doc.name,
          subject: subject || undefined,
          message: message || undefined,
          signingUrl,
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
      signingUrl,
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
    const rows = await db.execute(sql`SELECT * FROM esign_envelopes WHERE id = ${id} LIMIT 1`);
    const env = (rows as any[])[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }

    if (env.status === "completed" || env.status === "declined") {
      res.status(409).json({ error: "already_resolved", message: `Cannot resend — envelope is ${env.status}` });
      return;
    }

    const signers: EsignSigner[] = tryParse(env.signers_json, []);
    const baseUrl = process.env.PUBLIC_URL || process.env.PORTAL_URL || "";
    const signingUrl = `${baseUrl}/esign/${env.review_token}`;

    for (const signer of signers) {
      await sendEsignInvite({
        to: signer.email,
        signerName: signer.name,
        documentName: env.document_name,
        subject: env.subject || undefined,
        message: env.message || undefined,
        signingUrl,
      });
    }

    res.json({ sent: true });
  } catch (err: any) {
    console.error("[esign] resend error:", err);
    res.status(500).json({ error: "server_error", message: err.message || "Failed to resend" });
  }
});

// ─── Admin: "Refresh" — no-op for built-in (status tracked in real time) ─────

router.post("/admin/esign/envelopes/:id/refresh", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const rows = await db.execute(sql`SELECT status, signers_json FROM esign_envelopes WHERE id = ${id} LIMIT 1`);
    const env = (rows as any[])[0];
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
    const rows = await db.execute(sql`
      SELECT e.*,
             d.name     AS document_name,
             d.filename AS document_filename,
             d.content  AS document_content,
             d.storage_path AS document_storage_path
      FROM esign_envelopes e
      LEFT JOIN documents d ON e.document_id = d.id
      WHERE e.review_token = ${token}
      LIMIT 1
    `);
    const env = (rows as any[])[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }

    if (env.status === "sent") {
      await db.execute(sql`
        UPDATE esign_envelopes
        SET status = 'viewed', viewed_at = NOW(), updated_at = NOW()
        WHERE review_token = ${token} AND status = 'sent'
      `);
    }

    // Resolve document content
    let fileBase64: string | null = null;
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

    res.json({
      envelope: {
        id: env.id,
        status: env.status,
        documentName: env.document_name,
        documentFilename: env.document_filename,
        subject: env.subject,
        message: env.message,
        signers: tryParse(env.signers_json, []),
        sentAt: env.sent_at,
        completedAt: env.completed_at,
        signerName: env.signer_name,
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
    const { signerName, signerTitle, signatureImage } = req.body;

    if (!signerName?.trim()) {
      res.status(400).json({ error: "validation_error", message: "signerName is required" });
      return;
    }
    if (!signatureImage || !signatureImage.startsWith("data:image/png;base64,")) {
      res.status(400).json({ error: "validation_error", message: "signatureImage must be a PNG data URL" });
      return;
    }
    if (Buffer.byteLength(signatureImage, "utf8") > 5 * 1024 * 1024) {
      res.status(400).json({ error: "validation_error", message: "Signature image too large" });
      return;
    }

    const rows = await db.execute(sql`
      SELECT * FROM esign_envelopes WHERE review_token = ${token} LIMIT 1
    `);
    const env = (rows as any[])[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }
    if (env.status === "completed" || env.status === "declined") {
      res.status(409).json({ error: "already_resolved", message: `Envelope already ${env.status}` });
      return;
    }

    const signedAt = new Date();
    const events: any[] = tryParse(env.events_json, []);
    events.push({
      type: "document_signed",
      timestamp: signedAt.toISOString(),
      recipientEmail: null,
      recipientName: signerName,
    });

    // Generate signature certificate PDF
    let executedDocumentId: number | null = null;
    try {
      const certBuffer = await generateSignatureCertificate({
        documentName: env.document_name,
        signerName: signerName.trim(),
        signerTitle: signerTitle?.trim() || null,
        signatureImage,
        signedAt,
        envelopeId: env.id,
      });

      const certBase64 = certBuffer.toString("base64");
      const certFilename = `certificate_${env.document_name.replace(/\s+/g, "_")}_${Date.now()}.pdf`;

      const inserted = await db.insert(documentsTable).values({
        name: `[Signed] ${env.document_name}`,
        description: `Signature certificate — signed by ${signerName} on ${signedAt.toLocaleDateString()}`,
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
    } catch (pdfErr) {
      console.error("[esign sign] certificate generation failed:", pdfErr);
    }

    events.push({
      type: "document_completed",
      timestamp: new Date().toISOString(),
      recipientEmail: null,
      recipientName: signerName,
    });

    await db.execute(sql`
      UPDATE esign_envelopes
      SET status               = 'completed',
          signer_name          = ${signerName.trim()},
          signer_title         = ${signerTitle?.trim() || null},
          signature_image      = ${signatureImage},
          completed_at         = ${signedAt},
          executed_document_id = ${executedDocumentId},
          events_json          = ${JSON.stringify(events)},
          updated_at           = NOW()
      WHERE review_token = ${token}
    `);

    // Notify initiating admin
    if (env.initiated_by_email) {
      sendEsignNotification({
        to: env.initiated_by_email,
        adminName: env.initiated_by_name || "Admin",
        documentName: env.document_name,
        envelopeId: env.id,
        eventType: "completed",
        recipientName: signerName,
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

    const rows = await db.execute(sql`SELECT * FROM esign_envelopes WHERE review_token = ${token} LIMIT 1`);
    const env = (rows as any[])[0];
    if (!env) { res.status(404).json({ error: "not_found" }); return; }
    if (env.status === "completed" || env.status === "declined") {
      res.status(409).json({ error: "already_resolved", message: `Envelope already ${env.status}` });
      return;
    }

    const events: any[] = tryParse(env.events_json, []);
    events.push({ type: "document_declined", timestamp: new Date().toISOString(), reason, note });

    await db.execute(sql`
      UPDATE esign_envelopes
      SET status      = 'declined',
          events_json = ${JSON.stringify(events)},
          updated_at  = NOW()
      WHERE review_token = ${token}
    `);

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

// ─── Public: Download signature certificate ───────────────────────────────────

router.get("/public/esign/:token/certificate", async (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };
    const rows = await db.execute(sql`
      SELECT e.*, d.content AS cert_content, d.filename AS cert_filename
      FROM esign_envelopes e
      LEFT JOIN documents d ON e.executed_document_id = d.id
      WHERE e.review_token = ${token}
      LIMIT 1
    `);
    const env = (rows as any[])[0];
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
