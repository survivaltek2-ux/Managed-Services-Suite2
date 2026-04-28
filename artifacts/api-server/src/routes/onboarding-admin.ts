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
import { sendGuestInviteForRecord, isGraphConfigured } from "../lib/microsoft-graph.js";
import { and, desc, eq, gt, isNull, sql, isNotNull, lt, or } from "drizzle-orm";
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
  // partner_team_invite extras
  inviterName?: string | null;
  inviterCompany?: string | null;
  inviteExpiresAt?: string | null;
  isExpired?: boolean;
  // Microsoft SSO (Entra B2B) lifecycle for the admin "Send Microsoft SSO
  // invite" action (Task #191). msObjectId presence means the account is
  // linked to a guest user in the tenant.
  msObjectId?: string | null;
  ssoInviteSentAt?: string | null;
  ssoInviteSentBy?: string | null;
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

function adminAccountStatusKind(
  u: { lastLoginAt: Date | null; createdAt: Date | null; mustChangePassword: boolean },
  overdueHours: number,
): UnifiedRow["statusKind"] {
  if (u.lastLoginAt && !u.mustChangePassword) return "complete";
  if (u.lastLoginAt && u.mustChangePassword) return "in_progress";
  const stale = hoursBetween(u.createdAt, new Date());
  if (stale != null && stale >= overdueHours) return "stalled";
  return "pending";
}

/**
 * Build the unified row list. Used by both the JSON overview endpoint
 * and the CSV export, so filters apply consistently.
 */
