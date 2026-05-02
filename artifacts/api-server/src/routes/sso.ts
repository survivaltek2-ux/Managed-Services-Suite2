import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, partnersTable, partnerTeamMembersTable, siteSettingsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { sendPartnerSsoRegistrationNotification } from "../lib/email.js";
import { recordOnboardingEvent } from "../lib/onboardingEvents.js";
import { generatePartnerToken, generateTeamMemberToken } from "../middlewares/partnerAuth.js";
import {
  decideAccess,
  persistAzureSnapshotForPartner,
  persistAzureSnapshotForUser,
  recordEvent,
  getMappingConfig,
} from "../lib/azure-ad-access.js";

const router = Router();

// ─── SSO One-Time Code Exchange ───────────────────────────────────────────────
// Instead of putting long-lived bearer tokens in the URL (where they are
// exposed to server logs, browser history, and browser extensions), the SSO
// callback mints a short-lived one-time code that the frontend exchanges for
// the real token in a POST request.  The code expires after 60 seconds and
// can only be used once.

interface SsoCodeEntry {
  token: string;
  expiresAt: number; // Unix ms
}

const ssoCodeStore = new Map<string, SsoCodeEntry>();
const SSO_CODE_TTL_MS = 60_000; // 60 seconds — plenty for a redirect + JS bootstrap

function issueSsoCode(token: string): string {
  const code = crypto.randomBytes(32).toString("hex");
  ssoCodeStore.set(code, { token, expiresAt: Date.now() + SSO_CODE_TTL_MS });
  return code;
}

// Clean up expired codes periodically so the map doesn't grow unboundedly.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ssoCodeStore) {
    if (entry.expiresAt <= now) ssoCodeStore.delete(key);
  }
}, SSO_CODE_TTL_MS * 2);

/** Exchanges a one-time SSO code for the real bearer token.
 *  Accepts the code in the POST body so it never appears in server access logs. */
router.post("/sso/exchange-code", (req, res) => {
  const code = req.body?.code as string | undefined;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "bad_request", message: "code is required" });
    return;
  }
  const entry = ssoCodeStore.get(code);
  if (!entry) {
    res.status(401).json({ error: "invalid_code", message: "SSO code is invalid or has already been used" });
    return;
  }
  // One-time use: delete immediately before returning.
  ssoCodeStore.delete(code);
  if (entry.expiresAt <= Date.now()) {
    res.status(401).json({ error: "code_expired", message: "SSO code has expired. Please sign in again." });
    return;
  }
  res.json({ token: entry.token });
});

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || "";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}

// Cookie name for the per-login CSRF nonce
const SSO_NONCE_COOKIE = "ms_sso_nonce";
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface MicrosoftTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

interface MicrosoftIdTokenClaims {
  tid?: string;
  oid?: string;
  email?: string;
  preferred_username?: string;
}

interface MicrosoftProfile {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  companyName?: string;
}

interface SsoDomainRule {
  domain: string;
  role: "client" | "admin";
}

function decodeIdTokenClaims(idToken: string): MicrosoftIdTokenClaims {
  try {
    const payload = idToken.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as MicrosoftIdTokenClaims;
  } catch {
    return {};
  }
}

async function getSsoDomainRules(): Promise<SsoDomainRule[]> {
  try {
    const [row] = await db
      .select({ value: siteSettingsTable.value })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.key, "sso_domain_rules"))
      .limit(1);
    if (!row?.value) return [];
    return JSON.parse(row.value) as SsoDomainRule[];
  } catch {
    return [];
  }
}

function getRoleForEmail(email: string, rules: SsoDomainRule[]): "client" | "admin" | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const exactMatch = rules.find(r => r.domain.toLowerCase() === domain);
  if (exactMatch) return exactMatch.role;
  const wildcardMatch = rules.find(r => r.domain === "*");
  return wildcardMatch ? wildcardMatch.role : null;
}

// ─── Step-up auth ─────────────────────────────────────────────────────────────
// Triggered by the client when an API call comes back 401 stepup_required.
// Forces a fresh interactive Microsoft sign-in (prompt=login) and on
// callback re-issues the JWT with a refreshed auth_time.

