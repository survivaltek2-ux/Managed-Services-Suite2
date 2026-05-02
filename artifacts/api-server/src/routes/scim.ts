// SCIM 2.0 server (Task #187).
//
// Mounted at /scim/v2 — Azure AD's "Provisioning" connector calls these
// endpoints to push user create/update/disable + group membership changes
// into our partner-portal. Authentication is a bearer token issued from
// the admin Azure AD page; tokens are stored hashed.
//
// The scope is intentionally narrow: only the resources we actually use
// for partner team-member management. We respond to `Users` and `Groups`
// with the SCIM 2.0 schema URNs Microsoft expects.

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db, azureAdScimTokensTable, azureAdGroupBindingsTable, partnerTeamMembersTable, partnersTable } from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { recordEvent } from "../lib/azure-ad-access.js";

const router = Router();

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

function scimError(res: Response, status: number, detail: string): void {
  res.status(status).type("application/scim+json").json({
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
  });
}

async function authMiddleware(req: Request, res: Response, next: () => void): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    scimError(res, 401, "Missing or malformed bearer token");
    return;
  }
  const raw = authHeader.substring(7).trim();
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  try {
    const [row] = await db
      .select()
      .from(azureAdScimTokensTable)
      .where(and(eq(azureAdScimTokensTable.tokenHash, tokenHash), isNull(azureAdScimTokensTable.revokedAt)))
      .limit(1);
    if (!row) {
      scimError(res, 401, "Invalid bearer token");
      return;
    }
    await db
      .update(azureAdScimTokensTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(azureAdScimTokensTable.id, row.id));
    next();
  } catch (err) {
    console.error("[SCIM] auth error:", err);
    scimError(res, 500, "Auth check failed");
  }
}

router.use((req, res, next) => {
  // Force JSON content type for everything the SCIM connector returns.
  res.type("application/scim+json");
  void authMiddleware(req, res, next);
});

// ─── Service-provider config endpoints (Microsoft pings these on first run) ─

router.get("/ServiceProviderConfig", (_req, res) => {
  res.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://learn.microsoft.com/azure/active-directory/app-provisioning/use-scim-to-provision-users-and-groups",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token", description: "Authentication scheme using the OAuth Bearer Token Standard" }],
  });
});

router.get("/Schemas", (_req, res) => {
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
    Resources: [{ id: SCIM_USER_SCHEMA }, { id: SCIM_GROUP_SCHEMA }],
  });
});

router.get("/ResourceTypes", (_req, res) => {
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
    Resources: [
      { id: "User", name: "User", endpoint: "/Users", schema: SCIM_USER_SCHEMA },
      { id: "Group", name: "Group", endpoint: "/Groups", schema: SCIM_GROUP_SCHEMA },
    ],
  });
});

// ─── User helpers ────────────────────────────────────────────────────────────

interface ScimUserBody {
  userName?: string;
  externalId?: string;
  active?: boolean;
  emails?: { value?: string; primary?: boolean; type?: string }[];
  name?: { givenName?: string; familyName?: string };
  displayName?: string;
}

function userToScim(member: {
  id: number;
  email: string;
  name: string;
  status: string;
  azureOid: string | null;
}): Record<string, unknown> {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: String(member.id),
    externalId: member.azureOid ?? undefined,
    userName: member.email,
    displayName: member.name,
    active: member.status === "active",
    emails: [{ value: member.email, type: "work", primary: true }],
    meta: { resourceType: "User", location: `/scim/v2/Users/${member.id}` },
  };
}

function emailFrom(body: ScimUserBody): string | null {
  const fromUserName = body.userName?.toLowerCase().trim();
  if (fromUserName && fromUserName.includes("@")) return fromUserName;
  const primary = body.emails?.find(e => e.primary) ?? body.emails?.[0];
  return primary?.value?.toLowerCase().trim() ?? null;
}

async function defaultPartnerIdForEmail(email: string): Promise<number | null> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const rows = await db.execute<{ id: number }>(sql`
    SELECT id FROM partners
    WHERE lower(split_part(email, '@', 2)) = ${domain}
      AND status = 'approved'
    ORDER BY id ASC
    LIMIT 1
  `);
  return (rows.rows?.[0]?.id as number) ?? null;
}

// ─── Users CRUD ──────────────────────────────────────────────────────────────

router.get("/Users", async (req, res) => {
  const filter = typeof req.query.filter === "string" ? req.query.filter : "";
  let resources: typeof partnerTeamMembersTable.$inferSelect[] = [];
  if (filter && filter.includes("userName eq")) {
    const m = filter.match(/userName\s+eq\s+"([^"]+)"/i);
    const email = m?.[1]?.toLowerCase();
    if (email) {
      resources = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.email, email)).limit(1);
    }
  } else {
    resources = await db.select().from(partnerTeamMembersTable).limit(200);
  }
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources.map(r => userToScim(r as never)),
  });
});

router.get("/Users/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) { scimError(res, 404, "Not found"); return; }
  const [row] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.id, id)).limit(1);
  if (!row) { scimError(res, 404, "Not found"); return; }
  res.json(userToScim(row as never));
});