async function buildOverviewRows(req: AuthRequest): Promise<{ rows: UnifiedRow[]; settings: Awaited<ReturnType<typeof loadOnboardingSettings>> }> {
  const settings = await loadOnboardingSettings();
  const flowFilter = (req.query.flow as string | undefined)?.split(",").filter(Boolean) as OnboardingFlow[] | undefined;
  const statusFilter = (req.query.status as string | undefined)?.split(",").filter(Boolean);
  const searchRaw = (req.query.q as string | undefined)?.trim().toLowerCase() ?? "";
  // No per-flow `.limit()` — pagination is applied to the final filtered set
  // by the GET /overview endpoint, and the CSV export is intentionally
  // unbounded so admins get the complete filtered set in one file.

  const parseDate = (s: string | undefined): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  const fromDate = parseDate(req.query.from as string | undefined);
  const toDate = parseDate(req.query.to as string | undefined);

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
        .orderBy(desc(clientOnboardingTable.updatedAt));
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
          msObjectId: o.msObjectId ?? null,
          ssoInviteSentAt: o.ssoInviteSentAt?.toISOString() ?? null,
          ssoInviteSentBy: o.ssoInviteSentBy ?? null,
        });
      }
    }

    // ── 2) Partner Applications ─────────────────────────────────────────────
    if (includeFlow("partner_application")) {
      const partners = await db.select().from(partnersTable).orderBy(desc(partnersTable.createdAt));
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
          partnerId: p.id,
          partnerCompanyName: p.companyName,
          msObjectId: p.msObjectId ?? null,
          ssoInviteSentAt: p.ssoInviteSentAt?.toISOString() ?? null,
          ssoInviteSentBy: p.ssoInviteSentBy ?? null,
        });
      }
    }

    // ── 3) Partner Team Invites ─────────────────────────────────────────────
    // Includes the inviter (the partner who owns the team — that's who issued
    // the invite) as `inviterName`/`inviterCompany`, and surfaces an explicit
    // `expired` blocked state when the invite token's TTL has passed.
    if (includeFlow("partner_team_invite")) {
      const invites = await db
        .select({
          m: partnerTeamMembersTable,
          partnerName: partnersTable.companyName,
          partnerContact: partnersTable.contactName,
        })
        .from(partnerTeamMembersTable)
        .leftJoin(partnersTable, eq(partnersTable.id, partnerTeamMembersTable.partnerId))
        .orderBy(desc(partnerTeamMembersTable.invitedAt));
      for (const { m, partnerName, partnerContact } of invites) {
        const expired =
          m.status === "pending" &&
          m.inviteTokenExpires != null &&
          m.inviteTokenExpires.getTime() < now.getTime();
        let kind = teamInviteStatusKind(
          { status: m.status, invitedAt: m.invitedAt, acceptedAt: m.acceptedAt },
          settings.partnerTeamInviteOverdueHours,
        );
        let statusLabel: string = m.status;
        let blockingReason: string | null =
          m.status === "pending" && kind === "stalled" ? `Invite outstanding ${hoursBetween(m.invitedAt, now)}h` : null;
        if (expired) {
          kind = "blocked";
          statusLabel = "expired";
          blockingReason = `Invitation token expired ${hoursBetween(m.inviteTokenExpires, now)}h ago`;
        }
        rows.push({
          flow: "partner_team_invite",
          id: m.id,
          label: m.name,
          subLabel: partnerName ?? null,
          email: m.email,
          status: statusLabel,
          statusKind: kind,
          startedAt: m.invitedAt?.toISOString() ?? null,
          updatedAt: m.updatedAt?.toISOString() ?? null,
          ageHours: hoursBetween(m.invitedAt, now),
          staleHours: hoursBetween(m.updatedAt, now),
          blockingReason,
          reminderCount: m.reminderCount ?? 0,
          lastReminderSentAt: m.lastReminderSentAt?.toISOString() ?? null,
          partnerId: m.partnerId ?? null,
          partnerCompanyName: partnerName ?? null,
          inviterName: partnerContact ?? null,
          inviterCompany: partnerName ?? null,
          inviteExpiresAt: m.inviteTokenExpires?.toISOString() ?? null,
          isExpired: expired,
          msObjectId: m.msObjectId ?? null,
          ssoInviteSentAt: m.ssoInviteSentAt?.toISOString() ?? null,
          ssoInviteSentBy: m.ssoInviteSentBy ?? null,
        });
      }
    }

    // ── 4) Stripe Connect ───────────────────────────────────────────────────
    if (includeFlow("stripe_connect")) {
      const partners = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.status, "approved"))
        .orderBy(desc(partnersTable.approvedAt));
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
          msObjectId: p.msObjectId ?? null,
          ssoInviteSentAt: p.ssoInviteSentAt?.toISOString() ?? null,
          ssoInviteSentBy: p.ssoInviteSentBy ?? null,
        });
      }
    }

    // ── 5) Admin / Employee Accounts ────────────────────────────────────────
    // Covers the full account lifecycle for any user that is part of the
    // admin/employee cohort OR any account that still needs to set its
    // password (e.g. invited users, password-reset-required users) — not
    // just role='admin'. This makes the lifecycle visible end-to-end and
    // gives admins resend coverage across every onboarding/welcome state.
    if (includeFlow("admin_account")) {
      const admins = await db
        .select()
        .from(usersTable)
        .where(or(eq(usersTable.role, "admin"), eq(usersTable.mustChangePassword, true)))
        .orderBy(desc(usersTable.createdAt));
      for (const u of admins) {
        const kind = adminAccountStatusKind(
          { lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, mustChangePassword: u.mustChangePassword ?? false },
          settings.adminAccountOverdueHours,
        );
        // Distinct lifecycle states:
        //   • "Invitation sent · awaiting first login" (when invitationSentAt
        //     is recorded)
        //   • "Awaiting first login (temp password)" (mustChangePassword set
        //     but no invitationSentAt — typically a manual create)
        //   • "Awaiting first login"
        //   • "Logged in · password change required"
        //   • "Active"
        const friendly = !u.lastLoginAt
          ? (u.invitationSentAt
              ? "Invitation sent · awaiting first login"
              : u.mustChangePassword
                ? "Awaiting first login (temp password)"
                : "Awaiting first login")
          : u.mustChangePassword
            ? "Logged in · password change required"
            : "Active";
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
          blockingReason: !u.lastLoginAt && kind === "stalled"
            ? `No login for ${hoursBetween(u.createdAt, now)}h`
            : (u.lastLoginAt && u.mustChangePassword ? "Password change still required after first login" : null),
          reminderCount: u.welcomeReminderCount ?? 0,
          lastReminderSentAt: u.lastWelcomeSentAt?.toISOString() ?? null,
          msObjectId: u.msObjectId ?? null,
          ssoInviteSentAt: u.ssoInviteSentAt?.toISOString() ?? null,
          ssoInviteSentBy: u.ssoInviteSentBy ?? null,
        });
      }
    }

    // Apply text search, status filter, and date range filter in-memory
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
    if (fromDate || toDate) {
      filtered = filtered.filter(r => {
        const startMs = r.startedAt ? Date.parse(r.startedAt) : null;
        if (startMs == null) return false;
        if (fromDate && startMs < fromDate.getTime()) return false;
        if (toDate && startMs > toDate.getTime()) return false;
        return true;
      });
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

    return { rows: filtered, settings };
}

