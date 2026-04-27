// Central Azure AD access decision (Task #187).
//
// Every login surface (Microsoft SSO, password, magic-code, Replit OIDC) and
// every protected request funnels through `decideAccess()`. The function
// answers a single question: given THIS email, is the holder allowed to use
// THIS portal right now, and if so what role + permission flags do they get?
//
// The decision is driven by a JSON mapping stored in `site_settings`
// under the key `azure_ad_mapping_v1`. Mapping rules can match on:
//   • Azure app-role values (preferred, e.g. "Siebert.Admin")
//   • Azure group object ids (display names are advisory only)
//   • Email domain (legacy fallback, kept for the bootstrap window)
//
// Three rollout modes ride alongside, stored under `azure_ad_rollout_mode`:
//   • disabled — Azure check is a no-op; legacy logic is unchanged
//   • audit    — Azure check runs and is logged but does NOT block logins
//   • enforce  — Azure check runs and blocks any non-allowed login
//
// A break-glass allow-list (env var AZURE_AD_BREAKGLASS_EMAILS) bypasses
// enforce mode for designated emergency operators so a misconfiguration
// can never lock the entire team out.

import crypto from "crypto";
import { db, siteSettingsTable, azureAdEventsTable, partnersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  lookupUserByEmail,
  getUserAppRoleAssignments,
  getUserGroupMemberships,
  isGraphConfigured,
  type GraphAppRoleAssignment,
  type GraphGroup,
  type GraphUser,
} from "./microsoft-graph.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RolloutMode = "disabled" | "audit" | "enforce";

export type AccessSource =
  | "sso_microsoft"
  | "sso_replit"
  | "password"
  | "magic_code"
  | "scim"
  | "scheduled_sync"
  | "admin_test";

export type Portal = "client" | "partner" | "admin";

export interface AzureRolePermissions {
  canViewDeals: boolean;
  canCreateDeals: boolean;
  canViewLeads: boolean;
  canCreateLeads: boolean;
  canViewCommissions: boolean;
  canViewResources: boolean;
  canCreatePlans: boolean;
}

export interface AzureMappingTarget {
  /** Which portal this rule grants access to. */
  portal: Portal;
  /** "client" / "admin" for client portal; "partner" / "admin" for partner portal. */
  role: "client" | "admin" | "partner" | "team_member";
  /** True only for admin-level grants. */
  isAdmin: boolean;
  /** Permission flags applied to partner team-member sessions. */
  permissions?: Partial<AzureRolePermissions>;
  /** Optional human label shown in the admin UI / audit log. */
  label?: string;
}

export interface AzureMappingRule {
  type: "appRole" | "group" | "domain";
  /** App-role value, group OID, or email domain. */
  match: string;
  target: AzureMappingTarget;
}

export interface AzureMappingConfig {
  rules: AzureMappingRule[];
  /** Default for users with NO matching app-role / group / domain rule. */
  defaultDeny: boolean;
  /** Friendly message shown when access is denied. */
  notAuthorizedMessage: string;
  /** Email shown to denied users for help. */
  contactEmail: string;
}

export interface AccessDecisionContext {
  email: string;
  source: AccessSource;
  /** Portal the user is trying to enter. Used to filter mapping rules. */
  portal: Portal;
  /** Identity of the calling request, for audit context (free-form). */
  requestIp?: string;
  /** Microsoft id_token claims, when available. */
  idTokenClaims?: Record<string, unknown>;
}

export interface AccessDecision {
  allowed: boolean;
  /** True when allowed BECAUSE we're in disabled mode or break-glass. */
  bypass: boolean;
  /** Why we made the decision we did. */
  reason: string;
  /** Friendly message a UI can show to the user when allowed=false. */
  friendlyMessage?: string;
  /** Raw role values matched. */
  matchedRoles: string[];
  /** Raw group ids matched. */
  matchedGroups: string[];
  /** The rules that fired. */
  matchedRules: AzureMappingRule[];
  /** Resolved target (when allowed). */
  target?: AzureMappingTarget;
  /** Echoed inputs for the audit trail. */
  rolloutMode: RolloutMode;
  azureOid?: string;
  /** True when Graph credentials aren't configured / call failed. The login
   *  path can still allow legacy logins (audit mode) but the admin UI will
   *  surface this as a warning. */
  azureUnreachable: boolean;
}

