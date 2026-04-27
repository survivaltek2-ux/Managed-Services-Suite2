import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { loginCodesTable, partnersTable } from "@workspace/db/schema";
import { eq, and, gt, isNull, asc } from "drizzle-orm";
import { generateToken, requireAuth, requireAdmin, AuthRequest } from "../middlewares/auth.js";
import { generatePartnerToken } from "../middlewares/partnerAuth.js";
import { Response } from "express";
import { sendLoginCode, sendUserRegistrationNotification, sendPasswordResetEmail, sendAdminWelcomeEmail, sendAdminPasswordResetNotification, sendEmailVerification } from "../lib/email.js";
import { inviteGuestUser } from "../lib/microsoft-graph.js";

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

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) {
      res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
      return;
    }

    if (!user.emailVerifiedAt) {
      res.status(403).json({
        error: "email_not_verified",
        message: "Please verify your email address before signing in. Check your inbox for a verification link.",
      });
      return;
    }

    const token = generateToken(user.id, user.role);
    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
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
    await db.update(usersTable).set({ password: hashedPassword, mustChangePassword: false }).where(eq(usersTable.id, req.userId!));
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

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

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
    await db.update(usersTable).set({ password: hashedPassword, resetToken: null, resetTokenExpires: null })
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
      res.status(401).json({ message: "Invalid or expired code" });
      return;
    }

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
      const token = generatePartnerToken(partner.id, partner.isAdmin);
      res.json({
        token,
        partner: {
          id: partner.id,
          contactName: partner.contactName,
          companyName: partner.companyName,
          email: partner.email,
          phone: partner.phone ?? null,
          status: partner.status,
          isAdmin: partner.isAdmin,
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

    const token = generateToken(account.id, account.role);
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
    await db.update(usersTable).set({ password: hashedPassword, mustChangePassword: false }).where(eq(usersTable.id, req.userId!));
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
    }).returning();

    const loginUrl = `${getAppBaseUrl()}/admin`;
    const emailSent = await sendAdminWelcomeEmail(user.email, user.name, tempPassword, loginUrl).catch(err => {
      console.error("[Email] Admin welcome email error:", err);
      return false;
    });

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
    const targetId = parseInt(req.params.id, 10);
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
      .set({ password: hashedPassword, mustChangePassword: true })
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

export default router;
