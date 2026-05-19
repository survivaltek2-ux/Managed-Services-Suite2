import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { db, usersTable, connectorsTable } from "@workspace/db";
import { loginCodesTable, partnersTable } from "@workspace/db/schema";
import { eq, and, gt, isNull, asc } from "drizzle-orm";
import { generateToken, requireAuth, requireAdmin, AuthRequest } from "../middlewares/auth.js";
import { generatePartnerToken } from "../middlewares/partnerAuth.js";
import { revokeJti } from "../lib/session-utils.js";
import { decideAccess, persistAzureSnapshotForUser, persistAzureSnapshotForPartner } from "../lib/azure-ad-access.js";
import { recordOnboardingEvent } from "../lib/onboardingEvents.js";
import { Response } from "express";
import { sendLoginCode, sendUserRegistrationNotification, sendPasswordResetEmail, sendAdminWelcomeEmail, sendAdminPasswordResetNotification, sendEmailVerification } from "../lib/email.js";
import { inviteGuestUser } from "../lib/microsoft-graph.js";

const MIN_PASSWORD_LENGTH = 8;

// Per-account OTP verify lockout tracker.
// Keyed by "email:type"; tracks consecutive failures and locks accounts out
// after too many wrong guesses regardless of source IP.
interface VerifyAttemptRecord {
  count: number;
  lockedUntil?: Date;
}
const verifyAttemptMap = new Map<string, VerifyAttemptRecord>();
const MAX_VERIFY_FAILURES = 5;
const VERIFY_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getVerifyAttempts(email: string, type: string): VerifyAttemptRecord {
  return verifyAttemptMap.get(`${email}:${type}`) ?? { count: 0 };
}
function setVerifyAttempts(email: string, type: string, record: VerifyAttemptRecord): void {
  verifyAttemptMap.set(`${email}:${type}`, record);
}
function clearVerifyAttempts(email: string, type: string): void {
  verifyAttemptMap.delete(`${email}:${type}`);
}

// Per-account password-login lockout tracker.
// Blocks repeated password-spray attempts against a known email address,
// regardless of the source IP (defeats rotating proxies and botnets).
const loginAttemptMap = new Map<string, VerifyAttemptRecord>();
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getLoginAttempts(email: string): VerifyAttemptRecord {
  return loginAttemptMap.get(email) ?? { count: 0 };
}
function setLoginAttempts(email: string, record: VerifyAttemptRecord): void {
  loginAttemptMap.set(email, record);
}
function clearLoginAttempts(email: string): void {
  loginAttemptMap.delete(email);
}

function getAppBaseUrl(): string {
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || "";
  const m = redirectUri.match(/^(https?:\/\/[^/]+)/);
  return m ? m[1] : "https://siebertrservices.com";
}

const router: IRouter = Router();

router.post("/auth/register", async (req, res) => {
  try {
    const { name, email: rawEmail, password, company, phone } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!name || !email || !password || !company) {
      res.status(400).json({ error: "validation_error", message: "name, email, password, and company are required" });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: "validation_error", message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "conflict", message: "An account with this email already exists" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const [user] = await db.insert(usersTable).values({
      name,
      email,
      password: hashedPassword,
      company,
      phone: phone || null,
      emailVerificationToken,
      emailVerificationExpiresAt,
      // emailVerifiedAt intentionally left null until verified
    }).returning();

    // Send verification email — no JWT until email is proven
    const verifyUrl = `${getAppBaseUrl()}/portal?verify_email=${emailVerificationToken}`;
    sendEmailVerification(user.email, user.name, verifyUrl)
      .catch(err => console.error("[Email] Verification email error:", err));

    res.status(201).json({
      status: "pending_verification",
      message: "Account created. Please check your email to verify your address before signing in.",
    });

    // Background notifications (non-blocking)
    sendUserRegistrationNotification({
      name: user.name,
      email: user.email,
      company: user.company,
      password,
    }).catch(err => console.error("[Email] User registration notification error:", err));
    const portalUrl = `${getAppBaseUrl()}/portal`;
    inviteGuestUser(
      user.email,
      user.name,
      portalUrl,
      `Hi ${user.name}, you've been invited to access the Siebert Services client portal. Click the link below to accept your invitation and sign in with Microsoft.`
    ).then(result => {
      if (result) {
        db.update(usersTable)
          .set({ msObjectId: result.msObjectId })
          .where(eq(usersTable.id, user.id))
          .catch(err => console.error("[Graph] Failed to store ms_object_id:", err));
      }
    }).catch(err => console.error("[Graph] Guest invite error:", err));
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "server_error", message: "Registration failed" });
  }
});

