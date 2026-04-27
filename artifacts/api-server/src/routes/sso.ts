import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, partnersTable, partnerTeamMembersTable, siteSettingsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { sendPartnerSsoRegistrationNotification } from "../lib/email.js";
import { generatePartnerToken, generateTeamMemberToken } from "../middlewares/partnerAuth.js";

const router = Router();

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

  let type: "partner" | "client" = "client";
  let stateNonce: string | undefined;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    type = decoded.type === "partner" ? "partner" : "client";
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
        const token = generatePartnerToken(partner.id, partner.isAdmin);
        res.redirect(`/partners/login?sso_token=${token}`);
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
        console.log(`[SSO] Team member ${email} logged in for partner ${parentPartner.companyName}`);
        const token = generateTeamMemberToken(parentPartner.id, teamMember.id);
        res.redirect(`/partners/login?sso_token=${token}`);
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
        const token = jwt.sign({ userId: adminUser.id, role: adminUser.role }, JWT_SECRET, { expiresIn: "7d" });
        res.redirect(`/partners/login?sso_token=${token}`);
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
          })
          .returning();
        user = newUser;
        console.log(`[SSO] Created new client account for ${email} with role=${user.role}`);
      } else {
        if (!user.ssoId) {
          const domainRole = getRoleForEmail(email, domainRules);
          await db
            .update(usersTable)
            .set({
              ssoProvider: "microsoft",
              ssoId,
              ...(domainRole && user.role !== domainRole ? { role: domainRole } : {}),
            })
            .where(eq(usersTable.id, user.id));
          user = { ...user, ssoId, ssoProvider: "microsoft", role: domainRole ?? user.role };
        }
      }

      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
        expiresIn: "7d",
      });
      res.redirect(`/portal?sso_token=${token}`);
    }
  } catch (err) {
    console.error("[SSO] Error:", err);
    res.redirect(`${loginPath}?sso_error=server_error`);
  }
});

export default router;