// ─── Settings storage ────────────────────────────────────────────────────────

const MAPPING_KEY = "azure_ad_mapping_v1";
const ROLLOUT_KEY = "azure_ad_rollout_mode";
const SCHEDULED_SYNC_KEY = "azure_ad_last_full_sync_at";
const AUDIT_FORWARD_URL_KEY = "azure_ad_audit_forward_url";
const AUDIT_FORWARD_AUTH_KEY = "azure_ad_audit_forward_auth";

const DEFAULT_MAPPING: AzureMappingConfig = {
  rules: [
    {
      type: "appRole",
      match: "Siebert.Admin",
      target: { portal: "client", role: "admin", isAdmin: true, label: "Siebert internal admin" },
    },
    {
      type: "appRole",
      match: "Siebert.Client",
      target: { portal: "client", role: "client", isAdmin: false, label: "Siebert end-customer" },
    },
    {
      type: "appRole",
      match: "Partner.Admin",
      target: {
        portal: "partner",
        role: "partner",
        isAdmin: true,
        label: "Partner company admin",
        permissions: {
          canViewDeals: true,
          canCreateDeals: true,
          canViewLeads: true,
          canCreateLeads: true,
          canViewCommissions: true,
          canViewResources: true,
          canCreatePlans: true,
        },
      },
    },
    {
      type: "appRole",
      match: "Partner.TeamMember",
      target: {
        portal: "partner",
        role: "team_member",
        isAdmin: false,
        label: "Partner team member",
        permissions: { canViewDeals: true, canViewLeads: true, canViewResources: true },
      },
    },
  ],
  defaultDeny: false,
  notAuthorizedMessage:
    "Your account exists but isn't authorized for this portal. Please contact your IT admin to be added to the right Microsoft Entra group or app role.",
  contactEmail: "support@siebertservices.com",
};

async function readSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: siteSettingsTable.value })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.key, key))
      .limit(1);
    return row?.value ?? null;
  } catch (err) {
    console.error(`[AzureAccess] readSetting(${key}) error:`, err);
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  try {
    const existing = await readSetting(key);
    if (existing === null) {
      await db.insert(siteSettingsTable).values({ key, value });
    } else {
      await db.update(siteSettingsTable).set({ value, updatedAt: new Date() }).where(eq(siteSettingsTable.key, key));
    }
  } catch (err) {
    console.error(`[AzureAccess] writeSetting(${key}) error:`, err);
  }
}

export async function getMappingConfig(): Promise<AzureMappingConfig> {
  const raw = await readSetting(MAPPING_KEY);
  if (!raw) return { ...DEFAULT_MAPPING };
  try {
    const parsed = JSON.parse(raw) as Partial<AzureMappingConfig>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : DEFAULT_MAPPING.rules,
      defaultDeny: typeof parsed.defaultDeny === "boolean" ? parsed.defaultDeny : DEFAULT_MAPPING.defaultDeny,
      notAuthorizedMessage: typeof parsed.notAuthorizedMessage === "string" && parsed.notAuthorizedMessage
        ? parsed.notAuthorizedMessage
        : DEFAULT_MAPPING.notAuthorizedMessage,
      contactEmail: typeof parsed.contactEmail === "string" && parsed.contactEmail
        ? parsed.contactEmail
        : DEFAULT_MAPPING.contactEmail,
    };
  } catch {
    return { ...DEFAULT_MAPPING };
  }
}

export async function setMappingConfig(cfg: AzureMappingConfig): Promise<void> {
  await writeSetting(MAPPING_KEY, JSON.stringify(cfg));
}

