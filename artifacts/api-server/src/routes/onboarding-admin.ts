/**
 * Onboarding Command Center — unified admin API across all five flows
 * (Task #189). Surfaces a single overview, per-entity detail with full
 * event timeline, manual reminder triggers, Stripe Connect status refresh,
 * health metrics for the dashboard widget, CSV export, and pause/threshold
 * settings.
 */
import { Router, type IRouter, type Response } from "express";
import {
  db,
  partnersTable,
  partnerTeamMembersTable,
  clientOnboardingTable,
  clientPortalTokensTable,
  usersTable,
  writtenPlansTable,
} from "@workspace/db";
import { and, desc, eq, gt, isNull, sql, isNotNull, lt } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import {
  recordOnboardingEvent,
  listEventsForEntity,
  loadOnboardingSettings,
  updateOnboardingSettings,
  type OnboardingFlow,
} from "../lib/onboardingEvents.js";
import { refreshPartnerStripeStatus } from "../lib/stripeConnectStatus.js";
import {
  sendStripeConnectReminder,
  sendPartnerApplicationReminderEmail,
  sendClientOnboardingReminderEmail,
  sendUserWelcomeReminderEmail,
  sendPartnerTeamInviteEmail,
} from "../lib/email.js";
import { issueClientPortalToken } from "./client-portal.js";
import crypto from "crypto";

const router: IRouter = Router();

const FLOWS: readonly OnboardingFlow[] = [
  "client_onboarding",
  "partner_application",
  "partner_team_invite",
  "stripe_connect",
  "admin_account",
] as const;

interface UnifiedRow {
  flow: OnboardingFlow;
  id: number; // entity_id
  label: string; // primary display label
  subLabel: string | null; // org / company / step
  email: string | null;
  status: string; // human-friendly status
  statusKind: "pending" | "in_progress" | "complete" | "stalled" | "blocked";
  startedAt: string | null;
  updatedAt: string | null;
  ageHours: number | null;
  staleHours: number | null; // hours since last activity
  blockingReason: string | null;
  reminderCount: number;
  lastReminderSentAt: string | null;
  partnerId?: number | null;
  partnerCompanyName?: string | null;
}

function hoursBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 3600000));
}

function clientStatusKind(o: { status: string; updatedAt: Date | null }, overdueHours: number): UnifiedRow["statusKind"] {
  if (o.status === "completed") return "complete";
  const stale = hoursBetween(o.updatedAt, new Date());
  if (stale != null && stale >= overdueHours) return "stalled";
  return "in_progress";
}

function partnerAppStatusKind(p: { status: string; createdAt: Date | null }, overdueHours: number): UnifiedRow["statusKind"] {
  if (p.status === "approved") return "complete";
  if (p.status === "rejected" || p.status === "suspended") return "blocked";
  const stale = hoursBetween(p.createdAt, new Date());
  if (stale != null && stale >= overdueHours) return "stalled";
  return "pending";
}

function teamInviteStatusKind(m: { status: string; invitedAt: Date | null; acceptedAt: Date | null }, overdueHours: number): UnifiedRow["statusKind"] {
  if (m.status === "active" || m.acceptedAt) return "complete";
  if (m.status === "revoked") return "blocked";
  const stale = hoursBetween(m.invitedAt, new Date());
  if (stale != null && stale >= overdueHours) return "stalled";
  return "pending";
}

function stripeStatusKind(s: string | null, blocking: string | null, refreshedAt: Date | null, overdueHours: number): UnifiedRow["statusKind"] {
  if (s === "complete") return "complete";
  if (s === "invalid") return "blocked";
  if (s === "restricted" && blocking) return "blocked";
  const stale = hoursBetween(refreshedAt, new Date());
  if (stale != null && stale >= overdueHours) return "stalled";
  return s === "in_progress" ? "in_progress" : "pending";
}

function adminAccountStatusKind(u: { lastLoginAt: Date | null; createdAt: Date | null }, overdueHours: number): UnifiedRow["statusKind"] {
  if (u.lastLoginAt) return "complete";
  const stale = hoursBetween(u.createdAt, new Date());
  if (stale != null && stale >= overdueHours) return "stalled";
  return "pending";
}

