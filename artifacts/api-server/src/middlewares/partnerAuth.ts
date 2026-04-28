import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, partnerTeamMembersTable, partnersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isJtiRevoked, getCachedRolloutMode } from "../lib/session-utils.js";
import { generateJti, isStepUpRequired, revalidateRequest } from "../lib/azure-ad-access.js";

const PARTNER_JWT_SECRET = process.env.JWT_SECRET;
if (!PARTNER_JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required but not set. Refusing to start with an insecure configuration.");
}

export const MAIN_SITE_ADMIN_SENTINEL = -999;

export interface TeamMemberPermissions {
  canViewDeals: boolean;
  canCreateDeals: boolean;
  canViewLeads: boolean;
  canCreateLeads: boolean;
  canViewCommissions: boolean;
  canViewResources: boolean;
  canCreatePlans: boolean;
}

export interface PartnerRequest extends Request {
  partnerId?: number;
  partnerIsAdmin?: boolean;
  mainSiteUserId?: number;
  /** Set when the request is authenticated as an invited team member of a partner company. */
  teamMemberId?: number;
  /** Permission flags for team-member sessions; undefined for full partner/admin sessions. */
  teamMemberPermissions?: TeamMemberPermissions;
  /** JWT id for revocation purposes (may be absent on legacy tokens). */
  authJti?: string;
  /** Unix seconds when the user last completed an interactive auth event. */
  authTime?: number;
  /** Email associated with the token, for audit + revalidation. */
  authEmail?: string;
}

interface PartnerTokenPayload {
  partnerId: number;
  isAdmin?: boolean;
  teamMemberId?: number;
  jti?: string;
  auth_time?: number;
  email?: string;
  /** Standard JWT issued-at (Unix seconds). Set automatically by jsonwebtoken. */
  iat?: number;
}

interface AdminTokenPayload {
  userId: number;
  role: string;
  jti?: string;
  auth_time?: number;
  email?: string;
  /** Standard JWT issued-at (Unix seconds). Set automatically by jsonwebtoken. */
  iat?: number;
}

function isPartnerTokenPayload(payload: unknown): payload is PartnerTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).partnerId === "number"
  );
}

function isAdminTokenPayload(payload: unknown): payload is AdminTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).userId === "number" &&
    (payload as Record<string, unknown>).role === "admin"
  );
}

function applyJwtMeta(
  req: PartnerRequest,
  payload: { jti?: string; auth_time?: number; email?: string },
): void {
  if (typeof payload.jti === "string") req.authJti = payload.jti;
  if (typeof payload.auth_time === "number") req.authTime = payload.auth_time;
  if (typeof payload.email === "string") req.authEmail = payload.email;
}

async function azureRevalidate(
  req: PartnerRequest,
  res: Response,
  portal: "partner" | "admin",
): Promise<boolean> {
  // Returns true when the request should continue, false when the response
  // has already been written (deny in enforce mode).
  try {
    const mode = await getCachedRolloutMode();
    if (mode === "disabled" || !req.authEmail) return true;
    const decision = await revalidateRequest({
      email: req.authEmail,
      portal,
      source: "password",
      staleAfterSec: 300,
    });
    if (decision && !decision.allowed && mode === "enforce") {
      res.status(401).json({
        error: "access_revoked",
        message: decision.friendlyMessage || "Your access has been revoked.",
        reason: decision.reason,
        force_logout: true,
      });
      return false;
    }
  } catch (err) {
    console.error("[partnerAuth] revalidation error:", err);
  }
  return true;
}

