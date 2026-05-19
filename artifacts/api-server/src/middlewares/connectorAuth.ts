import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, connectorsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isJtiRevoked, getSessionsRevokedBefore } from "../lib/session-utils.js";

const CONNECTOR_JWT_SECRET = process.env.JWT_SECRET;
if (!CONNECTOR_JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required but not set. Refusing to start with an insecure configuration.",
  );
}

export interface ConnectorRequest extends Request {
  connectorId?: number;
  connectorEmail?: string;
  isAdminPassthrough?: boolean;
  adminUserId?: number;
}

interface ConnectorTokenPayload {
  connectorId: number;
  email?: string;
  iat?: number;
}

interface AdminTokenPayload {
  userId: number;
  role: string;
  jti?: string;
  iat?: number;
  email?: string;
}

function isConnectorTokenPayload(payload: unknown): payload is ConnectorTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).connectorId === "number"
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

export function generateConnectorToken(connectorId: number, email?: string): string {
  const payload: Record<string, unknown> = { connectorId };
  if (email) payload.email = email.toLowerCase();
  return jwt.sign(payload, CONNECTOR_JWT_SECRET as string, { expiresIn: "30d" });
}

export async function requireConnectorAuth(
  req: ConnectorRequest,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7);
  let payload: unknown;
  try {
    payload = jwt.verify(token, CONNECTOR_JWT_SECRET as string);
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    return;
  }

  // Admin passthrough: a valid siebert_token with role=admin is accepted.
  // We apply the same session-validity checks as requireAuth to prevent
  // stale/revoked admin sessions from accessing connector routes.
  if (isAdminTokenPayload(payload)) {
    try {
      // jti revocation check
      if (typeof payload.jti === "string" && await isJtiRevoked(payload.jti)) {
        res.status(401).json({ error: "session_revoked", message: "Your session has been revoked. Please sign in again.", force_logout: true });
        return;
      }
      // Global revoke-before check
      if (typeof payload.iat === "number") {
        const revokedBefore = await getSessionsRevokedBefore();
        if (revokedBefore) {
          const revokedBeforeSec = Math.floor(revokedBefore.getTime() / 1000);
          if (payload.iat < revokedBeforeSec) {
            res.status(401).json({ error: "session_revoked", message: "All sessions were revoked by an administrator. Please sign in again.", force_logout: true });
            return;
          }
        }
      }
      // DB-level account lock + password-change check
      const [adminUser] = await db
        .select({ id: usersTable.id, role: usersTable.role, passwordChangedAt: usersTable.passwordChangedAt })
        .from(usersTable)
        .where(eq(usersTable.id, payload.userId))
        .limit(1);
      if (!adminUser || adminUser.role !== "admin") {
        res.status(401).json({ error: "unauthorized", message: "Admin account not found." });
        return;
      }
      if ((adminUser as Record<string, unknown>).accountLockedAt) {
        res.status(401).json({ error: "access_revoked", message: "Account has been locked. Please contact your administrator.", force_logout: true });
        return;
      }
      if (adminUser.passwordChangedAt && typeof payload.iat === "number") {
        const changedAtSec = Math.floor(adminUser.passwordChangedAt.getTime() / 1000);
        if (payload.iat < changedAtSec) {
          res.status(401).json({ error: "session_revoked", message: "Your session expired due to a password change. Please sign in again.", force_logout: true });
          return;
        }
      }
      req.isAdminPassthrough = true;
      req.adminUserId = payload.userId;
      req.connectorId = -999;
      req.connectorEmail = typeof payload.email === "string" ? payload.email : undefined;
      next();
      return;
    } catch (err) {
      console.error("[connectorAuth] admin passthrough validation error:", err);
      res.status(500).json({ error: "server_error", message: "Failed to validate session." });
      return;
    }
  }

  if (!isConnectorTokenPayload(payload)) {
    res.status(401).json({ error: "unauthorized", message: "Invalid token payload" });
    return;
  }

  try {
    const [connector] = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, payload.connectorId))
      .limit(1);
    if (!connector) {
      res.status(401).json({ error: "unauthorized", message: "Account not found." });
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
    req.connectorId = connector.id;
    req.connectorEmail = connector.email;
    next();
  } catch (err) {
    console.error("[connectorAuth] validation error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to validate session." });
  }
}
