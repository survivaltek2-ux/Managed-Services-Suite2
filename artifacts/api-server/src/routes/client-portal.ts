import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  clientPortalTokensTable,
  clientOnboardingTable,
  writtenPlansTable,
  partnersTable,
} from "@workspace/db";

const router: IRouter = Router();

const ONBOARDING_STEPS = ["welcome", "contacts", "billing", "kickoff", "complete"] as const;
type OnboardingStep = typeof ONBOARDING_STEPS[number];

export function generateClientToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function issueClientPortalToken(params: {
  partnerId: number | null;
  planId: number | null;
  clientEmail: string;
  clientName: string;
  clientCompany: string;
  ttlDays?: number;
}) {
  // Revoke all previous active tokens for this client email before issuing a new one
  await db.update(clientPortalTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(clientPortalTokensTable.clientEmail, params.clientEmail),
      isNull(clientPortalTokensTable.revokedAt),
    ));

  const token = generateClientToken();
  const expiresAt = new Date(Date.now() + (params.ttlDays ?? 30) * 86400000);
  const [row] = await db.insert(clientPortalTokensTable).values({
    token,
    partnerId: params.partnerId,
    planId: params.planId,
    clientEmail: params.clientEmail,
    clientName: params.clientName,
    clientCompany: params.clientCompany,
    expiresAt,
  }).returning();
  return row;
}

async function loadTokenRow(token: string) {
  const [row] = await db.select().from(clientPortalTokensTable)
    .where(eq(clientPortalTokensTable.token, token)).limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  // touch last_used_at (non-blocking)
  db.update(clientPortalTokensTable).set({ lastUsedAt: new Date() })
    .where(eq(clientPortalTokensTable.id, row.id)).execute().catch(() => {});
  return row;
}

