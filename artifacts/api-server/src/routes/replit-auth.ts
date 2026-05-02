// @ts-nocheck
import * as oidc from "openid-client";
import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, partnersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { decideAccess, persistAzureSnapshotForUser, persistAzureSnapshotForPartner } from "../lib/azure-ad-access.js";

const router = Router();

const ISSUER_URL = "https://replit.com/oidc";
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required but not set. Refusing to start with an insecure configuration.");
}
const OIDC_COOKIE_TTL = 10 * 60 * 1000;

let oidcConfig: oidc.Configuration | null = null;

async function getOidcConfig(): Promise<oidc.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await oidc.discovery(new URL(ISSUER_URL), process.env.REPL_ID!);
  }
  return oidcConfig;
}

function getOrigin(req: any): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setOidcCookie(res: any, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

router.get("/auth/replit", async (req, res) => {
  try {
    const config = await getOidcConfig();
    const type = req.query.type === "partner" ? "partner" : "client";
    const callbackUrl = `${getOrigin(req)}/api/auth/replit/callback`;

    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

    const redirectUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl,
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    setOidcCookie(res, "oidc_code_verifier", codeVerifier);
    setOidcCookie(res, "oidc_nonce", nonce);
    setOidcCookie(res, "oidc_state", state);
    setOidcCookie(res, "oidc_portal_type", type);

    res.redirect(redirectUrl.href);
  } catch (err) {
    console.error("[Replit Auth] initiate error:", err);
    res.redirect("/portal?sso_error=server_error");
  }
});

router.get("/auth/replit/callback", async (req, res) => {
  const codeVerifier = req.cookies?.oidc_code_verifier;
  const nonce = req.cookies?.oidc_nonce;
  const expectedState = req.cookies?.oidc_state;
  const portalType: "partner" | "client" = req.cookies?.oidc_portal_type === "partner" ? "partner" : "client";
  const loginPath = portalType === "partner" ? "/partners/login" : "/portal";

  const clearOidcCookies = () => {
    ["oidc_code_verifier", "oidc_nonce", "oidc_state", "oidc_portal_type"].forEach(name =>
      res.clearCookie(name, { path: "/" })
    );
  };

  if (!codeVerifier || !expectedState) {
    clearOidcCookies();
    res.redirect(`${loginPath}?sso_error=access_denied`);
    return;
  }

  const { error } = req.query;
  if (error) {
    clearOidcCookies();
    res.redirect(`${loginPath}?sso_error=access_denied`);
    return;
  }

  try {
    const config = await getOidcConfig();
    const callbackUrl = `${getOrigin(req)}/api/auth/replit/callback`;

    const currentUrl = new URL(
      `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`
    );

    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
    });

    const claims = tokens.claims();
    if (!claims) {
      clearOidcCookies();
      res.redirect(`${loginPath}?sso_error=token_failed`);
      return;
    }

    const replitUserId = claims.sub as string;
    const email = (claims.email as string || "").toLowerCase().trim();
    const name = (claims.name as string) || (claims.preferred_username as string) || email;

    clearOidcCookies();

    if (portalType === "partner") {
      const [partner] = await db
        .select()
        .from(partnersTable)
        .where(
          email
            ? or(eq(partnersTable.replitUserId, replitUserId), eq(partnersTable.email, email))
            : eq(partnersTable.replitUserId, replitUserId)
        )
        .limit(1);

      if (!partner) {
        res.redirect(`/partners/login?sso_error=no_account`);
        return;
      }

      if (!partner.replitUserId) {
        await db
          .update(partnersTable)
          .set({ replitUserId })
          .where(eq(partnersTable.id, partner.id));
      }

      // Azure AD authorization (Task #187) — partner branch.
      let isAdmin = partner.isAdmin;
      if (email) {
        const decision = await decideAccess({ email, portal: "partner", source: "sso_replit" });
        if (!decision.allowed) {
          res.redirect(`/partners/login?sso_error=not_authorized`);
          return;
        }
        if (decision.target?.portal === "partner" && typeof decision.target.isAdmin === "boolean") {
          isAdmin = decision.target.isAdmin;
        }
        if (isAdmin !== partner.isAdmin) {
          await db
            .update(partnersTable)
            .set({ isAdmin })
            .where(eq(partnersTable.id, partner.id));
        }
        await persistAzureSnapshotForPartner(partner.id, decision);
      }
      const now = Math.floor(Date.now() / 1000);
      const jti = crypto.randomBytes(16).toString("hex");
      const token = jwt.sign(
        { partnerId: partner.id, isAdmin, jti, auth_time: now, email: email || undefined },
        JWT_SECRET,
        { expiresIn: "7d" },
      );
      res.redirect(`/partners/login?sso_token=${token}`);
    } else {
      let [user] = await db
        .select()
        .from(usersTable)
        .where(
          email
            ? or(eq(usersTable.replitUserId, replitUserId), eq(usersTable.email, email))
            : eq(usersTable.replitUserId, replitUserId)
        )
        .limit(1);

      if (!user) {
        const randomPw = await bcrypt.hash(replitUserId + crypto.randomUUID(), 10);
        const [newUser] = await db
          .insert(usersTable)
          .values({
            name: name || "User",
            email: email || `${replitUserId}@replit.user`,
            password: randomPw,
            company: "Siebert Services Client",
            replitUserId,
          })
          .returning();
        user = newUser;
      } else if (!user.replitUserId) {
        await db
          .update(usersTable)
          .set({ replitUserId })
          .where(eq(usersTable.id, user.id));
      }

      // Azure AD authorization (Task #187) — client branch.
      let resolvedRole = user.role;
      if (email) {
        const decision = await decideAccess({ email, portal: "client", source: "sso_replit" });
        if (!decision.allowed) {
          res.redirect(`/portal?sso_error=not_authorized`);
          return;
        }
        if (decision.target?.portal === "client") {
          if (decision.target.isAdmin) resolvedRole = "admin";
          else if (decision.target.role === "client") resolvedRole = "client";
        }
        if (resolvedRole !== user.role) {
          await db
            .update(usersTable)
            .set({ role: resolvedRole })
            .where(eq(usersTable.id, user.id));
        }
        await persistAzureSnapshotForUser(user.id, decision);
      }
      const now = Math.floor(Date.now() / 1000);
      const jti = crypto.randomBytes(16).toString("hex");
      const token = jwt.sign(
        { userId: user.id, role: resolvedRole, jti, auth_time: now, email: email || undefined },
        JWT_SECRET,
        { expiresIn: "7d" },
      );
      res.redirect(`/portal?sso_token=${token}`);
    }
  } catch (err) {
    console.error("[Replit Auth] callback error:", err);
    clearOidcCookies();
    res.redirect(`${loginPath}?sso_error=server_error`);
  }
});

export default router;
