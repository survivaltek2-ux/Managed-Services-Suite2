/**
 * Admin endpoints for the Referral Network.
 *
 * All routes require partner-admin authentication (same credentials used for
 * the Partner Portal admin area). Mounted at /api/connectors/admin/*.
 *
 * Key operations:
 *  - List/search all connectors and their referrals
 *  - Update referral status, ACV, invoice-paid date → auto-computes reward
 *  - Manage payout records
 */
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { db, connectorsTable, connectorReferralsTable, connectorPayoutsTable } from "@workspace/db";
import { eq, desc, ilike, or, sql } from "drizzle-orm";
import { requirePartnerAuth, requirePartnerAdmin, type PartnerRequest } from "../middlewares/partnerAuth.js";
import { computeReward, computePayoutDates } from "../lib/connectorRewards.js";

const router: IRouter = Router();

const adminMiddleware = [requirePartnerAuth, requirePartnerAdmin];

// ─────────────────────────────────────────────────────────────────────────────
// List all connectors (with aggregate stats)
// GET /api/connectors/admin/connectors
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/connectors/admin/connectors",
  ...adminMiddleware,
  async (req: PartnerRequest, res: Response) => {
    try {
      const rows = await db
        .select({
          id: connectorsTable.id,
          email: connectorsTable.email,
          firstName: connectorsTable.firstName,
          lastName: connectorsTable.lastName,
          phone: connectorsTable.phone,
          city: connectorsTable.city,
          state: connectorsTable.state,
          occupation: connectorsTable.occupation,
          status: connectorsTable.status,
          totalReferrals: connectorsTable.totalReferrals,
          totalEarnedCents: connectorsTable.totalEarnedCents,
          createdAt: connectorsTable.createdAt,
        })
        .from(connectorsTable)
        .orderBy(desc(connectorsTable.createdAt));

      res.json({ connectors: rows });
    } catch (err) {
      console.error("[connectors-admin] list connectors error:", err);
      res.status(500).json({ error: "server_error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Update connector account status
// PATCH /api/connectors/admin/connectors/:id
// ─────────────────────────────────────────────────────────────────────────────
const UpdateConnectorSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "suspended"]),
});

