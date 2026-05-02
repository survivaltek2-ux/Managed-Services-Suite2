import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { sql, desc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  partnersTable,
  partnerCommissionsTable,
  partnerstackConfigsTable,
  partnerstackWebhookEventsTable,
  partnerstackSyncLogTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth.js";
import {
  isPartnerstackConfigured,
  ping,
  listPartners,
  listTransactions,
  upsertPartnerByEmail,
  createTransaction,
  type PsPartner,
  type PsTransaction,
} from "../services/partnerstack.js";

const router: IRouter = Router();

// ─── Config helpers ──────────────────────────────────────────────────────────

async function getOrCreateConfig() {
  const rows = await db.select().from(partnerstackConfigsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(partnerstackConfigsTable).values({}).returning();
  return created;
}

async function setConfigError(message: string) {
  const cfg = await getOrCreateConfig();
  await db.update(partnerstackConfigsTable).set({
    lastError: message.slice(0, 500),
    lastErrorAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(partnerstackConfigsTable.id, cfg.id));
}

async function clearConfigError() {
  const cfg = await getOrCreateConfig();
  if (cfg.lastError) {
    await db.update(partnerstackConfigsTable).set({
      lastError: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    }).where(eq(partnerstackConfigsTable.id, cfg.id));
  }
}

async function recordSyncRun(entry: {
  direction: "push" | "pull";
  kind: "partner" | "transaction" | "full_sync";
  success: boolean;
  partnerCount?: number;
  transactionCount?: number;
  message?: string | null;
}) {
  try {
    await db.insert(partnerstackSyncLogTable).values({
      direction: entry.direction,
      kind: entry.kind,
      success: entry.success,
      partnerCount: entry.partnerCount ?? 0,
      transactionCount: entry.transactionCount ?? 0,
      message: entry.message ? entry.message.slice(0, 500) : null,
    });
  } catch (err) {
    console.error("[PartnerStack] Failed to record sync log:", err);
  }
}

// ─── Outbound push helpers (called from partners.ts) ────────────────────────

function splitName(contactName: string): { first: string; last: string } {
  const parts = (contactName || "").trim().split(/\s+/);
  if (parts.length === 0) return { first: "Partner", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export async function pushPartnerToPartnerstack(partnerId: number): Promise<void> {
  if (!isPartnerstackConfigured()) return;
  try {
    const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, partnerId)).limit(1);
    if (!partner) return;

    const { first, last } = splitName(partner.contactName);
    const ps = await upsertPartnerByEmail({
      email: partner.email,
      first_name: first,
      last_name: last,
      company: partner.companyName,
      state: partner.status === "approved" ? "approved" : "pending",
    });

    await db.update(partnersTable).set({
      partnerstackKey: ps.key,
      partnerstackSyncedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(partnersTable.id, partner.id));

    const cfg = await getOrCreateConfig();
    await db.update(partnerstackConfigsTable).set({
      lastPushAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(partnerstackConfigsTable.id, cfg.id));
    await clearConfigError();
    console.log(`[PartnerStack] Pushed partner #${partner.id} → ${ps.key}`);
    await recordSyncRun({ direction: "push", kind: "partner", success: true, partnerCount: 1, message: `Partner #${partner.id} → ${ps.key}` });
  } catch (err: any) {
    const msg = `Push partner #${partnerId} failed: ${err.message || err}`;
    console.error(`[PartnerStack] ${msg}`);
    await setConfigError(msg).catch(() => {});
    await recordSyncRun({ direction: "push", kind: "partner", success: false, message: msg });
  }
}

export async function pushCommissionToPartnerstack(commissionId: number): Promise<void> {
  if (!isPartnerstackConfigured()) return;
  try {
    const [commission] = await db.select().from(partnerCommissionsTable)
      .where(eq(partnerCommissionsTable.id, commissionId)).limit(1);
    if (!commission) return;
    if (commission.partnerstackKey) return; // already pushed

    const [partner] = await db.select().from(partnersTable)
      .where(eq(partnersTable.id, commission.partnerId)).limit(1);
    if (!partner?.partnerstackKey) {
      console.log(`[PartnerStack] Skipping commission #${commissionId} — partner not synced yet`);
      return;
    }

    const tx = await createTransaction({
      partnership_key: partner.partnerstackKey,
      amount: parseFloat(String(commission.amount)),
      description: commission.description || `Commission #${commission.id}`,
      external_key: `commission_${commission.id}`,
    });

    await db.update(partnerCommissionsTable).set({
      partnerstackKey: tx.key,
      partnerstackSyncedAt: new Date(),
    }).where(eq(partnerCommissionsTable.id, commission.id));

    const cfg = await getOrCreateConfig();
    await db.update(partnerstackConfigsTable).set({
      lastPushAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(partnerstackConfigsTable.id, cfg.id));
    await clearConfigError();
    console.log(`[PartnerStack] Pushed commission #${commission.id} → ${tx.key}`);
    await recordSyncRun({ direction: "push", kind: "transaction", success: true, transactionCount: 1, message: `Commission #${commission.id} → ${tx.key}` });
  } catch (err: any) {
    const msg = `Push commission #${commissionId} failed: ${err.message || err}`;
    console.error(`[PartnerStack] ${msg}`);
    await setConfigError(msg).catch(() => {});
    await recordSyncRun({ direction: "push", kind: "transaction", success: false, message: msg });
  }
}

// ─── Inbound reconciliation ──────────────────────────────────────────────────

async function upsertPartnerFromPs(ps: PsPartner): Promise<void> {
  const company = ps.company || `${ps.first_name ?? ""} ${ps.last_name ?? ""}`.trim() || ps.email;
  const contactName = `${ps.first_name ?? ""} ${ps.last_name ?? ""}`.trim() || ps.email;

  // Find by partnerstack_key first, then fall back to email.
  let [existing] = await db.select().from(partnersTable)
    .where(eq(partnersTable.partnerstackKey, ps.key)).limit(1);
  if (!existing) {
    const [byEmail] = await db.select().from(partnersTable)
      .where(eq(partnersTable.email, ps.email)).limit(1);
    if (byEmail) existing = byEmail;
  }

  const mappedStatus: "approved" | "rejected" | "suspended" | "pending" =
    ps.state === "approved" ? "approved" :
    ps.state === "rejected" ? "rejected" :
    ps.state === "suspended" ? "suspended" :
    "pending";

  if (existing) {
    const update: Partial<typeof partnersTable.$inferInsert> = {
      partnerstackKey: ps.key,
      partnerstackSyncedAt: new Date(),
      updatedAt: new Date(),
    };
    // Only update status if PartnerStack approved/rejected/suspended (avoid overwriting local edits with "pending").
    if (ps.state === "approved" || ps.state === "rejected" || ps.state === "suspended") {
      update.status = mappedStatus;
    }
    await db.update(partnersTable).set(update).where(eq(partnersTable.id, existing.id));
    return;
  }

  // New partner from PartnerStack — insert with a placeholder password (they'd reset to log in).
  const placeholderHash = crypto.randomBytes(32).toString("hex");
  await db.insert(partnersTable).values({
    companyName: company,
    contactName,
    email: ps.email,
    password: placeholderHash,
    status: mappedStatus,
    partnerstackKey: ps.key,
    partnerstackSyncedAt: new Date(),
  }).onConflictDoNothing();
}

async function upsertCommissionFromPs(tx: PsTransaction): Promise<void> {
  // Find local partner by partnerstack_key.
  const [partner] = await db.select().from(partnersTable)
    .where(eq(partnersTable.partnerstackKey, tx.partnership_key)).limit(1);
  if (!partner) {
    console.log(`[PartnerStack] Skipping transaction ${tx.key} — no local partner for ${tx.partnership_key}`);
    return;
  }

  const [existing] = await db.select().from(partnerCommissionsTable)
    .where(eq(partnerCommissionsTable.partnerstackKey, tx.key)).limit(1);

  const mappedStatus: "paid" | "approved" | "rejected" | "pending" =
    tx.state === "paid" ? "paid" :
    tx.state === "approved" ? "approved" :
    tx.state === "declined" ? "rejected" :
    "pending";

  if (existing) {
    await db.update(partnerCommissionsTable).set({
      amount: tx.amount.toFixed(2),
      status: mappedStatus,
      partnerstackSyncedAt: new Date(),
    }).where(eq(partnerCommissionsTable.id, existing.id));
    return;
  }

  await db.insert(partnerCommissionsTable).values({
    partnerId: partner.id,
    type: "partnerstack",
    description: tx.description || `PartnerStack transaction ${tx.key}`,
    amount: tx.amount.toFixed(2),
    status: mappedStatus,
    partnerstackKey: tx.key,
    partnerstackSyncedAt: new Date(),
  });
}

async function runFullSync(): Promise<{ partnersPulled: number; transactionsPulled: number }> {
  if (!isPartnerstackConfigured()) {
    throw new Error("PartnerStack credentials are not configured");
  }
  const cfg = await getOrCreateConfig();
  const since = cfg.lastPullAt ?? undefined;

  const [partners, transactions] = await Promise.all([
    listPartners(since),
    listTransactions(since),
  ]);

  for (const p of partners) {
    try { await upsertPartnerFromPs(p); }
    catch (err) { console.error(`[PartnerStack] upsert partner ${p.key} failed:`, err); }
  }
  for (const t of transactions) {
    try { await upsertCommissionFromPs(t); }
    catch (err) { console.error(`[PartnerStack] upsert transaction ${t.key} failed:`, err); }
  }

  // Push any approved local partners that don't yet have a partnerstack_key.
  const unpushedPartners = await db.select({ id: partnersTable.id }).from(partnersTable)
    .where(sql`${partnersTable.status} = 'approved' AND ${partnersTable.partnerstackKey} IS NULL`);
  for (const u of unpushedPartners.slice(0, 20)) {
    await pushPartnerToPartnerstack(u.id);
  }

  // Push any local commissions whose partner is synced but the commission itself isn't.
  // This makes "Sync Now" a true push + pull and recovers from any earlier transient errors.
  const unpushedCommissions = await db.select({ id: partnerCommissionsTable.id })
    .from(partnerCommissionsTable)
    .innerJoin(partnersTable, eq(partnersTable.id, partnerCommissionsTable.partnerId))
    .where(sql`${partnerCommissionsTable.partnerstackKey} IS NULL AND ${partnersTable.partnerstackKey} IS NOT NULL`);
  for (const c of unpushedCommissions.slice(0, 50)) {
    await pushCommissionToPartnerstack(c.id);
  }

  await db.update(partnerstackConfigsTable).set({
    lastPullAt: new Date(),
    totalPartnersSynced: (cfg.totalPartnersSynced || 0) + partners.length,
    totalCommissionsSynced: (cfg.totalCommissionsSynced || 0) + transactions.length,
    updatedAt: new Date(),
  }).where(eq(partnerstackConfigsTable.id, cfg.id));
  await clearConfigError();
  await recordSyncRun({
    direction: "pull",
    kind: "full_sync",
    success: true,
    partnerCount: partners.length,
    transactionCount: transactions.length,
    message: `Pulled ${partners.length} partners + ${transactions.length} transactions`,
  });

  return { partnersPulled: partners.length, transactionsPulled: transactions.length };
}

// ─── Polling scheduler ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const PARTNERSTACK_LOCK_ID = 202604212;

interface AdvisoryLockRow extends Record<string, unknown> { acquired: boolean }
function readLockRow(result: unknown): AdvisoryLockRow | undefined {
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: AdvisoryLockRow[] }).rows;
    return rows?.[0];
  }
  return undefined;
}

async function pollOnce(): Promise<void> {
  if (!isPartnerstackConfigured()) return;
  try {
    await db.transaction(async (tx) => {
      const lockResult = await tx.execute<AdvisoryLockRow>(
        sql`SELECT pg_try_advisory_xact_lock(${PARTNERSTACK_LOCK_ID}) AS acquired`
      );
      const lockRow = readLockRow(lockResult);
      if (!lockRow?.acquired) return;
      const result = await runFullSync();
      console.log(`[PartnerStack] Poll OK — partners=${result.partnersPulled}, transactions=${result.transactionsPulled}`);
    });
  } catch (err: any) {
    const msg = `Polling failed: ${err.message || err}`;
    console.error("[PartnerStack] Poll error:", err.message || err);
    await setConfigError(msg).catch(() => {});
    await recordSyncRun({ direction: "pull", kind: "full_sync", success: false, message: msg });
  }
}

let pollTimer: NodeJS.Timeout | null = null;
export function startPartnerstackScheduler() {
  if (pollTimer) return;
  // Boot-time run (delayed so DB migrations finish first), then interval.
  setTimeout(() => { pollOnce().catch(() => {}); }, 8000);
  pollTimer = setInterval(() => { pollOnce().catch(() => {}); }, POLL_INTERVAL_MS);
  console.log("[PartnerStack] Polling scheduler started (every 30 min)");
}

// ─── Webhook receiver ────────────────────────────────────────────────────────

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = process.env.PARTNERSTACK_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // Allow either raw hex or "sha256=..." prefix.
  const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

router.post("/webhooks/partnerstack", async (req: Request, res: Response) => {
  // Secure-by-default: if no webhook secret is configured, reject every inbound
  // request rather than processing unsigned payloads. This prevents anyone on
  // the internet from forging events into the partner/commission tables.
  if (!process.env.PARTNERSTACK_WEBHOOK_SECRET) {
    console.warn("[PartnerStack Webhook] Rejecting — PARTNERSTACK_WEBHOOK_SECRET is not configured");
    res.status(503).json({ error: "webhook_not_configured" });
    return;
  }

  const sig = (req.headers["x-partnerstack-signature"] as string)
    || (req.headers["x-ps-signature"] as string)
    || undefined;

  const raw = req.rawBody;
  if (!raw) {
    res.status(400).json({ error: "missing_raw_body" });
    return;
  }

  if (!verifySignature(raw, sig)) {
    console.warn("[PartnerStack Webhook] Invalid signature");
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const payload: any = req.body || {};
  const eventId: string = payload.id || payload.event_id || `${payload.type ?? "unknown"}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const eventType: string = payload.type || payload.event || "unknown";

  // Dedupe + record
  try {
    await db.insert(partnerstackWebhookEventsTable).values({
      eventId,
      eventType,
      status: "received",
      rawPayload: raw.toString("utf8").slice(0, 50000),
    });
  } catch (err: any) {
    if (String(err.message || err).includes("duplicate")) {
      res.json({ received: true, deduped: true });
      return;
    }
    console.error("[PartnerStack Webhook] Failed to record event:", err);
  }

  // Always ack 200 so PartnerStack stops retrying. Process best-effort.
  res.json({ received: true });

  try {
    const data = payload.data ?? payload;
    switch (eventType) {
      case "partner.created":
      case "partner.approved":
      case "partner.updated":
      case "partner.rejected":
      case "partnership.created":
      case "partnership.updated":
        if (data && data.email && data.key) {
          await upsertPartnerFromPs(data as PsPartner);
        }
        break;
      case "transaction.created":
      case "transaction.updated":
      case "transaction.declined":
      case "transaction.approved":
        if (data && data.partnership_key && data.key) {
          await upsertCommissionFromPs(data as PsTransaction);
        }
        break;
      default:
        console.log(`[PartnerStack Webhook] Unhandled event ${eventType}`);
    }

    await db.update(partnerstackWebhookEventsTable).set({
      status: "processed",
      processedAt: new Date(),
    }).where(eq(partnerstackWebhookEventsTable.eventId, eventId));
  } catch (err: any) {
    console.error(`[PartnerStack Webhook] Error processing ${eventType}:`, err);
    await db.update(partnerstackWebhookEventsTable).set({
      status: "failed",
      error: String(err.message || err).slice(0, 500),
      processedAt: new Date(),
    }).where(eq(partnerstackWebhookEventsTable.eventId, eventId)).catch(() => {});
  }
});

// ─── Admin endpoints ─────────────────────────────────────────────────────────

router.get("/admin/partnerstack/status", requireAdmin, async (_req: Request, res: Response) => {
  const cfg = await getOrCreateConfig();
  const configured = isPartnerstackConfigured();
  const webhookConfigured = Boolean(process.env.PARTNERSTACK_WEBHOOK_SECRET);

  const [{ count: syncedCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(partnersTable)
    .where(isNotNull(partnersTable.partnerstackKey));

  let connection: {
    ok: boolean;
    reachable: boolean;
    accountHint: string | null;
    sampleSize: number;
    error: string | null;
  } = {
    ok: false,
    reachable: false,
    accountHint: null,
    sampleSize: 0,
    error: configured ? null : "Credentials not configured",
  };

  if (configured) {
    try {
      const p = await ping();
      connection = {
        ok: true,
        reachable: true,
        accountHint: p.accountHint,
        sampleSize: p.sampleSize,
        error: null,
      };
    } catch (err: any) {
      connection = {
        ok: false,
        reachable: false,
        accountHint: null,
        sampleSize: 0,
        error: err.message || String(err),
      };
    }
  }

  res.json({
    configured,
    webhookConfigured,
    connection,
    config: {
      lastPushAt: cfg.lastPushAt,
      lastPullAt: cfg.lastPullAt,
      lastError: cfg.lastError,
      lastErrorAt: cfg.lastErrorAt,
      totalPartnersSynced: cfg.totalPartnersSynced,
      totalCommissionsSynced: cfg.totalCommissionsSynced,
    },
    syncedPartnerCount: syncedCount,
  });
});

router.get("/admin/partnerstack/sync-log", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db.select().from(partnerstackSyncLogTable)
    .orderBy(desc(partnerstackSyncLogTable.ranAt))
    .limit(50);
  res.json({ entries: rows });
});

router.post("/admin/partnerstack/sync", requireAdmin, async (_req: Request, res: Response) => {
  if (!isPartnerstackConfigured()) {
    res.status(503).json({ error: "not_configured", message: "PartnerStack credentials are not configured" });
    return;
  }
  try {
    const result = await runFullSync();
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[PartnerStack] Manual sync error:", err);
    await setConfigError(`Manual sync failed: ${err.message || err}`).catch(() => {});
    res.status(500).json({ error: "sync_failed", message: err.message || String(err) });
  }
});

router.get("/admin/partnerstack/partners", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db.select({
    id: partnersTable.id,
    companyName: partnersTable.companyName,
    contactName: partnersTable.contactName,
    email: partnersTable.email,
    status: partnersTable.status,
    partnerstackKey: partnersTable.partnerstackKey,
    partnerstackSyncedAt: partnersTable.partnerstackSyncedAt,
  }).from(partnersTable)
    .orderBy(desc(partnersTable.partnerstackSyncedAt))
    .limit(200);
  res.json({ partners: rows });
});

router.get("/admin/partnerstack/webhook-events", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db.select({
    id: partnerstackWebhookEventsTable.id,
    eventId: partnerstackWebhookEventsTable.eventId,
    eventType: partnerstackWebhookEventsTable.eventType,
    status: partnerstackWebhookEventsTable.status,
    error: partnerstackWebhookEventsTable.error,
    receivedAt: partnerstackWebhookEventsTable.receivedAt,
    processedAt: partnerstackWebhookEventsTable.processedAt,
  }).from(partnerstackWebhookEventsTable)
    .orderBy(desc(partnerstackWebhookEventsTable.receivedAt))
    .limit(50);
  res.json({ events: rows });
});

export default router;
