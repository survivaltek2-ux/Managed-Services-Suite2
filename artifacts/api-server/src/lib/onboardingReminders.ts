/**
 * Background scheduler for the Onboarding Command Center (Task #189).
 *
 * Every interval, sweeps each onboarding flow for entities that:
 *   - are still in a non-terminal state,
 *   - have not received a reminder within the cooldown window,
 *   - have not exceeded the max reminders per entity, and
 *   - have aged past the per-flow overdue threshold.
 *
 * Each successful send updates the entity's reminder counters, refreshes
 * the cached Stripe Connect status (for that flow), and records an event
 * in `onboarding_events` so the audit trail is complete.
 *
 * The scheduler is fully no-op when `onboarding_settings.paused = true`.
 */
import { db, partnersTable, partnerTeamMembersTable, clientOnboardingTable, usersTable } from "@workspace/db";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { loadOnboardingSettings } from "./onboardingEvents.js";
import { recordOnboardingEvent } from "./onboardingEvents.js";
import { refreshPartnerStripeStatus } from "./stripeConnectStatus.js";
import {
  sendStripeConnectReminder,
  sendPartnerApplicationReminderEmail,
  sendClientOnboardingReminderEmail,
  sendUserWelcomeReminderEmail,
  sendPartnerTeamInviteEmail,
} from "./email.js";
import { issueClientPortalToken } from "../routes/client-portal.js";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let intervalHandle: NodeJS.Timeout | null = null;

export function startOnboardingReminderScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (intervalHandle) return;
  // First run is delayed slightly so it doesn't compete with startup
  setTimeout(() => {
    runOnboardingReminderSweep().catch(err => console.error("[OnboardingReminders] sweep error:", err));
  }, 60_000);
  intervalHandle = setInterval(() => {
    runOnboardingReminderSweep().catch(err => console.error("[OnboardingReminders] sweep error:", err));
  }, intervalMs);
  console.log(`[OnboardingReminders] scheduler started (interval=${intervalMs}ms)`);
}

interface SweepCounts {
  partnerApp: number;
  clientOnb: number;
  teamInvite: number;
  stripeConnect: number;
  adminAcct: number;
  skippedPaused: boolean;
  skippedMax: number;
  skippedCooldown: number;
}