export async function getRolloutMode(): Promise<RolloutMode> {
  const raw = await readSetting(ROLLOUT_KEY);
  if (raw === "audit" || raw === "enforce") return raw;
  return "disabled";
}

export async function setRolloutMode(mode: RolloutMode): Promise<void> {
  await writeSetting(ROLLOUT_KEY, mode);
}

export function getBreakGlassEmails(): string[] {
  const raw = (process.env.AZURE_AD_BREAKGLASS_EMAILS || "").trim();
  if (!raw) return [];
  return raw.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ─── Audit helpers ───────────────────────────────────────────────────────────

interface RecordEventOpts {
  eventType: string;
  email?: string;
  azureOid?: string;
  source: AccessSource | string;
  decision?: string;
  reason?: string;
  rolloutMode?: RolloutMode | string;
  details?: Record<string, unknown>;
}

export async function recordEvent(opts: RecordEventOpts): Promise<number | null> {
  try {
    const [row] = await db
      .insert(azureAdEventsTable)
      .values({
        eventType: opts.eventType,
        email: opts.email?.toLowerCase() ?? null,
        azureOid: opts.azureOid ?? null,
        source: opts.source,
        decision: opts.decision ?? "info",
        reason: opts.reason ?? null,
        rolloutMode: opts.rolloutMode ?? null,
        details: (opts.details ?? {}) as Record<string, unknown>,
      })
      .returning({ id: azureAdEventsTable.id });
    // Background-forward (do not block the request).
    forwardEventInBackground(row.id).catch(() => {});
    return row.id;
  } catch (err) {
    console.error("[AzureAccess] recordEvent error:", err);
    return null;
  }
}

async function forwardEventInBackground(eventId: number): Promise<void> {
  const url = (await readSetting(AUDIT_FORWARD_URL_KEY))?.trim();
  if (!url) return;
  const auth = (await readSetting(AUDIT_FORWARD_AUTH_KEY))?.trim() ?? "";
  try {
    const [event] = await db
      .select()
      .from(azureAdEventsTable)
      .where(eq(azureAdEventsTable.id, eventId))
      .limit(1);
    if (!event) return;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers["Authorization"] = auth;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ts: event.occurredAt,
        type: event.eventType,
        source: event.source,
        email: event.email,
        oid: event.azureOid,
        decision: event.decision,
        reason: event.reason,
        rollout: event.rolloutMode,
        details: event.details,
      }),
    });
    if (res.ok) {
      await db.update(azureAdEventsTable).set({ forwardedAt: new Date(), forwardError: null }).where(eq(azureAdEventsTable.id, eventId));
    } else {
      const txt = await res.text().catch(() => `${res.status}`);
      await db.update(azureAdEventsTable).set({ forwardError: txt.slice(0, 480) }).where(eq(azureAdEventsTable.id, eventId));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(azureAdEventsTable).set({ forwardError: msg.slice(0, 480) }).where(eq(azureAdEventsTable.id, eventId)).catch(() => {});
  }
}

// ─── Decision engine ─────────────────────────────────────────────────────────

interface CachedAzureLookup {
  expiresAt: number;
  user: GraphUser | null;
  assignments: GraphAppRoleAssignment[];
  groups: GraphGroup[];
  failed: boolean;
}

const lookupCache = new Map<string, CachedAzureLookup>();
const LOOKUP_TTL_MS = 60_000;

export function clearAccessCache(email?: string): void {
  if (email) lookupCache.delete(email.toLowerCase());
  else lookupCache.clear();
}