router.get("/auth/verify-email", async (req, res) => {
  try {
    const token = req.query.token as string;
    if (!token || token.length !== 64) {
      res.status(400).json({ error: "invalid_token", message: "Invalid or missing verification token" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.emailVerificationToken, token))
      .limit(1);

    if (!user) {
      res.status(400).json({ error: "invalid_token", message: "Verification token not found or already used" });
      return;
    }

    if (user.emailVerifiedAt) {
      // Already verified — just return a token so the client can log in
      const authToken = generateToken(user.id, user.role);
      res.json({ token: authToken, message: "Email already verified" });
      return;
    }

    // Enforce 24-hour token expiry
    if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt < new Date()) {
      res.status(400).json({
        error: "token_expired",
        message: "This verification link has expired. Please register again or contact support.",
      });
      return;
    }

    await db
      .update(usersTable)
      .set({ emailVerifiedAt: new Date(), emailVerificationToken: null, emailVerificationExpiresAt: null })
      .where(eq(usersTable.id, user.id));

    const authToken = generateToken(user.id, user.role);
    res.json({
      token: authToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company: user.company,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Verify email error:", err);
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!email || !password) {
      res.status(400).json({ error: "validation_error", message: "email and password are required" });
      return;
    }

    // Per-account lockout: block spray attacks regardless of source IP.
    const loginAttempts = getLoginAttempts(email);
    if (loginAttempts.lockedUntil && loginAttempts.lockedUntil > new Date()) {
      const retryAfterSecs = Math.ceil((loginAttempts.lockedUntil.getTime() - Date.now()) / 1000);
      res.status(429).json({ error: "too_many_requests", message: `Too many failed login attempts. Try again in ${retryAfterSecs} seconds.` });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) {
      // Increment counter even for unknown accounts to prevent existence oracle via lockout differential.
      const newCount = loginAttempts.count + 1;
      setLoginAttempts(email, { count: newCount, lockedUntil: newCount >= MAX_LOGIN_FAILURES ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : loginAttempts.lockedUntil });
      res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const newCount = loginAttempts.count + 1;
      setLoginAttempts(email, { count: newCount, lockedUntil: newCount >= MAX_LOGIN_FAILURES ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : loginAttempts.lockedUntil });
      res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
      return;
    }

    // Successful auth — clear the failure counter.
    clearLoginAttempts(email);

    if (!user.emailVerifiedAt) {
      res.status(403).json({
        error: "email_not_verified",
        message: "Please verify your email address before signing in. Check your inbox for a verification link.",
      });
      return;
    }

    // Azure AD authorization (Task #187). disabled mode → no-op fast path.
    const accessDecision = await decideAccess({
      email,
      portal: "client",
      source: "password",
    });
    if (!accessDecision.allowed) {
      res.status(403).json({
        error: "not_authorized",
        message: accessDecision.friendlyMessage || "Your account isn't authorized to access this portal.",
        reason: accessDecision.reason,
      });
      return;
    }
    let resolvedRole = user.role;
    if (accessDecision.target?.portal === "client") {
      if (accessDecision.target.isAdmin) resolvedRole = "admin";
      else if (accessDecision.target.role === "client") resolvedRole = "client";
    }
    if (resolvedRole !== user.role) {
      await db.update(usersTable).set({ role: resolvedRole }).where(eq(usersTable.id, user.id));
    }
    await persistAzureSnapshotForUser(user.id, accessDecision);

    const token = generateToken(user.id, resolvedRole, { email });
    const wasFirstLogin = !user.lastLoginAt;
    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    // Record onboarding event on first ever login so the admin_account
    // timeline reflects the activation transition.
    if (wasFirstLogin) {
      recordOnboardingEvent({
        flow: "admin_account", entityId: user.id, eventType: "first_login",
        actorType: "admin", actorLabel: email,
        note: `${email} signed in for the first time`,
        payload: { mustChangePassword: user.mustChangePassword ?? false },
      }).catch(() => {});
    }
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company: user.company,
        phone: user.phone,
        role: user.role,
        mustChangePassword: user.mustChangePassword ?? false,
        createdAt: user.createdAt,
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "server_error", message: "Login failed" });
  }
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!user) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      company: user.company,
      phone: user.phone,
      role: user.role,
      mustChangePassword: user.mustChangePassword ?? false,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("Get me error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to get user" });
  }
});