export async function requirePartnerAuth(req: PartnerRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7);
  let payload: unknown;
  try {
    payload = jwt.verify(token, PARTNER_JWT_SECRET);
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    return;
  }

  // Honor revocations regardless of which token shape is in flight.
  const jti = (payload as { jti?: unknown })?.jti;
  if (typeof jti === "string" && await isJtiRevoked(jti)) {
    res.status(401).json({ error: "session_revoked", message: "Your session has been revoked. Please sign in again.", force_logout: true });
    return;
  }

  if (isAdminTokenPayload(payload)) {
    req.partnerId = MAIN_SITE_ADMIN_SENTINEL;
    req.mainSiteUserId = payload.userId;
    req.partnerIsAdmin = true;
    applyJwtMeta(req, payload);
    // Reject tokens issued before the user's most recent password change.
    try {
      const [adminUser] = await db
        .select({ passwordChangedAt: usersTable.passwordChangedAt })
        .from(usersTable)
        .where(eq(usersTable.id, payload.userId))
        .limit(1);
      if (adminUser?.passwordChangedAt && typeof payload.iat === "number") {
        const changedAtSec = Math.floor(adminUser.passwordChangedAt.getTime() / 1000);
        if (payload.iat < changedAtSec) {
          res.status(401).json({
            error: "session_revoked",
            message: "Your session has expired due to a password change. Please sign in again.",
            force_logout: true,
          });
          return;
        }
      }
    } catch (err) {
      console.error("[partnerAuth] admin passwordChangedAt check error:", err);
    }
    if (!(await azureRevalidate(req, res, "admin"))) return;
    next();
    return;
  }

  if (isPartnerTokenPayload(payload)) {
    req.partnerId = payload.partnerId;
    // A team-member session never grants admin privileges, even if the token
    // somehow carries `isAdmin: true`.
    req.teamMemberId = typeof payload.teamMemberId === "number" ? payload.teamMemberId : undefined;
    req.partnerIsAdmin = req.teamMemberId ? false : payload.isAdmin === true;
    applyJwtMeta(req, payload);

    // Re-validate partner account status on every request so that pending,
    // rejected, or suspended partners cannot use previously issued tokens.
    try {
      const [partner] = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.id, payload.partnerId))
        .limit(1);
      if (!partner) {
        res.status(401).json({ error: "unauthorized", message: "Partner account not found." });
        return;
      }
      // Account-level lock — used by Azure-AD admin "revoke by email" path.
      if ((partner as Record<string, unknown>).accountLockedAt) {
        res.status(401).json({
          error: "access_revoked",
          message: "Your access has been revoked. Please contact your administrator.",
          force_logout: true,
        });
        return;
      }
      // Reject tokens issued before the most recent password change/reset.
      if ((partner as Record<string, unknown>).passwordChangedAt && typeof payload.iat === "number") {
        const changedAtSec = Math.floor(((partner as Record<string, unknown>).passwordChangedAt as Date).getTime() / 1000);
        if (payload.iat < changedAtSec) {
          res.status(401).json({
            error: "session_revoked",
            message: "Your session has expired due to a password change. Please sign in again.",
            force_logout: true,
          });
          return;
        }
      }
      if (partner.status === "pending") {
        res.status(403).json({ error: "pending_approval", message: "Your account is pending approval." });
        return;
      }
      if (partner.status === "rejected") {
        res.status(403).json({ error: "account_rejected", message: "Your partner account application was not approved." });
        return;
      }
      if (partner.status === "suspended") {
        res.status(403).json({ error: "account_suspended", message: "Your account has been suspended. Please contact support." });
        return;
      }
    } catch (err) {
      console.error("[partnerAuth] Failed to validate partner status:", err);
      res.status(500).json({ error: "server_error", message: "Failed to validate session." });
      return;
    }

    // Re-validate team-member status on every request so that revoked or
    // pending sessions cannot keep using a previously issued token.
    if (req.teamMemberId) {
      try {
        const [member] = await db
          .select()
          .from(partnerTeamMembersTable)
          .where(eq(partnerTeamMembersTable.id, req.teamMemberId))
          .limit(1);
        if (!member || member.status !== "active") {
          res.status(401).json({ error: "team_member_inactive", message: "Your team access is no longer active." });
          return;
        }
        if (member.partnerId !== req.partnerId) {
          res.status(401).json({ error: "team_member_mismatch", message: "Team membership context is invalid." });
          return;
        }
        req.teamMemberPermissions = {
          canViewDeals: member.canViewDeals,
          canCreateDeals: member.canCreateDeals,
          canViewLeads: member.canViewLeads,
          canCreateLeads: member.canCreateLeads,
          canViewCommissions: member.canViewCommissions,
          canViewResources: member.canViewResources,
          canCreatePlans: member.canCreatePlans,
        };
      } catch (err) {
        console.error("[partnerAuth] Failed to validate team member:", err);
        res.status(500).json({ error: "server_error", message: "Failed to validate session." });
        return;
      }
    }

    if (!(await azureRevalidate(req, res, "partner"))) return;

    next();
    return;
  }

  res.status(401).json({ error: "unauthorized", message: "Invalid token payload" });
}

