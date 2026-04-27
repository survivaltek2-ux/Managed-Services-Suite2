// Scheduled Azure AD directory pull (Task #187).
//
// Walks every user with an app-role assignment on this app, refreshes
// our local snapshot (azure_oid, last_sync, last_groups), and reconciles
// partner_team_members rows against any configured group bindings.
//
// Default cadence: every 15 minutes. Overridable via env
// AZURE_AD_SYNC_INTERVAL_MIN. Set to 0 to disable.

import { db, partnerTeamMembersTable, azureAdGroupBindingsTable, partnersTable, usersTable, siteSettingsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  isGraphConfigured,
  getAppObjectId,
  getUserAppRoleAssignments,
  getUserGroupMemberships,
  lookupUserByEmail,
} from "./microsoft-graph.js";
import { recordEvent } from "./azure-ad-access.js";

let timerHandle: NodeJS.Timeout | null = null;

interface SyncResult {
  scannedUsers: number;
  refreshedUsers: number;
  refreshedPartners: number;
  refreshedTeamMembers: number;
  groupBindingsApplied: number;
  errors: number;
}

const APP_ONLY_GRAPH = "https://graph.microsoft.com/v1.0";

interface AppRoleAssignedTo {
  id: string;
  principalId: string;
  principalType?: string;
  principalDisplayName?: string;
  appRoleId: string;
}

async function fetchAllAssignedPrincipals(token: string): Promise<AppRoleAssignedTo[]> {
  const appOid = getAppObjectId();
  if (!appOid) return [];
  const out: AppRoleAssignedTo[] = [];
  let url: string | null = `${APP_ONLY_GRAPH}/servicePrincipals/${encodeURIComponent(appOid)}/appRoleAssignedTo?$top=200`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.warn(`[AzureSync] appRoleAssignedTo ${res.status}: ${(await res.text()).slice(0, 200)}`);
      break;
    }
    const data = await res.json() as { value: AppRoleAssignedTo[]; "@odata.nextLink"?: string };
    out.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }
  return out;
}

async function getAppOnlyToken(): Promise<string | null> {
  const tenant = process.env.MICROSOFT_TENANT_ID || "";
  const clientId = process.env.MICROSOFT_CLIENT_ID || "";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
  if (!tenant || tenant === "common" || !clientId || !clientSecret) return null;
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    });
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string };
    return data.access_token;
  } catch { return null; }
}