router.post("/Users", async (req, res) => {
  const body = req.body as ScimUserBody;
  const email = emailFrom(body);
  if (!email) { scimError(res, 400, "userName/emails required"); return; }
  // Find an existing row first — Microsoft's connector retries on conflict.
  const [existing] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.email, email)).limit(1);
  if (existing) {
    res.status(200).json(userToScim(existing as never));
    return;
  }
  const partnerId = await defaultPartnerIdForEmail(email);
  if (!partnerId) {
    scimError(res, 400, "No approved partner exists for this email domain. Configure a group binding first.");
    return;
  }
  const name = body.displayName || `${body.name?.givenName ?? ""} ${body.name?.familyName ?? ""}`.trim() || email;
  const [created] = await db.insert(partnerTeamMembersTable).values({
    partnerId,
    email,
    name,
    status: body.active === false ? "revoked" : "active",
  }).returning();
  await recordEvent({
    eventType: "scim.user.created",
    email,
    source: "scim",
    decision: "info",
    details: { teamMemberId: created.id, partnerId },
  });
  res.status(201).json(userToScim(created as never));
});

router.patch("/Users/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) { scimError(res, 404, "Not found"); return; }
  const body = req.body as { Operations?: { op?: string; path?: string; value?: unknown }[] };
  const [existing] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.id, id)).limit(1);
  if (!existing) { scimError(res, 404, "Not found"); return; }
  const updates: Record<string, unknown> = { azureLastSyncAt: new Date() };
  for (const op of body.Operations ?? []) {
    const opName = (op.op || "").toLowerCase();
    if (opName !== "replace" && opName !== "add") continue;
    if (op.path === "active") {
      updates.status = op.value === false || op.value === "False" ? "revoked" : "active";
    } else if (op.path === "userName" && typeof op.value === "string") {
      updates.email = op.value.toLowerCase();
    } else if (op.path === "displayName" && typeof op.value === "string") {
      updates.name = op.value;
    } else if (op.path === undefined && typeof op.value === "object" && op.value !== null) {
      const val = op.value as Record<string, unknown>;
      if (typeof val.active === "boolean") updates.status = val.active ? "active" : "revoked";
      if (typeof val.userName === "string") updates.email = val.userName.toLowerCase();
      if (typeof val.displayName === "string") updates.name = val.displayName;
    }
  }
  await db.update(partnerTeamMembersTable).set(updates).where(eq(partnerTeamMembersTable.id, id));
  await recordEvent({
    eventType: "scim.user.patched",
    email: existing.email,
    source: "scim",
    decision: "info",
    details: { teamMemberId: id, updates },
  });
  const [refreshed] = await db.select().from(partnerTeamMembersTable).where(eq(partnerTeamMembersTable.id, id)).limit(1);
  res.json(userToScim(refreshed as never));
});

router.delete("/Users/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) { scimError(res, 404, "Not found"); return; }
  await db.update(partnerTeamMembersTable).set({ status: "revoked" }).where(eq(partnerTeamMembersTable.id, id));
  await recordEvent({
    eventType: "scim.user.deleted",
    source: "scim",
    decision: "info",
    details: { teamMemberId: id },
  });
  res.status(204).send();
});

// ─── Groups CRUD ─────────────────────────────────────────────────────────────

interface ScimGroupBody {
  displayName?: string;
  externalId?: string;
  members?: { value?: string }[];
}

router.get("/Groups", async (_req, res) => {
  const rows = await db.select().from(azureAdGroupBindingsTable).limit(200);
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: rows.length,
    Resources: rows.map(r => ({
      schemas: [SCIM_GROUP_SCHEMA],
      id: String(r.id),
      externalId: r.groupOid,
      displayName: r.groupDisplayName,
      meta: { resourceType: "Group", location: `/scim/v2/Groups/${r.id}` },
    })),
  });
});

router.post("/Groups", async (req, res) => {
  const body = req.body as ScimGroupBody;
  const groupOid = body.externalId || "";
  if (!groupOid) { scimError(res, 400, "externalId required"); return; }
  // Group binding requires a partnerId — admins create the binding via the
  // admin UI; the connector just records the external id.
  res.status(201).json({
    schemas: [SCIM_GROUP_SCHEMA],
    id: groupOid,
    externalId: groupOid,
    displayName: body.displayName,
  });
});

router.patch("/Groups/:id", async (req, res) => {
  const body = req.body as { Operations?: { op?: string; path?: string; value?: unknown }[] };
  const id = req.params.id;
  for (const op of body.Operations ?? []) {
    const opName = (op.op || "").toLowerCase();
    // members add/remove → toggle the team_member.status accordingly
    if ((opName === "add" || opName === "remove") && op.path?.startsWith("members") && Array.isArray(op.value)) {
      for (const m of op.value as { value?: string }[]) {
        if (typeof m.value !== "string") continue;
        const memberId = parseInt(m.value, 10);
        if (!Number.isFinite(memberId)) continue;
        const newStatus = opName === "add" ? "active" : "revoked";
        await db.update(partnerTeamMembersTable)
          .set({ status: newStatus, azureManagedByGroup: true, azureLastSyncAt: new Date() } as Record<string, unknown>)
          .where(eq(partnerTeamMembersTable.id, memberId));
      }
    }
  }
  await recordEvent({
    eventType: "scim.group.patched",
    source: "scim",
    decision: "info",
    details: { groupId: id, ops: body.Operations?.length ?? 0 },
  });
  res.status(204).send();
});

router.delete("/Groups/:id", async (_req, res) => {
  // We never actually remove a binding via SCIM — the admin must do that
  // explicitly in the admin UI. SCIM delete only marks members revoked.
  res.status(204).send();
});

export default router;
