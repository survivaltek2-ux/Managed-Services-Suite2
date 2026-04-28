import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, leadMagnetSubmissionsTable, leadMagnetSequenceSendsTable, contactsTable, quotesTable } from "@workspace/db";
import { eq, desc, and, gte, lte, inArray, isNull, sql, isNotNull } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth.js";
import { sendLeadMagnetSubmission, type LeadMagnetKey, type LeadMagnetPayload } from "../lib/email.js";
import { generateLeadMagnetPdf, type LeadMagnetPdfKey } from "../lib/pdfGenerator.js";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../lib/objectStorage.js";
import { randomUUID } from "crypto";
import { normalizeEmail, tryConsume } from "../lib/abuseControls.js";
import { upsertContact } from "../lib/crmUpsert.js";
import {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
  markUnsubscribed,
  unsubscribeAllByEmail,
  getAllSequencePauseStates,
  setSequencePaused,
  isSequencePaused,
  SEQUENCES,
  loadStepViews,
  upsertStepOverride,
  resetStepOverride,
  previewStep,
} from "../lib/leadMagnetSequence.js";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const ALLOWED_MAGNETS = new Set([
  "cybersecurity_assessment",
  "downtime_calculator",
  "hipaa_checklist",
  "buyers_guide",
]);

const PDF_MAGNETS = new Set<LeadMagnetPdfKey>(["hipaa_checklist", "buyers_guide"]);

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "forbidden", message: "Admin access required" });
    return;
  }
  next();
}

function siteBaseUrl(req: Request): string {
  const explicit = process.env.PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = req.get("host") || "siebertrservices.com";
  const proto = req.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

async function uploadPdfToPrivateStorage(buffer: Buffer, filename: string): Promise<string> {
  const privateDir = objectStorage.getPrivateObjectDir();
  const id = randomUUID();
  const fullPath = `${privateDir}${privateDir.endsWith("/") ? "" : "/"}lead-magnets/${id}-${filename}`;
  // parseObjectPath is internal; replicate split here.
  const noLead = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const [bucketName, ...rest] = noLead.split("/");
  const objectName = rest.join("/");
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType: "application/pdf", resumable: false });
  // Return entity-style path consistent with normalizeObjectEntityPath
  let entityDir = privateDir;
  if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
  const entityId = `lead-magnets/${id}-${filename}`;
  return `/objects/${entityId}`;
}

