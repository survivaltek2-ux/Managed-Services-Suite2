// Admin endpoints for the Azure AD authorization layer (Task #187).
// Mounted at /api/admin/azure-ad. Restricted to MAIN-SITE admins only
// (sentinel partnerId === MAIN_SITE_ADMIN_SENTINEL). Partner-company admins
// are not allowed to alter tenant-wide identity policy or provisioning
// secrets.

import { Router, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db, azureAdEventsTable, azureAdScimTokensTable, azureAdGroupBindingsTable, azureAdRevokedSessionsTable, partnersTable, usersTable, siteSettingsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requirePartnerAdmin, isMainSiteAdmin, type PartnerRequest } from "../middlewares/partnerAuth.js";
import { generateToken } from "../middlewares/auth.js";
import {
  getMappingConfig,
  setMappingConfig,
  getRolloutMode,
  setRolloutMode,
  getBreakGlassEmails,
  decideAccess,
  recordEvent,
  clearAccessCache,
  AUDIT_FORWARD_URL_KEY,
  AUDIT_FORWARD_AUTH_KEY,
  type AzureMappingConfig,
} from "../lib/azure-ad-access.js";
import { bustRolloutCache, revokeJti, getSessionsRevokedBefore, setSessionsRevokedBefore } from "../lib/session-utils.js";
import { isGraphConfigured, listAppRoles, assignAppRole, revokeAppRoleAssignment, getUserAppRoleAssignments, lookupUserByEmail, pingGraph } from "../lib/microsoft-graph.js";
import { runDirectorySyncOnce } from "../lib/azure-ad-sync.js";

const router = Router();

// Site-admin-only gate. requirePartnerAdmin establishes auth + admin flag,
// then we additionally require the main-site sentinel partnerId so that
// partner-company admins cannot modify tenant-wide Azure AD policy.
function requireSiteAdmin(req: PartnerRequest, res: Response, next: NextFunction) {
  requirePartnerAdmin(req, res, () => {
    if (!isMainSiteAdmin(req)) {
      res.status(403).json({ error: "forbidden", message: "Site-admin access required for Azure AD administration." });
      return;
    }
    next();
  });
}

router.use(requireSiteAdmin);

// ─── Status ──────────────────────────────────────────────────────────────────

router.get("/azure-ad/status", async (_req: PartnerRequest, res) => {
  const [mapping, rolloutMode, breakGlass, graphReachable] = await Promise.all([
    getMappingConfig(),
    getRolloutMode(),
    Promise.resolve(getBreakGlassEmails()),
    pingGraph(),
  ]);
  const lastSyncRow = await db.select({ value: siteSettingsTable.value }).from(siteSettingsTable).where(eq(siteSettingsTable.key, "azure_ad_last_full_sync_at")).limit(1);
  res.json({
    rolloutMode,
    graphConfigured: isGraphConfigured(),
    graphReachable,
    breakGlassEmailCount: breakGlass.length,
    mappingRulesCount: mapping.rules.length,
    lastSyncAt: lastSyncRow[0]?.value || null,
  });
});

// ─── Mapping ─────────────────────────────────────────────────────────────────

router.get("/azure-ad/mapping", async (_req, res) => {
  res.json(await getMappingConfig());
});

router.put("/azure-ad/mapping", async (req: PartnerRequest, res) => {
  const body = req.body as Partial<AzureMappingConfig>;
  if (!body || !Array.isArray(body.rules)) {
    res.status(400).json({ error: "validation_error", message: "rules array is required" });
    return;
  }
  const cfg: AzureMappingConfig = {
    rules: body.rules,
    defaultDeny: Boolean(body.defaultDeny),
    notAuthorizedMessage: typeof body.notAuthorizedMessage === "string" ? body.notAuthorizedMessage : "",
    contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : "",
  };
  await setMappingConfig(cfg);
  clearAccessCache();
  await recordEvent({
    eventType: "admin.mapping.updated",
    source: "admin_test",
    decision: "info",
    rolloutMode: await getRolloutMode(),
    details: { ruleCount: cfg.rules.length, by: req.mainSiteUserId ?? req.partnerId },
  });
  res.json({ ok: true });
});

// ─── Rollout mode ────────────────────────────────────────────────────────────

router.get("/azure-ad/rollout", async (_req, res) => {
  res.json({ mode: await getRolloutMode() });
});