async function loadAzureProfile(email: string): Promise<CachedAzureLookup> {
  const key = email.toLowerCase();
  const now = Date.now();
  const cached = lookupCache.get(key);
  if (cached && cached.expiresAt > now) return cached;
  if (!isGraphConfigured()) {
    const empty: CachedAzureLookup = { expiresAt: now + LOOKUP_TTL_MS, user: null, assignments: [], groups: [], failed: true };
    lookupCache.set(key, empty);
    return empty;
  }
  try {
    const user = await lookupUserByEmail(key);
    if (!user) {
      const out: CachedAzureLookup = { expiresAt: now + LOOKUP_TTL_MS, user: null, assignments: [], groups: [], failed: false };
      lookupCache.set(key, out);
      return out;
    }
    const [assignments, groups] = await Promise.all([
      getUserAppRoleAssignments(user.id),
      getUserGroupMemberships(user.id),
    ]);
    const out: CachedAzureLookup = { expiresAt: now + LOOKUP_TTL_MS, user, assignments, groups, failed: false };
    lookupCache.set(key, out);
    return out;
  } catch (err) {
    console.error("[AzureAccess] loadAzureProfile error:", err);
    const out: CachedAzureLookup = { expiresAt: now + 5_000, user: null, assignments: [], groups: [], failed: true };
    lookupCache.set(key, out);
    return out;
  }
}

function pickRule(
  rules: AzureMappingRule[],
  portal: Portal,
  email: string,
  roleValues: Set<string>,
  groupOids: Set<string>,
): { rule: AzureMappingRule | undefined; matchedRoles: string[]; matchedGroups: string[] } {
  const matchedRoles: string[] = [];
  const matchedGroups: string[] = [];
  const domain = (email.split("@")[1] || "").toLowerCase();
  let chosen: AzureMappingRule | undefined;
  // App-role and group rules are ranked by specificity: admin > non-admin.
  // Within the same kind, the first rule wins so the admin can put their
  // most-specific rules at the top of the list.
  const candidates: AzureMappingRule[] = [];
  for (const rule of rules) {
    if (rule.target.portal !== portal) continue;
    if (rule.type === "appRole" && roleValues.has(rule.match)) {
      matchedRoles.push(rule.match);
      candidates.push(rule);
    } else if (rule.type === "group" && groupOids.has(rule.match)) {
      matchedGroups.push(rule.match);
      candidates.push(rule);
    } else if (rule.type === "domain" && domain && (rule.match === "*" || rule.match.toLowerCase() === domain)) {
      candidates.push(rule);
    }
  }
  candidates.sort((a, b) => Number(b.target.isAdmin) - Number(a.target.isAdmin));
  chosen = candidates[0];
  return { rule: chosen, matchedRoles, matchedGroups };
}