router.put("/auth/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, company, phone } = req.body;
    const updates: any = {};
    if (name) updates.name = name;
    if (company) updates.company = company;
    if (phone !== undefined) updates.phone = phone || null;
    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!)).returning();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    res.json({
      id: user.id, name: user.name, email: user.email,
      company: user.company, phone: user.phone, role: user.role, createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update profile" });
  }
});

router.post("/auth/change-password", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "validation_error", message: "currentPassword and newPassword are required" });
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: "validation_error", message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!user) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      res.status(401).json({ error: "unauthorized", message: "Current password is incorrect" });
      return;
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const now = new Date();
    await db.update(usersTable).set({ password: hashedPassword, mustChangePassword: false, passwordChangedAt: now }).where(eq(usersTable.id, req.userId!));
    // Revoke the current session so any stolen copy of this token is invalidated.
    if (req.authJti) {
      await revokeJti(req.authJti, "password_change");
    }
    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to change password" });
  }
});

router.post("/auth/request-code", async (req, res) => {
  try {
    const { email: rawEmail, type } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!email || !type) {
      res.status(400).json({ message: "email and type are required" });
      return;
    }

    const table = type === "partner" ? partnersTable : usersTable;
    const [account] = await db.select().from(table as typeof usersTable).where(eq((table as typeof usersTable).email, email)).limit(1);
    if (!account) {
      res.json({ sent: true });
      return;
    }

    // crypto.randomInt is cryptographically secure (unlike Math.random)
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Invalidate any existing unused codes for this account and type before
    // issuing a new one. This ensures only one active code ever exists per
    // (email, type) pair, preventing code-accumulation attacks that would
    // shrink the effective 6-digit brute-force search space.
    await db
      .update(loginCodesTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(loginCodesTable.email, email),
          eq(loginCodesTable.type, type),
          isNull(loginCodesTable.usedAt),
        )
      );

    await db.insert(loginCodesTable).values({ email, code, type, expiresAt });
    const sent = await sendLoginCode(email, code, type as "user" | "partner");
    if (!sent) {
      res.status(503).json({ message: "Email could not be sent. The email service may not be configured yet. Please contact support or use password login." });
      return;
    }

    res.json({ sent: true });
  } catch (err) {
    console.error("request-code error:", err);
    res.status(500).json({ message: "Failed to send code" });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email: rawEmail } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: "validation_error", message: "email is required" });
      return;
    }
    // Respond immediately to prevent email enumeration
    res.json({ success: true, message: "If an account exists for this email, a reset link has been sent." });

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) return;

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await db.update(usersTable).set({ resetToken: token, resetTokenExpires: expires }).where(eq(usersTable.id, user.id));

    const resetUrl = `${getAppBaseUrl()}/reset-password?token=${token}`;
    sendPasswordResetEmail(user.email, user.name, resetUrl).catch(err =>
      console.error("[Email] Password reset email error:", err)
    );
  } catch (err) {
    console.error("Forgot password error:", err);
  }
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: "validation_error", message: "token and password are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "validation_error", message: "Password must be at least 8 characters" });
      return;
    }
    const now = new Date();
    const [user] = await db.select().from(usersTable)
      .where(and(eq(usersTable.resetToken, token), gt(usersTable.resetTokenExpires, now)))
      .limit(1);
    if (!user) {
      res.status(400).json({ error: "invalid_token", message: "Reset link is invalid or has expired. Please request a new one." });
      return;
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.update(usersTable).set({ password: hashedPassword, resetToken: null, resetTokenExpires: null, passwordChangedAt: new Date() })
      .where(eq(usersTable.id, user.id));
    res.json({ success: true, message: "Password reset successfully. You can now sign in." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to reset password" });
  }
});