router.get("/auth/sso/microsoft/step-up", (req, res) => {
  const type = req.query.type === "partner" ? "partner" : "client";
  if (!CLIENT_ID || !REDIRECT_URI) {
    const loginPath = type === "partner" ? "/partners/login" : "/portal";
    res.redirect(`${loginPath}?sso_error=sso_not_configured`);
    return;
  }
  const nonce = crypto.randomBytes(32).toString("hex");
  res.cookie(SSO_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: NONCE_TTL_MS,
    path: "/",
  });
  const state = Buffer.from(JSON.stringify({ type, nonce, stepUp: true })).toString("base64url");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: "openid email profile User.Read",
    prompt: "login",
    state,
  });
  res.redirect(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`);
});

// ─── Login initiation ─────────────────────────────────────────────────────────

router.get("/auth/sso/microsoft", (req, res) => {
  const type = req.query.type === "partner" ? "partner" : "client";
  if (!CLIENT_ID || !REDIRECT_URI) {
    const loginPath = type === "partner" ? "/partners/login" : "/portal";
    res.redirect(`${loginPath}?sso_error=sso_not_configured`);
    return;
  }

  // Generate a cryptographically random nonce to bind the callback to this browser
  const nonce = crypto.randomBytes(32).toString("hex");

  // Store nonce in an HttpOnly, SameSite=Lax cookie so only this browser can complete the flow
  res.cookie(SSO_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: NONCE_TTL_MS,
    path: "/",
  });

  // Include both the type and the nonce in the state parameter
  const state = Buffer.from(JSON.stringify({ type, nonce })).toString("base64url");

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: "openid email profile User.Read",
    state,
  });
  res.redirect(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`);
});

// ─── Callback ─────────────────────────────────────────────────────────────────