export async function decideAccess(ctx: AccessDecisionContext): Promise<AccessDecision> {
  const email = ctx.email.toLowerCase().trim();
  const rolloutMode = await getRolloutMode();
  const mapping = await getMappingConfig();
  const breakGlass = getBreakGlassEmails();

  const baseDecision: AccessDecision = {
    allowed: false,
    bypass: false,
    reason: "",
    matchedRoles: [],
    matchedGroups: [],
    matchedRules: [],
    rolloutMode,
    azureUnreachable: false,
  };

  // Break-glass: always allow, never depend on Azure being reachable.
  if (breakGlass.includes(email)) {
    const decision: AccessDecision = {
      ...baseDecision,
      allowed: true,
      bypass: true,
      reason: "break_glass",
      target: {
        portal: ctx.portal,
        role: ctx.portal === "partner" ? "partner" : "admin",
        isAdmin: true,
        label: "Break-glass operator",
      },
    };
    await recordEvent({
      eventType: "access.decision",
      email,
      source: ctx.source,
      decision: "allow",
      reason: "break_glass",
      rolloutMode,
      details: { portal: ctx.portal },
    });
    return decision;
  }

  // Disabled rollout: short-circuit to "allow without target" so callers
  // keep their legacy code path.
  if (rolloutMode === "disabled") {
    const decision: AccessDecision = { ...baseDecision, allowed: true, bypass: true, reason: "rollout_disabled" };
    await recordEvent({
      eventType: "access.decision",
      email,
      source: ctx.source,
      decision: "allow",
      reason: "rollout_disabled",
      rolloutMode,
      details: { portal: ctx.portal },
    });
    return decision;
  }

  const azure = await loadAzureProfile(email);
  baseDecision.azureUnreachable = azure.failed;
  baseDecision.azureOid = azure.user?.id;

  // If Graph is unreachable, audit-mode lets logins through (so an outage
  // doesn't lock everyone out) but enforce-mode rejects with a clear reason.
  if (azure.failed) {
    if (rolloutMode === "audit") {
      const decision: AccessDecision = { ...baseDecision, allowed: true, bypass: true, reason: "azure_unreachable_audit_mode" };
      await recordEvent({
        eventType: "access.decision",
        email,
        source: ctx.source,
        decision: "allow_due_to_outage",
        reason: "azure_unreachable",
        rolloutMode,
        details: { portal: ctx.portal },
      });
      return decision;
    }
    await recordEvent({
      eventType: "access.decision",
      email,
      source: ctx.source,
      decision: "deny",
      reason: "azure_unreachable",
      rolloutMode,
      details: { portal: ctx.portal },
    });
    return {
      ...baseDecision,
      allowed: false,
      reason: "azure_unreachable",
      friendlyMessage: "Sign-in is temporarily unavailable. Please try again in a few minutes.",
    };
  }

  // No Azure user found → straight deny.
  if (!azure.user) {
    const decision: AccessDecision = {
      ...baseDecision,
      allowed: rolloutMode === "audit",
      bypass: rolloutMode === "audit",
      reason: "no_azure_user",
      friendlyMessage: mapping.notAuthorizedMessage,
    };
    await recordEvent({
      eventType: "access.decision",
      email,
      source: ctx.source,
      decision: rolloutMode === "audit" ? "would_deny" : "deny",
      reason: "no_azure_user",
      rolloutMode,
      details: { portal: ctx.portal },
    });
    return decision;
  }

  const roleValues = new Set<string>();
  for (const a of azure.assignments) {
    // Resolve appRoleId to its `value` would normally need a lookup; we
    // store both the id and the value so admins can match either.
    if (a.appRoleId) roleValues.add(a.appRoleId);
  }
  // Mapping `match` is typically the role's `value` like "Siebert.Admin",
  // but admins may also paste the appRoleId GUID directly. Both are stored
  // in roleValues so a "value" rule needs the resolved value too. We cache
  // them in the user.last_roles_json after a full sync so admins can copy
  // them out of the UI.
  for (const a of azure.assignments) {
    const anyA = a as unknown as { value?: string };
    if (anyA.value) roleValues.add(anyA.value);
  }
  const groupOids = new Set<string>();
  for (const g of azure.groups) {
    if (g.id) groupOids.add(g.id);
  }

  const { rule, matchedRoles, matchedGroups } = pickRule(mapping.rules, ctx.portal, email, roleValues, groupOids);

  const allowed = Boolean(rule);
  const decision: AccessDecision = {
    ...baseDecision,
    allowed: allowed || rolloutMode === "audit",
    bypass: !allowed && rolloutMode === "audit",
    reason: rule ? `matched_${rule.type}:${rule.match}` : (mapping.defaultDeny ? "default_deny" : "no_matching_rule"),
    matchedRoles,
    matchedGroups,
    matchedRules: rule ? [rule] : [],
    target: rule?.target,
    friendlyMessage: allowed ? undefined : mapping.notAuthorizedMessage,
  };
  await recordEvent({
    eventType: "access.decision",
    email,
    azureOid: azure.user.id,
    source: ctx.source,
    decision: allowed ? "allow" : (rolloutMode === "audit" ? "would_deny" : "deny"),
    reason: decision.reason,
    rolloutMode,
    details: {
      portal: ctx.portal,
      matchedRoles,
      matchedGroups,
      target: rule?.target,
    },
  });
  return decision;
}

// ─── Profile sync helpers ────────────────────────────────────────────────────

export interface CachedAzureSnapshot {
  oid: string;
  rolesJson: string;
  groupsJson: string;
}

/** Helper that login paths use to persist the Azure snapshot back onto the
 *  local users/partners row so audit and admin UI can show "what we last saw". */