router.post("/lead-magnets/submit", async (req, res) => {
  try {
    const { magnet, name, email, company, phone, payload, source } = req.body || {};
    if (!magnet || !ALLOWED_MAGNETS.has(magnet)) {
      res.status(400).json({ error: "validation_error", message: "valid magnet is required" });
      return;
    }
    if (!name || !email) {
      res.status(400).json({ error: "validation_error", message: "name and email are required" });
      return;
    }

    const normalizedEmail = normalizeEmail(email);

    // Per-recipient throttle (cross-IP). Prevents bombing one victim with new
    // submissions across multiple magnets from many source IPs. Sliding 24h
    // window, max 3 distinct submissions per recipient address.
    if (!tryConsume(`leadmagnet:${normalizedEmail}`, 3, 24 * 60 * 60 * 1000)) {
      res.status(200).json({
        id: 0,
        magnet,
        thankYouPath: `/resources/${magnet.replace(/_/g, "-")}/thanks`,
      });
      return;
    }

    // Global opt-out: if this email previously unsubscribed from ANY lead-magnet
    // submission, refuse new submissions (and skip the drip sequence). One
    // unsubscribe click now silences the address across all magnets, so a
    // bombed victim does not have to opt out submission-by-submission.
    const [priorUnsub] = await db
      .select({ id: leadMagnetSubmissionsTable.id })
      .from(leadMagnetSubmissionsTable)
      .where(
        and(
          eq(sql`lower(${leadMagnetSubmissionsTable.email})`, normalizedEmail),
          isNotNull(leadMagnetSubmissionsTable.unsubscribedAt),
        )
      )
      .limit(1);
    if (priorUnsub) {
      // Same shape as a real success so attackers cannot enumerate which
      // addresses are opted out.
      res.status(200).json({
        id: 0,
        magnet,
        thankYouPath: `/resources/${magnet.replace(/_/g, "-")}/thanks`,
      });
      return;
    }

    // Deduplicate: if this email already has an active (non-unsubscribed) submission
    // for the same magnet, return success without creating a new row or triggering
    // a new drip sequence. This prevents subscription-bombing attacks where an
    // attacker repeatedly submits a victim's address to stack up repeated email campaigns.
    const [existingSubmission] = await db
      .select({ id: leadMagnetSubmissionsTable.id, magnet: leadMagnetSubmissionsTable.magnet })
      .from(leadMagnetSubmissionsTable)
      .where(
        and(
          eq(sql`lower(${leadMagnetSubmissionsTable.email})`, normalizedEmail),
          eq(leadMagnetSubmissionsTable.magnet, magnet as LeadMagnetKey),
          isNull(leadMagnetSubmissionsTable.unsubscribedAt),
        )
      )
      .limit(1);

    if (existingSubmission) {
      res.status(200).json({
        id: existingSubmission.id,
        magnet: existingSubmission.magnet,
        thankYouPath: `/resources/${magnet.replace(/_/g, "-")}/thanks`,
      });
      return;
    }

    const safePayload: LeadMagnetPayload = (payload && typeof payload === "object") ? payload as LeadMagnetPayload : {};
    const [submission] = await db.insert(leadMagnetSubmissionsTable).values({
      magnet: magnet as LeadMagnetKey,
      name: String(name).trim(),
      email: normalizedEmail,
      company: company ? String(company).trim() : null,
      phone: phone ? String(phone).trim() : null,
      payload: safePayload,
      source: source ? String(source).slice(0, 200) : null,
    }).returning();

    upsertContact({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : null,
      companyName: company ? String(company).trim() : null,
      source: `lead_magnet_${magnet}`,
    }).then(async ({ contactId, companyId }) => {
      if (contactId || companyId) {
        await db.update(leadMagnetSubmissionsTable)
          .set({ crmContactId: contactId, crmCompanyId: companyId })
          .where(eq(leadMagnetSubmissionsTable.id, submission.id));
      }
    }).catch(err => console.error("[CRM] Lead-magnet upsert error:", err));

    const baseUrl = siteBaseUrl(req);
    const unsubscribeUrl = buildUnsubscribeUrl(baseUrl, submission.id);

    // Generate PDF + upload to private storage (only for the two PDF magnets).
    let pdfAttachment: { filename: string; content: Buffer; contentType: string } | undefined;
    if (PDF_MAGNETS.has(submission.magnet as LeadMagnetPdfKey)) {
      try {
        const { buffer, filename } = await generateLeadMagnetPdf(submission.magnet as LeadMagnetPdfKey);
        pdfAttachment = { filename, content: buffer, contentType: "application/pdf" };
        try {
          const storagePath = await uploadPdfToPrivateStorage(buffer, filename);
          await db.update(leadMagnetSubmissionsTable)
            .set({ pdfStoragePath: storagePath })
            .where(eq(leadMagnetSubmissionsTable.id, submission.id));
        } catch (storageErr) {
          console.error("[LeadMagnet] Failed to upload PDF to object storage:", storageErr);
        }
      } catch (pdfErr) {
        console.error("[LeadMagnet] Failed to generate PDF:", pdfErr);
      }
    }

    sendLeadMagnetSubmission({
      id: submission.id,
      magnet: submission.magnet as LeadMagnetKey,
      name: submission.name,
      email: submission.email,
      company: submission.company,
      phone: submission.phone,
      payload: (submission.payload || {}) as LeadMagnetPayload,
      pdfAttachment,
      unsubscribeUrl,
    }, baseUrl)
      .then(async () => {
        await db.update(leadMagnetSubmissionsTable)
          .set({ emailSent: "sent" })
          .where(eq(leadMagnetSubmissionsTable.id, submission.id));
      })
      .catch(async (err) => {
        console.error("[Email] Lead magnet send error:", err);
        await db.update(leadMagnetSubmissionsTable)
          .set({ emailSent: "failed" })
          .where(eq(leadMagnetSubmissionsTable.id, submission.id))
          .catch(() => {});
      });

    res.status(201).json({
      id: submission.id,
      magnet: submission.magnet,
      thankYouPath: `/resources/${magnet.replace(/_/g, "-")}/thanks`,
    });
  } catch (err) {
    console.error("Lead magnet submit error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to submit. Please try again." });
  }
});

// Public PDF download for the two gated guides. Generates on demand so the
// printable-page CTA + email link both work even if storage upload failed.
router.get("/lead-magnets/:magnet/pdf", async (req: Request, res: Response) => {
  try {
    const magnet = req.params.magnet?.replace(/-/g, "_");
    if (!magnet || !PDF_MAGNETS.has(magnet as LeadMagnetPdfKey)) {
      res.status(404).json({ error: "not_found", message: "Unknown guide" });
      return;
    }
    const { buffer, filename } = await generateLeadMagnetPdf(magnet as LeadMagnetPdfKey);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(buffer);
  } catch (err) {
    console.error("Lead magnet PDF error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to generate PDF" });
  }
});

function escHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function unsubscribePage(message: string, status: "ok" | "error", emailContext?: string | null): string {
  const color = status === "ok" ? "#16a34a" : "#dc2626";
  const safeEmail = emailContext ? `<strong>${escHtml(emailContext)}</strong>` : "";
  const safeMessage = escHtml(message);
  const fullMessage = safeEmail ? safeMessage.replace("[[EMAIL]]", safeEmail) : safeMessage.replace("[[EMAIL]]", "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe — Siebert Services</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body{font-family:Inter,Arial,sans-serif;background:#f9fafb;margin:0;padding:0;}
      .wrap{max-width:520px;margin:80px auto;padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;}
      h1{margin:0 0 12px;font-size:20px;color:#111827;}p{font-size:14px;color:#374151;line-height:1.6;}
      .badge{display:inline-block;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${color}20;color:${color};margin-bottom:16px;}
      a{color:#0176d3;}</style></head><body>
    <div class="wrap"><span class="badge">${status === "ok" ? "Unsubscribed" : "Error"}</span>
    <h1>Siebert Services</h1><p>${fullMessage}</p>
    <p style="margin-top:24px;font-size:12px;color:#9ca3af;">Questions? Email <a href="mailto:support@siebertrservices.com">support@siebertrservices.com</a> or call 866-484-9180.</p>
    </div></body></html>`;
}

router.get("/lead-magnets/unsubscribe", async (req, res) => {
  const token = String(req.query.token || "");
  const id = verifyUnsubscribeToken(token);
  if (!id) {
    res.status(400).type("html").send(unsubscribePage("This unsubscribe link is invalid or has expired. Please contact support to be removed.", "error"));
    return;
  }
  const result = await markUnsubscribed(id);
  if (!result.ok) {
    res.status(404).type("html").send(unsubscribePage("We couldn't find that subscription. It may have already been removed.", "error"));
    return;
  }
  // Cascade the unsubscribe across every other active submission for this
  // email. One click now opts the address out of all current and future
  // lead-magnet drips — important for bombed victims.
  if (result.email) {
    await unsubscribeAllByEmail(result.email).catch(err =>
      console.error("[LeadMagnet] cascade unsubscribe failed:", err)
    );
  }
  const msg = result.email
    ? `You've been unsubscribed from Siebert Services lead-magnet follow-up emails for [[EMAIL]]. You won't receive any further automated messages on any resource.`
    : `You've been unsubscribed from Siebert Services lead-magnet follow-up emails. You won't receive any further automated messages on any resource.`;
  res.type("html").send(unsubscribePage(msg, "ok", result.email || null));
});

router.post("/lead-magnets/unsubscribe", async (req, res) => {
  const token = String(req.body?.token || req.query.token || "");
  const id = verifyUnsubscribeToken(token);
  if (!id) { res.status(400).json({ error: "invalid_token" }); return; }
  const result = await markUnsubscribed(id);
  if (!result.ok) { res.status(404).json({ error: "not_found" }); return; }
  // Same global cascade as the GET handler — one POST also opts the address
  // out of every other active lead-magnet submission.
  if (result.email) {
    await unsubscribeAllByEmail(result.email).catch(err =>
      console.error("[LeadMagnet] cascade unsubscribe failed:", err)
    );
  }
  res.json({ success: true });
});

router.get("/admin/lead-magnets/analytics", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { magnet, source, from, to } = req.query as Record<string, string | undefined>;

    const conds = [] as any[];
    if (magnet && ALLOWED_MAGNETS.has(magnet)) {
      conds.push(eq(leadMagnetSubmissionsTable.magnet, magnet as LeadMagnetKey));
    }
    if (source) {
      conds.push(eq(leadMagnetSubmissionsTable.source, source));
    }
    let fromDate: Date | null = null;
    let toDate: Date | null = null;
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) { fromDate = d; conds.push(gte(leadMagnetSubmissionsTable.createdAt, d)); }
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) {
        // Make `to` inclusive of the entire day
        d.setHours(23, 59, 59, 999);
        toDate = d;
        conds.push(lte(leadMagnetSubmissionsTable.createdAt, d));
      }
    }
    const whereClause = conds.length ? and(...conds) : undefined;

    const submissions = await db.select({
      id: leadMagnetSubmissionsTable.id,
      magnet: leadMagnetSubmissionsTable.magnet,
      email: leadMagnetSubmissionsTable.email,
      source: leadMagnetSubmissionsTable.source,
      createdAt: leadMagnetSubmissionsTable.createdAt,
    }).from(leadMagnetSubmissionsTable).where(whereClause);

    const total = submissions.length;
    const emails = Array.from(new Set(submissions.map(s => s.email).filter(Boolean)));

    // Pull all contact and quote rows that match any submission email so we can
    // compute "this lead later converted" without an N+1.
    const [contactRows, quoteRows] = emails.length === 0 ? [[], []] : await Promise.all([
      db.select({ email: contactsTable.email, createdAt: contactsTable.createdAt })
        .from(contactsTable)
        .where(inArray(contactsTable.email, emails)),
      db.select({ email: quotesTable.email, createdAt: quotesTable.createdAt })
        .from(quotesTable)
        .where(inArray(quotesTable.email, emails)),
    ]);

    const contactsByEmail = new Map<string, Date[]>();
    for (const c of contactRows) {
      const list = contactsByEmail.get(c.email) || [];
      list.push(c.createdAt);
      contactsByEmail.set(c.email, list);
    }
    const quotesByEmail = new Map<string, Date[]>();
    for (const q of quoteRows) {
      const list = quotesByEmail.get(q.email) || [];
      list.push(q.createdAt);
      quotesByEmail.set(q.email, list);
    }

    const wasConverted = (email: string, submittedAt: Date) => {
      const t = submittedAt.getTime();
      const cs = contactsByEmail.get(email) || [];
      if (cs.some(d => d.getTime() >= t)) return true;
      const qs = quotesByEmail.get(email) || [];
      return qs.some(d => d.getTime() >= t);
    };

    // Aggregations
    const byMagnetMap = new Map<string, { magnet: string; count: number; converted: number }>();
    const bySourceMap = new Map<string, { source: string; count: number; converted: number }>();
    const dayMap = new Map<string, number>();
    let convertedTotal = 0;

    for (const s of submissions) {
      const converted = wasConverted(s.email, s.createdAt);
      if (converted) convertedTotal++;

      const m = byMagnetMap.get(s.magnet) || { magnet: s.magnet, count: 0, converted: 0 };
      m.count++;
      if (converted) m.converted++;
      byMagnetMap.set(s.magnet, m);

      const srcKey = s.source || "(unknown)";
      const src = bySourceMap.get(srcKey) || { source: srcKey, count: 0, converted: 0 };
      src.count++;
      if (converted) src.converted++;
      bySourceMap.set(srcKey, src);

      const day = s.createdAt.toISOString().slice(0, 10);
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }

    // Build a continuous time series so charts don't have gaps.
    const seriesStart = fromDate ?? (submissions.length
      ? new Date(Math.min(...submissions.map(s => s.createdAt.getTime())))
      : new Date());
    const seriesEnd = toDate ?? new Date();
    const startDay = new Date(Date.UTC(seriesStart.getUTCFullYear(), seriesStart.getUTCMonth(), seriesStart.getUTCDate()));
    const endDay = new Date(Date.UTC(seriesEnd.getUTCFullYear(), seriesEnd.getUTCMonth(), seriesEnd.getUTCDate()));
    const dayMs = 86400000;
    const spanDays = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / dayMs) + 1);
    const useWeekly = spanDays > 60;

    const timeSeries: { date: string; count: number }[] = [];
    if (submissions.length > 0) {
      if (useWeekly) {
        // Bucket by ISO week (Mon-start)
        const weekMap = new Map<string, number>();
        for (const s of submissions) {
          const d = new Date(s.createdAt);
          const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
          const dayOfWeek = (utc.getUTCDay() + 6) % 7; // Mon=0
          utc.setUTCDate(utc.getUTCDate() - dayOfWeek);
          const key = utc.toISOString().slice(0, 10);
          weekMap.set(key, (weekMap.get(key) || 0) + 1);
        }
        const firstMon = new Date(startDay);
        const dow = (firstMon.getUTCDay() + 6) % 7;
        firstMon.setUTCDate(firstMon.getUTCDate() - dow);
        for (let t = firstMon.getTime(); t <= endDay.getTime(); t += dayMs * 7) {
          const key = new Date(t).toISOString().slice(0, 10);
          timeSeries.push({ date: key, count: weekMap.get(key) || 0 });
        }
      } else {
        for (let t = startDay.getTime(); t <= endDay.getTime(); t += dayMs) {
          const key = new Date(t).toISOString().slice(0, 10);
          timeSeries.push({ date: key, count: dayMap.get(key) || 0 });
        }
      }
    }

    const byMagnet = Array.from(byMagnetMap.values())
      .map(m => ({ ...m, conversionRate: m.count ? Math.round((m.converted / m.count) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    const bySource = Array.from(bySourceMap.values())
      .map(s => ({ ...s, conversionRate: s.count ? Math.round((s.converted / s.count) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    // Distinct sources for the filter dropdown (unfiltered by source).
    const sourceOptionRows = await db.selectDistinct({ source: leadMagnetSubmissionsTable.source })
      .from(leadMagnetSubmissionsTable);
    const sourceOptions = sourceOptionRows.map(r => r.source).filter((s): s is string => !!s).sort();

    res.json({
      filters: {
        magnet: magnet || null,
        source: source || null,
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
      },
      totals: {
        submissions: total,
        converted: convertedTotal,
        conversionRate: total ? Math.round((convertedTotal / total) * 100) : 0,
      },
      byMagnet,
      bySource,
      topSources: bySource.slice(0, 10),
      timeSeries,
      granularity: useWeekly ? "week" : "day",
      sourceOptions,
    });
  } catch (err) {
    console.error("Lead magnet analytics error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load lead magnet analytics" });
  }
});

router.get("/admin/lead-magnets", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(leadMagnetSubmissionsTable).orderBy(desc(leadMagnetSubmissionsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("Admin lead-magnets error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load lead magnet submissions" });
  }
});

router.get("/admin/lead-magnets/:id/pdf", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [row] = await db.select().from(leadMagnetSubmissionsTable).where(eq(leadMagnetSubmissionsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // Prefer the stored copy so admins see the exact PDF the user received.
    if (row.pdfStoragePath) {
      try {
        const file = await objectStorage.getObjectEntityFile(row.pdfStoragePath);
        const [buffer] = await file.download();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="lead-magnet-${row.id}.pdf"`);
        res.send(buffer);
        return;
      } catch (err) {
        if (!(err instanceof ObjectNotFoundError)) {
          console.error("[Admin] PDF fetch error:", err);
        }
      }
    }

    // Fallback: regenerate from the same template.
    if (PDF_MAGNETS.has(row.magnet as LeadMagnetPdfKey)) {
      const { buffer, filename } = await generateLeadMagnetPdf(row.magnet as LeadMagnetPdfKey);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
      return;
    }
    res.status(404).json({ error: "not_found", message: "No PDF available for this submission" });
  } catch (err) {
    console.error("Admin lead-magnet PDF error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to fetch PDF" });
  }
});

