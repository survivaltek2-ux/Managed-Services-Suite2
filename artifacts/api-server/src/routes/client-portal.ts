import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { eq, and, isNull, ne, desc, sql } from "drizzle-orm";
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

    // Plans: a valid portal token must always carry a planId. Without it we have no
    // safe scope boundary and refuse to return any plans rather than exposing all
    // records for the email address.
    // Never expose reviewToken — that field must stay server-side only.
    let plans: Array<{
      id: number;
      planNumber: string | null;
      status: string | null;
      clientCompany: string | null;
      planContent: unknown;
      approvedAt: Date | null;
      sentAt: Date | null;
      validityDays: number | null;
      expiresAt: Date | null;
    }> = [];
    if (tokenRow.planId != null) {
      plans = await db.select({
        id: writtenPlansTable.id,
        planNumber: writtenPlansTable.planNumber,
        status: writtenPlansTable.status,
        clientCompany: writtenPlansTable.clientCompany,
        planContent: writtenPlansTable.planContent,
        approvedAt: writtenPlansTable.approvedAt,
        sentAt: writtenPlansTable.sentAt,
        validityDays: writtenPlansTable.validityDays,
        expiresAt: writtenPlansTable.expiresAt,
      }).from(writtenPlansTable)
        .where(and(
          eq(writtenPlansTable.id, tokenRow.planId),
          eq(writtenPlansTable.clientEmail, tokenRow.clientEmail),
        ))
        .limit(1);
    }

    // Tickets — only query when we have a partnerId to scope the results.
    // Without a partner constraint we cannot safely limit cross-partner data.
    let openTickets = 0;
    let recentTickets: Array<{ id: number; subject: string; status: string; createdAt: Date | null }> = [];
    if (tokenRow.partnerId != null) {
      try {
        const tcountRow = await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM tickets t
          JOIN users u ON u.id = t.user_id
          WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
            AND t.partner_id = ${tokenRow.partnerId}
            AND t.status NOT IN ('closed','resolved')
        `);
        openTickets = (tcountRow.rows?.[0] as any)?.c ?? 0;
        const trecentRows = await db.execute(sql`
          SELECT t.id, t.subject, t.status, t.created_at as "createdAt"
          FROM tickets t
          JOIN users u ON u.id = t.user_id
          WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
            AND t.partner_id = ${tokenRow.partnerId}
          ORDER BY t.created_at DESC
          LIMIT 3
        `);
        recentTickets = (trecentRows.rows as any[]).map(r => ({ id: r.id, subject: r.subject, status: r.status, createdAt: r.createdAt }));
      } catch (e) {
        // tickets join failed (schema mismatch); leave as zero
      }
    }

    // Invoices — only query when we have a partnerId to scope the results.
    let recentInvoices: Array<{ id: number; invoiceNumber: string; status: string; total: string | number; dueDate: Date | null; paidAt: Date | null }> = [];
    if (tokenRow.partnerId != null) {
      try {
        const invRows = await db.execute(sql`
          SELECT i.id, i.invoice_number as "invoiceNumber", i.status, i.total, i.due_date as "dueDate", i.paid_at as "paidAt"
          FROM invoices i
          JOIN users u ON u.id = i.user_id
          WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
            AND i.partner_id = ${tokenRow.partnerId}
          ORDER BY i.created_at DESC
          LIMIT 5
        `);
        recentInvoices = invRows.rows as any[];
      } catch {}
    }

    // Active subscription — only query when we have a partnerId to scope the results.
    let currentSubscription: { planName: string; status: string; amount: string | number | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean } | null = null;
    if (tokenRow.partnerId != null) {
      try {
        const subRows = await db.execute(sql`
          SELECT s.plan_name as "planName", s.status, s.amount, s.current_period_end as "currentPeriodEnd", s.cancel_at_period_end as "cancelAtPeriodEnd"
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          WHERE LOWER(u.email) = LOWER(${tokenRow.clientEmail})
            AND s.partner_id = ${tokenRow.partnerId}
            AND s.status IN ('active','trialing','past_due')
          ORDER BY s.created_at DESC
          LIMIT 1
        `);
        currentSubscription = (subRows.rows?.[0] as any) ?? null;
      } catch {}
    }

    // Onboarding: must be scoped to the specific plan on the token.
    // Without a planId we cannot safely identify which onboarding record belongs
    // to this engagement, so we return null rather than leaking cross-engagement data.
    let onboarding: {
      id: number;
      status: string | null;
      currentStep: string | null;
      planId: number | null;
      startedAt: Date | null;
      completedAt: Date | null;
    } | undefined;
    if (tokenRow.planId != null) {
      [onboarding] = await db.select({
        id: clientOnboardingTable.id,
        status: clientOnboardingTable.status,
        currentStep: clientOnboardingTable.currentStep,
        planId: clientOnboardingTable.planId,
        startedAt: clientOnboardingTable.startedAt,
        completedAt: clientOnboardingTable.completedAt,
      }).from(clientOnboardingTable)
        .where(and(
          eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail),
          eq(clientOnboardingTable.planId, tokenRow.planId),
        ))
        .orderBy(desc(clientOnboardingTable.createdAt))
        .limit(1);
    }

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
    // Fail closed: without a planId we cannot safely scope the onboarding record.
    if (tokenRow.planId == null) { res.status(403).json({ error: "insufficient_scope" }); return; }
    const [onboarding] = await db.select().from(clientOnboardingTable)
      .where(and(
        eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail),
        eq(clientOnboardingTable.planId, tokenRow.planId),
      ))
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
    // Fail closed: without a planId we cannot safely scope the onboarding record.
    if (tokenRow.planId == null) { res.status(403).json({ error: "insufficient_scope" }); return; }
    const { currentStep, stepData, complete } = req.body as {
      currentStep?: OnboardingStep;
      stepData?: Record<string, unknown>;
      complete?: boolean;
    };
    if (currentStep && !ONBOARDING_STEPS.includes(currentStep)) {
      res.status(400).json({ error: "invalid_step" }); return;
    }
    const [existing] = await db.select().from(clientOnboardingTable)
      .where(and(
        eq(clientOnboardingTable.clientEmail, tokenRow.clientEmail),
        eq(clientOnboardingTable.planId, tokenRow.planId),
      ))
      .orderBy(desc(clientOnboardingTable.createdAt))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "no_onboarding" }); return; }
    // Fail closed once onboarding has reached its terminal state. Without this
    // check the same portal token could continue to overwrite primary contact,
    // billing, address, PO, kickoff, and notes fields long after staff
    // believed the workflow was finished — silently misrouting invoices and
    // service communications.
    if (existing.status === "completed") {
      res.status(409).json({
        error: "onboarding_completed",
        message: "Onboarding is already complete and can no longer be modified through this link.",
      });
      return;
    }
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
    // Atomic guard against the TOCTOU race where two concurrent PATCH
    // requests both observe `in_progress` but one of them lands after the
    // other has already set `status = 'completed'`. The status guard in the
    // WHERE clause makes the write reject any update that would mutate a
    // record which is already complete, regardless of what the earlier read
    // returned.
    const [updated] = await db.update(clientOnboardingTable)
      .set(updates as any)
      .where(and(
        eq(clientOnboardingTable.id, existing.id),
        ne(clientOnboardingTable.status, "completed"),
      ))
      .returning();
    if (!updated) {
      res.status(409).json({
        error: "onboarding_completed",
        message: "Onboarding completed concurrently and can no longer be modified through this link.",
      });
      return;
    }

    // When onboarding completes, retire the portal token so the same URL can
    // no longer be replayed against either the dashboard or this onboarding
    // endpoint. Treating the link as a single-purpose, narrowly scoped
    // capability avoids it functioning as a long-lived account credential.
    if (complete && updated.status === "completed") {
      await db.update(clientPortalTokensTable)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(clientPortalTokensTable.id, tokenRow.id),
          isNull(clientPortalTokensTable.revokedAt),
        ));
    }

    res.json({ onboarding: updated });
  } catch (err) {
    console.error("[ClientPortal] onboarding patch error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