export function snapshotForPersist(decision: AccessDecision): CachedAzureSnapshot | null {
  if (!decision.azureOid) return null;
  return {
    oid: decision.azureOid,
    rolesJson: JSON.stringify(decision.matchedRoles),
    groupsJson: JSON.stringify(decision.matchedGroups),
  };
}

// ─── Per-request revalidation ───────────────────────────────────────────────

/** When the auth middleware sees a request whose `azure_last_check_at` is
 *  stale, it calls this to re-decide WITHOUT re-issuing a token. If the
 *  decision is `deny` and we're in enforce mode, the middleware returns 401
 *  with a `force_logout` flag and the caller wipes their local token. */
export async function revalidateRequest(opts: {
  email: string;
  portal: Portal;
  source: AccessSource;
  staleAfterSec?: number;
  lastCheckAt?: Date | null;
}): Promise<AccessDecision | null> {
  const stale = opts.staleAfterSec ?? 300;
  if (opts.lastCheckAt && opts.lastCheckAt.getTime() > Date.now() - stale * 1000) {
    return null;
  }
  return decideAccess({ email: opts.email, portal: opts.portal, source: opts.source });
}

// ─── Step-up auth ────────────────────────────────────────────────────────────

/** Returns true when a JWT's auth_time is older than the configured TTL. */
export function isStepUpRequired(authTime: number | undefined, maxAgeSec = 300): boolean {
  if (!authTime || !Number.isFinite(authTime)) return true;
  const age = Math.floor(Date.now() / 1000) - authTime;
  return age > maxAgeSec;
}

// ─── Persistence helpers used by login routes ───────────────────────────────

/** Persist the azure snapshot + last_check_at onto the local users row. */
export async function persistAzureSnapshotForUser(userId: number, decision: AccessDecision): Promise<void> {
  // When rollout is disabled, behave as if Azure-AD were not in the picture
  // at all — no DB writes to the new columns. This guarantees zero
  // observable change vs. the legacy code path until an admin opts in.
  if (decision.bypass && decision.reason === "rollout_disabled") return;
  const snap = snapshotForPersist(decision);
  const now = new Date();
  try {
    await db.update(usersTable).set({
      azureOid: snap?.oid ?? null,
      azureLastSyncAt: now,
      azureLastCheckAt: now,
      azureLastDecision: decision.allowed ? "allow" : "deny",
      azureLastRolesJson: snap?.rolesJson ?? null,
      azureLastGroupsJson: snap?.groupsJson ?? null,
      lastAuthnAt: now,
    } as Record<string, unknown>).where(eq(usersTable.id, userId));
  } catch (err) {
    console.error("[AzureAccess] persistAzureSnapshotForUser error:", err);
  }
}

/** Persist the azure snapshot onto the local partners row. */
export async function persistAzureSnapshotForPartner(partnerId: number, decision: AccessDecision): Promise<void> {
  if (decision.bypass && decision.reason === "rollout_disabled") return;
  const snap = snapshotForPersist(decision);
  const now = new Date();
  try {
    await db.update(partnersTable).set({
      azureOid: snap?.oid ?? null,
      azureLastSyncAt: now,
      azureLastCheckAt: now,
      azureLastDecision: decision.allowed ? "allow" : "deny",
      azureLastRolesJson: snap?.rolesJson ?? null,
      azureLastGroupsJson: snap?.groupsJson ?? null,
      lastAuthnAt: now,
    } as Record<string, unknown>).where(eq(partnersTable.id, partnerId));
  } catch (err) {
    console.error("[AzureAccess] persistAzureSnapshotForPartner error:", err);
  }
}

// ─── JWT jti helpers ─────────────────────────────────────────────────────────

export function generateJti(): string {
  return crypto.randomBytes(16).toString("hex");
}

export { AUDIT_FORWARD_URL_KEY, AUDIT_FORWARD_AUTH_KEY, SCHEDULED_SYNC_KEY };
