import { Router, type Response } from "express";
import crypto from "crypto";
import { db, partnersTable, partnerTeamMembersTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  requirePartnerAuth,
  requirePartnerCompanyAdmin,
  type PartnerRequest,
} from "../middlewares/partnerAuth.js";
import { sendPartnerTeamInviteEmail } from "../lib/email.js";
import { recordOnboardingEvent } from "../lib/onboardingEvents.js";
import { sendGuestInviteForRecord, isGraphConfigured } from "../lib/microsoft-graph.js";

const router = Router();

const PERMISSION_KEYS = [
  "canViewDeals",
  "canCreateDeals",
  "canViewLeads",
  "canCreateLeads",
  "canViewCommissions",
  "canViewResources",
  "canCreatePlans",
] as const;

type PermissionKey = typeof PERMISSION_KEYS[number];

function pickPermissions(input: Record<string, unknown> | undefined | null): Partial<Record<PermissionKey, boolean>> {
  const out: Partial<Record<PermissionKey, boolean>> = {};
  if (!input || typeof input !== "object") return out;
  for (const key of PERMISSION_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function publicMember(m: typeof partnerTeamMembersTable.$inferSelect) {
  return {
    id: m.id,
    email: m.email,
    name: m.name,
    status: m.status,
    canViewDeals: m.canViewDeals,
    canCreateDeals: m.canCreateDeals,
    canViewLeads: m.canViewLeads,
    canCreateLeads: m.canCreateLeads,
    canViewCommissions: m.canViewCommissions,
    canViewResources: m.canViewResources,
    canCreatePlans: m.canCreatePlans,
    invitedAt: m.invitedAt,
    acceptedAt: m.acceptedAt,
    lastLoginAt: m.lastLoginAt,
    // Microsoft SSO (Entra B2B) lifecycle (Task #191).
    msObjectId: m.msObjectId ?? null,
    ssoInviteSentAt: m.ssoInviteSentAt,
    ssoInviteSentBy: m.ssoInviteSentBy ?? null,
  };
}

router.get(
  "/partner/team",
  requirePartnerAuth,
  async (req: PartnerRequest, res: Response) => {
    if (!req.partnerId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const rows = await db
      .select()
      .from(partnerTeamMembersTable)
      .where(eq(partnerTeamMembersTable.partnerId, req.partnerId))
      .orderBy(desc(partnerTeamMembersTable.invitedAt));
    res.json({ members: rows.map(publicMember) });
  },
);

router.post(
  "/partner/team/invite",
  requirePartnerCompanyAdmin,
  async (req: PartnerRequest, res: Response) => {
    if (!req.partnerId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const email = normalizeEmail(req.body?.email);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!email || !name) {
      res.status(400).json({ error: "validation_error", message: "Name and email are required." });
      return;
    }

    const [partner] = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.id, req.partnerId))
      .limit(1);
    if (!partner) {
      res.status(404).json({ error: "partner_not_found" });
      return;
    }

    const partnerDomain = partner.email.split("@")[1]?.toLowerCase() ?? "";
    const inviteDomain = email.split("@")[1]?.toLowerCase() ?? "";
    if (partnerDomain && inviteDomain && partnerDomain !== inviteDomain) {
      res.status(400).json({
        error: "domain_mismatch",
        message: `Team members must use an @${partnerDomain} email address.`,
      });
      return;
    }
    if (email === partner.email.toLowerCase()) {
      res.status(400).json({ error: "self_invite", message: "You cannot invite yourself." });
      return;
    }

    // Email is globally unique across all partner team rosters. Look up any
    // existing row by email so we can either re-invite (same partner) or reject
    // with a clear conflict (other partner).
    const [existingAny] = await db
      .select()
      .from(partnerTeamMembersTable)
      .where(eq(partnerTeamMembersTable.email, email))
      .limit(1);

    if (existingAny && existingAny.partnerId !== req.partnerId) {
      res.status(409).json({
        error: "email_belongs_to_other_partner",
        message: "This email is already a team member of another partner company.",
      });
      return;
    }

    const permissions = pickPermissions(req.body?.permissions ?? req.body);
    const inviteToken = crypto.randomBytes(24).toString("hex");
    const inviteTokenExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    let memberId: number;
    if (existingAny) {
      if (existingAny.status === "active") {
        res.status(409).json({ error: "already_member", message: "This person is already an active team member." });
        return;
      }
      await db
        .update(partnerTeamMembersTable)
        .set({
          name,
          status: "pending",
          inviteToken,
          inviteTokenExpires,
          updatedAt: new Date(),
          ...permissions,
        })
        .where(eq(partnerTeamMembersTable.id, existingAny.id));
      memberId = existingAny.id;
    } else {
      const [created] = await db
        .insert(partnerTeamMembersTable)
        .values({
          partnerId: req.partnerId,
          email,
          name,
          status: "pending",
          inviteToken,
          inviteTokenExpires,
          ...permissions,
        })
        .returning({ id: partnerTeamMembersTable.id });
      memberId = created.id;
    }

    sendPartnerTeamInviteEmail({
      to: email,
      inviteeName: name,
      inviterName: partner.contactName,
      companyName: partner.companyName,
      inviteToken,
    }).catch(err => console.error("[PartnerTeam] Invite email error:", err));

    recordOnboardingEvent({
      flow: "partner_team_invite", entityId: memberId, eventType: "invite_sent",
      actorType: "partner", actorId: req.partnerId ?? null,
      note: `Invite sent to ${email}`, payload: { inviterName: partner.contactName, companyName: partner.companyName },
    }).catch(() => {});

    const [member] = await db
      .select()
      .from(partnerTeamMembersTable)
      .where(eq(partnerTeamMembersTable.id, memberId))
      .limit(1);
    res.json({ member: publicMember(member) });
  },
);

router.post(
  "/partner/team/:id/resend",
  requirePartnerCompanyAdmin,
  async (req: PartnerRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!req.partnerId || Number.isNaN(id)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const [member] = await db
      .select()
      .from(partnerTeamMembersTable)
      .where(and(
        eq(partnerTeamMembersTable.id, id),
        eq(partnerTeamMembersTable.partnerId, req.partnerId),
      ))
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const [partner] = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.id, req.partnerId))
      .limit(1);
    if (!partner) {
      res.status(404).json({ error: "partner_not_found" });
      return;
    }
    const inviteToken = crypto.randomBytes(24).toString("hex");
    const inviteTokenExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db
      .update(partnerTeamMembersTable)
      .set({
        status: "pending",
        inviteToken,
        inviteTokenExpires,
        updatedAt: new Date(),
      })
      .where(eq(partnerTeamMembersTable.id, member.id));
    sendPartnerTeamInviteEmail({
      to: member.email,
      inviteeName: member.name,
      inviterName: partner.contactName,
      companyName: partner.companyName,
      inviteToken,
    }).catch(err => console.error("[PartnerTeam] Resend invite error:", err));
    recordOnboardingEvent({
      flow: "partner_team_invite", entityId: member.id, eventType: "invite_resent",
      actorType: "partner", actorId: req.partnerId ?? null,
      note: `Invite resent to ${member.email}`,
    }).catch(() => {});
    res.json({ ok: true });
  },
);