export async function runOnboardingReminderSweep(): Promise<SweepCounts> {
  const counts: SweepCounts = {
    partnerApp: 0,
    clientOnb: 0,
    teamInvite: 0,
    stripeConnect: 0,
    adminAcct: 0,
    skippedPaused: false,
    skippedMax: 0,
    skippedCooldown: 0,
  };
  const settings = await loadOnboardingSettings();
  if (settings.paused) {
    counts.skippedPaused = true;
    console.log("[OnboardingReminders] paused — sweep skipped");
    return counts;
  }
  const now = new Date();
  const cooldownMs = settings.reminderCooldownHours * 3600000;
  const cutoff = (h: number) => new Date(now.getTime() - h * 3600000);
  const portalBase = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "siebertrservices.com"}`).replace(/\/+$/, "");

  const eligible = (lastSentAt: Date | null, count: number) => {
    if (count >= settings.maxRemindersPerEntity) { counts.skippedMax++; return false; }
    if (lastSentAt && now.getTime() - new Date(lastSentAt).getTime() < cooldownMs) { counts.skippedCooldown++; return false; }
    return true;
  };

  // ── Partner Applications ───────────────────────────────────────────────
  try {
    const candidates = await db
      .select()
      .from(partnersTable)
      .where(and(eq(partnersTable.status, "pending"), lt(partnersTable.createdAt, cutoff(settings.partnerApplicationOverdueHours))));
    for (const p of candidates) {
      if (!eligible(p.lastApplicationReminderSentAt ?? null, p.applicationReminderCount ?? 0)) continue;
      const ok = await sendPartnerApplicationReminderEmail({ companyName: p.companyName, contactName: p.contactName, email: p.email });
      if (!ok) continue;
      await db
        .update(partnersTable)
        .set({ lastApplicationReminderSentAt: now, applicationReminderCount: (p.applicationReminderCount ?? 0) + 1 })
        .where(eq(partnersTable.id, p.id));
      await recordOnboardingEvent({
        flow: "partner_application", entityId: p.id, eventType: "reminder_sent",
        actorType: "system", note: `Auto-reminder sent to ${p.email}`,
        payload: { reminderCount: (p.applicationReminderCount ?? 0) + 1 },
      });
      counts.partnerApp++;
    }
  } catch (err) { console.error("[OnboardingReminders] partner_application:", err); }

  // ── Client Onboarding ──────────────────────────────────────────────────
  try {
    const candidates = await db
      .select()
      .from(clientOnboardingTable)
      .where(and(ne(clientOnboardingTable.status, "completed"), lt(clientOnboardingTable.updatedAt, cutoff(settings.clientOnboardingOverdueHours))));
    for (const o of candidates) {
      if (!eligible(o.lastReminderSentAt ?? null, o.reminderCount ?? 0)) continue;
      let portalUrl = `${portalBase}/portal`;
      try {
        const tokenRow = await issueClientPortalToken({
          partnerId: o.partnerId,
          planId: o.planId,
          clientEmail: o.clientEmail,
          clientName: o.clientEmail.split("@")[0],
          clientCompany: o.clientCompany,
          ttlDays: 30,
        });
        portalUrl = `${portalBase}/c/${tokenRow.token}/onboarding`;
      } catch (issueErr) {
        console.error("[OnboardingReminders] issueToken failed:", issueErr);
      }
      const ok = await sendClientOnboardingReminderEmail({
        clientName: o.clientEmail.split("@")[0],
        clientEmail: o.clientEmail,
        clientCompany: o.clientCompany,
        currentStep: o.currentStep,
        portalUrl,
      });
      if (!ok) continue;
      await db
        .update(clientOnboardingTable)
        .set({ lastReminderSentAt: now, reminderCount: (o.reminderCount ?? 0) + 1 })
        .where(eq(clientOnboardingTable.id, o.id));
      await recordOnboardingEvent({
        flow: "client_onboarding", entityId: o.id, eventType: "reminder_sent",
        actorType: "system", note: `Auto-reminder sent to ${o.clientEmail}`,
        payload: { reminderCount: (o.reminderCount ?? 0) + 1, currentStep: o.currentStep },
      });
      counts.clientOnb++;
    }
  } catch (err) { console.error("[OnboardingReminders] client_onboarding:", err); }

  // ── Partner Team Invites ───────────────────────────────────────────────
  try {
    const candidates = await db
      .select()
      .from(partnerTeamMembersTable)
      .where(and(eq(partnerTeamMembersTable.status, "pending"), lt(partnerTeamMembersTable.invitedAt, cutoff(settings.partnerTeamInviteOverdueHours))));
    for (const m of candidates) {
      if (!eligible(m.lastReminderSentAt ?? null, m.reminderCount ?? 0)) continue;
      // Don't rotate the invite token automatically — that would invalidate
      // any link the user may already have. If the existing token is still
      // valid, send a reminder email reusing it. If it has expired, skip
      // and require admin to manually resend (which generates a new token).
      const expired = m.inviteTokenExpires && m.inviteTokenExpires < now;
      if (expired || !m.inviteToken) {
        await recordOnboardingEvent({
          flow: "partner_team_invite", entityId: m.id, eventType: "auto_reminder_skipped",
          actorType: "system", note: `Skipped: invite token expired — admin must manually resend`,
          payload: { reminderCount: m.reminderCount ?? 0 },
        });
        counts.skippedMax++;
        continue;
      }
      const [partner] = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.id, m.partnerId))
        .limit(1);
      const ok = await sendPartnerTeamInviteEmail({
        to: m.email,
        inviteeName: m.name,
        inviterName: partner?.contactName ?? "Your team",
        companyName: partner?.companyName ?? "Siebert Services",
        inviteToken: m.inviteToken,
      });
      if (!ok) continue;
      await db
        .update(partnerTeamMembersTable)
        .set({ lastReminderSentAt: now, reminderCount: (m.reminderCount ?? 0) + 1 })
        .where(eq(partnerTeamMembersTable.id, m.id));
      await recordOnboardingEvent({
        flow: "partner_team_invite", entityId: m.id, eventType: "reminder_sent",
        actorType: "system", note: `Auto-reminder sent to ${m.email}`,
        payload: { reminderCount: (m.reminderCount ?? 0) + 1 },
      });
      counts.teamInvite++;
    }
  } catch (err) { console.error("[OnboardingReminders] partner_team_invite:", err); }

  // ── Stripe Connect ─────────────────────────────────────────────────────
  try {
    const candidates = await db
      .select()
      .from(partnersTable)
      .where(and(eq(partnersTable.status, "approved"), isNull(partnersTable.stripeConnectAccountId)));
    for (const p of candidates) {
      if (!eligible(p.lastStripeReminderSentAt ?? null, p.stripeReminderCount ?? 0)) continue;
      // Only nudge if approved long enough ago to be considered overdue.
      const startRef = p.approvedAt ?? p.createdAt;
      if (!startRef || startRef >= cutoff(settings.stripeConnectOverdueHours)) continue;
      const ok = await sendStripeConnectReminder({ companyName: p.companyName, contactName: p.contactName, email: p.email });
      if (!ok) continue;
      await db
        .update(partnersTable)
        .set({ lastStripeReminderSentAt: now, stripeReminderCount: (p.stripeReminderCount ?? 0) + 1 })
        .where(eq(partnersTable.id, p.id));
      await recordOnboardingEvent({
        flow: "stripe_connect", entityId: p.id, eventType: "reminder_sent",
        actorType: "system", note: `Auto-reminder sent to ${p.email}`,
        payload: { reminderCount: (p.stripeReminderCount ?? 0) + 1 },
      });
      counts.stripeConnect++;
    }
    // Also refresh status for partners with an account so we can detect blockers
    const accountPartners = await db
      .select()
      .from(partnersTable)
      .where(and(eq(partnersTable.status, "approved"), or(isNull(partnersTable.stripeConnectRefreshedAt), lt(partnersTable.stripeConnectRefreshedAt, cutoff(24)))));
    for (const p of accountPartners) {
      if (!p.stripeConnectAccountId) continue;
      try { await refreshPartnerStripeStatus(p.id); } catch {/* logged inside */}
    }

    // Also auto-remind partners whose Stripe account exists but is stuck in
    // restricted / invalid / in_progress state (action_required). Without
    // this they'd be silently stuck after the first link was issued. Re-read
    // the partner record after the refresh above so we use fresh status.
    const stalledStripe = await db
      .select()
      .from(partnersTable)
      .where(and(
        eq(partnersTable.status, "approved"),
        or(
          eq(partnersTable.stripeConnectStatus, "restricted"),
          eq(partnersTable.stripeConnectStatus, "invalid"),
          eq(partnersTable.stripeConnectStatus, "in_progress"),
        ),
      ));
    for (const p of stalledStripe) {
      if (!p.stripeConnectAccountId) continue;
      if (!eligible(p.lastStripeReminderSentAt ?? null, p.stripeReminderCount ?? 0)) continue;
      // Gate on time-in-onboarding (approval timestamp), NOT on
      // stripeConnectRefreshedAt — the refresh loop above renews refreshedAt
      // every ~24h, which would keep "ref" perpetually fresh and silently
      // suppress reminders past the overdue threshold. Using approvedAt
      // (or createdAt as a fallback) measures the true time the account has
      // been stuck in restricted/invalid/in_progress.
      const ref = p.approvedAt ?? p.createdAt;
      if (!ref || ref >= cutoff(settings.stripeConnectOverdueHours)) continue;
      const ok = await sendStripeConnectReminder({ companyName: p.companyName, contactName: p.contactName, email: p.email });
      if (!ok) continue;
      await db
        .update(partnersTable)
        .set({ lastStripeReminderSentAt: now, stripeReminderCount: (p.stripeReminderCount ?? 0) + 1 })
        .where(eq(partnersTable.id, p.id));
      await recordOnboardingEvent({
        flow: "stripe_connect", entityId: p.id, eventType: "reminder_sent",
        actorType: "system",
        note: `Auto-reminder sent (${p.stripeConnectStatus}) to ${p.email}${p.stripeConnectBlockingRequirement ? ` — blocked on ${p.stripeConnectBlockingRequirement}` : ""}`,
        payload: {
          reminderCount: (p.stripeReminderCount ?? 0) + 1,
          status: p.stripeConnectStatus,
          blockingRequirement: p.stripeConnectBlockingRequirement ?? null,
        },
      });
      counts.stripeConnect++;
    }
  } catch (err) { console.error("[OnboardingReminders] stripe_connect:", err); }

  // ── Admin / Employee Accounts ──────────────────────────────────────────
  // Match the overview's admin_account scope: anyone with role='admin' OR
  // mustChangePassword=true. This covers admins, internal staff invited as
  // employees, and any user account still requiring a password change.
  try {
    const candidates = await db
      .select()
      .from(usersTable)
      .where(and(
        or(eq(usersTable.role, "admin"), eq(usersTable.mustChangePassword, true)),
        isNull(usersTable.lastLoginAt),
        lt(usersTable.createdAt, cutoff(settings.adminAccountOverdueHours)),
      ));
    for (const u of candidates) {
      if (!eligible(u.lastWelcomeSentAt ?? null, u.welcomeReminderCount ?? 0)) continue;
      const ok = await sendUserWelcomeReminderEmail({
        name: u.name, email: u.email,
        loginUrl: `${portalBase}/portal`,
      });
      if (!ok) continue;
      await db
        .update(usersTable)
        .set({ lastWelcomeSentAt: now, welcomeReminderCount: (u.welcomeReminderCount ?? 0) + 1 })
        .where(eq(usersTable.id, u.id));
      await recordOnboardingEvent({
        flow: "admin_account", entityId: u.id, eventType: "reminder_sent",
        actorType: "system", note: `Auto welcome reminder sent to ${u.email}`,
        payload: { reminderCount: (u.welcomeReminderCount ?? 0) + 1 },
      });
      counts.adminAcct++;
    }
  } catch (err) { console.error("[OnboardingReminders] admin_account:", err); }

  console.log(`[OnboardingReminders] sweep complete: partnerApp=${counts.partnerApp} clientOnb=${counts.clientOnb} teamInvite=${counts.teamInvite} stripe=${counts.stripeConnect} admin=${counts.adminAcct} skippedCooldown=${counts.skippedCooldown} skippedMax=${counts.skippedMax}`);
  return counts;
}
