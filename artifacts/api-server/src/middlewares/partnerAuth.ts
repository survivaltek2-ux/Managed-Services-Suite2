import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, partnerTeamMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const PARTNER_JWT_SECRET = process.env.JWT_SECRET;
if (!PARTNER_JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required but not set. Refusing to start with an insecure configuration.");
}

export const MAIN_SITE_ADMIN_SENTINEL = -999;

export interface PartnerRequest extends Request {
  partnerId?: number;
  partnerIsAdmin?: boolean;
  mainSiteUserId?: number;
  /** Set when the request is authenticated as an invited team member of a partner company. */
  teamMemberId?: number;
}

interface PartnerTokenPayload {
  partnerId: number;
  isAdmin?: boolean;
  teamMemberId?: number;
}

interface AdminTokenPayload {
  userId: number;
  role: string;
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

  if (isAdminTokenPayload(payload)) {
    req.partnerId = MAIN_SITE_ADMIN_SENTINEL;
    req.mainSiteUserId = payload.userId;
    req.partnerIsAdmin = true;
    next();
    return;
  }

  if (isPartnerTokenPayload(payload)) {
    req.partnerId = payload.partnerId;
    // A team-member session never grants admin privileges, even if the token
    // somehow carries `isAdmin: true`.
    req.teamMemberId = typeof payload.teamMemberId === "number" ? payload.teamMemberId : undefined;
    req.partnerIsAdmin = req.teamMemberId ? false : payload.isAdmin === true;

    // Re-validate team-member status on every request so that revoked or
    // pending sessions cannot keep using a previously issued token.
    if (req.teamMemberId) {
      try {
        const [member] = await db
          .select({
            id: partnerTeamMembersTable.id,
            partnerId: partnerTeamMembersTable.partnerId,
            status: partnerTeamMembersTable.status,
          })
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
      } catch (err) {
        console.error("[partnerAuth] Failed to validate team member:", err);
        res.status(500).json({ error: "server_error", message: "Failed to validate session." });
        return;
      }
    }

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

export function generatePartnerToken(partnerId: number, isAdmin = false): string {
  return jwt.sign({ partnerId, isAdmin }, PARTNER_JWT_SECRET, { expiresIn: "30d" });
}

/**
 * Token for an invited team-member session. Carries the parent partnerId and
 * the team-member's own id; admin scope is always denied.
 */
export function generateTeamMemberToken(partnerId: number, teamMemberId: number): string {
  return jwt.sign({ partnerId, teamMemberId, isAdmin: false }, PARTNER_JWT_SECRET, { expiresIn: "30d" });
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