router.post("/auth/verify-code", async (req, res) => {
  try {
    const { email: rawEmail, code, type } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!email || !code || !type) {
      res.status(400).json({ message: "email, code, and type are required" });
      return;
    }

    // Per-account lockout check (IP-independent).
    // Blocks distributed attackers who route requests through multiple IPs.
    const attempts = getVerifyAttempts(email, type);
    if (attempts.lockedUntil && attempts.lockedUntil > new Date()) {
      const retryAfterSecs = Math.ceil((attempts.lockedUntil.getTime() - Date.now()) / 1000);
      res.status(429).json({ message: `Too many failed attempts. Try again in ${retryAfterSecs} seconds.` });
      return;
    }

    const now = new Date();
    const [record] = await db
      .select()
      .from(loginCodesTable)
      .where(
        and(
          eq(loginCodesTable.email, email),
          eq(loginCodesTable.code, code),
          eq(loginCodesTable.type, type),
          gt(loginCodesTable.expiresAt, now),
          isNull(loginCodesTable.usedAt),
        )
      )
      .limit(1);

    if (!record) {
      // Increment failure counter; lock account after too many wrong guesses.
      const newCount = attempts.count + 1;
      const lockedUntil = newCount >= MAX_VERIFY_FAILURES
        ? new Date(Date.now() + VERIFY_LOCKOUT_MS)
        : attempts.lockedUntil;
      setVerifyAttempts(email, type, { count: newCount, lockedUntil });
      res.status(401).json({ message: "Invalid or expired code" });
      return;
    }

    // Successful match — clear the failure counter and consume the code.
    clearVerifyAttempts(email, type);
    await db.update(loginCodesTable).set({ usedAt: now }).where(eq(loginCodesTable.id, record.id));

    if (type === "partner") {
      const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.email, email)).limit(1);
      if (!partner) {
        res.status(401).json({ message: "Account not found" });
        return;
      }
      if (partner.status === "pending") {
        res.status(403).json({ error: "pending_approval", message: "Your account is pending approval.", companyName: partner.companyName, email: partner.email });
        return;
      }
      if (partner.status === "rejected") {
        res.status(403).json({ error: "account_rejected", message: "Your partner account application was not approved. Please contact us for more information." });
        return;
      }
      if (partner.status === "suspended") {
        res.status(403).json({ error: "account_suspended", message: "Your account has been suspended. Please contact support." });
        return;
      }
      // Azure AD authorization (Task #187) — partner branch.
      const partnerDecision = await decideAccess({ email, portal: "partner", source: "magic_code" });
      if (!partnerDecision.allowed) {
        res.status(403).json({
          error: "not_authorized",
          message: partnerDecision.friendlyMessage || "Your account isn't authorized to access this portal.",
          reason: partnerDecision.reason,
        });
        return;
      }
      let isAdmin = partner.isAdmin;
      if (partnerDecision.target?.portal === "partner" && typeof partnerDecision.target.isAdmin === "boolean") {
        isAdmin = partnerDecision.target.isAdmin;
      }
      await persistAzureSnapshotForPartner(partner.id, partnerDecision);
      const token = generatePartnerToken(partner.id, isAdmin, { email });
      res.json({
        token,
        partner: {
          id: partner.id,
          contactName: partner.contactName,
          companyName: partner.companyName,
          email: partner.email,
          phone: partner.phone ?? null,
          status: partner.status,
          isAdmin,
          createdAt: partner.createdAt,
        },
      });
      return;
    }

    const [account] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!account) {
      res.status(401).json({ message: "Account not found" });
      return;
    }

    // Azure AD authorization (Task #187) — client branch.
    const clientDecision = await decideAccess({ email, portal: "client", source: "magic_code" });
    if (!clientDecision.allowed) {
      res.status(403).json({
        error: "not_authorized",
        message: clientDecision.friendlyMessage || "Your account isn't authorized to access this portal.",
        reason: clientDecision.reason,
      });
      return;
    }
    let resolvedRole = account.role;
    if (clientDecision.target?.portal === "client") {
      if (clientDecision.target.isAdmin) resolvedRole = "admin";
      else if (clientDecision.target.role === "client") resolvedRole = "client";
    }
    if (resolvedRole !== account.role) {
      await db.update(usersTable).set({ role: resolvedRole }).where(eq(usersTable.id, account.id));
    }
    await persistAzureSnapshotForUser(account.id, clientDecision);

    const token = generateToken(account.id, resolvedRole, { email });
    res.json({
      token,
      user: {
        id: account.id,
        name: account.name,
        email: account.email,
        company: account.company,
        phone: account.phone ?? null,
        role: account.role,
        createdAt: account.createdAt,
      },
    });
  } catch (err) {
    console.error("verify-code error:", err);
    res.status(500).json({ message: "Failed to verify code" });
  }
});

