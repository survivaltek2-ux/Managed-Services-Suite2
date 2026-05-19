import { Router, type IRouter, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, connectorsTable, connectorReferralsTable, connectorPayoutsTable, usersTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import {
  generateConnectorToken,
  requireConnectorAuth,
  type ConnectorRequest,
} from "../middlewares/connectorAuth.js";

const router: IRouter = Router();

const SignupSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  phone: z.string().max(40).optional().or(z.literal("").transform(() => undefined)),
  city: z.string().max(120).optional().or(z.literal("").transform(() => undefined)),
  state: z.string().max(60).optional().or(z.literal("").transform(() => undefined)),
  occupation: z.string().max(160).optional().or(z.literal("").transform(() => undefined)),
  howHeard: z.string().max(500).optional().or(z.literal("").transform(() => undefined)),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ReferralSchema = z.object({
  companyName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(160),
  contactEmail: z.string().email().max(255),
  contactPhone: z.string().max(40).optional().or(z.literal("").transform(() => undefined)),
  contactTitle: z.string().max(160).optional().or(z.literal("").transform(() => undefined)),
  companySize: z.enum(["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"]).optional(),
  multiLocation: z.enum(["yes", "no", "unknown"]).optional(),
  servicesNeeded: z.array(z.string().max(80)).max(20).default([]),
  notes: z.string().max(4000).optional().or(z.literal("").transform(() => undefined)),
});

function publicConnector(c: {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  occupation: string | null;
  status: string;
  totalReferrals: number;
  totalEarnedCents: number;
  createdAt: Date;
}) {
  return {
    id: c.id,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    city: c.city,
    state: c.state,
    occupation: c.occupation,
    status: c.status,
    totalReferrals: c.totalReferrals,
    totalEarnedCents: c.totalEarnedCents,
    createdAt: c.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth: signup
// ─────────────────────────────────────────────────────────────────────────────
router.post("/connectors/auth/signup", async (req, res: Response) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const emailLower = data.email.toLowerCase();

  try {
    const [existing] = await db
      .select({ id: connectorsTable.id })
      .from(connectorsTable)
      .where(eq(connectorsTable.email, emailLower))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "email_in_use", message: "An account with that email already exists." });
      return;
    }

    const hash = await bcrypt.hash(data.password, 10);
    const [created] = await db
      .insert(connectorsTable)
      .values({
        email: emailLower,
        password: hash,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        occupation: data.occupation ?? null,
        howHeard: data.howHeard ?? null,
      })
      .returning();

    const token = generateConnectorToken(created.id, created.email);
    res.status(201).json({ token, connector: publicConnector(created) });
  } catch (err) {
    console.error("[connectors] signup error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create account." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth: login
// ─────────────────────────────────────────────────────────────────────────────
router.post("/connectors/auth/login", async (req, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }
  const emailLower = parsed.data.email.toLowerCase();

  try {
    const [connector] = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.email, emailLower))
      .limit(1);

    if (!connector) {
      res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password." });
      return;
    }
    const ok = await bcrypt.compare(parsed.data.password, connector.password);
    if (!ok) {
      res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password." });
      return;
    }
    if (connector.status === "rejected") {
      res.status(403).json({ error: "account_rejected", message: "Your application was not approved." });
      return;
    }
    if (connector.status === "suspended") {
      res.status(403).json({ error: "account_suspended", message: "Your account has been suspended." });
      return;
    }

    const token = generateConnectorToken(connector.id, connector.email);
    res.json({ token, connector: publicConnector(connector) });
  } catch (err) {
    console.error("[connectors] login error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to log in." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Current connector
// ─────────────────────────────────────────────────────────────────────────────
router.get("/connectors/me", requireConnectorAuth, async (req: ConnectorRequest, res: Response) => {
  try {
    // Admin passthrough: return a synthetic profile so the dashboard bootstraps
    if (req.isAdminPassthrough) {
      const [adminUser] = await db
        .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, req.adminUserId!))
        .limit(1);
      const nameParts = (adminUser?.name ?? "Admin User").split(" ");
      res.json({
        connector: {
          id: -999,
          email: adminUser?.email ?? req.connectorEmail ?? "",
          firstName: nameParts[0] ?? "Admin",
          lastName: nameParts.slice(1).join(" ") || "User",
          phone: null,
          city: null,
          state: null,
          occupation: "Administrator",
          status: "approved",
          totalReferrals: 0,
          totalEarnedCents: 0,
          createdAt: new Date().toISOString(),
        },
        stats: { totalReferrals: 0, totalQualified: 0, totalWon: 0, totalPaidCents: 0, totalPendingCents: 0 },
        isAdminPassthrough: true,
      });
      return;
    }

    const [connector] = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, req.connectorId!))
      .limit(1);
    if (!connector) {
      res.status(404).json({ error: "not_found", message: "Account not found." });
      return;
    }

    // Recompute aggregate counts in case admin actions updated state outside this request.
    const [agg] = await db
      .select({
        totalReferrals: sql<number>`count(*)::int`,
        totalWon: sql<number>`count(*) filter (where ${connectorReferralsTable.status} = 'won')::int`,
        totalQualified: sql<number>`count(*) filter (where ${connectorReferralsTable.status} in ('qualified','in_progress','won'))::int`,
      })
      .from(connectorReferralsTable)
      .where(eq(connectorReferralsTable.connectorId, connector.id));

    const [paid] = await db
      .select({
        totalPaidCents: sql<number>`coalesce(sum(${connectorPayoutsTable.amountCents}) filter (where ${connectorPayoutsTable.status} = 'paid'), 0)::int`,
        totalPendingCents: sql<number>`coalesce(sum(${connectorPayoutsTable.amountCents}) filter (where ${connectorPayoutsTable.status} in ('pending','approved')), 0)::int`,
      })
      .from(connectorPayoutsTable)
      .where(eq(connectorPayoutsTable.connectorId, connector.id));

    res.json({
      connector: publicConnector(connector),
      stats: {
        totalReferrals: agg?.totalReferrals ?? 0,
        totalQualified: agg?.totalQualified ?? 0,
        totalWon: agg?.totalWon ?? 0,
        totalPaidCents: paid?.totalPaidCents ?? 0,
        totalPendingCents: paid?.totalPendingCents ?? 0,
      },
    });
  } catch (err) {
    console.error("[connectors] me error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load account." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Submit a referral
// ─────────────────────────────────────────────────────────────────────────────
router.post("/connectors/referrals", requireConnectorAuth, async (req: ConnectorRequest, res: Response) => {
  // Admin passthrough sessions may browse the connector portal but cannot submit
  // referrals on behalf of an arbitrary connector account.
  if (req.isAdminPassthrough) {
    res.status(403).json({ error: "forbidden", message: "Admin passthrough sessions cannot submit referrals. Log in as a connector to submit." });
    return;
  }
  const parsed = ReferralSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const connectorId = req.connectorId!;

  try {
    // Soft duplicate-check within this connector's existing referrals (case-insensitive email).
    const [duplicate] = await db
      .select({ id: connectorReferralsTable.id })
      .from(connectorReferralsTable)
      .where(
        and(
          eq(connectorReferralsTable.connectorId, connectorId),
          sql`lower(${connectorReferralsTable.contactEmail}) = ${data.contactEmail.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (duplicate) {
      res.status(409).json({
        error: "duplicate_referral",
        message: "You have already submitted a referral for this contact.",
      });
      return;
    }

    const [created] = await db
      .insert(connectorReferralsTable)
      .values({
        connectorId,
        companyName: data.companyName.trim(),
        contactName: data.contactName.trim(),
        contactEmail: data.contactEmail.toLowerCase(),
        contactPhone: data.contactPhone ?? null,
        contactTitle: data.contactTitle ?? null,
        companySize: data.companySize ?? null,
        multiLocation: data.multiLocation ?? null,
        servicesNeeded: JSON.stringify(data.servicesNeeded),
        notes: data.notes ?? null,
      })
      .returning();

    // Bump aggregate count on the connector row for fast list views.
    await db
      .update(connectorsTable)
      .set({
        totalReferrals: sql`${connectorsTable.totalReferrals} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(connectorsTable.id, connectorId));

    res.status(201).json({ referral: created });
  } catch (err) {
    console.error("[connectors] submit referral error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to submit referral." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// List my referrals
// ─────────────────────────────────────────────────────────────────────────────
router.get("/connectors/referrals", requireConnectorAuth, async (req: ConnectorRequest, res: Response) => {
  try {
    if (req.isAdminPassthrough) { res.json({ referrals: [] }); return; }
    const referrals = await db
      .select()
      .from(connectorReferralsTable)
      .where(eq(connectorReferralsTable.connectorId, req.connectorId!))
      .orderBy(desc(connectorReferralsTable.createdAt));
    res.json({ referrals });
  } catch (err) {
    console.error("[connectors] list referrals error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load referrals." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// List my payouts
// ─────────────────────────────────────────────────────────────────────────────
router.get("/connectors/payouts", requireConnectorAuth, async (req: ConnectorRequest, res: Response) => {
  try {
    if (req.isAdminPassthrough) { res.json({ payouts: [] }); return; }
    const payouts = await db
      .select()
      .from(connectorPayoutsTable)
      .where(eq(connectorPayoutsTable.connectorId, req.connectorId!))
      .orderBy(desc(connectorPayoutsTable.createdAt));
    res.json({ payouts });
  } catch (err) {
    console.error("[connectors] list payouts error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load payouts." });
  }
});

export default router;