router.get("/admin/onboarding/overview", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { rows: allFiltered, settings } = await buildOverviewRows(req);
    // Pagination: filters/search/sort have already been applied above so
    // pagination is over the *final* set, not a per-flow window.
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize ?? "50")) || 50, 1), 200);
    const page = Math.max(parseInt(String(req.query.page ?? "1")) || 1, 1);
    const total = allFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const rows = allFiltered.slice(start, start + pageSize);
    res.json({
      rows,
      settings,
      page,
      pageSize,
      total,
      totalPages,
      hasMore: page < totalPages,
    });
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
      // Match the overview's admin_account scope: role='admin' OR
      // mustChangePassword=true (covers internal employees / non-admin
      // invitees still owing a password change).
      countOf(sql`SELECT COUNT(*)::int AS c FROM users WHERE (role = 'admin' OR must_change_password = true) AND last_login_at IS NULL`),
      countOf(sql`SELECT COUNT(*)::int AS c FROM users WHERE (role = 'admin' OR must_change_password = true) AND last_login_at IS NULL AND created_at < ${cutoff(settings.adminAccountOverdueHours)}`),
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
      // Look up the active (non-revoked, non-expired) portal token for this
      // client so the admin can copy a resume link straight from the drawer
      // without rotating the existing token (which would invalidate any
      // prior link the client may have).
      const [activeToken] = await db
        .select({
          token: clientPortalTokensTable.token,
          expiresAt: clientPortalTokensTable.expiresAt,
        })
        .from(clientPortalTokensTable)
        .where(
          and(
            eq(clientPortalTokensTable.clientEmail, row.clientEmail),
            isNull(clientPortalTokensTable.revokedAt),
            gt(clientPortalTokensTable.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(clientPortalTokensTable.createdAt))
        .limit(1);
      const portalBase = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "siebertservices.com"}`).replace(/\/+$/, "");
      const resumeUrl = activeToken ? `${portalBase}/c/${activeToken.token}/onboarding` : null;
      entity = { ...row, resumeUrl, resumeTokenExpiresAt: activeToken?.expiresAt ?? null } as Record<string, unknown>;
      summary = {
        company: row.clientCompany,
        email: row.clientEmail,
        currentStep: row.currentStep,
        status: row.status,
        partnerId: row.partnerId,
        planId: row.planId,
        resumeUrl,
        resumeTokenExpiresAt: activeToken?.expiresAt?.toISOString() ?? null,
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
        msObjectId: row.msObjectId,
        ssoInviteSentAt: row.ssoInviteSentAt?.toISOString() ?? null,
        ssoInviteSentBy: row.ssoInviteSentBy,
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
        msObjectId: row.msObjectId,
        ssoInviteSentAt: row.ssoInviteSentAt?.toISOString() ?? null,
        ssoInviteSentBy: row.ssoInviteSentBy,
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
        msObjectId: row.msObjectId,
        ssoInviteSentAt: row.ssoInviteSentAt?.toISOString() ?? null,
        ssoInviteSentBy: row.ssoInviteSentBy,
      };
    }

    const events = await listEventsForEntity(flow, id, 100);
    res.json({ flow, id, summary, entity, events });
  } catch (err) {
    console.error("[OnboardingAdmin] detail error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * Send (or re-send) a Microsoft Entra B2B guest invitation for the given
 * onboarding entity (Task #191). Works across every flow — partners,
 * partner team members, admin/employee users, and client onboarding.
 *
 * Behavior:
 *   - Calls Microsoft Graph and surfaces the raw error body verbatim on
 *     failure so admins see the actual reason (insufficient privileges,
 *     tenant policy, malformed email, etc).
 *   - Persists `msObjectId`, `ssoInviteSentAt`, `ssoInviteSentBy` on the
 *     entity so the Onboarding Command Center can show SSO status.
 *   - Records an audit event (`sso_invite_sent`, `sso_invite_resent`, or
 *     `sso_invite_failed`) so the full history shows up in the drawer.
 *   - Re-invites are de-duplicated by Graph itself: POST /invitations is
 *     idempotent for an email address — if a guest already exists, Graph
 *     returns the same `invitedUser.id`. We compare it to the previously
 *     stored `msObjectId` to label the event "resent" vs "sent".
 */
router.post("/admin/onboarding/:flow/:id/send-sso-invite", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const flow = req.params.flow as OnboardingFlow;
    const id = parseInt(req.params.id);
    if (!FLOWS.includes(flow) || !Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const portalBase = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "siebertservices.com"}`).replace(/\/+$/, "");
    const now = new Date();
    // ssoInviteSentBy is a free-text actor label so we can store both
    // admin invokers ("admin@siebert.com") and partner invokers ("Acme
    // Co (partner)") in the same column without a polymorphic FK.
    const actorLabel = req.authEmail ?? `admin#${req.userId ?? "unknown"}`;
    const audit = { actorType: "admin" as const, actorId: req.userId ?? null, actorLabel: req.authEmail ?? null };

    // Resolve the target entity (email + display name + previous msObjectId
    // + a sensible post-redeem redirect URL) by flow.
    let target: {
      email: string;
      displayName: string;
      previousMsObjectId: string | null;
      redirectUrl: string;
      customMessage: string;
    } | null = null;

    if (flow === "partner_application" || flow === "stripe_connect") {
      const [row] = await db.select().from(partnersTable).where(eq(partnersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      target = {
        email: row.email,
        displayName: row.contactName,
        previousMsObjectId: row.msObjectId ?? null,
        redirectUrl: `${portalBase}/partners/login`,
        customMessage: `Hi ${row.contactName}, your Siebert Services Partner Portal account is enabled for Microsoft single sign-on. Click the button below to accept the invitation and sign in.`,
      };
    } else if (flow === "partner_team_invite") {
      const [row] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      target = {
        email: row.email,
        displayName: row.name,
        previousMsObjectId: row.msObjectId ?? null,
        redirectUrl: `${portalBase}/partners/login`,
        customMessage: `Hi ${row.name}, you've been invited to the Siebert Services Partner Portal. Click below to accept the Microsoft invitation and sign in.`,
      };
    } else if (flow === "admin_account") {
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      target = {
        email: row.email,
        displayName: row.name,
        previousMsObjectId: row.msObjectId ?? null,
        redirectUrl: `${portalBase}/portal`,
        customMessage: `Hi ${row.name}, your Siebert Services account is enabled for Microsoft single sign-on. Click below to accept and sign in.`,
      };
    } else if (flow === "client_onboarding") {
      const [row] = await db.select().from(clientOnboardingTable).where(eq(clientOnboardingTable.id, id)).limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      const fallbackName = row.clientEmail.split("@")[0] || "Client";
      target = {
        email: row.clientEmail,
        displayName: fallbackName,
        previousMsObjectId: row.msObjectId ?? null,
        redirectUrl: `${portalBase}/portal`,
        customMessage: `Hi, you've been invited to access the Siebert Services client portal. Click below to accept the Microsoft invitation and sign in.`,
      };
    } else {
      res.status(400).json({ error: "unsupported_flow" });
      return;
    }

    const result = await sendGuestInviteForRecord({
      email: target.email,
      displayName: target.displayName,
      redirectUrl: target.redirectUrl,
      customMessage: target.customMessage,
    });

    if (!result.ok) {
      // Surface the raw Graph error verbatim and audit it so admins can
      // diagnose tenant/policy/permission problems themselves.
      await recordOnboardingEvent({
        flow, entityId: id, eventType: "sso_invite_failed", ...audit,
        note: `Microsoft SSO invite failed for ${target.email}: ${(result.error ?? "").slice(0, 480)}`,
        payload: { error: result.error, status: result.status, configured: isGraphConfigured() },
      });
      // 502 Bad Gateway is the most accurate code: our request was fine,
      // the upstream (Graph) rejected it. The UI surfaces `message` raw.
      res.status(502).json({
        error: "graph_error",
        status: result.status ?? null,
        message: result.error ?? "Microsoft Graph returned an error.",
      });
      return;
    }

    const reSent = !!(target.previousMsObjectId && target.previousMsObjectId === result.msObjectId);
    const eventType = reSent ? "sso_invite_resent" : "sso_invite_sent";

    // Persist msObjectId / lastInviteAt / invitedBy on the right table.
    if (flow === "partner_application" || flow === "stripe_connect") {
      await db.update(partnersTable).set({
        msObjectId: result.msObjectId ?? target.previousMsObjectId ?? null,
        ssoInviteSentAt: now,
        ssoInviteSentBy: actorLabel,
        updatedAt: now,
      }).where(eq(partnersTable.id, id));
    } else if (flow === "partner_team_invite") {
      await db.update(partnerTeamMembersTable).set({
        msObjectId: result.msObjectId ?? target.previousMsObjectId ?? null,
        ssoInviteSentAt: now,
        ssoInviteSentBy: actorLabel,
        updatedAt: now,
      }).where(eq(partnerTeamMembersTable.id, id));
    } else if (flow === "admin_account") {
      await db.update(usersTable).set({
        msObjectId: result.msObjectId ?? target.previousMsObjectId ?? null,
        ssoInviteSentAt: now,
        ssoInviteSentBy: actorLabel,
      }).where(eq(usersTable.id, id));
    } else if (flow === "client_onboarding") {
      await db.update(clientOnboardingTable).set({
        msObjectId: result.msObjectId ?? target.previousMsObjectId ?? null,
        ssoInviteSentAt: now,
        ssoInviteSentBy: actorLabel,
        updatedAt: now,
      }).where(eq(clientOnboardingTable.id, id));
    }

    await recordOnboardingEvent({
      flow, entityId: id, eventType, ...audit,
      note: `${reSent ? "Re-sent" : "Sent"} Microsoft SSO invite to ${target.email}`,
      payload: { msObjectId: result.msObjectId, alreadyExisted: reSent },
    });

    res.json({
      ok: true,
      sentTo: target.email,
      msObjectId: result.msObjectId,
      alreadyExisted: reSent,
      ssoInviteSentAt: now.toISOString(),
      ssoInviteSentBy: actorLabel,
    });
  } catch (err) {
    console.error("[OnboardingAdmin] send sso invite error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "server_error", message: msg });
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
    // Honor the same flow / status / search / date-range filters the UI uses
    // so the CSV always matches the current list view.
    const { rows } = await buildOverviewRows(req);
    const lines: string[] = [];
    lines.push("flow,id,label,sub_label,email,status,status_kind,started_at,updated_at,age_hours,stale_hours,blocking_reason,reminder_count,last_reminder_sent_at,partner_company");

    const escape = (v: unknown): string => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    for (const r of rows) {
      lines.push([
        r.flow, r.id, r.label, r.subLabel ?? "", r.email ?? "", r.status, r.statusKind,
        r.startedAt ?? "", r.updatedAt ?? "",
        r.ageHours ?? "", r.staleHours ?? "",
        r.blockingReason ?? "", r.reminderCount, r.lastReminderSentAt ?? "",
        r.partnerCompanyName ?? "",
      ].map(escape).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="onboarding-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("[OnboardingAdmin] csv export error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * Revoke a pending partner team invite from the central command center.
 * Marks the invite as revoked and clears the token so any outstanding
 * invitation link stops working.
 */
router.post("/admin/onboarding/partner-team-invite/:id/revoke", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad_request" }); return; }
    const [row] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    if (row.status === "active") {
      res.status(400).json({ error: "already_active", message: "This member already accepted the invite." });
      return;
    }
    if (row.status === "revoked") {
      res.status(400).json({ error: "already_revoked" });
      return;
    }
    const now = new Date();
    await db
      .update(partnerTeamMembersTable)
      .set({ status: "revoked", inviteToken: null, inviteTokenExpires: null, updatedAt: now })
      .where(eq(partnerTeamMembersTable.id, id));
    await recordOnboardingEvent({
      flow: "partner_team_invite", entityId: id, eventType: "invite_revoked",
      actorType: "admin", actorId: req.userId ?? null, actorLabel: req.authEmail ?? null,
      note: `Invite revoked (was ${row.status})`,
      payload: { previousStatus: row.status },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[OnboardingAdmin] revoke invite error:", err);
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