router.get("/public/client-portal/:token", async (req: Request, res: Response) => {
  try {
    const tokenRow = await loadTokenRow(req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "invalid_or_expired" }); return; }

    // Account manager (partner)
    let accountManager: { name: string; email: string; phone: string | null; companyName: string | null } | null = null;
    if (tokenRow.partnerId) {
      const [p] = await db.select().from(partnersTable).where(eq(partnersTable.id, tokenRow.partnerId)).limit(1);
      if (p) {
        accountManager = {
          name: p.contactName || p.companyName || "",
          email: p.email || "",
          phone: p.phone ?? null,
          companyName: p.companyName ?? null,
        };
      }
    }

    // Plans for this client (by email)
    const plans = await db.select({
      id: writtenPlansTable.id,
      planNumber: writtenPlansTable.planNumber,
      status: writtenPlansTable.status,
      clientCompany: writtenPlansTable.clientCompany,
      planContent: writtenPlansTable.planContent,
      approvedAt: writtenPlansTable.approvedAt,
      sentAt: writtenPlansTable.sentAt,
      reviewToken: writtenPlansTable.reviewToken,
      validityDays: writtenPlansTable.validityDays,
      expiresAt: writtenPlansTable.expiresAt,
    }).from(writtenPlansTable)
      .where(eq(writtenPlansTable.clientEmail, tokenRow.clientEmail))
      .orderBy(desc(writtenPlansTable.createdAt))
      .limit(10);

    // Tickets (by clientEmail-as-creator OR linked user — tickets table uses userId so we need to look up by email->user later; for now skip if no user join available)
    let openTickets = 0;
    let recentTickets: Array<{ id: number; subject: string; status: string; createdAt: Date | null }> = [];
    try {
      const tcountRow = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM tickets t
        JOIN users u ON u.id = t.user_id
        WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
          AND t.status NOT IN ('closed','resolved')
      `);
      openTickets = (tcountRow.rows?.[0] as any)?.c ?? 0;
      const trecentRows = await db.execute(sql`
        SELECT t.id, t.subject, t.status, t.created_at as "createdAt"
        FROM tickets t
        JOIN users u ON u.id = t.user_id
        WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
        ORDER BY t.created_at DESC
        LIMIT 3
      `);
      recentTickets = (trecentRows.rows as any[]).map(r => ({ id: r.id, subject: r.subject, status: r.status, createdAt: r.createdAt }));
    } catch (e) {
      // tickets join failed (schema mismatch); leave as zero
    }

    // Invoices (by client email via users join)
    let recentInvoices: Array<{ id: number; invoiceNumber: string; status: string; total: string | number; dueDate: Date | null; paidAt: Date | null }> = [];
    try {
      const invRows = await db.execute(sql`
        SELECT i.id, i.invoice_number as "invoiceNumber", i.status, i.total, i.due_date as "dueDate", i.paid_at as "paidAt"
        FROM invoices i
        JOIN users u ON u.id = i.user_id
        WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
        ORDER BY i.created_at DESC
        LIMIT 5
      `);
      recentInvoices = invRows.rows as any[];
    } catch {}

    // Active subscription
    let currentSubscription: { planName: string; status: string; amount: string | number | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean } | null = null;
    try {
      const subRows = await db.execute(sql`
        SELECT s.plan_name as "planName", s.status, s.amount, s.current_period_end as "currentPeriodEnd", s.cancel_at_period_end as "cancelAtPeriodEnd"
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
          AND s.status IN ('active','trialing','past_due')
        ORDER BY s.created_at DESC
        LIMIT 1
      `);
      currentSubscription = (subRows.rows?.[0] as any) ?? null;
    } catch {}

    // Onboarding: scope to the plan this token was issued for when possible
    const onboardingWhere = tokenRow.planId != null
      ? and(eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail), eq(clientOnboardingTable.planId, tokenRow.planId))
      : eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail);
    const [onboarding] = await db.select({
      id: clientOnboardingTable.id,
      status: clientOnboardingTable.status,
      currentStep: clientOnboardingTable.currentStep,
      planId: clientOnboardingTable.planId,
      startedAt: clientOnboardingTable.startedAt,
      completedAt: clientOnboardingTable.completedAt,
    }).from(clientOnboardingTable)
      .where(onboardingWhere)
      .orderBy(desc(clientOnboardingTable.createdAt))
      .limit(1);

    res.json({
      client: {
        name: tokenRow.clientName,
        email: tokenRow.clientEmail,
        company: tokenRow.clientCompany,
      },
      accountManager,
      plans,
      tickets: { open: openTickets, recent: recentTickets },
      invoices: recentInvoices,
      subscription: currentSubscription,
      onboarding: onboarding ?? null,
    });
  } catch (err) {
    console.error("[ClientPortal] dashboard error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/public/client-portal/:token/onboarding", async (req: Request, res: Response) => {
  try {
    const tokenRow = await loadTokenRow(req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "invalid_or_expired" }); return; }
    const onboardingWhere = tokenRow.planId != null
      ? and(eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail), eq(clientOnboardingTable.planId, tokenRow.planId))
      : eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail);
    const [onboarding] = await db.select().from(clientOnboardingTable)
      .where(onboardingWhere)
      .orderBy(desc(clientOnboardingTable.createdAt))
      .limit(1);
    if (!onboarding) { res.status(404).json({ error: "no_onboarding" }); return; }
    res.json({ onboarding, client: { name: tokenRow.clientName, email: tokenRow.clientEmail, company: tokenRow.clientCompany } });
  } catch (err) {
    console.error("[ClientPortal] onboarding get error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/public/client-portal/:token/onboarding", async (req: Request, res: Response) => {
  try {
    const tokenRow = await loadTokenRow(req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "invalid_or_expired" }); return; }
    const { currentStep, stepData, complete } = req.body as {
      currentStep?: OnboardingStep;
      stepData?: Record<string, unknown>;
      complete?: boolean;
    };
    if (currentStep && !ONBOARDING_STEPS.includes(currentStep)) {
      res.status(400).json({ error: "invalid_step" }); return;
    }
    const patchOnboardingWhere = tokenRow.planId != null
      ? and(eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail), eq(clientOnboardingTable.planId, tokenRow.planId))
      : eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail);
    const [existing] = await db.select().from(clientOnboardingTable)
      .where(patchOnboardingWhere)
      .orderBy(desc(clientOnboardingTable.createdAt))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "no_onboarding" }); return; }
    const mergedStepData = stepData
      ? { ...((existing.stepData as Record<string, unknown>) ?? {}), ...stepData }
      : existing.stepData;
    const updates: Record<string, unknown> = {
      stepData: mergedStepData,
      updatedAt: new Date(),
    };
    if (currentStep) updates.currentStep = currentStep;
    if (complete) {
      updates.status = "completed";
      updates.currentStep = "complete";
      updates.completedAt = new Date();
    }
    const [updated] = await db.update(clientOnboardingTable)
      .set(updates as any)
      .where(eq(clientOnboardingTable.id, existing.id))
      .returning();
    res.json({ onboarding: updated });
  } catch (err) {
    console.error("[ClientPortal] onboarding patch error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