router.put("/azure-ad/rollout", async (req: PartnerRequest, res) => {
  const mode = (req.body as { mode?: string })?.mode;
  if (mode !== "disabled" && mode !== "audit" && mode !== "enforce") {
    res.status(400).json({ error: "validation_error", message: "mode must be disabled|audit|enforce" });
    return;
  }
  await setRolloutMode(mode);
  bustRolloutCache();
  await recordEvent({
    eventType: "admin.rollout.changed",
    source: "admin_test",
    decision: "info",
    rolloutMode: mode,
    details: { by: req.mainSiteUserId ?? req.partnerId },
  });
  res.json({ ok: true, mode });
});

// ─── Test a single email ─────────────────────────────────────────────────────

router.post("/azure-ad/test", async (req, res) => {
  const { email, portal } = req.body as { email?: string; portal?: string };
  if (!email || (portal !== "client" && portal !== "partner")) {
    res.status(400).json({ error: "validation_error", message: "email and portal=client|partner are required" });
    return;
  }
  const decision = await decideAccess({ email, portal: portal as "client" | "partner", source: "admin_test" });
  res.json(decision);
});

// ─── Break-glass list (read-only echo of env) ───────────────────────────────

router.get("/azure-ad/break-glass", (_req, res) => {
  res.json({ emails: getBreakGlassEmails() });
});

// ─── Audit log feed ──────────────────────────────────────────────────────────

router.get("/azure-ad/events", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const filterEmail = typeof req.query.email === "string" ? req.query.email.toLowerCase() : null;
  const filterDecision = typeof req.query.decision === "string" ? req.query.decision : null;
  const conditions = [] as ReturnType<typeof eq>[];
  if (filterEmail) conditions.push(eq(azureAdEventsTable.email, filterEmail));
  if (filterDecision) conditions.push(eq(azureAdEventsTable.decision, filterDecision));
  const rows = await db
    .select()
    .from(azureAdEventsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(azureAdEventsTable.occurredAt))
    .limit(limit);
  res.json(rows);
});

// ─── Group bindings ─────────────────────────────────────────────────────────

router.get("/azure-ad/group-bindings", async (_req, res) => {
  const rows = await db.select().from(azureAdGroupBindingsTable).orderBy(desc(azureAdGroupBindingsTable.createdAt));
  res.json(rows);
});

router.post("/azure-ad/group-bindings", async (req, res) => {
  const { groupOid, groupDisplayName, partnerId, isCompanyAdmin, permissions } = req.body as {
    groupOid?: string;
    groupDisplayName?: string;
    partnerId?: number;
    isCompanyAdmin?: boolean;
    permissions?: Record<string, boolean>;
  };
  if (!groupOid || typeof partnerId !== "number") {
    res.status(400).json({ error: "validation_error", message: "groupOid and partnerId are required" });
    return;
  }
  await db.insert(azureAdGroupBindingsTable).values({
    groupOid,
    groupDisplayName: groupDisplayName || "",
    partnerId,
    isCompanyAdmin: Boolean(isCompanyAdmin),
    permissionsJson: (permissions ?? {}) as Record<string, boolean>,
  }).onConflictDoNothing();
  res.json({ ok: true });
});

router.delete("/azure-ad/group-bindings/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "validation_error", message: "id must be numeric" });
    return;
  }
  await db.delete(azureAdGroupBindingsTable).where(eq(azureAdGroupBindingsTable.id, id));
  res.json({ ok: true });
});

// ─── App-role admin (only when MICROSOFT_APP_OBJECT_ID is configured) ───────

router.get("/azure-ad/app-roles", async (_req, res) => {
  res.json(await listAppRoles());
});

router.get("/azure-ad/app-role-assignments", async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (!email) {
    res.status(400).json({ error: "validation_error", message: "email is required" });
    return;
  }
  const user = await lookupUserByEmail(email);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found in directory" });
    return;
  }
  const assignments = await getUserAppRoleAssignments(user.id);
  res.json({ user, assignments });
});

router.post("/azure-ad/app-role-assignments", async (req: PartnerRequest, res) => {
  const { email, appRoleId } = req.body as { email?: string; appRoleId?: string };
  if (!email || !appRoleId) {
    res.status(400).json({ error: "validation_error", message: "email and appRoleId are required" });
    return;
  }
  const user = await lookupUserByEmail(email);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found in directory" });
    return;
  }
  const result = await assignAppRole(user.id, appRoleId);
  if (!result) {
    res.status(502).json({ error: "graph_error", message: "Assignment failed (see server logs)" });
    return;
  }
  await recordEvent({
    eventType: "admin.app_role.assigned",
    email,
    azureOid: user.id,
    source: "admin_test",
    decision: "info",
    rolloutMode: await getRolloutMode(),
    details: { appRoleId, by: req.mainSiteUserId ?? req.partnerId },
  });
  res.json(result);
});