export function isMainSiteAdmin(req: PartnerRequest): boolean {
  return req.partnerId === MAIN_SITE_ADMIN_SENTINEL;
}

export function requirePartnerAdmin(req: PartnerRequest, res: Response, next: NextFunction) {
  requirePartnerAuth(req, res, () => {
    if (!req.partnerIsAdmin) {
      res.status(403).json({ error: "forbidden", message: "Admin access required" });
      return;
    }
    next();
  });
}

/** Step-up auth for sensitive partner-portal admin actions. */
export function requirePartnerStepUp(maxAgeSec = 300) {
  return (req: PartnerRequest, res: Response, next: NextFunction) => {
    requirePartnerAuth(req, res, () => {
      if (isStepUpRequired(req.authTime, maxAgeSec)) {
        res.status(401).json({
          error: "stepup_required",
          message: "This action requires you to re-confirm your identity.",
          maxAgeSec,
        });
        return;
      }
      next();
    });
  };
}

interface PartnerTokenOpts {
  email?: string;
  authTime?: number;
  jti?: string;
  expiresIn?: jwt.SignOptions["expiresIn"];
}

export function generatePartnerToken(partnerId: number, isAdmin = false, opts: PartnerTokenOpts = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    partnerId,
    isAdmin,
    jti: opts.jti ?? generateJti(),
    auth_time: opts.authTime ?? now,
  };
  if (opts.email) payload.email = opts.email.toLowerCase();
  return jwt.sign(payload, PARTNER_JWT_SECRET, { expiresIn: opts.expiresIn ?? "30d" });
}

/**
 * Token for an invited team-member session. Carries the parent partnerId and
 * the team-member's own id; admin scope is always denied.
 */
export function generateTeamMemberToken(
  partnerId: number,
  teamMemberId: number,
  opts: PartnerTokenOpts = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    partnerId,
    teamMemberId,
    isAdmin: false,
    jti: opts.jti ?? generateJti(),
    auth_time: opts.authTime ?? now,
  };
  if (opts.email) payload.email = opts.email.toLowerCase();
  return jwt.sign(payload, PARTNER_JWT_SECRET, { expiresIn: opts.expiresIn ?? "30d" });
}

/**
 * Block routes that only the company's primary partner (admin) is allowed to use.
 * Requires:
 *  - a real partner token (not a main-site sentinel),
 *  - not a team-member session,
 *  - and the partner row is flagged isAdmin === true.
 */
export function requirePartnerCompanyAdmin(req: PartnerRequest, res: Response, next: NextFunction) {
  requirePartnerAuth(req, res, () => {
    if (req.teamMemberId) {
      res.status(403).json({ error: "team_member_forbidden", message: "This action is restricted to the partner company admin." });
      return;
    }
    if (req.partnerId === MAIN_SITE_ADMIN_SENTINEL) {
      res.status(403).json({ error: "forbidden", message: "Use the partner company admin account to manage team members." });
      return;
    }
    if (req.partnerIsAdmin !== true) {
      res.status(403).json({ error: "forbidden", message: "This action is restricted to the partner company admin." });
      return;
    }
    next();
  });
}