router.put(
  "/partner/team/:id",
  requirePartnerCompanyAdmin,
  async (req: PartnerRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!req.partnerId || Number.isNaN(id)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const permissions = pickPermissions(req.body?.permissions ?? req.body);
    const update: Record<string, unknown> = { updatedAt: new Date(), ...permissions };
    if (typeof req.body?.name === "string" && req.body.name.trim()) {
      update.name = req.body.name.trim();
    }
    if (Object.keys(update).length === 1) {
      res.status(400).json({ error: "no_changes" });
      return;
    }
    const updated = await db
      .update(partnerTeamMembersTable)
      .set(update)
      .where(and(
        eq(partnerTeamMembersTable.id, id),
        eq(partnerTeamMembersTable.partnerId, req.partnerId),
      ))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ member: publicMember(updated[0]) });
  },
);

router.post(
  "/partner/team/:id/revoke",
  requirePartnerCompanyAdmin,
  async (req: PartnerRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!req.partnerId || Number.isNaN(id)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const updated = await db
      .update(partnerTeamMembersTable)
      .set({ status: "revoked", inviteToken: null, inviteTokenExpires: null, updatedAt: new Date() })
      .where(and(
        eq(partnerTeamMembersTable.id, id),
        eq(partnerTeamMembersTable.partnerId, req.partnerId),
      ))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ member: publicMember(updated[0]) });
  },
);

/**
 * Partner-side "Send Microsoft SSO invite" action (Task #191).
 * Lets a partner company admin (re)invite one of their team members as an
 * Entra B2B guest without going through the platform admin. Surfaces the
 * raw Graph error verbatim, persists msObjectId/ssoInviteSentAt/By, and
 * writes an audit event so the platform Onboarding Command Center sees
 * the same history.
 */