router.delete("/azure-ad/app-role-assignments", async (req: PartnerRequest, res) => {
  const { email, assignmentId } = req.body as { email?: string; assignmentId?: string };
  if (!email || !assignmentId) {
    res.status(400).json({ error: "validation_error", message: "email and assignmentId are required" });
    return;
  }
  const user = await lookupUserByEmail(email);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found in directory" });
    return;
  }
  const ok = await revokeAppRoleAssignment(user.id, assignmentId);
  if (!ok) {
    res.status(502).json({ error: "graph_error", message: "Revocation failed (see server logs)" });
    return;
  }
  await recordEvent({
    eventType: "admin.app_role.revoked",
    email,
    azureOid: user.id,
    source: "admin_test",
    decision: "info",
    rolloutMode: await getRolloutMode(),
    details: { assignmentId, by: req.mainSiteUserId ?? req.partnerId },
  });
  res.json({ ok: true });
});

// ─── SCIM tokens ─────────────────────────────────────────────────────────────

router.get("/azure-ad/scim-tokens", async (_req, res) => {
  const rows = await db
    .select({
      id: azureAdScimTokensTable.id,
      label: azureAdScimTokensTable.label,
      tokenPreview: azureAdScimTokensTable.tokenPreview,
      createdAt: azureAdScimTokensTable.createdAt,
      lastSeenAt: azureAdScimTokensTable.lastSeenAt,
      revokedAt: azureAdScimTokensTable.revokedAt,
    })
    .from(azureAdScimTokensTable)
    .orderBy(desc(azureAdScimTokensTable.createdAt));
  res.json(rows);
});

router.post("/azure-ad/scim-tokens", async (req: PartnerRequest, res) => {
  const label = (req.body as { label?: string })?.label?.trim() || "Azure SCIM Connector";
  const raw = "scim_" + crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const tokenPreview = raw.slice(0, 8) + "..." + raw.slice(-4);
  const [row] = await db.insert(azureAdScimTokensTable).values({
    label,
    tokenHash,
    tokenPreview,
  }).returning({ id: azureAdScimTokensTable.id });
  await recordEvent({
    eventType: "admin.scim_token.created",
    source: "admin_test",
    decision: "info",
    rolloutMode: await getRolloutMode(),
    details: { id: row.id, label, by: req.mainSiteUserId ?? req.partnerId },
  });
  // Token is shown ONCE here. Admin must copy it before navigating away.
  res.json({ id: row.id, label, token: raw, tokenPreview });
});

router.delete("/azure-ad/scim-tokens/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "validation_error" });
    return;
  }
  await db
    .update(azureAdScimTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(azureAdScimTokensTable.id, id));
  res.json({ ok: true });
});

// ─── Sessions / revocation ───────────────────────────────────────────────────

router.get("/azure-ad/sessions/revoked", async (_req, res) => {
  const rows = await db.select().from(azureAdRevokedSessionsTable).orderBy(desc(azureAdRevokedSessionsTable.revokedAt)).limit(200);
  res.json(rows);
});

router.post("/azure-ad/sessions/revoke", async (req: PartnerRequest, res) => {
  const { jti, email, reason } = req.body as { jti?: string; email?: string; reason?: string };
  if (jti) {
    await revokeJti(jti, reason || "manual_revoke");
    await recordEvent({
      eventType: "admin.session.revoked",
      source: "admin_test",
      decision: "info",
      rolloutMode: await getRolloutMode(),
      details: { jti, by: req.mainSiteUserId ?? req.partnerId },
    });
    res.json({ ok: true, mode: "jti" });
    return;
  }
  if (email) {
    // We don't keep an index of all live jtis per email; instead we lock
    // the local account so the next request is rejected by the existing
    // status checks and the user is forced to re-auth (which then runs
    // through the new Azure decision).
    const lower = email.toLowerCase();
    const lockedAt = new Date();
    await db.update(usersTable).set({ accountLockedAt: lockedAt } as Record<string, unknown>).where(eq(usersTable.email, lower));
    await db.update(partnersTable).set({ accountLockedAt: lockedAt } as Record<string, unknown>).where(eq(partnersTable.email, lower));
    clearAccessCache(lower);
    await recordEvent({
      eventType: "admin.account.locked",
      email: lower,
      source: "admin_test",
      decision: "info",
      rolloutMode: await getRolloutMode(),
      details: { by: req.mainSiteUserId ?? req.partnerId, reason: reason ?? "manual_lock" },
    });
    res.json({ ok: true, mode: "email_lock" });
    return;
  }
  res.status(400).json({ error: "validation_error", message: "Provide either jti or email" });
});

// ─── Audit forwarding config ─────────────────────────────────────────────────