router.get("/admin/lead-magnets/sequences", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const pauseStates = await getAllSequencePauseStates();
    const summary = (Object.keys(SEQUENCES) as LeadMagnetKey[]).map((magnet) => ({
      magnet,
      paused: pauseStates[magnet] || false,
      steps: SEQUENCES[magnet].map(s => ({ step: s.step, delayDays: s.delayDays, subject: s.subject, intro: s.intro })),
    }));
    res.json(summary);
  } catch (err) {
    console.error("Admin lead-magnets sequences error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load sequences" });
  }
});

router.patch("/admin/lead-magnets/sequences/:magnet", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const magnet = req.params.magnet as LeadMagnetKey;
    if (!ALLOWED_MAGNETS.has(magnet)) { res.status(400).json({ error: "invalid_magnet" }); return; }
    const paused = !!req.body?.paused;
    await setSequencePaused(magnet, paused);
    res.json({ magnet, paused: await isSequencePaused(magnet) });
  } catch (err) {
    console.error("Admin lead-magnets pause error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update sequence" });
  }
});

router.get("/admin/lead-magnets/sequences/:magnet/steps", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const magnet = req.params.magnet as LeadMagnetKey;
    if (!ALLOWED_MAGNETS.has(magnet)) { res.status(400).json({ error: "invalid_magnet" }); return; }
    const steps = await loadStepViews(magnet);
    res.json({ magnet, steps });
  } catch (err) {
    console.error("Admin sequence steps load error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load sequence steps" });
  }
});