router.post(
  "/partner/team/:id/send-sso-invite",
  requirePartnerCompanyAdmin,
  async (req: PartnerRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!req.partnerId || Number.isNaN(id)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const [member] = await db
      .select()
      .from(partnerTeamMembersTable)
      .where(and(
        eq(partnerTeamMembersTable.id, id),
        eq(partnerTeamMembersTable.partnerId, req.partnerId),
      ))
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // Resolve a label for `ssoInviteSentBy` so the platform side can show
    // who triggered the invite. Partners use their company name + the
    // authenticated email for traceability.
    const [partner] = await db
      .select({ companyName: partnersTable.companyName, contactName: partnersTable.contactName })
      .from(partnersTable)
      .where(eq(partnersTable.id, req.partnerId))
      .limit(1);
    const actorLabel = `${req.authEmail ?? partner?.contactName ?? "partner"} (${partner?.companyName ?? "partner"})`;

    const portalBase = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "siebertservices.com"}`).replace(/\/+$/, "");
    const result = await sendGuestInviteForRecord({
      email: member.email,
      displayName: member.name,
      redirectUrl: `${portalBase}/partners/login`,
      customMessage: `Hi ${member.name}, ${partner?.companyName ?? "your company"} has enabled Microsoft single sign-on for the Siebert Services Partner Portal. Click below to accept the invitation and sign in.`,
    });

    const audit = { actorType: "partner" as const, actorId: req.partnerId, actorLabel: req.authEmail ?? partner?.contactName ?? null };

    if (!result.ok) {
      await recordOnboardingEvent({
        flow: "partner_team_invite", entityId: id, eventType: "sso_invite_failed", ...audit,
        note: `Microsoft SSO invite failed for ${member.email}: ${(result.error ?? "").slice(0, 480)}`,
        payload: { error: result.error, status: result.status, configured: isGraphConfigured() },
      });
      res.status(502).json({
        error: "graph_error",
        status: result.status ?? null,
        message: result.error ?? "Microsoft Graph returned an error.",
      });
      return;
    }

    const reSent = !!(member.msObjectId && member.msObjectId === result.msObjectId);
    const now = new Date();
    const [updated] = await db
      .update(partnerTeamMembersTable)
      .set({
        msObjectId: result.msObjectId ?? member.msObjectId ?? null,
        ssoInviteSentAt: now,
        ssoInviteSentBy: actorLabel,
        updatedAt: now,
      })
      .where(eq(partnerTeamMembersTable.id, id))
      .returning();

    await recordOnboardingEvent({
      flow: "partner_team_invite", entityId: id,
      eventType: reSent ? "sso_invite_resent" : "sso_invite_sent",
      ...audit,
      note: `${reSent ? "Re-sent" : "Sent"} Microsoft SSO invite to ${member.email}`,
      payload: { msObjectId: result.msObjectId, alreadyExisted: reSent },
    });

    res.json({
      ok: true,
      member: publicMember(updated),
      sentTo: member.email,
      msObjectId: result.msObjectId,
      alreadyExisted: reSent,
    });
  },
);

router.post(
  "/partner/team/:id/restore",
  requirePartnerCompanyAdmin,
  async (req: PartnerRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!req.partnerId || Number.isNaN(id)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const [existing] = await db
      .select()
      .from(partnerTeamMembersTable)
      .where(and(
        eq(partnerTeamMembersTable.id, id),
        eq(partnerTeamMembersTable.partnerId, req.partnerId),
      ))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const nextStatus = existing.acceptedAt ? "active" : "pending";
    const updated = await db
      .update(partnerTeamMembersTable)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(partnerTeamMembersTable.id, existing.id))
      .returning();
    res.json({ member: publicMember(updated[0]) });
  },
);

router.delete(
  "/partner/team/:id",
  requirePartnerCompanyAdmin,
  async (req: PartnerRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!req.partnerId || Number.isNaN(id)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const deleted = await db
      .delete(partnerTeamMembersTable)
      .where(and(
        eq(partnerTeamMembersTable.id, id),
        eq(partnerTeamMembersTable.partnerId, req.partnerId),
      ))
      .returning({ id: partnerTeamMembersTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  },
);

// Public endpoint used by the invite landing page so the invitee can see
// who invited them before clicking "Sign in with Microsoft".
router.get("/partner/team/invite/:token", async (req, res) => {
  const token = req.params.token;
  if (!token) {
    res.status(400).json({ error: "bad_request" });
    return;
  }
  const [member] = await db
    .select()
    .from(partnerTeamMembersTable)
    .where(eq(partnerTeamMembersTable.inviteToken, token))
    .limit(1);
  if (!member) {
    res.status(404).json({ error: "invalid_token" });
    return;
  }
  if (member.inviteTokenExpires && member.inviteTokenExpires < new Date()) {
    res.status(410).json({ error: "expired" });
    return;
  }
  if (member.status === "revoked") {
    res.status(403).json({ error: "revoked" });
    return;
  }
  const [partner] = await db
    .select({ companyName: partnersTable.companyName })
    .from(partnersTable)
    .where(eq(partnersTable.id, member.partnerId))
    .limit(1);
  res.json({
    email: member.email,
    name: member.name,
    companyName: partner?.companyName ?? "",
    status: member.status,
  });
});

export default router;
