// Microsoft Graph client — used both for the long-standing guest-invite flow
// and for the Azure AD source-of-truth authorization layer (Task #187).
//
// All public functions degrade gracefully when MICROSOFT_TENANT_ID,
// MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET are missing or when the
// tenant is "common": they return null/empty so the calling code can fall
// back to its existing local behavior.

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const TENANT_ID = process.env.MICROSOFT_TENANT_ID || "";
const APP_OBJECT_ID = process.env.MICROSOFT_APP_OBJECT_ID || ""; // service principal object id used for app-role lookups

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppOnlyToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET || !TENANT_ID || TENANT_ID === "common") {
    if (TENANT_ID === "common") {
      console.warn("[Graph] MICROSOFT_TENANT_ID must be a specific tenant ID for app-only tokens. Skipping.");
    }
    return null;
  }
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error("[Graph] Token acquisition failed:", err);
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return cachedToken.value;
  } catch (err) {
    console.error("[Graph] Token acquisition error:", err);
    return null;
  }
}

// ─── Guest invite (legacy) ───────────────────────────────────────────────────

export interface GuestInviteResult {
  msObjectId: string;
  inviteRedeemUrl: string;
}

export async function inviteGuestUser(
  email: string,
  displayName: string,
  redirectUrl: string,
  customMessage?: string
): Promise<GuestInviteResult | null> {
  const outcome = await sendGuestInviteForRecord({ email, displayName, redirectUrl, customMessage });
  if (!outcome.ok) return null;
  return {
    msObjectId: outcome.msObjectId!,
    inviteRedeemUrl: outcome.inviteRedeemUrl!,
  };
}

/**
 * Structured result for the admin-controlled "Send Microsoft SSO invite"
 * action (Task #191). Unlike the legacy `inviteGuestUser` helper, this one
 * surfaces the raw Graph error body so admins see exactly why a call failed
 * (e.g. AADB2B insufficient permissions, malformed email, tenant policy).
 */
export interface GuestInviteOutcome {
  ok: boolean;
  msObjectId?: string;
  inviteRedeemUrl?: string;
  /** Raw Graph error body (verbatim) when ok=false. */
  error?: string;
  /** HTTP status from Graph when ok=false. */
  status?: number;
}

export async function sendGuestInviteForRecord(opts: {
  email: string;
  displayName: string;
  redirectUrl: string;
  customMessage?: string;
}): Promise<GuestInviteOutcome> {
  if (!isGraphConfigured()) {
    return {
      ok: false,
      error:
        "Microsoft Graph is not configured. Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET (and MICROSOFT_TENANT_ID must be a specific tenant id, not 'common').",
    };
  }
  const token = await getAppOnlyToken();
  if (!token) {
    return {
      ok: false,
      error:
        "Failed to obtain a Microsoft Graph application token. Check the configured client id/secret and tenant id.",
    };
  }
  try {
    const body = {
      invitedUserEmailAddress: opts.email,
      invitedUserDisplayName: opts.displayName,
      inviteRedirectUrl: opts.redirectUrl,
      sendInvitationMessage: true,
      invitedUserMessageInfo: opts.customMessage
        ? { customizedMessageBody: opts.customMessage }
        : undefined,
    };
    const res = await fetch("https://graph.microsoft.com/v1.0/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[Graph] Guest invite failed for ${opts.email} (${res.status}):`, errText);
      return { ok: false, status: res.status, error: errText || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      invitedUser: { id: string };
      inviteRedeemUrl: string;
    };
    console.log(`[Graph] Guest invited: ${opts.email} → objectId=${data.invitedUser.id}`);
    return { ok: true, msObjectId: data.invitedUser.id, inviteRedeemUrl: data.inviteRedeemUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Graph] Guest invite error for ${opts.email}:`, msg);
    return { ok: false, error: msg };
  }
}

// ─── User & directory lookups (Task #187) ─────────────────────────────────────

export interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  accountEnabled?: boolean;
  jobTitle?: string;
  department?: string;
  companyName?: string;
}

export interface GraphAppRoleAssignment {
  id: string;
  appRoleId: string;
  principalDisplayName?: string;
  resourceDisplayName?: string;
  resourceId: string;
  createdDateTime?: string;
}

export interface GraphAppRole {
  id: string;
  value: string;
  displayName: string;
  description?: string;
  isEnabled?: boolean;
}

export interface GraphGroup {
  id: string;
  displayName?: string;
}

async function graphGet<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[Graph] GET ${path} failed (${res.status}): ${txt.slice(0, 240)}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[Graph] GET ${path} error:`, err);
    return null;
  }
}