router.put("/admin/lead-magnets/sequences/:magnet/steps/:step", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const magnet = req.params.magnet as LeadMagnetKey;
    const step = parseInt(req.params.step as string, 10);
    if (!ALLOWED_MAGNETS.has(magnet)) { res.status(400).json({ error: "invalid_magnet" }); return; }
    if (!Number.isFinite(step) || step <= 0) { res.status(400).json({ error: "invalid_step" }); return; }

    const { delayDays, subject, intro, bodyHtml } = req.body ?? {};
    const fields: { delayDays?: number; subject?: string; intro?: string; bodyHtml?: string } = {};

    if (delayDays !== undefined) {
      const d = Number(delayDays);
      if (!Number.isFinite(d) || d < 0 || d > 365) { res.status(400).json({ error: "invalid_delay" }); return; }
      fields.delayDays = Math.floor(d);
    }
    if (typeof subject === "string") {
      if (!subject.trim()) { res.status(400).json({ error: "subject_required" }); return; }
      if (subject.length > 500) { res.status(400).json({ error: "subject_too_long" }); return; }
      fields.subject = subject;
    }
    if (typeof intro === "string") {
      if (intro.length > 1000) { res.status(400).json({ error: "intro_too_long" }); return; }
      fields.intro = intro;
    }
    if (typeof bodyHtml === "string") {
      if (!bodyHtml.trim()) { res.status(400).json({ error: "body_required" }); return; }
      if (bodyHtml.length > 50_000) { res.status(400).json({ error: "body_too_long" }); return; }
      fields.bodyHtml = bodyHtml;
    }

    const view = await upsertStepOverride(magnet, step, fields);
    if (!view) { res.status(404).json({ error: "not_found", message: "No such default step" }); return; }
    res.json(view);
  } catch (err) {
    console.error("Admin sequence step upsert error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to save step" });
  }
});

