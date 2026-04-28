import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { isJtiRevoked, getCachedRolloutMode } from "../lib/session-utils.js";
import { generateJti, isStepUpRequired, revalidateRequest } from "../lib/azure-ad-access.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required but not set. Refusing to start with an insecure configuration.");
}

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  /** JWT id for revocation purposes (may be absent on legacy tokens). */
  authJti?: string;
  /** Unix seconds when the user last completed an interactive auth event. */
  authTime?: number;
  /** Email captured into the token at issue time, for audit + revalidation. */
  authEmail?: string;
}

interface JwtPayload {
  userId?: unknown;
  role?: unknown;
  jti?: unknown;
  auth_time?: unknown;
  email?: unknown;
  /** Standard JWT issued-at (Unix seconds). Set automatically by jsonwebtoken. */
  iat?: number;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7);
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    return;
  }

  if (typeof payload.userId !== "number" || typeof payload.role !== "string") {
    res.status(401).json({ error: "unauthorized", message: "Invalid token type" });
    return;
  }
  const ALLOWED_USER_ROLES = new Set(["client", "admin"]);
  if (!ALLOWED_USER_ROLES.has(payload.role)) {
    res.status(401).json({ error: "unauthorized", message: "Invalid token type" });
    return;
  }

  // Reject any token whose jti has been revoked (admin-initiated, Azure
  // role removal, or scheduled-sync tear-down). Legacy tokens that predate
  // jti are accepted for backwards compatibility.
  if (typeof payload.jti === "string") {
    if (await isJtiRevoked(payload.jti)) {
      res.status(401).json({ error: "session_revoked", message: "Your session has been revoked. Please sign in again.", force_logout: true });
      return;
    }
    req.authJti = payload.jti;
  }
  if (typeof payload.auth_time === "number") req.authTime = payload.auth_time;
  if (typeof payload.email === "string") req.authEmail = payload.email;

  req.userId = payload.userId;
  req.userRole = payload.role;

  // Account-level lock + post-password-change token rejection.
  try {
    const [u] = await db
      .select({ accountLockedAt: usersTable.accountLockedAt as any, passwordChangedAt: usersTable.passwordChangedAt })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId))
      .limit(1);
    if (u && (u as Record<string, unknown>).accountLockedAt) {
      res.status(401).json({
        error: "access_revoked",
        message: "Your access has been revoked. Please contact your administrator.",
        force_logout: true,
      });
      return;
    }
    // Reject tokens issued before the most recent password change/reset.
    // This ensures that stolen sessions are evicted when the account owner
    // changes their password, regardless of the token's remaining TTL.
    if (u?.passwordChangedAt && typeof payload.iat === "number") {
      const changedAtSec = Math.floor(u.passwordChangedAt.getTime() / 1000);
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
    console.error("[requireAuth] lock check error:", err);
  }

  // Per-request Azure revalidation when rollout mode is enforce. We only
  // revalidate if we have an email to match against and ONLY if the cached
  // last-check is stale (revalidateRequest itself enforces the TTL).
  try {
    const mode = await getCachedRolloutMode();
    if (mode !== "disabled" && req.authEmail) {
      const decision = await revalidateRequest({
        email: req.authEmail,
        portal: "client",
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
        return;
      }
    }
  } catch (err) {
    // Never let a revalidation failure block a request: log and continue.
    console.error("[requireAuth] revalidation error:", err);
  }

  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Admin access required" });
      return;
    }
    next();
  });
}

/** Refuses requests whose underlying interactive auth is older than `maxAgeSec`.
 *  The client should redirect to /api/auth/sso/microsoft/step-up on a 401
 *  with reason=stepup_required. */
export function requireStepUp(maxAgeSec = 300) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
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

interface GenerateTokenOpts {
  email?: string;
  /** Unix seconds when interactive auth completed (defaults to now). */
  authTime?: number;
  jti?: string;
  expiresIn?: jwt.SignOptions["expiresIn"];
}

/** Issues a user JWT with the new claim shape (jti, auth_time, email).
 *  Backwards-compatible with the old (userId, role) signature. */
export function generateToken(userId: number, role: string, opts: GenerateTokenOpts = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const jti = opts.jti ?? generateJti();
  const payload: Record<string, unknown> = {
    userId,
    role,
    jti,
    auth_time: opts.authTime ?? now,
  };
  if (opts.email) payload.email = opts.email.toLowerCase();
  return jwt.sign(payload, JWT_SECRET, { expiresIn: opts.expiresIn ?? "7d" });
}