router.get("/azure-ad/audit-forward", async (_req, res) => {
  const url = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, AUDIT_FORWARD_URL_KEY)).limit(1);
  const auth = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, AUDIT_FORWARD_AUTH_KEY)).limit(1);
  res.json({
    url: url[0]?.value ?? "",
    authConfigured: Boolean(auth[0]?.value),
  });
});

router.put("/azure-ad/audit-forward", async (req: PartnerRequest, res) => {
  const { url, auth } = req.body as { url?: string; auth?: string };
  await db.execute(sql`
    INSERT INTO site_settings (key, value) VALUES (${AUDIT_FORWARD_URL_KEY}, ${url ?? ""})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
  if (typeof auth === "string") {
    await db.execute(sql`
      INSERT INTO site_settings (key, value) VALUES (${AUDIT_FORWARD_AUTH_KEY}, ${auth})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `);
  }
  await recordEvent({
    eventType: "admin.audit_forward.configured",
    source: "admin_test",
    decision: "info",
    rolloutMode: await getRolloutMode(),
    details: { hasUrl: Boolean(url), by: req.mainSiteUserId ?? req.partnerId },
  });
  res.json({ ok: true });
});

// ─── Trigger directory sync ──────────────────────────────────────────────────

router.post("/azure-ad/sync/run", async (req: PartnerRequest, res) => {
  // Fire-and-forget; the sync writes its own audit events and counts.
  const mode = await getRolloutMode();
  runDirectorySyncOnce()
    .then(result => {
      void recordEvent({
        eventType: "admin.sync.manual",
        source: "admin_test",
        decision: "info",
        rolloutMode: mode,
        details: { ...result, by: req.mainSiteUserId ?? req.partnerId },
      });
    })
    .catch(err => console.error("[AzureAdmin] manual sync error:", err));
  res.json({ ok: true, message: "Sync started" });
});

// ─── Lookup users still managed by the legacy stack ─────────────────────────

router.get("/azure-ad/orphans", async (_req, res) => {
  // Orphans are local accounts that have NEVER been seen in Azure or whose
  // last decision was "deny". Useful for the admin to clean up after rollout.
  const userOrphans = await db.execute(sql`
    SELECT id, email, role, azure_last_decision, azure_last_check_at
    FROM users
    WHERE azure_oid IS NULL OR azure_last_decision = 'deny'
    ORDER BY id DESC
    LIMIT 200
  `);
  const partnerOrphans = await db.execute(sql`
    SELECT id, email, company_name, is_admin, azure_last_decision, azure_last_check_at
    FROM partners
    WHERE azure_oid IS NULL OR azure_last_decision = 'deny'
    ORDER BY id DESC
    LIMIT 200
  `);
  res.json({
    users: userOrphans.rows,
    partners: partnerOrphans.rows,
  });
});

// ─── Global session revocation ───────────────────────────────────────────────

/**
 * GET /api/admin/security/settings
 * Returns the current global sessions-revoked-before timestamp (if any).
 */
router.get("/security/settings", async (_req, res) => {
  const revokedBefore = await getSessionsRevokedBefore();
  res.json({ sessionsRevokedBefore: revokedBefore ? revokedBefore.toISOString() : null });
});

/**
 * POST /api/admin/security/revoke-all-sessions
 * Sets sessions_revoked_before = NOW() so every token issued before this
 * moment is rejected.  Immediately issues a fresh token for the calling
 * admin so they are not logged out.
 */
router.post("/security/revoke-all-sessions", async (req: PartnerRequest, res) => {
  const revokedAt = new Date();
  const adminUserId = req.mainSiteUserId ?? undefined;
  const adminEmail = req.authEmail ?? undefined;

  await setSessionsRevokedBefore(revokedAt, adminUserId, adminEmail);

  await recordEvent({
    eventType: "admin.security.revoke_all_sessions",
    email: adminEmail,
    source: "security_admin",
    decision: "info",
    rolloutMode: await getRolloutMode(),
    details: { revokedAt: revokedAt.toISOString(), by: adminUserId ?? req.partnerId },
  });

  // Issue a fresh token for the calling admin so their session survives.
  // Site admins authenticate with a user JWT (mainSiteUserId set); partners
  // with a partner JWT (partnerId set to a non-sentinel value).
  let freshToken: string | null = null;
  const adminId = req.mainSiteUserId ?? undefined;
  if (adminId) {
    freshToken = generateToken(adminId, "admin", { email: adminEmail });
  }

  res.json({
    ok: true,
    sessionsRevokedBefore: revokedAt.toISOString(),
    freshToken,
  });
});

export default router;