router.get("/auth/sso/microsoft/callback", async (req, res) => {
  const { code, state, error } = req.query;

  // ── CSRF check: state must be present and parseable ──────────────────────────
  if (!state || typeof state !== "string") {
    res.redirect("/portal?sso_error=invalid_state");
    return;
  }

  let type: "partner" | "client";
  let stateNonce: string | undefined;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    if (decoded.type !== "partner" && decoded.type !== "client") {
      res.redirect("/portal?sso_error=invalid_state");
      return;
    }
    type = decoded.type;
    stateNonce = typeof decoded.nonce === "string" ? decoded.nonce : undefined;
  } catch {
    res.redirect("/portal?sso_error=invalid_state");
    return;
  }

  const loginPath = type === "partner" ? "/partners/login" : "/portal";

  // ── CSRF check: nonce in state must match the HttpOnly cookie ─────────────────
  const cookieNonce = req.cookies?.[SSO_NONCE_COOKIE];

  // Clear the nonce cookie regardless of outcome (one-time use)
  res.clearCookie(SSO_NONCE_COOKIE, { path: "/" });

  if (!stateNonce || !cookieNonce || stateNonce !== cookieNonce) {
    console.warn("[SSO] CSRF check failed — state nonce does not match cookie nonce");
    res.redirect(`${loginPath}?sso_error=csrf_check_failed`);
    return;
  }

  // ── Standard OAuth error from Microsoft ──────────────────────────────────────
  if (error || !code) {
    res.redirect(`${loginPath}?sso_error=access_denied`);
    return;
  }

  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code as string,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
          scope: "openid email profile User.Read",
        }),
      }
    );

    if (!tokenRes.ok) {
      console.error("[SSO] Token exchange failed:", await tokenRes.text());
      res.redirect(`${loginPath}?sso_error=token_failed`);
      return;
    }

    const tokenData = (await tokenRes.json()) as MicrosoftTokenResponse;

    if (TENANT_ID !== "common" && tokenData.id_token) {
      const claims = decodeIdTokenClaims(tokenData.id_token);
      if (claims.tid && claims.tid !== TENANT_ID) {
        console.warn(`[SSO] Tenant mismatch: expected ${TENANT_ID}, got ${claims.tid}`);
        res.redirect(`${loginPath}?sso_error=wrong_tenant`);
        return;
      }
    }

    const profileRes = await fetch(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,companyName",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    if (!profileRes.ok) {
      res.redirect(`${loginPath}?sso_error=profile_failed`);
      return;
    }

    const profile = (await profileRes.json()) as MicrosoftProfile;
    const email = (profile.mail || profile.userPrincipalName || "").toLowerCase().trim();
    const name = profile.displayName || email;
    const ssoId = profile.id;

    if (!email) {
      res.redirect(`${loginPath}?sso_error=no_email`);
      return;
    }

    // ── Azure AD authorization check (Task #187) ────────────────────────
    // In disabled mode this returns {allowed:true, bypass:true} and is a
    // no-op. In audit mode it logs a "would_deny" event but lets the user
    // through. In enforce mode it short-circuits with a friendly error.
    const idTokenClaims = tokenData.id_token ? decodeIdTokenClaims(tokenData.id_token) : {};
    const accessDecision = await decideAccess({
      email,
      portal: type === "partner" ? "partner" : "client",
      source: "sso_microsoft",
      idTokenClaims: idTokenClaims as Record<string, unknown>,
    });
    if (!accessDecision.allowed) {
      const errParams = new URLSearchParams({
        sso_error: accessDecision.reason === "azure_unreachable" ? "azure_unreachable" : "not_authorized",
      });
      res.redirect(`${loginPath}?${errParams}`);
      return;
    }

    const domainRules = await getSsoDomainRules();
    const JWT_SECRET = getJwtSecret();

    if (type === "partner") {
      const [partner] = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.email, email))
        .limit(1);

      if (partner) {
        if (!partner.ssoId) {
          await db
            .update(partnersTable)
            .set({ ssoProvider: "microsoft", ssoId })
            .where(eq(partnersTable.id, partner.id));
        }
        if (partner.status === "pending") {
          const pendingParams = new URLSearchParams({ company: partner.companyName, email: partner.email });
          res.redirect(`/partners/pending?${pendingParams}`);
          return;
        }
        if (partner.status === "rejected") {
          res.redirect(`/partners/login?sso_error=account_rejected`);
          return;
        }
        // Apply Azure mapping target overrides when present (e.g. an Azure
        // app role that says "this user IS an admin").
        let isAdmin = partner.isAdmin;
        if (accessDecision.target?.portal === "partner" && typeof accessDecision.target.isAdmin === "boolean") {
          isAdmin = accessDecision.target.isAdmin;
        }
        await persistAzureSnapshotForPartner(partner.id, accessDecision);
        const token = generatePartnerToken(partner.id, isAdmin, { email, authTime: Math.floor(Date.now() / 1000) });
        res.redirect(`/partners/login?sso_code=${issueSsoCode(token)}`);
        return;
      }

      // Not a primary partner. Check if this email is an invited team member.
      const [teamMember] = await db
        .select()
        .from(partnerTeamMembersTable)
        .where(eq(partnerTeamMembersTable.email, email))
        .limit(1);

      if (teamMember) {
        if (teamMember.status === "revoked") {
          res.redirect(`/partners/login?sso_error=team_member_revoked`);
          return;
        }
        // For pending invites, enforce the invite expiry — a stale invite must
        // not auto-activate just because the email matches.
        if (teamMember.status === "pending") {
          if (teamMember.inviteTokenExpires && teamMember.inviteTokenExpires < new Date()) {
            res.redirect(`/partners/login?sso_error=invite_expired`);
            return;
          }
        }
        const [parentPartner] = await db
          .select()
          .from(partnersTable)
          .where(eq(partnersTable.id, teamMember.partnerId))
          .limit(1);
        if (!parentPartner || parentPartner.status !== "approved") {
          res.redirect(`/partners/login?sso_error=team_member_company_inactive`);
          return;
        }
        await db
          .update(partnerTeamMembersTable)
          .set({
            status: "active",
            ssoProvider: "microsoft",
            ssoId,
            acceptedAt: teamMember.acceptedAt ?? new Date(),
            lastLoginAt: new Date(),
            inviteToken: null,
            inviteTokenExpires: null,
            updatedAt: new Date(),
          })
          .where(eq(partnerTeamMembersTable.id, teamMember.id));
        // Record onboarding events: explicit "invite_accepted" the first time
        // (when there was no acceptedAt yet) and an "sso_login" on every SSO
        // sign-in so the timeline reflects each lifecycle transition.
        if (!teamMember.acceptedAt) {
          recordOnboardingEvent({
            flow: "partner_team_invite", entityId: teamMember.id, eventType: "invite_accepted",
            actorType: "partner", actorLabel: email,
            note: `${email} accepted invite via Microsoft SSO`,
            payload: { ssoProvider: "microsoft" },
          }).catch(() => {});
        }
        recordOnboardingEvent({
          flow: "partner_team_invite", entityId: teamMember.id, eventType: "sso_login",
          actorType: "partner", actorLabel: email,
          note: `${email} signed in via Microsoft SSO`,
        }).catch(() => {});
        console.log(`[SSO] Team member ${email} logged in for partner ${parentPartner.companyName}`);
        const token = generateTeamMemberToken(parentPartner.id, teamMember.id, { email, authTime: Math.floor(Date.now() / 1000) });
        res.redirect(`/partners/login?sso_code=${issueSsoCode(token)}`);
        return;
      }

      // Not a partner and not an invited team member. Fall back to admin-user
      // shortcut if this email belongs to an internal admin.
      const [adminUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (adminUser && adminUser.role === "admin") {
        if (!adminUser.ssoId) {
          await db
            .update(usersTable)
            .set({ ssoProvider: "microsoft", ssoId })
            .where(eq(usersTable.id, adminUser.id));
        }
        await persistAzureSnapshotForUser(adminUser.id, accessDecision);
        const now = Math.floor(Date.now() / 1000);
        const jti = crypto.randomBytes(16).toString("hex");
        const token = jwt.sign(
          { userId: adminUser.id, role: adminUser.role, jti, auth_time: now, email },
          JWT_SECRET,
          { expiresIn: "7d" },
        );
        res.redirect(`/partners/login?sso_code=${issueSsoCode(token)}`);
        return;
      }

      // Enforce one-admin-per-domain: if any approved partner already exists
      // with the same email domain, this person must be invited by that admin
      // rather than self-register a duplicate company.
      const domain = email.split("@")[1]?.toLowerCase() ?? "";
      if (domain) {
        const [existingDomainPartner] = await db
          .select({ id: partnersTable.id, companyName: partnersTable.companyName, email: partnersTable.email })
          .from(partnersTable)
          .where(and(
            sql`lower(split_part(${partnersTable.email}, '@', 2)) = ${domain}`,
            ne(partnersTable.status, "rejected"),
          ))
          .limit(1);
        if (existingDomainPartner) {
          console.log(`[SSO] Blocking self-registration for ${email} — domain already owned by partner ${existingDomainPartner.email}`);
          const params = new URLSearchParams({
            sso_error: "domain_already_registered",
            admin_email: existingDomainPartner.email,
            company: existingDomainPartner.companyName,
          });
          res.redirect(`/partners/login?${params}`);
          return;
        }
      }

      const companyName = profile.companyName || email.split("@")[1]?.split(".")[0] || "Unknown Company";
      await db.insert(partnersTable).values({
        companyName,
        contactName: name,
        email,
        password: await bcrypt.hash(ssoId + crypto.randomUUID(), 10),
        phone: null,
        website: null,
        businessType: "other",
        specializations: "[]",
        status: "pending",
        tier: "registered",
        isAdmin: true,
        ssoProvider: "microsoft",
        ssoId,
      });

      sendPartnerSsoRegistrationNotification({
        companyName,
        contactName: name,
        email,
      }).catch(err => console.error("[SSO] Partner registration notification error:", err));

      console.log(`[SSO] Created pending partner account for ${email} via SSO self-registration`);
      const pendingParams = new URLSearchParams({ company: companyName, email });
      res.redirect(`/partners/pending?${pendingParams}`);
      return;
    } else {
      let [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);

      if (!user) {
        const domainRole = getRoleForEmail(email, domainRules);
        const randomPw = await bcrypt.hash(ssoId + crypto.randomUUID(), 10);
        const [newUser] = await db
          .insert(usersTable)
          .values({
            name,
            email,
            password: randomPw,
            company: profile.companyName || "Microsoft SSO User",
            ssoProvider: "microsoft",
            ssoId,
            role: domainRole ?? "client",
            emailVerifiedAt: new Date(), // SSO proves email identity
          })
          .returning();
        user = newUser;
        console.log(`[SSO] Created new client account for ${email} with role=${user.role}`);
      } else {
        const updates: Record<string, unknown> = {};
        if (!user.ssoId) {
          const domainRole = getRoleForEmail(email, domainRules);
          updates.ssoProvider = "microsoft";
          updates.ssoId = ssoId;
          if (domainRole && user.role !== domainRole) updates.role = domainRole;
        }
        // Verify any existing user who successfully completes SSO
        if (!user.emailVerifiedAt) updates.emailVerifiedAt = new Date();
        if (Object.keys(updates).length > 0) {
          await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
          user = { ...user, ...updates } as typeof user;
        }
      }

      // Apply Azure mapping target overrides when present.
      let resolvedRole = user.role;
      if (accessDecision.target?.portal === "client") {
        if (accessDecision.target.isAdmin) resolvedRole = "admin";
        else if (accessDecision.target.role === "client") resolvedRole = "client";
      }
      if (resolvedRole !== user.role) {
        await db.update(usersTable).set({ role: resolvedRole }).where(eq(usersTable.id, user.id));
      }
      await persistAzureSnapshotForUser(user.id, accessDecision);
      const now = Math.floor(Date.now() / 1000);
      const jti = crypto.randomBytes(16).toString("hex");
      const token = jwt.sign(
        { userId: user.id, role: resolvedRole, jti, auth_time: now, email },
        JWT_SECRET,
        { expiresIn: "7d" },
      );
      res.redirect(`/portal?sso_code=${issueSsoCode(token)}`);
    }
  } catch (err) {
    console.error("[SSO] Error:", err);
    res.redirect(`${loginPath}?sso_error=server_error`);
  }
});

export default router;