router.patch(
  "/connectors/admin/connectors/:id",
  ...adminMiddleware,
  async (req: PartnerRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = UpdateConnectorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: parsed.error.message });
      return;
    }
    try {
      const [updated] = await db
        .update(connectorsTable)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(eq(connectorsTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ connector: updated });
    } catch (err) {
      console.error("[connectors-admin] update connector error:", err);
      res.status(500).json({ error: "server_error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// List all referrals (optionally filtered by connectorId or status)
// GET /api/connectors/admin/referrals
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/connectors/admin/referrals",
  ...adminMiddleware,
  async (req: PartnerRequest, res: Response) => {
    try {
      const rows = await db
        .select({
          referral: connectorReferralsTable,
          connectorEmail: connectorsTable.email,
          connectorFirstName: connectorsTable.firstName,
          connectorLastName: connectorsTable.lastName,
        })
        .from(connectorReferralsTable)
        .leftJoin(connectorsTable, eq(connectorReferralsTable.connectorId, connectorsTable.id))
        .orderBy(desc(connectorReferralsTable.createdAt));

      const referrals = rows.map(({ referral, connectorEmail, connectorFirstName, connectorLastName }) => ({
        ...referral,
        connectorEmail,
        connectorName: connectorFirstName && connectorLastName
          ? `${connectorFirstName} ${connectorLastName}`
          : connectorEmail,
      }));

      res.json({ referrals });
    } catch (err) {
      console.error("[connectors-admin] list referrals error:", err);
      res.status(500).json({ error: "server_error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Update referral pipeline state
// PATCH /api/connectors/admin/referrals/:id
//
// This is the core admin action. When status is moved to "won" and an ACV is
// provided, the reward is computed automatically. When firstInvoicePaidAt is
// set, payout/clawback dates are computed automatically.
// ─────────────────────────────────────────────────────────────────────────────
const UpdateReferralSchema = z.object({
  status: z
    .enum(["submitted", "qualified", "in_progress", "won", "lost", "duplicate"])
    .optional(),
  actualAcvCents: z.number().int().positive().optional(),
  estimatedAcvCents: z.number().int().positive().optional(),
  firstInvoicePaidAt: z.string().datetime().optional().nullable(),
  adminNotes: z.string().max(4000).optional().nullable(),
});

router.patch(
  "/connectors/admin/referrals/:id",
  ...adminMiddleware,
  async (req: PartnerRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = UpdateReferralSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: parsed.error.message });
      return;
    }
    const updates = parsed.data;

    try {
      // Load current referral to merge state correctly.
      const [current] = await db
        .select()
        .from(connectorReferralsTable)
        .where(eq(connectorReferralsTable.id, id))
        .limit(1);

      if (!current) {
        res.status(404).json({ error: "not_found", message: "Referral not found." });
        return;
      }

      // Build the patch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: Record<string, any> = { updatedAt: new Date() };

      if (updates.status !== undefined && updates.status !== current.status) {
        patch.status = updates.status;

        // Timestamp transitions.
        if (updates.status === "qualified" && !current.qualifiedAt) {
          patch.qualifiedAt = new Date();
        }
        if (updates.status === "won" && !current.wonAt) {
          patch.wonAt = new Date();
        }
        if (updates.status === "lost" && !current.lostAt) {
          patch.lostAt = new Date();
        }
      }

      if (updates.estimatedAcvCents !== undefined) {
        patch.estimatedAcvCents = updates.estimatedAcvCents;
      }

      if (updates.adminNotes !== undefined) {
        patch.adminNotes = updates.adminNotes;
      }

      // Compute reward when we have an actual ACV.
      const effectiveAcv = updates.actualAcvCents ?? current.actualAcvCents;
      if (updates.actualAcvCents !== undefined) {
        patch.actualAcvCents = updates.actualAcvCents;
      }

      if (effectiveAcv && effectiveAcv > 0) {
        const reward = computeReward(effectiveAcv, current.multiLocation);
        patch.rewardTier = reward.tierName;
        patch.rewardAmountCents = reward.totalAmountCents;
      }

      // Compute payout and clawback dates when invoice-paid date is set.
      if (updates.firstInvoicePaidAt !== undefined) {
        patch.firstInvoicePaidAt = updates.firstInvoicePaidAt ? new Date(updates.firstInvoicePaidAt) : null;
      }
      const effectiveInvoiceDate =
        patch.firstInvoicePaidAt !== undefined
          ? patch.firstInvoicePaidAt
          : current.firstInvoicePaidAt;
      if (effectiveInvoiceDate) {
        const dates = computePayoutDates(effectiveInvoiceDate);
        patch.payoutDueAt = dates.payoutDueAt;
        patch.clawbackUntil = dates.clawbackUntil;
      }

      const [updated] = await db
        .update(connectorReferralsTable)
        .set(patch)
        .where(eq(connectorReferralsTable.id, id))
        .returning();

      // Keep the connector's totalEarnedCents in sync when a referral is won and
      // a reward amount is now confirmed.
      if (patch.rewardAmountCents !== undefined) {
        const [agg] = await db
          .select({
            total: sql<number>`coalesce(sum(${connectorReferralsTable.rewardAmountCents}) filter (where ${connectorReferralsTable.status} = 'won'), 0)::int`,
          })
          .from(connectorReferralsTable)
          .where(eq(connectorReferralsTable.connectorId, current.connectorId));

        await db
          .update(connectorsTable)
          .set({ totalEarnedCents: agg?.total ?? 0, updatedAt: new Date() })
          .where(eq(connectorsTable.id, current.connectorId));
      }

      res.json({ referral: updated });
    } catch (err) {
      console.error("[connectors-admin] update referral error:", err);
      res.status(500).json({ error: "server_error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Create a payout record
// POST /api/connectors/admin/payouts
// ─────────────────────────────────────────────────────────────────────────────
const CreatePayoutSchema = z.object({
  connectorId: z.number().int().positive(),
  referralId: z.number().int().positive().optional(),
  amountCents: z.number().int().positive(),
  payoutMethod: z.string().max(80).optional(),
  payoutReference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["pending", "approved", "paid", "void"]).default("pending"),
  paidAt: z.string().datetime().optional().nullable(),
});

router.post(
  "/connectors/admin/payouts",
  ...adminMiddleware,
  async (req: PartnerRequest, res: Response) => {
    const parsed = CreatePayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: parsed.error.message });
      return;
    }
    const data = parsed.data;
    try {
      const [payout] = await db
        .insert(connectorPayoutsTable)
        .values({
          connectorId: data.connectorId,
          referralId: data.referralId ?? null,
          amountCents: data.amountCents,
          payoutMethod: data.payoutMethod ?? null,
          payoutReference: data.payoutReference ?? null,
          notes: data.notes ?? null,
          status: data.status,
          paidAt: data.paidAt ? new Date(data.paidAt) : null,
          approvedAt: ["approved", "paid"].includes(data.status) ? new Date() : null,
        })
        .returning();

      // Sync totalEarnedCents on the connector row.
      const [agg] = await db
        .select({
          total: sql<number>`coalesce(sum(${connectorPayoutsTable.amountCents}) filter (where ${connectorPayoutsTable.status} = 'paid'), 0)::int`,
        })
        .from(connectorPayoutsTable)
        .where(eq(connectorPayoutsTable.connectorId, data.connectorId));

      await db
        .update(connectorsTable)
        .set({ totalEarnedCents: agg?.total ?? 0, updatedAt: new Date() })
        .where(eq(connectorsTable.id, data.connectorId));

      res.status(201).json({ payout });
    } catch (err) {
      console.error("[connectors-admin] create payout error:", err);
      res.status(500).json({ error: "server_error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Update payout status
// PATCH /api/connectors/admin/payouts/:id
// ─────────────────────────────────────────────────────────────────────────────
const UpdatePayoutSchema = z.object({
  status: z.enum(["pending", "approved", "paid", "void"]).optional(),
  payoutMethod: z.string().max(80).optional().nullable(),
  payoutReference: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
});

router.patch(
  "/connectors/admin/payouts/:id",
  ...adminMiddleware,
  async (req: PartnerRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = UpdatePayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: parsed.error.message });
      return;
    }
    const updates = parsed.data;
    try {
      const [current] = await db
        .select()
        .from(connectorPayoutsTable)
        .where(eq(connectorPayoutsTable.id, id))
        .limit(1);
      if (!current) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.payoutMethod !== undefined) patch.payoutMethod = updates.payoutMethod;
      if (updates.payoutReference !== undefined) patch.payoutReference = updates.payoutReference;
      if (updates.notes !== undefined) patch.notes = updates.notes;
      if (updates.paidAt !== undefined) patch.paidAt = updates.paidAt ? new Date(updates.paidAt) : null;
      if (updates.status === "approved" && !current.approvedAt) patch.approvedAt = new Date();
      if (updates.status === "paid" && !current.paidAt) patch.paidAt = patch.paidAt ?? new Date();
      if (updates.status === "void") patch.voidedAt = new Date();

      const [updated] = await db
        .update(connectorPayoutsTable)
        .set(patch)
        .where(eq(connectorPayoutsTable.id, id))
        .returning();

      // Re-sync totalEarnedCents.
      const [agg] = await db
        .select({
          total: sql<number>`coalesce(sum(${connectorPayoutsTable.amountCents}) filter (where ${connectorPayoutsTable.status} = 'paid'), 0)::int`,
        })
        .from(connectorPayoutsTable)
        .where(eq(connectorPayoutsTable.connectorId, current.connectorId));

      await db
        .update(connectorsTable)
        .set({ totalEarnedCents: agg?.total ?? 0, updatedAt: new Date() })
        .where(eq(connectorsTable.id, current.connectorId));

      res.json({ payout: updated });
    } catch (err) {
      console.error("[connectors-admin] update payout error:", err);
      res.status(500).json({ error: "server_error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard summary
// GET /api/connectors/admin/summary
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/connectors/admin/summary",
  ...adminMiddleware,
  async (_req: PartnerRequest, res: Response) => {
    try {
      const [connStats] = await db
        .select({
          totalConnectors: sql<number>`count(*)::int`,
          approved: sql<number>`count(*) filter (where ${connectorsTable.status} = 'approved')::int`,
        })
        .from(connectorsTable);

      const [refStats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          submitted: sql<number>`count(*) filter (where ${connectorReferralsTable.status} = 'submitted')::int`,
          qualified: sql<number>`count(*) filter (where ${connectorReferralsTable.status} = 'qualified')::int`,
          inProgress: sql<number>`count(*) filter (where ${connectorReferralsTable.status} = 'in_progress')::int`,
          won: sql<number>`count(*) filter (where ${connectorReferralsTable.status} = 'won')::int`,
          lost: sql<number>`count(*) filter (where ${connectorReferralsTable.status} = 'lost')::int`,
          rewardsPendingCents: sql<number>`coalesce(sum(${connectorReferralsTable.rewardAmountCents}) filter (where ${connectorReferralsTable.status} = 'won'), 0)::int`,
        })
        .from(connectorReferralsTable);

      const [payStats] = await db
        .select({
          totalPaidCents: sql<number>`coalesce(sum(${connectorPayoutsTable.amountCents}) filter (where ${connectorPayoutsTable.status} = 'paid'), 0)::int`,
          totalPendingCents: sql<number>`coalesce(sum(${connectorPayoutsTable.amountCents}) filter (where ${connectorPayoutsTable.status} in ('pending','approved')), 0)::int`,
        })
        .from(connectorPayoutsTable);

      res.json({ connectors: connStats, referrals: refStats, payouts: payStats });
    } catch (err) {
      console.error("[connectors-admin] summary error:", err);
      res.status(500).json({ error: "server_error" });
    }
  },
);

export default router;