router.post("/auth/set-password", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) {
      res.status(400).json({ error: "validation_error", message: "newPassword is required" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "validation_error", message: "Password must be at least 8 characters" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!user) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    if (!user.mustChangePassword) {
      res.status(403).json({ error: "forbidden", message: "Password change not required for this account" });
      return;
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.update(usersTable).set({ password: hashedPassword, mustChangePassword: false, passwordChangedAt: new Date() }).where(eq(usersTable.id, req.userId!));
    if (req.authJti) {
      await revokeJti(req.authJti, "password_set");
    }
    res.json({ success: true, message: "Password set successfully" });
  } catch (err) {
    console.error("Set password error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to set password" });
  }
});

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return `Tmp@${password}`;
}

router.get("/admin/users", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const admins = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        mustChangePassword: usersTable.mustChangePassword,
        lastLoginAt: usersTable.lastLoginAt,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .orderBy(asc(usersTable.createdAt));
    res.json(admins);
  } catch (err) {
    console.error("List admin users error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to list admin users" });
  }
});

router.post("/admin/users", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email: rawEmail } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!name || !email) {
      res.status(400).json({ error: "validation_error", message: "name and email are required" });
      return;
    }

    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "conflict", message: "An account with this email already exists" });
      return;
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const [user] = await db.insert(usersTable).values({
      name,
      email,
      password: hashedPassword,
      company: "Siebert Services",
      role: "admin" as const,
      mustChangePassword: true,
      emailVerifiedAt: new Date(), // Admin-created accounts are trusted
      invitationSentAt: new Date(),
    }).returning();

    const loginUrl = `${getAppBaseUrl()}/admin`;
    const emailSent = await sendAdminWelcomeEmail(user.email, user.name, tempPassword, loginUrl).catch(err => {
      console.error("[Email] Admin welcome email error:", err);
      return false;
    });
    if (emailSent) {
      await db.update(usersTable).set({ lastWelcomeSentAt: new Date() }).where(eq(usersTable.id, user.id));
    }
    recordOnboardingEvent({
      flow: "admin_account", entityId: user.id, eventType: "account_created",
      actorType: "admin", actorId: req.userId ?? null, actorLabel: req.authEmail ?? null,
      note: `Admin account created for ${user.email}`,
      payload: { emailSent },
    }).catch(() => {});

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mustChangePassword: user.mustChangePassword,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
      tempPassword,
      emailSent,
    });
  } catch (err) {
    console.error("Create admin user error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create admin user" });
  }
});