interface GraphUserDetail {
  id: string;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

async function fetchUserDetail(token: string, oid: string): Promise<GraphUserDetail | null> {
  try {
    const res = await fetch(`${APP_ONLY_GRAPH}/users/${encodeURIComponent(oid)}?$select=id,mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json() as GraphUserDetail;
  } catch { return null; }
}

export async function runDirectorySyncOnce(): Promise<SyncResult> {
  const result: SyncResult = {
    scannedUsers: 0,
    refreshedUsers: 0,
    refreshedPartners: 0,
    refreshedTeamMembers: 0,
    groupBindingsApplied: 0,
    errors: 0,
  };
  if (!isGraphConfigured()) {
    console.log("[AzureSync] Graph not configured — skipping scheduled sync.");
    return result;
  }
  const token = await getAppOnlyToken();
  if (!token) {
    console.log("[AzureSync] No app-only token — skipping scheduled sync.");
    return result;
  }

  // Walk every user assigned to this app's service principal.
  const assignments = await fetchAllAssignedPrincipals(token);
  const userIds = new Set<string>();
  for (const a of assignments) {
    if (a.principalType === "User") userIds.add(a.principalId);
  }
  result.scannedUsers = userIds.size;

  // Pre-load group bindings once.
  const bindings = await db.select().from(azureAdGroupBindingsTable);
  const bindingByGroup = new Map<string, typeof bindings[number][]>();
  for (const b of bindings) {
    const arr = bindingByGroup.get(b.groupOid) ?? [];
    arr.push(b);
    bindingByGroup.set(b.groupOid, arr);
  }

  for (const oid of userIds) {
    try {
      const detail = await fetchUserDetail(token, oid);
      if (!detail) continue;
      const email = (detail.mail || detail.userPrincipalName || "").toLowerCase();
      if (!email) continue;
      const groups = await getUserGroupMemberships(oid);
      const groupOids = groups.map(g => g.id).filter((id): id is string => Boolean(id));
      const now = new Date();
      const rolesJson = JSON.stringify(assignments.filter(a => a.principalId === oid).map(a => a.appRoleId));
      const groupsJson = JSON.stringify(groupOids);

      // Refresh local users row if present.
      const userRes = await db.update(usersTable).set({
        azureOid: oid,
        azureLastSyncAt: now,
        azureLastRolesJson: rolesJson,
        azureLastGroupsJson: groupsJson,
      } as Record<string, unknown>).where(eq(usersTable.email, email));
      if ((userRes as unknown as { rowCount?: number }).rowCount) result.refreshedUsers++;

      // Refresh local partners row if present.
      const partnerRes = await db.update(partnersTable).set({
        azureOid: oid,
        azureLastSyncAt: now,
        azureLastRolesJson: rolesJson,
        azureLastGroupsJson: groupsJson,
      } as Record<string, unknown>).where(eq(partnersTable.email, email));
      if ((partnerRes as unknown as { rowCount?: number }).rowCount) result.refreshedPartners++;

      // Refresh local team-member row if present.
      const tmRes = await db.update(partnerTeamMembersTable).set({
        azureOid: oid,
        azureLastSyncAt: now,
      } as Record<string, unknown>).where(eq(partnerTeamMembersTable.email, email));
      if ((tmRes as unknown as { rowCount?: number }).rowCount) result.refreshedTeamMembers++;

      // Apply group bindings: for each binding group the user is in, ensure
      // a team-member row exists for that partner; for each binding group
      // they're NOT in but used to be in, revoke.
      for (const gOid of groupOids) {
        const matchingBindings = bindingByGroup.get(gOid) || [];
        for (const b of matchingBindings) {
          // Upsert a team-member row.
          const [existing] = await db.select().from(partnerTeamMembersTable)
            .where(and(eq(partnerTeamMembersTable.email, email), eq(partnerTeamMembersTable.partnerId, b.partnerId)))
            .limit(1);
          if (existing) {
            if (existing.status !== "active") {
              await db.update(partnerTeamMembersTable).set({
                status: "active",
                azureManagedByGroup: true,
                azureLastSyncAt: now,
              } as Record<string, unknown>).where(eq(partnerTeamMembersTable.id, existing.id));
              result.groupBindingsApplied++;
            }
          } else {
            await db.insert(partnerTeamMembersTable).values({
              partnerId: b.partnerId,
              email,
              name: detail.displayName || email,
              status: "active",
              azureOid: oid,
              azureLastSyncAt: now,
              azureManagedByGroup: true,
              ssoProvider: "microsoft",
              ssoId: oid,
              acceptedAt: now,
            } as Record<string, unknown>).onConflictDoNothing();
            result.groupBindingsApplied++;
          }
        }
      }
    } catch (err) {
      console.error(`[AzureSync] error syncing oid=${oid}:`, err);
      result.errors++;
    }
  }

  // Reconcile group-managed team members: any team_member with
  // azure_managed_by_group=true whose user no longer has that group is
  // revoked. Done by scanning all bindings and computing.
  for (const b of bindings) {
    // Find every team-member tied to this partner whose group binding
    // should still be active. Anyone NOT in that set who is currently
    // azure_managed_by_group + active gets revoked.
    const shouldBeActiveEmails = new Set<string>();
    for (const oid of userIds) {
      const groups = await getUserGroupMemberships(oid);
      if (!groups.some(g => g.id === b.groupOid)) continue;
      const detail = await fetchUserDetail(token, oid);
      const email = (detail?.mail || detail?.userPrincipalName || "").toLowerCase();
      if (email) shouldBeActiveEmails.add(email);
    }
    const candidates = await db.select().from(partnerTeamMembersTable).where(and(
      eq(partnerTeamMembersTable.partnerId, b.partnerId),
    ));
    for (const m of candidates) {
      const azureManaged = (m as { azureManagedByGroup?: boolean }).azureManagedByGroup === true;
      if (!azureManaged) continue;
      if (m.status === "active" && !shouldBeActiveEmails.has(m.email.toLowerCase())) {
        await db.update(partnerTeamMembersTable).set({
          status: "revoked",
          azureLastSyncAt: new Date(),
        } as Record<string, unknown>).where(eq(partnerTeamMembersTable.id, m.id));
        result.groupBindingsApplied++;
      }
    }
  }

  // Persist last-run stamp.
  await db.execute(sql`
    INSERT INTO site_settings (key, value)
    VALUES ('azure_ad_last_full_sync_at', ${new Date().toISOString()})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);

  await recordEvent({
    eventType: "sync.completed",
    source: "scheduled_sync",
    decision: "info",
    details: result as unknown as Record<string, unknown>,
  });

  console.log(`[AzureSync] done: scanned=${result.scannedUsers} usersUpd=${result.refreshedUsers} partnersUpd=${result.refreshedPartners} teamUpd=${result.refreshedTeamMembers} bindings=${result.groupBindingsApplied} errors=${result.errors}`);
  return result;
}

export function startAzureAdSyncScheduler(): void {
  if (timerHandle) return;
  const intervalMin = Number(process.env.AZURE_AD_SYNC_INTERVAL_MIN ?? "15");
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) {
    console.log("[AzureSync] disabled (AZURE_AD_SYNC_INTERVAL_MIN <= 0)");
    return;
  }
  if (!isGraphConfigured()) {
    console.log("[AzureSync] not starting — Graph credentials not configured.");
    return;
  }
  console.log(`[AzureSync] scheduler starting (every ${intervalMin}min)`);
  // First run after 60s so startup isn't blocked.
  setTimeout(() => { runDirectorySyncOnce().catch(err => console.error("[AzureSync] initial run error:", err)); }, 60_000);
  timerHandle = setInterval(() => {
    runDirectorySyncOnce().catch(err => console.error("[AzureSync] interval run error:", err));
  }, intervalMin * 60 * 1000);
}

export function stopAzureAdSyncScheduler(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}