router.get("/admin/onboarding/overview", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await loadOnboardingSettings();
    const flowFilter = (req.query.flow as string | undefined)?.split(",").filter(Boolean) as OnboardingFlow[] | undefined;
    const statusFilter = (req.query.status as string | undefined)?.split(",").filter(Boolean);
    const searchRaw = (req.query.q as string | undefined)?.trim().toLowerCase() ?? "";
    const limit = Math.min(parseInt(String(req.query.limit ?? "500")) || 500, 2000);

    const includeFlow = (f: OnboardingFlow) => !flowFilter || flowFilter.length === 0 || flowFilter.includes(f);

    const rows: UnifiedRow[] = [];
    const now = new Date();

    // ── 1) Client Onboarding ────────────────────────────────────────────────
    if (includeFlow("client_onboarding")) {
      const clients = await db
        .select({
          o: clientOnboardingTable,
          partnerName: partnersTable.companyName,
        })
        .from(clientOnboardingTable)
        .leftJoin(partnersTable, eq(partnersTable.id, clientOnboardingTable.partnerId))
        .orderBy(desc(clientOnboardingTable.updatedAt))
        .limit(limit);
      for (const { o, partnerName } of clients) {
        const kind = clientStatusKind({ status: o.status, updatedAt: o.updatedAt }, settings.clientOnboardingOverdueHours);
        rows.push({
          flow: "client_onboarding",
          id: o.id,
          label: o.clientCompany,
          subLabel: o.currentStep,
          email: o.clientEmail,
          status: o.status === "completed" ? "Completed" : `In progress · ${o.currentStep}`,
          statusKind: kind,
          startedAt: o.startedAt?.toISOString() ?? null,
          updatedAt: o.updatedAt?.toISOString() ?? null,
          ageHours: hoursBetween(o.startedAt, now),
          staleHours: hoursBetween(o.updatedAt, now),
          blockingReason: kind === "stalled" ? `No activity for ${hoursBetween(o.updatedAt, now)}h` : null,
          reminderCount: o.reminderCount ?? 0,
          lastReminderSentAt: o.lastReminderSentAt?.toISOString() ?? null,
          partnerId: o.partnerId ?? null,
          partnerCompanyName: partnerName ?? null,
        });
      }
    }

    // ── 2) Partner Applications ─────────────────────────────────────────────
    if (includeFlow("partner_application")) {
      const partners = await db.select().from(partnersTable).orderBy(desc(partnersTable.createdAt)).limit(limit);
      for (const p of partners) {
        const kind = partnerAppStatusKind({ status: p.status, createdAt: p.createdAt }, settings.partnerApplicationOverdueHours);
        rows.push({
          flow: "partner_application",
          id: p.id,
          label: p.companyName,
          subLabel: p.contactName,
          email: p.email,
          status: p.status,
          statusKind: kind,
          startedAt: p.createdAt?.toISOString() ?? null,
          updatedAt: p.updatedAt?.toISOString() ?? null,
          ageHours: hoursBetween(p.createdAt, now),
          staleHours: hoursBetween(p.updatedAt, now),
          blockingReason: p.status === "pending" && kind === "stalled" ? `Awaiting review for ${hoursBetween(p.createdAt, now)}h` : null,
          reminderCount: p.applicationReminderCount ?? 0,
          lastReminderSentAt: p.lastApplicationReminderSentAt?.toISOString() ?? null,
        });
      }
    }

    // ── 3) Partner Team Invites ─────────────────────────────────────────────
    if (includeFlow("partner_team_invite")) {
      const invites = await db
        .select({
          m: partnerTeamMembersTable,
          partnerName: partnersTable.companyName,
        })
        .from(partnerTeamMembersTable)
        .leftJoin(partnersTable, eq(partnersTable.id, partnerTeamMembersTable.partnerId))
        .orderBy(desc(partnerTeamMembersTable.invitedAt))
        .limit(limit);
      for (const { m, partnerName } of invites) {
        const kind = teamInviteStatusKind({ status: m.status, invitedAt: m.invitedAt, acceptedAt: m.acceptedAt }, settings.partnerTeamInviteOverdueHours);
        rows.push({
          flow: "partner_team_invite",
          id: m.id,
          label: m.name,
          subLabel: partnerName ?? null,
          email: m.email,
          status: m.status,
          statusKind: kind,
          startedAt: m.invitedAt?.toISOString() ?? null,
          updatedAt: m.updatedAt?.toISOString() ?? null,
          ageHours: hoursBetween(m.invitedAt, now),
          staleHours: hoursBetween(m.updatedAt, now),
          blockingReason: m.status === "pending" && kind === "stalled" ? `Invite outstanding ${hoursBetween(m.invitedAt, now)}h` : null,
          reminderCount: m.reminderCount ?? 0,
          lastReminderSentAt: m.lastReminderSentAt?.toISOString() ?? null,
          partnerId: m.partnerId ?? null,
          partnerCompanyName: partnerName ?? null,
        });
      }
    }

    // ── 4) Stripe Connect ───────────────────────────────────────────────────
    if (includeFlow("stripe_connect")) {
      const partners = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.status, "approved"))
        .orderBy(desc(partnersTable.approvedAt))
        .limit(limit);
      for (const p of partners) {
        const cachedStatus = (p.stripeConnectStatus as string | null) ?? (p.stripeConnectAccountId ? "in_progress" : "not_started");
        const kind = stripeStatusKind(cachedStatus, p.stripeConnectBlockingRequirement ?? null, p.stripeConnectRefreshedAt ?? null, settings.stripeConnectOverdueHours);
        const friendly =
          cachedStatus === "complete" ? "Payouts enabled" :
          cachedStatus === "restricted" ? "Restricted" :
          cachedStatus === "invalid" ? "Account invalid" :
          cachedStatus === "in_progress" ? "Onboarding in progress" :
          "Not started";
        rows.push({
          flow: "stripe_connect",
          id: p.id,
          label: p.companyName,
          subLabel: p.stripeConnectAccountId ?? "No Stripe account",
          email: p.email,
          status: friendly,
          statusKind: kind,
          startedAt: p.approvedAt?.toISOString() ?? p.createdAt?.toISOString() ?? null,
          updatedAt: p.stripeConnectRefreshedAt?.toISOString() ?? null,
          ageHours: hoursBetween(p.approvedAt ?? p.createdAt, now),
          staleHours: hoursBetween(p.stripeConnectRefreshedAt, now),
          blockingReason: p.stripeConnectBlockingRequirement ?? null,
          reminderCount: p.stripeReminderCount ?? 0,
          lastReminderSentAt: p.lastStripeReminderSentAt?.toISOString() ?? null,
          partnerId: p.id,
          partnerCompanyName: p.companyName,
        });
      }
    }

    // ── 5) Admin / Employee Accounts ────────────────────────────────────────
    if (includeFlow("admin_account")) {
      const admins = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.role, "admin"))
        .orderBy(desc(usersTable.createdAt))
        .limit(limit);
      for (const u of admins) {
        const kind = adminAccountStatusKind({ lastLoginAt: u.lastLoginAt, createdAt: u.createdAt }, settings.adminAccountOverdueHours);
        const friendly = u.lastLoginAt ? "Active" : u.mustChangePassword ? "Awaiting password change" : "Awaiting first login";
        rows.push({
          flow: "admin_account",
          id: u.id,
          label: u.name,
          subLabel: u.company,
          email: u.email,
          status: friendly,
          statusKind: kind,
          startedAt: u.createdAt?.toISOString() ?? null,
          updatedAt: u.lastLoginAt?.toISOString() ?? u.createdAt?.toISOString() ?? null,
          ageHours: hoursBetween(u.createdAt, now),
          staleHours: hoursBetween(u.lastLoginAt ?? u.createdAt, now),
          blockingReason: kind === "stalled" ? `No login for ${hoursBetween(u.createdAt, now)}h` : null,
          reminderCount: u.welcomeReminderCount ?? 0,
          lastReminderSentAt: u.lastWelcomeSentAt?.toISOString() ?? null,
        });
      }
    }

    // Apply text search & status filter in-memory
    let filtered = rows;
    if (searchRaw) {
      filtered = filtered.filter(r =>
        r.label.toLowerCase().includes(searchRaw) ||
        (r.email ?? "").toLowerCase().includes(searchRaw) ||
        (r.subLabel ?? "").toLowerCase().includes(searchRaw) ||
        (r.partnerCompanyName ?? "").toLowerCase().includes(searchRaw)
      );
    }
    if (statusFilter && statusFilter.length > 0) {
      filtered = filtered.filter(r => statusFilter.includes(r.statusKind));
    }

    // Sort: stalled/blocked first, then most recent
    filtered.sort((a, b) => {
      const order: Record<string, number> = { blocked: 0, stalled: 1, pending: 2, in_progress: 3, complete: 4 };
      const k = (order[a.statusKind] ?? 9) - (order[b.statusKind] ?? 9);
      if (k !== 0) return k;
      const ad = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bd = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bd - ad;
    });

    res.json({ rows: filtered, settings });
  } catch (err) {
    console.error("[OnboardingAdmin] overview error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/onboarding/health", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await loadOnboardingSettings();
    const now = new Date();
    const cutoff = (h: number) => new Date(now.getTime() - h * 3600000);

    // node-postgres + drizzle returns { rows: [...] } from db.execute()
    const countOf = async (query: ReturnType<typeof sql>): Promise<number> => {
      const result = await db.execute(query);
      const rows = ((result as unknown as { rows?: Array<{ c: number }> }).rows ?? []) as Array<{ c: number }>;
      return rows[0]?.c ?? 0;
    };

    const [
      pendingPartners, stalledPartners,
      pendingClientOnb, stalledClientOnb,
      pendingInvites, stalledInvites,
      stripeNotConnected, stripeBlocked,
      pendingAdminLogins, stalledAdminLogins,
    ] = await Promise.all([
      countOf(sql`SELECT COUNT(*)::int AS c FROM partners WHERE status = 'pending'`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM partners WHERE status = 'pending' AND created_at < ${cutoff(settings.partnerApplicationOverdueHours)}`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM client_onboarding WHERE status <> 'completed'`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM client_onboarding WHERE status <> 'completed' AND updated_at < ${cutoff(settings.clientOnboardingOverdueHours)}`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM partner_team_members WHERE status = 'pending'`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM partner_team_members WHERE status = 'pending' AND invited_at < ${cutoff(settings.partnerTeamInviteOverdueHours)}`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM partners WHERE status = 'approved' AND stripe_connect_account_id IS NULL`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM partners WHERE status = 'approved' AND stripe_connect_status IN ('restricted','invalid')`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND last_login_at IS NULL`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND last_login_at IS NULL AND created_at < ${cutoff(settings.adminAccountOverdueHours)}`),
    ]);

    res.json({
      paused: settings.paused,
      flows: {
        partner_application: { open: pendingPartners, stalled: stalledPartners },
        client_onboarding: { open: pendingClientOnb, stalled: stalledClientOnb },
        partner_team_invite: { open: pendingInvites, stalled: stalledInvites },
        stripe_connect: { open: stripeNotConnected, stalled: stripeBlocked },
        admin_account: { open: pendingAdminLogins, stalled: stalledAdminLogins },
      },
    });
  } catch (err) {
    console.error("[OnboardingAdmin] health error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/onboarding/:flow/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const flow = req.params.flow as OnboardingFlow;
    const id = parseInt(req.params.id);
    if (!FLOWS.includes(flow) || !Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "bad_request" });
      return;
    }

    let entity: Record<string, unknown> | null = null;
    let summary: Record<string, unknown> = {};
    if (flow === "client_onboarding") {
      const [row] = await db.select().from(clientOnboardingTable).where(eq(clientOnboardingTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      entity = row as Record<string, unknown>;
      summary = {
        company: row.clientCompany,
        email: row.clientEmail,
        currentStep: row.currentStep,
        status: row.status,
        partnerId: row.partnerId,
        planId: row.planId,
      };
    } else if (flow === "partner_application" || flow === "stripe_connect") {
      const [row] = await db.select().from(partnersTable).where(eq(partnersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      const safe: Record<string, unknown> = { ...row };
      delete safe.password;
      entity = safe;
      summary = {
        companyName: row.companyName,
        contactName: row.contactName,
        email: row.email,
        status: row.status,
        stripeConnectAccountId: row.stripeConnectAccountId,
        stripeConnectStatus: row.stripeConnectStatus,
        stripeConnectBlockingRequirement: row.stripeConnectBlockingRequirement,
      };
    } else if (flow === "partner_team_invite") {
      const [row] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      entity = row as Record<string, unknown>;
      const [partner] = await db
        .select({ companyName: partnersTable.companyName })
        .from(partnersTable)
        .where(eq(partnersTable.id, row.partnerId))
        .limit(1);
      summary = {
        name: row.name,
        email: row.email,
        status: row.status,
        partnerId: row.partnerId,
        partnerCompanyName: partner?.companyName,
      };
    } else if (flow === "admin_account") {
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      const safe: Record<string, unknown> = { ...row };
      delete safe.password;
      delete safe.resetToken;
      delete safe.emailVerificationToken;
      entity = safe;
      summary = {
        name: row.name,
        email: row.email,
        company: row.company,
        role: row.role,
        lastLoginAt: row.lastLoginAt,
        mustChangePassword: row.mustChangePassword,
      };
    }

    const events = await listEventsForEntity(flow, id, 100);
    res.json({ flow, id, summary, entity, events });
  } catch (err) {
    console.error("[OnboardingAdmin] detail error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/onboarding/:flow/:id/remind", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const flow = req.params.flow as OnboardingFlow;
    const id = parseInt(req.params.id);
    if (!FLOWS.includes(flow) || !Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const settings = await loadOnboardingSettings();
    const cooldownMs = settings.reminderCooldownHours * 3600000;
    const force = req.body?.force === true;
    const now = new Date();
    const actor = { actorType: "admin" as const, actorId: req.userId ?? null, actorLabel: req.authEmail ?? null };

    if (flow === "client_onboarding") {
      const [row] = await db.select().from(clientOnboardingTable).where(eq(clientOnboardingTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      if (row.status === "completed") {
        res.status(400).json({ error: "already_complete", message: "Onboarding already complete." });
        return;
      }
      if (!force && row.lastReminderSentAt && now.getTime() - new Date(row.lastReminderSentAt).getTime() < cooldownMs) {
        res.status(429).json({ error: "cooldown_active", message: `Reminder sent within last ${settings.reminderCooldownHours}h.` });
        return;
      }
      // Issue a fresh portal token (revokes prior tokens for that email)
      const portalBase = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "siebertrservices.com"}`).replace(/\/+$/, "");
      const tokenRow = await issueClientPortalToken({
        partnerId: row.partnerId,
        planId: row.planId,
        clientEmail: row.clientEmail,
        clientName: row.clientEmail.split("@")[0],
        clientCompany: row.clientCompany,
        ttlDays: 30,
      });
      const portalUrl = `${portalBase}/c/${tokenRow.token}/onboarding`;
      const ok = await sendClientOnboardingReminderEmail({
        clientName: row.clientEmail.split("@")[0],
        clientEmail: row.clientEmail,
        clientCompany: row.clientCompany,
        currentStep: row.currentStep,
        portalUrl,
      });
      if (!ok) { res.status(500).json({ error: "email_failed" }); return; }
      await db
        .update(clientOnboardingTable)
        .set({ lastReminderSentAt: now, reminderCount: (row.reminderCount ?? 0) + 1 })
        .where(eq(clientOnboardingTable.id, id));
      await recordOnboardingEvent({
        flow, entityId: id, eventType: "reminder_sent", ...actor,
        note: `Reminder sent to ${row.clientEmail}`, payload: { force, currentStep: row.currentStep },
      });
      res.json({ ok: true, sentTo: row.clientEmail, lastReminderSentAt: now.toISOString() });
      return;
    }

    if (flow === "partner_application") {
      const [row] = await db.select().from(partnersTable).where(eq(partnersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      if (row.status !== "pending") {
        res.status(400).json({ error: "not_pending", message: `Partner is in status '${row.status}'.` });
        return;
      }
      if (!force && row.lastApplicationReminderSentAt && now.getTime() - new Date(row.lastApplicationReminderSentAt).getTime() < cooldownMs) {
        res.status(429).json({ error: "cooldown_active" });
        return;
      }
      const ok = await sendPartnerApplicationReminderEmail({
        companyName: row.companyName,
        contactName: row.contactName,
        email: row.email,
      });
      if (!ok) { res.status(500).json({ error: "email_failed" }); return; }
      await db
        .update(partnersTable)
        .set({ lastApplicationReminderSentAt: now, applicationReminderCount: (row.applicationReminderCount ?? 0) + 1 })
        .where(eq(partnersTable.id, id));
      await recordOnboardingEvent({
        flow, entityId: id, eventType: "reminder_sent", ...actor,
        note: `Application reminder sent to ${row.email}`, payload: { force },
      });
      res.json({ ok: true, sentTo: row.email, lastReminderSentAt: now.toISOString() });
      return;
    }

    if (flow === "partner_team_invite") {
      const [row] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      if (row.status !== "pending") {
        res.status(400).json({ error: "not_pending" });
        return;
      }
      if (!force && row.lastReminderSentAt && now.getTime() - new Date(row.lastReminderSentAt).getTime() < cooldownMs) {
        res.status(429).json({ error: "cooldown_active" });
        return;
      }
      // Re-issue invite token in memory; only persist if email send succeeds
      // so a delivery failure doesn't invalidate the existing valid link.
      const newInviteToken = crypto.randomBytes(24).toString("hex");
      const newInviteTokenExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, row.partnerId)).limit(1);
      const ok = await sendPartnerTeamInviteEmail({
        to: row.email,
        inviteeName: row.name,
        inviterName: partner?.contactName ?? "Your team",
        companyName: partner?.companyName ?? "Siebert Services",
        inviteToken: newInviteToken,
      });
      if (!ok) { res.status(500).json({ error: "email_failed" }); return; }
      await db
        .update(partnerTeamMembersTable)
        .set({
          inviteToken: newInviteToken,
          inviteTokenExpires: newInviteTokenExpires,
          lastReminderSentAt: now,
          reminderCount: (row.reminderCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(partnerTeamMembersTable.id, id));
      await recordOnboardingEvent({
        flow, entityId: id, eventType: "reminder_sent", ...actor,
        note: `Invite reminder sent to ${row.email}`, payload: { force },
      });
      res.json({ ok: true, sentTo: row.email, lastReminderSentAt: now.toISOString() });
      return;
    }

    if (flow === "stripe_connect") {
      const [row] = await db.select().from(partnersTable).where(eq(partnersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      if (row.stripeConnectStatus === "complete") {
        res.status(400).json({ error: "already_complete" });
        return;
      }
      if (!force && row.lastStripeReminderSentAt && now.getTime() - new Date(row.lastStripeReminderSentAt).getTime() < cooldownMs) {
        res.status(429).json({ error: "cooldown_active" });
        return;
      }
      const ok = await sendStripeConnectReminder({
        companyName: row.companyName,
        contactName: row.contactName,
        email: row.email,
      });
      if (!ok) { res.status(500).json({ error: "email_failed" }); return; }
      await db
        .update(partnersTable)
        .set({ lastStripeReminderSentAt: now, stripeReminderCount: (row.stripeReminderCount ?? 0) + 1 })
        .where(eq(partnersTable.id, id));
      await recordOnboardingEvent({
        flow, entityId: id, eventType: "reminder_sent", ...actor,
        note: `Stripe Connect reminder sent to ${row.email}`, payload: { force },
      });
      res.json({ ok: true, sentTo: row.email, lastReminderSentAt: now.toISOString() });
      return;
    }

    if (flow === "admin_account") {
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      if (row.lastLoginAt) {
        res.status(400).json({ error: "already_active" });
        return;
      }
      if (!force && row.lastWelcomeSentAt && now.getTime() - new Date(row.lastWelcomeSentAt).getTime() < cooldownMs) {
        res.status(429).json({ error: "cooldown_active" });
        return;
      }
      const portalBase = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "siebertrservices.com"}`).replace(/\/+$/, "");
      const ok = await sendUserWelcomeReminderEmail({
        name: row.name,
        email: row.email,
        loginUrl: `${portalBase}/portal`,
      });
      if (!ok) { res.status(500).json({ error: "email_failed" }); return; }
      await db
        .update(usersTable)
        .set({ lastWelcomeSentAt: now, welcomeReminderCount: (row.welcomeReminderCount ?? 0) + 1 })
        .where(eq(usersTable.id, id));
      await recordOnboardingEvent({
        flow, entityId: id, eventType: "reminder_sent", ...actor,
        note: `Welcome reminder sent to ${row.email}`, payload: { force },
      });
      res.json({ ok: true, sentTo: row.email, lastReminderSentAt: now.toISOString() });
      return;
    }

    res.status(400).json({ error: "unsupported_flow" });
  } catch (err) {
    console.error("[OnboardingAdmin] remind error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/onboarding/stripe-connect/:id/refresh", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad_request" }); return; }
    const status = await refreshPartnerStripeStatus(id);
    await recordOnboardingEvent({
      flow: "stripe_connect", entityId: id, eventType: "stripe_status_refreshed",
      actorType: "admin", actorId: req.userId ?? null, actorLabel: req.authEmail ?? null,
      note: `Refreshed: ${status.status}${status.blockingRequirement ? ` — ${status.blockingRequirement}` : ""}`,
      payload: { status: status.status, blocking: status.blockingRequirement },
    });
    res.json({ ok: true, status });
  } catch (err) {
    console.error("[OnboardingAdmin] stripe refresh error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/onboarding/export.csv", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Reuse the overview endpoint logic by calling internally via fetch is overkill;
    // instead dispatch directly to the same implementation by re-invoking a query.
    // Simplest: re-issue an axios-style internal call — but here we just inline a
    // minimal export based on current data.
    const settings = await loadOnboardingSettings();
    const now = new Date();
    const lines: string[] = [];
    lines.push("flow,id,label,sub_label,email,status,status_kind,started_at,updated_at,age_hours,stale_hours,blocking_reason,reminder_count,last_reminder_sent_at");

    function emit(r: UnifiedRow) {
      const cells = [
        r.flow,
        String(r.id),
        r.label,
        r.subLabel ?? "",
        r.email ?? "",
        r.status,
        r.statusKind,
        r.startedAt ?? "",
        r.updatedAt ?? "",
        r.ageHours == null ? "" : String(r.ageHours),
        r.staleHours == null ? "" : String(r.staleHours),
        r.blockingReason ?? "",
        String(r.reminderCount),
        r.lastReminderSentAt ?? "",
      ].map(v => {
        const s = String(v ?? "");
        if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
        return s;
      });
      lines.push(cells.join(","));
    }

    // Pull each flow once (limit reasonable; reuses indexes)
    const clients = await db.select().from(clientOnboardingTable).orderBy(desc(clientOnboardingTable.updatedAt)).limit(2000);
    for (const o of clients) {
      const kind = clientStatusKind({ status: o.status, updatedAt: o.updatedAt }, settings.clientOnboardingOverdueHours);
      emit({
        flow: "client_onboarding", id: o.id, label: o.clientCompany, subLabel: o.currentStep,
        email: o.clientEmail, status: o.status, statusKind: kind,
        startedAt: o.startedAt?.toISOString() ?? null, updatedAt: o.updatedAt?.toISOString() ?? null,
        ageHours: hoursBetween(o.startedAt, now), staleHours: hoursBetween(o.updatedAt, now),
        blockingReason: kind === "stalled" ? `No activity for ${hoursBetween(o.updatedAt, now)}h` : null,
        reminderCount: o.reminderCount ?? 0, lastReminderSentAt: o.lastReminderSentAt?.toISOString() ?? null,
      });
    }
    const partners = await db.select().from(partnersTable).orderBy(desc(partnersTable.createdAt)).limit(2000);
    for (const p of partners) {
      const kindApp = partnerAppStatusKind({ status: p.status, createdAt: p.createdAt }, settings.partnerApplicationOverdueHours);
      emit({
        flow: "partner_application", id: p.id, label: p.companyName, subLabel: p.contactName,
        email: p.email, status: p.status, statusKind: kindApp,
        startedAt: p.createdAt?.toISOString() ?? null, updatedAt: p.updatedAt?.toISOString() ?? null,
        ageHours: hoursBetween(p.createdAt, now), staleHours: hoursBetween(p.updatedAt, now),
        blockingReason: kindApp === "stalled" ? `Awaiting review for ${hoursBetween(p.createdAt, now)}h` : null,
        reminderCount: p.applicationReminderCount ?? 0, lastReminderSentAt: p.lastApplicationReminderSentAt?.toISOString() ?? null,
      });
      if (p.status === "approved") {
        const cached = (p.stripeConnectStatus as string | null) ?? (p.stripeConnectAccountId ? "in_progress" : "not_started");
        const kindS = stripeStatusKind(cached, p.stripeConnectBlockingRequirement ?? null, p.stripeConnectRefreshedAt ?? null, settings.stripeConnectOverdueHours);
        emit({
          flow: "stripe_connect", id: p.id, label: p.companyName, subLabel: p.stripeConnectAccountId ?? "No Stripe account",
          email: p.email, status: cached, statusKind: kindS,
          startedAt: (p.approvedAt ?? p.createdAt)?.toISOString() ?? null, updatedAt: p.stripeConnectRefreshedAt?.toISOString() ?? null,
          ageHours: hoursBetween(p.approvedAt ?? p.createdAt, now), staleHours: hoursBetween(p.stripeConnectRefreshedAt, now),
          blockingReason: p.stripeConnectBlockingRequirement ?? null,
          reminderCount: p.stripeReminderCount ?? 0, lastReminderSentAt: p.lastStripeReminderSentAt?.toISOString() ?? null,
        });
      }
    }
    const invites = await db
      .select({ m: partnerTeamMembersTable, partnerName: partnersTable.companyName })
      .from(partnerTeamMembersTable)
      .leftJoin(partnersTable, eq(partnersTable.id, partnerTeamMembersTable.partnerId))
      .orderBy(desc(partnerTeamMembersTable.invitedAt))
      .limit(2000);
    for (const { m, partnerName } of invites) {
      const kind = teamInviteStatusKind({ status: m.status, invitedAt: m.invitedAt, acceptedAt: m.acceptedAt }, settings.partnerTeamInviteOverdueHours);
      emit({
        flow: "partner_team_invite", id: m.id, label: m.name, subLabel: partnerName ?? null,
        email: m.email, status: m.status, statusKind: kind,
        startedAt: m.invitedAt?.toISOString() ?? null, updatedAt: m.updatedAt?.toISOString() ?? null,
        ageHours: hoursBetween(m.invitedAt, now), staleHours: hoursBetween(m.updatedAt, now),
        blockingReason: kind === "stalled" ? `Invite outstanding ${hoursBetween(m.invitedAt, now)}h` : null,
        reminderCount: m.reminderCount ?? 0, lastReminderSentAt: m.lastReminderSentAt?.toISOString() ?? null,
      });
    }
    const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).orderBy(desc(usersTable.createdAt)).limit(2000);
    for (const u of admins) {
      const kind = adminAccountStatusKind({ lastLoginAt: u.lastLoginAt, createdAt: u.createdAt }, settings.adminAccountOverdueHours);
      emit({
        flow: "admin_account", id: u.id, label: u.name, subLabel: u.company,
        email: u.email, status: u.lastLoginAt ? "Active" : "Awaiting first login", statusKind: kind,
        startedAt: u.createdAt?.toISOString() ?? null, updatedAt: u.lastLoginAt?.toISOString() ?? u.createdAt?.toISOString() ?? null,
        ageHours: hoursBetween(u.createdAt, now), staleHours: hoursBetween(u.lastLoginAt ?? u.createdAt, now),
        blockingReason: kind === "stalled" ? `No login for ${hoursBetween(u.createdAt, now)}h` : null,
        reminderCount: u.welcomeReminderCount ?? 0, lastReminderSentAt: u.lastWelcomeSentAt?.toISOString() ?? null,
      });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="onboarding-${now.toISOString().slice(0,10)}.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("[OnboardingAdmin] csv export error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/onboarding/settings", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await loadOnboardingSettings();
    res.json(settings);
  } catch (err) {
    console.error("[OnboardingAdmin] settings get error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/admin/onboarding/settings", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await updateOnboardingSettings(req.body ?? {});
    res.json(settings);
  } catch (err) {
    console.error("[OnboardingAdmin] settings patch error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