router.post("/admin/users/:id/reset-password", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: "validation_error", message: "Invalid user id" });
      return;
    }

    const [target] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!target) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    if (target.role !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Can only reset passwords for admin accounts" });
      return;
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    await db.update(usersTable)
      .set({ password: hashedPassword, mustChangePassword: true, passwordChangedAt: new Date() })
      .where(eq(usersTable.id, targetId));

    const loginUrl = `${getAppBaseUrl()}/admin`;
    const emailSent = await sendAdminPasswordResetNotification(target.email, target.name, tempPassword, loginUrl).catch(err => {
      console.error("[Email] Admin password reset notification error:", err);
      return false;
    });

    res.json({ tempPassword, emailSent });
  } catch (err) {
    console.error("Reset admin password error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to reset password" });
  }
});

router.get("/admin/microsoft/test", requireAdmin, async (_req: AuthRequest, res: Response) => {
  const tenantId = process.env.MICROSOFT_TENANT_ID || "";
  const clientId = process.env.MICROSOFT_CLIENT_ID || "";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";

  if (!tenantId || !clientId || !clientSecret) {
    res.json({ ok: false, error: "missing_credentials", message: "One or more Microsoft credentials are not set (MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)." });
    return;
  }
  if (tenantId === "common") {
    res.json({ ok: false, error: "invalid_tenant", message: "MICROSOFT_TENANT_ID must be a specific tenant ID, not 'common'." });
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    });
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      res.json({ ok: false, error: "token_failed", message: err });
      return;
    }
    const { access_token, expires_in } = await tokenRes.json() as { access_token: string; expires_in: number };

    const inviteCheckRes = await fetch("https://graph.microsoft.com/v1.0/users?$filter=userType eq 'Guest'&$top=1&$select=id,displayName,mail", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!inviteCheckRes.ok) {
      const err = await inviteCheckRes.json() as { error?: { code?: string; message?: string } };
      const code = err?.error?.code || "unknown";
      const missing = code === "Authorization_RequestDenied"
        ? "Token acquired but User.Read.All or User.Invite.All permission may not be granted. Visit Azure AD app registrations and grant admin consent."
        : err?.error?.message || "Unknown Graph error";
      res.json({ ok: false, tokenAcquired: true, error: code, message: missing });
      return;
    }

    const data = await inviteCheckRes.json() as { value: { id: string; displayName: string; mail: string }[] };
    res.json({ ok: true, tokenAcquired: true, tokenExpiresIn: expires_in, guestCount: data.value.length, message: "Microsoft Graph credentials are working correctly. Guest invitations are enabled." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: "exception", message: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Unified login: searches users, partners, and connectors tables in parallel
// and returns a token for each portal the user has access to.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/unified-login", async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!email || !password) {
      res.status(400).json({ error: "validation_error", message: "email and password are required" });
      return;
    }

    // Per-account lockout check (reuses the same map as /auth/login)
    const loginAttempts = getLoginAttempts(email);
    if (loginAttempts.lockedUntil && loginAttempts.lockedUntil > new Date()) {
      const retryAfterSecs = Math.ceil((loginAttempts.lockedUntil.getTime() - Date.now()) / 1000);
      res.status(429).json({ error: "too_many_requests", message: `Too many failed login attempts. Try again in ${retryAfterSecs} seconds.` });
      return;
    }

    // Look up all three tables in parallel
    const [userRows, partnerRows, connectorRows] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1),
      db.select().from(partnersTable).where(eq(partnersTable.email, email)).limit(1),
      db.select().from(connectorsTable).where(eq(connectorsTable.email, email)).limit(1),
    ]);

    const user = userRows[0];
    const partner = partnerRows[0];
    const connector = connectorRows[0];

    let anySuccess = false;
    const JWT_SECRET = process.env.JWT_SECRET!;

    const result: {
      userToken?: string;
      partnerToken?: string;
      connectorToken?: string;
      primaryRedirect: string;
    } = {
      // "/portal" is intentional — it is the client portal route in siebert-services.
      // The UnifiedLogin page uses this as a fallback when no explicit redirect param
      // is provided and will override it with "/partners/" or "/referrals/" if the
      // user only has partner/connector access.
      primaryRedirect: "/portal",
    };

    // ── Users table (client/admin) ───────────────────────────────────────────
    if (user && user.emailVerifiedAt) {
      const valid = await bcrypt.compare(password, user.password);
      if (valid) {
        const accessDecision = await decideAccess({ email, portal: "client", source: "password" });
        if (accessDecision.allowed) {
          let resolvedRole = user.role;
          if (accessDecision.target?.portal === "client") {
            if (accessDecision.target.isAdmin) resolvedRole = "admin";
            else if (accessDecision.target.role === "client") resolvedRole = "client";
          }
          await persistAzureSnapshotForUser(user.id, accessDecision);
          result.userToken = generateToken(user.id, resolvedRole, { email });
          await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
          anySuccess = true;
          result.primaryRedirect = "/portal";
        }
      }
    }

    // ── Partners table ───────────────────────────────────────────────────────
    if (partner && partner.status === "approved" && partner.password) {
      // Partner-specific lockout (mirroring /partner/auth/login behavior)
      const partnerLockKey = `partner:${email}`;
      const partnerAttempts = getLoginAttempts(partnerLockKey);
      if (partnerAttempts.lockedUntil && partnerAttempts.lockedUntil > new Date()) {
        // Partner is locked — skip partner auth (user/connector auth may still proceed)
      } else if ((partner as Record<string, unknown>).accountLockedAt) {
        // Account locked by admin — skip partner auth
      } else {
        const valid = await bcrypt.compare(password, partner.password);
        if (valid) {
          const accessDecision = await decideAccess({ email, portal: "partner", source: "password" });
          if (accessDecision.allowed) {
            let isAdmin = partner.isAdmin;
            if (accessDecision.target?.portal === "partner" && typeof accessDecision.target.isAdmin === "boolean") {
              isAdmin = accessDecision.target.isAdmin;
            }
            await persistAzureSnapshotForPartner(partner.id, accessDecision);
            result.partnerToken = generatePartnerToken(partner.id, isAdmin, { email });
            anySuccess = true;
            clearLoginAttempts(partnerLockKey);
            if (!result.userToken) result.primaryRedirect = "/partners/";
          }
        } else {
          // Wrong password — increment partner-specific lockout counter
          const newCount = partnerAttempts.count + 1;
          setLoginAttempts(partnerLockKey, {
            count: newCount,
            lockedUntil: newCount >= MAX_LOGIN_FAILURES ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : partnerAttempts.lockedUntil,
          });
        }
      }
    }

    // ── Connectors table ─────────────────────────────────────────────────────
    if (connector && connector.status !== "rejected" && connector.status !== "suspended") {
      const valid = await bcrypt.compare(password, connector.password);
      if (valid) {
        result.connectorToken = jwt.sign({ connectorId: connector.id, email }, JWT_SECRET, { expiresIn: "30d" });
        anySuccess = true;
        if (!result.userToken && !result.partnerToken) result.primaryRedirect = "/referrals/";
      }
    }

    if (!anySuccess) {
      const newCount = loginAttempts.count + 1;
      setLoginAttempts(email, {
        count: newCount,
        lockedUntil: newCount >= MAX_LOGIN_FAILURES ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : loginAttempts.lockedUntil,
      });
      res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
      return;
    }

    clearLoginAttempts(email);
    res.json(result);
  } catch (err) {
    console.error("Unified login error:", err);
    res.status(500).json({ error: "server_error", message: "Login failed" });
  }
});

export default router;