/** Look a user up by email or UPN. Returns null when the user doesn't exist
 *  in the tenant or when Graph credentials aren't configured. */
export async function lookupUserByEmail(email: string): Promise<GraphUser | null> {
  const token = await getAppOnlyToken();
  if (!token) return null;
  const lookup = encodeURIComponent(email.toLowerCase());
  // Try direct lookup by UPN first (cheapest), then fall back to filter on mail.
  let user = await graphGet<GraphUser>(`/users/${lookup}?$select=id,displayName,mail,userPrincipalName,accountEnabled,jobTitle,department,companyName`, token);
  if (user?.id) return user;
  const filtered = await graphGet<{ value: GraphUser[] }>(`/users?$filter=${encodeURIComponent(`mail eq '${email}' or userPrincipalName eq '${email}'`)}&$select=id,displayName,mail,userPrincipalName,accountEnabled,jobTitle,department,companyName&$top=1`, token);
  user = filtered?.value?.[0] ?? null;
  return user ?? null;
}

/** Get every app-role assignment for a user across every app registration. */
export async function getUserAppRoleAssignments(oid: string): Promise<GraphAppRoleAssignment[]> {
  const token = await getAppOnlyToken();
  if (!token) return [];
  const out: GraphAppRoleAssignment[] = [];
  let url: string | null = `/users/${encodeURIComponent(oid)}/appRoleAssignments`;
  while (url) {
    const page = await graphGet<{ value: GraphAppRoleAssignment[]; "@odata.nextLink"?: string }>(url, token);
    if (!page) break;
    out.push(...(page.value || []));
    const next = (page as { "@odata.nextLink"?: string })["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : null;
  }
  return out;
}

/** Get every group (security or M365) the user is a transitive member of. */
export async function getUserGroupMemberships(oid: string): Promise<GraphGroup[]> {
  const token = await getAppOnlyToken();
  if (!token) return [];
  const out: GraphGroup[] = [];
  let url: string | null = `/users/${encodeURIComponent(oid)}/transitiveMemberOf?$select=id,displayName&$top=200`;
  while (url) {
    const page = await graphGet<{ value: GraphGroup[]; "@odata.nextLink"?: string }>(url, token);
    if (!page) break;
    out.push(...(page.value || []));
    const next = (page as { "@odata.nextLink"?: string })["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : null;
  }
  return out;
}

/** Fetch the user's profile photo as a Buffer + content type. */
export async function getUserPhoto(oid: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const token = await getAppOnlyToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(oid)}/photo/$value`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, contentType: res.headers.get("content-type") || "image/jpeg" };
  } catch (err) {
    console.error(`[Graph] getUserPhoto error for ${oid}:`, err);
    return null;
  }
}

/** List all enabled app roles defined on this app's service principal. */
export async function listAppRoles(): Promise<GraphAppRole[]> {
  if (!APP_OBJECT_ID) return [];
  const token = await getAppOnlyToken();
  if (!token) return [];
  const sp = await graphGet<{ appRoles?: GraphAppRole[] }>(`/servicePrincipals/${encodeURIComponent(APP_OBJECT_ID)}?$select=appRoles`, token);
  return (sp?.appRoles || []).filter(r => r.isEnabled !== false);
}

/** Assign a user to one of this app's app roles. */
export async function assignAppRole(userOid: string, appRoleId: string): Promise<GraphAppRoleAssignment | null> {
  if (!APP_OBJECT_ID) return null;
  const token = await getAppOnlyToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userOid)}/appRoleAssignments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        principalId: userOid,
        resourceId: APP_OBJECT_ID,
        appRoleId,
      }),
    });
    if (!res.ok) {
      console.warn(`[Graph] assignAppRole failed (${res.status}):`, await res.text());
      return null;
    }
    return (await res.json()) as GraphAppRoleAssignment;
  } catch (err) {
    console.error(`[Graph] assignAppRole error:`, err);
    return null;
  }
}

/** Revoke a previously created app-role assignment. */
export async function revokeAppRoleAssignment(userOid: string, assignmentId: string): Promise<boolean> {
  const token = await getAppOnlyToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userOid)}/appRoleAssignments/${encodeURIComponent(assignmentId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch (err) {
    console.error(`[Graph] revokeAppRoleAssignment error:`, err);
    return false;
  }
}

/** Light-weight "ping" that simply asks for an app-only token. */
export async function pingGraph(): Promise<boolean> {
  return (await getAppOnlyToken()) !== null;
}

export function isGraphConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && TENANT_ID && TENANT_ID !== "common");
}

export function getAppObjectId(): string {
  return APP_OBJECT_ID;
}
