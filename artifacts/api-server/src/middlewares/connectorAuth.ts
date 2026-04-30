import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, connectorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const CONNECTOR_JWT_SECRET = process.env.JWT_SECRET;
if (!CONNECTOR_JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required but not set. Refusing to start with an insecure configuration.",
  );
}

export interface ConnectorRequest extends Request {
  connectorId?: number;
  connectorEmail?: string;
}

interface ConnectorTokenPayload {
  connectorId: number;
  email?: string;
  iat?: number;
}

function isConnectorTokenPayload(payload: unknown): payload is ConnectorTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).connectorId === "number"
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