router.delete("/admin/lead-magnets/sequences/:magnet/steps/:step", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const magnet = req.params.magnet as LeadMagnetKey;
    const step = parseInt(req.params.step as string, 10);
    if (!ALLOWED_MAGNETS.has(magnet)) { res.status(400).json({ error: "invalid_magnet" }); return; }
    if (!Number.isFinite(step) || step <= 0) { res.status(400).json({ error: "invalid_step" }); return; }
    const view = await resetStepOverride(magnet, step);
    if (!view) { res.status(404).json({ error: "not_found" }); return; }
    res.json(view);
  } catch (err) {
    console.error("Admin sequence step reset error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to reset step" });
  }
});

router.post("/admin/lead-magnets/sequences/:magnet/steps/:step/preview", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const magnet = req.params.magnet as LeadMagnetKey;
    const step = parseInt(req.params.step as string, 10);
    if (!ALLOWED_MAGNETS.has(magnet)) { res.status(400).json({ error: "invalid_magnet" }); return; }
    if (!Number.isFinite(step) || step <= 0) { res.status(400).json({ error: "invalid_step" }); return; }

    const { name, bodyHtml, subject } = req.body ?? {};
    const baseUrl = siteBaseUrl(req);
    const sampleName = (typeof name === "string" && name.trim()) ? name.trim().slice(0, 80) : "Sample Recipient";
    const unsubUrl = `${baseUrl}/api/lead-magnets/unsubscribe?token=preview`;

    if (typeof bodyHtml === "string") {
      // Inline preview of unsaved edits.
      const PLACEHOLDER_RE = /\{\{\s*(name|baseUrl|unsubUrl)\s*\}\}/g;
      const ctx: Record<string, string> = { name: sampleName, baseUrl, unsubUrl };
      const html = bodyHtml.replace(PLACEHOLDER_RE, (_, k: string) => ctx[k] ?? "");
      res.json({
        magnet, step,
        subject: typeof subject === "string" && subject.trim() ? subject : "(unsaved subject)",
        html,
      });
      return;
    }

    const rendered = await previewStep(magnet, step, { name: sampleName, baseUrl, unsubUrl });
    if (!rendered) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ magnet, step, subject: rendered.subject, html: rendered.html });
  } catch (err) {
    console.error("Admin sequence step preview error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to render preview" });
  }
});

router.get("/admin/lead-magnets/:id/sequence", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const sends = await db.select().from(leadMagnetSequenceSendsTable)
      .where(eq(leadMagnetSequenceSendsTable.submissionId, id));
    res.json(sends);
  } catch (err) {
    console.error("Admin lead-magnet sequence sends error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load sequence sends" });
  }
});

router.delete("/admin/lead-magnets/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(leadMagnetSubmissionsTable).where(eq(leadMagnetSubmissionsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete lead-magnet error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to delete submission" });
  }
});

export default router;
