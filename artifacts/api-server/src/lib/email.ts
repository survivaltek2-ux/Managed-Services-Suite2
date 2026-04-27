import nodemailer from "nodemailer";
import { db, siteSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const EMAIL_KEYS = [
  "smtp_from_email", "smtp_from_name", "notification_email",
  "receipt_email_enabled", "receipt_email_intro",
];

interface EmailConfig {
  fromEmail: string;
  fromName: string;
  notificationEmail: string;
  receiptEmailEnabled: boolean;
  receiptEmailIntro: string;
}

let _configCache: EmailConfig | null = null;
let _configCacheAt = 0;
const CONFIG_TTL_MS = 30_000;

async function loadEmailConfig(): Promise<EmailConfig> {
  const now = Date.now();
  if (_configCache && now - _configCacheAt < CONFIG_TTL_MS) return _configCache;

  const envDefaults: EmailConfig = {
    fromEmail: process.env.SMTP_FROM_EMAIL || "notifications@siebertrservices.com",
    fromName: process.env.SMTP_FROM_NAME || "Siebert Services",
    notificationEmail: process.env.NOTIFICATION_EMAIL || "sales@siebertrservices.com",
    receiptEmailEnabled: true,
    receiptEmailIntro: "",
  };

  try {
    const rows = await db.select().from(siteSettingsTable).where(inArray(siteSettingsTable.key, EMAIL_KEYS));
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    _configCache = {
      fromEmail: map["smtp_from_email"] || envDefaults.fromEmail,
      fromName: map["smtp_from_name"] || envDefaults.fromName,
      notificationEmail: map["notification_email"] || envDefaults.notificationEmail,
      receiptEmailEnabled: map["receipt_email_enabled"] !== "false",
      receiptEmailIntro: map["receipt_email_intro"] || "",
    };
  } catch {
    _configCache = envDefaults;
  }

  _configCacheAt = now;
  return _configCache!;
}

export function invalidateSmtpCache() {
  _configCache = null;
  _configCacheAt = 0;
}

const SMTP_HOST = process.env.SMTP_HOST || "smtp-relay.brevo.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);

function buildSmtpTransport(user: string, pass: string) {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT !== 465,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2" },
  });
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

function providerName(): string {
  if (/brevo|sendinblue/i.test(SMTP_HOST)) return "brevo";
  if (/office365|outlook/i.test(SMTP_HOST)) return "microsoft365";
  if (/sendgrid/i.test(SMTP_HOST)) return "sendgrid";
  if (/postmark/i.test(SMTP_HOST)) return "postmark";
  if (/amazonaws/i.test(SMTP_HOST)) return "ses";
  if (/mailgun/i.test(SMTP_HOST)) return "mailgun";
  return "smtp";
}

async function sendEmail(to: string, subject: string, html: string, attachments?: EmailAttachment[]): Promise<boolean> {
  const cfg = await loadEmailConfig();
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  console.log(`[Email] Starting email send to ${to} via ${SMTP_HOST}:${SMTP_PORT} (${providerName()})`);

  if (!smtpUser || !smtpPass) {
    console.error(`[Email] SMTP credentials not configured (SMTP_USER / SMTP_PASS)`);
    return false;
  }

  try {
    const transport = buildSmtpTransport(smtpUser, smtpPass);

    // Use the configured From address (must be a verified sender at the SMTP
    // provider — for Brevo, complete sender / domain authentication first).
    // Microsoft 365 / Exchange Online require From == authenticated mailbox
    // (or explicit SendAs). When using an M365 endpoint, force the address to
    // the SMTP user to avoid 5.7.x rejections.
    const provider = providerName();
    const fromAddress = provider === "microsoft365" ? smtpUser : cfg.fromEmail;
    const fromDisplay = cfg.fromName ? `"${cfg.fromName}" <${fromAddress}>` : fromAddress;
    console.log(`[Email] Sending from: ${fromDisplay}`);

    await transport.sendMail({
      from: fromDisplay,
      to,
      subject,
      html,
      attachments: attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType || "application/pdf",
      })),
    });

    console.log(`[Email] ✓ Sent to ${to}: "${subject}"`);
    return true;
  } catch (err: any) {
    console.error(`[Email] ✗ Failed to send to ${to}:`, err?.message || err);
    return false;
  }
}

export async function testSmtpConnection(): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const provider = providerName();

  if (!smtpUser || !smtpPass) {
    return { ok: false, provider, error: "SMTP credentials not configured (SMTP_USER / SMTP_PASS)" };
  }

  try {
    const transport = buildSmtpTransport(smtpUser, smtpPass);
    await transport.verify();
    return { ok: true, provider };
  } catch (err: any) {
    return { ok: false, provider, error: err?.message || "Connection failed" };
  }
}

export async function getSmtpSettings(): Promise<{
  host: string;
  port: number;
  user: string;
  passSet: boolean;
  fromEmail: string;
  fromName: string;
  notificationEmail: string;
  activeProvider: string;
}> {
  const cfg = await loadEmailConfig();
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const activeProvider = smtpUser && smtpPass ? providerName() : "none";

  return {
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: smtpUser || cfg.fromEmail,
    passSet: !!smtpPass,
    fromEmail: cfg.fromEmail,
    fromName: cfg.fromName,
    notificationEmail: cfg.notificationEmail,
    activeProvider,
  };
}

export async function sendAdminWelcomeEmail(
  to: string,
  name: string,
  tempPassword: string,
  loginUrl: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Welcome to Siebert Services Admin</h1>
      </div>
      <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 32px 24px; border-radius: 0 0 4px 4px;">
        <p style="color: #374151; font-size: 16px; margin: 0 0 12px;">Hi ${esc(name)},</p>
        <p style="color: #374151; font-size: 15px; margin: 0 0 24px;">
          An admin account has been created for you on the Siebert Services portal.
          Use the temporary password below to sign in. You will be prompted to set a new password on your first login.
        </p>
        <div style="background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px;">
          <p style="color: #6b7280; font-size: 13px; margin: 0 0 4px;">Your temporary password</p>
          <p style="color: #111827; font-size: 20px; font-family: 'Courier New', monospace; font-weight: 700; letter-spacing: 1px; margin: 0;">${esc(tempPassword)}</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${loginUrl}"
             style="background: #0176d3; color: #fff; padding: 14px 32px; border-radius: 8px;
                    text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
            Sign In Now
          </a>
        </div>
        <p style="color: #6b7280; font-size: 13px; margin: 24px 0 8px;">
          For security, please do not share this email. This temporary password will remain active until you change it.
        </p>
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          Or copy this link into your browser:<br>
          <a href="${loginUrl}" style="color: #0176d3; word-break: break-all;">${loginUrl}</a>
        </p>
      </div>
    </div>`;
  return sendEmail(to, "Your Siebert Services admin account is ready", html);
}

export async function sendAdminPasswordResetNotification(
  to: string,
  name: string,
  tempPassword: string,
  loginUrl: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Your Admin Password Has Been Reset</h1>
      </div>
      <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 32px 24px; border-radius: 0 0 4px 4px;">
        <p style="color: #374151; font-size: 16px; margin: 0 0 12px;">Hi ${esc(name)},</p>
        <p style="color: #374151; font-size: 15px; margin: 0 0 24px;">
          An administrator has reset your Siebert Services admin password.
          Use the temporary password below to sign in. You will be prompted to set a new password immediately.
        </p>
        <div style="background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px;">
          <p style="color: #6b7280; font-size: 13px; margin: 0 0 4px;">Your temporary password</p>
          <p style="color: #111827; font-size: 20px; font-family: 'Courier New', monospace; font-weight: 700; letter-spacing: 1px; margin: 0;">${esc(tempPassword)}</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${loginUrl}"
             style="background: #0176d3; color: #fff; padding: 14px 32px; border-radius: 8px;
                    text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
            Sign In &amp; Set New Password
          </a>
        </div>
        <p style="color: #6b7280; font-size: 13px; margin: 24px 0 8px;">
          If you did not expect this reset, please contact your system administrator immediately.
        </p>
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          Or copy this link into your browser:<br>
          <a href="${loginUrl}" style="color: #0176d3; word-break: break-all;">${loginUrl}</a>
        </p>
      </div>
    </div>`;
  return sendEmail(to, "Your Siebert Services admin password has been reset", html);
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<boolean> {
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Reset Your Password</h1>
      </div>
      <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 32px 24px; border-radius: 0 0 4px 4px;">
        <p style="color: #374151; font-size: 16px; margin: 0 0 12px;">Hi ${esc(name)},</p>
        <p style="color: #374151; font-size: 15px; margin: 0 0 24px;">
          We received a request to reset your Siebert Services password.
          Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}"
             style="background: #0176d3; color: #fff; padding: 14px 32px; border-radius: 8px;
                    text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
            Reset My Password
          </a>
        </div>
        <p style="color: #6b7280; font-size: 13px; margin: 24px 0 8px;">
          If you didn't request a password reset you can safely ignore this email — your password will not change.
        </p>
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          Or copy this link into your browser:<br>
          <a href="${resetUrl}" style="color: #0176d3; word-break: break-all;">${resetUrl}</a>
        </p>
      </div>
    </div>`;
  return sendEmail(to, "Reset your Siebert Services password", html);
}

export async function sendDealSubmittedNotification(deal: {
  title: string;
  customerName: string;
  customerEmail?: string | null;
  estimatedValue?: string | null;
  stage: string;
  products: string;
}, partner: {
  companyName: string;
  contactName: string;
  email: string;
}) {
  const cfg = await loadEmailConfig();
  const products = (() => {
    try { return JSON.parse(deal.products).join(", "); } catch { return deal.products; }
  })();
  const value = deal.estimatedValue
    ? parseFloat(deal.estimatedValue).toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "Not specified";

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Deal Registration</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Deal Title</td><td style="padding: 8px 0; font-weight: 600;">${esc(deal.title)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Customer</td><td style="padding: 8px 0;">${esc(deal.customerName)}${deal.customerEmail ? ` (${esc(deal.customerEmail)})` : ""}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Products</td><td style="padding: 8px 0;">${esc(products)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Estimated Value</td><td style="padding: 8px 0; font-weight: 600; color: #2e844a;">${esc(value)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Stage</td><td style="padding: 8px 0;">${esc(deal.stage)}</td></tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" />
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Partner Company</td><td style="padding: 8px 0;">${esc(partner.companyName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Contact</td><td style="padding: 8px 0;">${esc(partner.contactName)} (${esc(partner.email)})</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services Partner Portal.</p>
      </div>
    </div>
  `;

  const partnerHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Deal Registration Confirmed</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Your deal registration has been successfully submitted. Here are the details:</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Deal Title</td><td style="padding: 10px 12px; font-weight: 600;">${esc(deal.title)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Customer</td><td style="padding: 10px 12px;">${esc(deal.customerName)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Products</td><td style="padding: 10px 12px;">${esc(products)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Estimated Value</td><td style="padding: 10px 12px; color: #2e844a; font-weight: 600;">${esc(value)}</td></tr>
        </table>
        <p style="font-size: 14px; margin: 16px 0 0;">Our team will review your deal registration and follow up shortly. You can track the status of this deal in the Partner Portal.</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Partner Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Deal Registration: ${esc(deal.title)} — ${esc(partner.companyName)}`, adminHtml),
    sendEmail(partner.email, `Deal Registration Confirmed: ${esc(deal.title)}`, partnerHtml),
  ]);
}

export async function sendLeadSubmittedNotification(lead: {
  companyName: string;
  contactName: string;
  email?: string | null;
  phone?: string | null;
  interest: string;
}, partner: {
  companyName: string;
  contactName: string;
  email: string;
}) {
  const cfg = await loadEmailConfig();

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Lead Submitted</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Company</td><td style="padding: 8px 0; font-weight: 600;">${esc(lead.companyName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Contact</td><td style="padding: 8px 0;">${esc(lead.contactName)}</td></tr>
          ${lead.email ? `<tr><td style="padding: 8px 0; color: #706e6b;">Email</td><td style="padding: 8px 0;"><a href="mailto:${esc(lead.email)}" style="color: #0176d3;">${esc(lead.email)}</a></td></tr>` : ""}
          ${lead.phone ? `<tr><td style="padding: 8px 0; color: #706e6b;">Phone</td><td style="padding: 8px 0;"><a href="tel:${esc(lead.phone)}" style="color: #0176d3;">${esc(lead.phone)}</a></td></tr>` : ""}
          <tr><td style="padding: 8px 0; color: #706e6b;">Interest</td><td style="padding: 8px 0;">${esc(lead.interest)}</td></tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" />
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Partner Company</td><td style="padding: 8px 0;">${esc(partner.companyName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Contact</td><td style="padding: 8px 0;">${esc(partner.contactName)} (${esc(partner.email)})</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services Partner Portal.</p>
      </div>
    </div>
  `;

  await sendEmail(cfg.notificationEmail, `New Lead Submitted: ${esc(lead.companyName)} — ${esc(partner.companyName)}`, adminHtml);
}

export async function sendTicketSubmittedNotification(ticket: {
  subject: string;
  description: string;
  priority: string;
  category: string;
}, partner: {
  companyName: string;
  contactName: string;
  email: string;
}) {
  const cfg = await loadEmailConfig();
  const priorityColors: Record<string, string> = {
    urgent: "#ea001e", high: "#fe9339", medium: "#0176d3", low: "#706e6b",
  };
  const pColor = priorityColors[ticket.priority] || "#706e6b";

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Support Ticket</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Subject</td><td style="padding: 8px 0; font-weight: 600;">${esc(ticket.subject)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Priority</td><td style="padding: 8px 0;"><span style="color: ${pColor}; font-weight: 600; text-transform: uppercase;">${esc(ticket.priority)}</span></td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Category</td><td style="padding: 8px 0; text-transform: capitalize;">${esc(ticket.category)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Description</td><td style="padding: 8px 0;">${esc(ticket.description)}</td></tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" />
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Partner Company</td><td style="padding: 8px 0;">${esc(partner.companyName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Contact</td><td style="padding: 8px 0;">${esc(partner.contactName)} (${esc(partner.email)})</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services Partner Portal.</p>
      </div>
    </div>
  `;

  const partnerHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Support Ticket Received</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">We've received your support ticket and our team will review it shortly.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Subject</td><td style="padding: 10px 12px; font-weight: 600;">${esc(ticket.subject)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Priority</td><td style="padding: 10px 12px;"><span style="color: ${pColor}; font-weight: 600; text-transform: uppercase;">${esc(ticket.priority)}</span></td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Category</td><td style="padding: 10px 12px; text-transform: capitalize;">${esc(ticket.category)}</td></tr>
        </table>
        <p style="font-size: 14px; margin: 16px 0 0;">You can track the status and add updates to your ticket in the Partner Portal under Support.</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Support Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Support Ticket: ${esc(ticket.subject)} — ${esc(partner.companyName)}`, adminHtml),
    sendEmail(partner.email, `Support Ticket Received: ${ticket.subject}`, partnerHtml),
  ]);
}

export async function sendContactFormNotification(contact: {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  service?: string | null;
  message: string;
}) {
  const cfg = await loadEmailConfig();
  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Contact Form Submission</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${esc(contact.name)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Email</td><td style="padding: 8px 0;">${esc(contact.email)}</td></tr>
          ${contact.phone ? `<tr><td style="padding: 8px 0; color: #706e6b;">Phone</td><td style="padding: 8px 0;">${esc(contact.phone)}</td></tr>` : ""}
          ${contact.company ? `<tr><td style="padding: 8px 0; color: #706e6b;">Company</td><td style="padding: 8px 0;">${esc(contact.company)}</td></tr>` : ""}
          ${contact.service ? `<tr><td style="padding: 8px 0; color: #706e6b;">Service Interest</td><td style="padding: 8px 0;">${esc(contact.service)}</td></tr>` : ""}
        </table>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" />
        <p style="font-size: 13px; color: #706e6b; margin: 0 0 4px;">Message:</p>
        <p style="font-size: 14px; margin: 0; white-space: pre-wrap;">${esc(contact.message)}</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services website.</p>
      </div>
    </div>
  `;

  const confirmHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Thank You for Contacting Us</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(contact.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Thank you for reaching out to Siebert Services. We've received your message and our team will get back to you within 1 business day.</p>
        <p style="font-size: 14px; margin: 0 0 4px;">In the meantime, you can reach us at:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:support@siebertrservices.com" style="color: #0176d3;">support@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Contact: ${esc(contact.name)}${contact.company ? ` — ${esc(contact.company)}` : ""}`, adminHtml),
    sendEmail(contact.email, "Thank You for Contacting Siebert Services", confirmHtml),
  ]);
}

export async function sendQuoteRequestNotification(quote: {
  name: string;
  email: string;
  phone?: string | null;
  company: string;
  companySize?: string | null;
  services: string;
  budget?: string | null;
  timeline?: string | null;
  details?: string | null;
  requestedTier?: string | null;
}) {
  const cfg = await loadEmailConfig();
  const services = (() => {
    try { return JSON.parse(quote.services).join(", "); } catch { return quote.services; }
  })();
  const tierLabel = quote.requestedTier
    ? quote.requestedTier.charAt(0).toUpperCase() + quote.requestedTier.slice(1)
    : null;

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Quote Request</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${esc(quote.name)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Email</td><td style="padding: 8px 0;">${esc(quote.email)}</td></tr>
          ${quote.phone ? `<tr><td style="padding: 8px 0; color: #706e6b;">Phone</td><td style="padding: 8px 0;">${esc(quote.phone)}</td></tr>` : ""}
          <tr><td style="padding: 8px 0; color: #706e6b;">Company</td><td style="padding: 8px 0;">${esc(quote.company)}</td></tr>
          ${quote.companySize ? `<tr><td style="padding: 8px 0; color: #706e6b;">Company Size</td><td style="padding: 8px 0;">${esc(quote.companySize)}</td></tr>` : ""}
          ${tierLabel ? `<tr><td style="padding: 8px 0; color: #706e6b;">Interested Tier</td><td style="padding: 8px 0; font-weight: 600;">${esc(tierLabel)}</td></tr>` : ""}
          <tr><td style="padding: 8px 0; color: #706e6b;">Services</td><td style="padding: 8px 0; font-weight: 600;">${esc(services)}</td></tr>
          ${quote.budget ? `<tr><td style="padding: 8px 0; color: #706e6b;">Budget</td><td style="padding: 8px 0;">${esc(quote.budget)}</td></tr>` : ""}
          ${quote.timeline ? `<tr><td style="padding: 8px 0; color: #706e6b;">Timeline</td><td style="padding: 8px 0;">${esc(quote.timeline)}</td></tr>` : ""}
        </table>
        ${quote.details ? `<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" /><p style="font-size: 13px; color: #706e6b; margin: 0 0 4px;">Additional Details:</p><p style="font-size: 14px; margin: 0; white-space: pre-wrap;">${esc(quote.details)}</p>` : ""}
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services website.</p>
      </div>
    </div>
  `;

  const confirmHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Quote Request Received</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(quote.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Thank you for requesting a quote from Siebert Services! We've received your request for the following services:</p>
        <div style="background: #f9f9f9; padding: 12px 16px; border-radius: 4px; margin: 0 0 16px;">
          <p style="font-size: 14px; font-weight: 600; margin: 0;">${esc(services)}</p>
        </div>
        <p style="font-size: 14px; margin: 0 0 16px;">Our team will review your requirements and prepare a customized quote for you. You can expect to hear from us within 1-2 business days.</p>
        <p style="font-size: 14px; margin: 0 0 4px;">Questions? Contact us:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:sales@siebertrservices.com" style="color: #0176d3;">sales@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Sales Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Quote Request: ${esc(quote.name)} — ${esc(quote.company)}`, adminHtml),
    sendEmail(quote.email, "Quote Request Received — Siebert Services", confirmHtml),
  ]);
}

export async function sendTrainingRequestNotification(request: {
  vendorName: string;
  topic: string;
  preferredDate?: string | null;
  attendeeCount: number;
  contactName: string;
  contactEmail: string;
  notes?: string | null;
}, partner: {
  companyName: string;
  contactName: string;
  email: string;
}) {
  const cfg = await loadEmailConfig();

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Training Request</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Vendor</td><td style="padding: 8px 0; font-weight: 600;">${esc(request.vendorName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Topic / Focus</td><td style="padding: 8px 0;">${esc(request.topic)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Preferred Date</td><td style="padding: 8px 0;">${esc(request.preferredDate || "Not specified")}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Attendees</td><td style="padding: 8px 0;">${request.attendeeCount}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Contact</td><td style="padding: 8px 0;">${esc(request.contactName)} (${esc(request.contactEmail)})</td></tr>
        </table>
        ${request.notes ? `<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" /><p style="font-size: 13px; color: #706e6b; margin: 0 0 4px;">Notes:</p><p style="font-size: 14px; margin: 0; white-space: pre-wrap;">${esc(request.notes)}</p>` : ""}
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" />
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Partner Company</td><td style="padding: 8px 0;">${esc(partner.companyName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Contact</td><td style="padding: 8px 0;">${esc(partner.contactName)} (${esc(partner.email)})</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services Partner Portal.</p>
      </div>
    </div>
  `;

  const partnerHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Training Request Received</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(request.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">We've received your training request and our team will coordinate with the vendor and follow up shortly.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Vendor</td><td style="padding: 10px 12px; font-weight: 600;">${esc(request.vendorName)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Topic / Focus</td><td style="padding: 10px 12px;">${esc(request.topic)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Preferred Date</td><td style="padding: 10px 12px;">${esc(request.preferredDate || "Not specified")}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Attendees</td><td style="padding: 10px 12px;">${request.attendeeCount}</td></tr>
        </table>
        <p style="font-size: 14px; margin: 16px 0 0;">Our team will reach out to you at ${esc(request.contactEmail)} to confirm details and scheduling.</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Partner Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Training Request: ${esc(request.vendorName)} — ${esc(partner.companyName)}`, adminHtml),
    sendEmail(request.contactEmail, `Training Request Received: ${esc(request.vendorName)} — ${esc(request.topic)}`, partnerHtml),
  ]);
}

export async function sendPartnerRegistrationNotification(partner: {
  companyName: string;
  contactName: string;
  email: string;
  password?: string;
}) {
  const cfg = await loadEmailConfig();
  const partnerPortalUrl = process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners/";

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Partner Registration</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">A new partner has registered and is awaiting approval.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Company</td><td style="padding: 10px 12px; font-weight: 600;">${esc(partner.companyName)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Contact</td><td style="padding: 10px 12px;">${esc(partner.contactName)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Email</td><td style="padding: 10px 12px;"><a href="mailto:${esc(partner.email)}" style="color: #0176d3;">${esc(partner.email)}</a></td></tr>
        </table>
        <p style="font-size: 14px; margin: 16px 0 0;">Please review and approve or reject this partner application in the admin portal.</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services Partner Portal.</p>
      </div>
    </div>
  `;

  const partnerHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Welcome to the Siebert Services Partner Program</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Thank you for registering as a Siebert Services partner! We've received your application for <strong>${esc(partner.companyName)}</strong> and our team will review it shortly.</p>
        ${partner.password ? `
        <div style="background: #f4f6f9; border: 1px solid #d8dde6; border-radius: 4px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="font-size: 13px; font-weight: 700; color: #032d60; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.05em;">Your Login Credentials</p>
          <table style="font-size: 14px; border-collapse: collapse;">
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0; width: 90px;">Username:</td><td style="font-weight: 600;">${esc(partner.email)}</td></tr>
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0;">Password:</td><td style="font-weight: 600;">${esc(partner.password)}</td></tr>
          </table>
          <p style="font-size: 13px; color: #706e6b; margin: 10px 0 0;">Partner Portal: <a href="${esc(partnerPortalUrl)}" style="color: #0176d3;">${esc(partnerPortalUrl)}</a></p>
        </div>
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px 16px; margin: 0 0 20px;">
          <p style="font-size: 13px; color: #856404; margin: 0;"><strong>Note:</strong> Your credentials will be active once your application is approved — you do not need to re-register. You'll receive a separate email when your account is approved.</p>
        </div>
        ` : ''}
        <p style="font-size: 14px; margin: 0 0 16px;">You'll receive a confirmation email once your account has been approved. In the meantime, if you have any questions, don't hesitate to reach out.</p>
        <p style="font-size: 14px; margin: 0 0 4px;">Contact us:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:partners@siebertrservices.com" style="color: #0176d3;">partners@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Partner Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Partner Registration: ${esc(partner.companyName)}`, adminHtml),
    sendEmail(partner.email, "Welcome to the Siebert Services Partner Program", partnerHtml),
  ]);
}

export async function sendPartnerApprovalNotification(partner: {
  companyName: string;
  contactName: string;
  email: string;
}, tempPassword?: string) {
  const portalUrl = process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners";

  const tempPasswordSection = tempPassword ? `
        <div style="background: #f0f7ff; border: 1px solid #cce5ff; border-radius: 4px; padding: 16px 20px; margin: 20px 0;">
          <p style="font-size: 13px; font-weight: 700; color: #032d60; margin: 0 0 6px;">Temporary Password</p>
          <p style="font-size: 13px; color: #444; margin: 0 0 10px;">Since you registered via Microsoft SSO, we've set a temporary password so you can also sign in with your email:</p>
          <div style="background: #fff; border: 1px solid #b3d4f5; border-radius: 4px; padding: 10px 14px; font-family: monospace; font-size: 16px; font-weight: 700; color: #032d60; letter-spacing: 1px; text-align: center;">${esc(tempPassword)}</div>
          <p style="font-size: 12px; color: #888; margin: 10px 0 0;">You can change this password after signing in under your profile settings.</p>
        </div>` : "";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #2e844a); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Your Partner Account is Approved!</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Great news! Your partner account for <strong>${esc(partner.companyName)}</strong> has been approved. You can now log in to the Partner Portal to access all available resources, register deals, track commissions, and more.</p>
        ${tempPasswordSection}
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(portalUrl)}" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">Log In to Partner Portal</a>
        </div>
        <p style="font-size: 14px; margin: 0 0 4px;">Need help getting started? Contact us:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:partners@siebertrservices.com" style="color: #0176d3;">partners@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Partner Team</p>
      </div>
    </div>
  `;

  await sendEmail(partner.email, "Your Siebert Services Partner Account is Approved", html);
}

export async function sendPartnerTierChangeNotification(partner: {
  companyName: string;
  contactName: string;
  email: string;
}, oldTier: string, newTier: string) {
  const tierLabels: Record<string, string> = {
    registered: "Registered",
    silver: "Silver",
    gold: "Gold",
    platinum: "Platinum",
  };
  const tierColors: Record<string, string> = {
    registered: "#706e6b",
    silver: "#a8a29e",
    gold: "#f59e0b",
    platinum: "#7c3aed",
  };
  const tierBenefits: Record<string, string> = {
    silver: "increased commission rates, priority deal support, and access to Silver-tier resources",
    gold: "higher commission rates, dedicated account support, Gold-tier resources, and co-marketing opportunities",
    platinum: "our top commission rates, a dedicated partner manager, Platinum-tier resources, and full co-marketing support",
    registered: "access to the Partner Portal, deal registration, and base-tier resources",
  };

  const tierLabel = tierLabels[newTier] || newTier;
  const tierColor = tierColors[newTier] || "#0176d3";
  const benefits = tierBenefits[newTier] || "updated partner benefits";
  const portalUrl = process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners";

  const tierOrder = ["registered", "silver", "gold", "platinum"];
  const isUpgrade = tierOrder.indexOf(newTier) > tierOrder.indexOf(oldTier);
  const changeVerb = isUpgrade ? "upgraded" : "updated";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, ${tierColor}); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Your Partner Tier Has Changed</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">The partner tier for <strong>${esc(partner.companyName)}</strong> has been ${changeVerb} from <strong>${esc(tierLabels[oldTier] || oldTier)}</strong> to <strong style="color: ${tierColor};">${esc(tierLabel)}</strong> in the Siebert Services Partner Program.</p>
        <div style="background: #f9f9f9; border-left: 4px solid ${tierColor}; padding: 14px 16px; margin: 16px 0; border-radius: 0 4px 4px 0;">
          <p style="font-size: 14px; margin: 0 0 4px; font-weight: 600; color: ${tierColor};">${esc(tierLabel)} Tier</p>
          <p style="font-size: 14px; margin: 0; color: #444;">Your ${esc(tierLabel)} status includes ${benefits}. Log in to the Partner Portal to explore your current benefits.</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(portalUrl)}" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">View Partner Portal</a>
        </div>
        <p style="font-size: 14px; margin: 0 0 4px;">Questions about your tier? Contact us:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:partners@siebertrservices.com" style="color: #0176d3;">partners@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Partner Team</p>
      </div>
    </div>
  `;

  await sendEmail(partner.email, `Your Siebert Services partner tier has been ${changeVerb} to ${esc(tierLabel)}`, html);
}

export async function sendUserRegistrationNotification(user: {
  name: string;
  email: string;
  company: string;
  password?: string;
}) {
  const cfg = await loadEmailConfig();
  const clientPortalUrl = process.env.CLIENT_PORTAL_URL || "https://siebertrservices.com";

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New User Registration</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">A new user has registered on the Siebert Services platform.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Name</td><td style="padding: 10px 12px; font-weight: 600;">${esc(user.name)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Email</td><td style="padding: 10px 12px;"><a href="mailto:${esc(user.email)}" style="color: #0176d3;">${esc(user.email)}</a></td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Company</td><td style="padding: 10px 12px;">${esc(user.company)}</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services website.</p>
      </div>
    </div>
  `;

  const userHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Welcome to Siebert Services</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(user.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Welcome to Siebert Services! Your account has been created and you can now log in to access your client portal, track support tickets, view proposals, and more.</p>
        ${user.password ? `
        <div style="background: #f4f6f9; border: 1px solid #d8dde6; border-radius: 4px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="font-size: 13px; font-weight: 700; color: #032d60; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.05em;">Your Login Credentials</p>
          <table style="font-size: 14px; border-collapse: collapse;">
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0; width: 90px;">Username:</td><td style="font-weight: 600;">${esc(user.email)}</td></tr>
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0;">Password:</td><td style="font-weight: 600;">${esc(user.password)}</td></tr>
          </table>
        </div>
        ` : ''}
        <p style="font-size: 14px; font-weight: 600; margin: 0 0 8px;">How to log in:</p>
        <ol style="font-size: 14px; margin: 0 0 20px; padding-left: 20px; line-height: 1.8;">
          <li>Visit the <a href="${esc(clientPortalUrl)}" style="color: #0176d3;">Client Portal</a></li>
          <li>Enter your email address and the password above</li>
          <li>Access your dashboard to manage tickets, view proposals, and more</li>
        </ol>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(clientPortalUrl)}" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 600;">Log In to Client Portal</a>
        </div>
        <p style="font-size: 14px; margin: 0 0 4px;">If you have any questions or need assistance, you can reach us at:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:support@siebertrservices.com" style="color: #0176d3;">support@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New User Registration: ${esc(user.name)} — ${esc(user.company)}`, adminHtml),
    sendEmail(user.email, "Welcome to Siebert Services", userHtml),
  ]);
}

export async function sendLoginCode(email: string, code: string, type: "user" | "partner") {
  const portalName = type === "partner" ? "Partner Portal" : "Admin Portal";
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Your Login Code — Siebert Services</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Use the code below to sign in to the ${esc(portalName)}. It expires in <strong>10 minutes</strong>.</p>
        <div style="background: #f4f6f9; border: 2px dashed #0176d3; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 20px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #032d60;">${esc(code)}</span>
        </div>
        <p style="font-size: 13px; color: #706e6b; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services</p>
      </div>
    </div>
  `;
  return sendEmail(email, `${code} — Your Siebert Services Login Code`, html);
}

export async function sendClientTicketNotification(ticket: {
  subject: string;
  description: string;
  priority: string;
  category: string;
}, client: {
  name: string;
  email: string;
}) {
  const cfg = await loadEmailConfig();
  const priorityColors: Record<string, string> = {
    urgent: "#ea001e", high: "#fe9339", medium: "#0176d3", low: "#706e6b",
  };
  const pColor = priorityColors[ticket.priority] || "#706e6b";

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Client Support Ticket</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #706e6b; width: 140px;">Subject</td><td style="padding: 8px 0; font-weight: 600;">${esc(ticket.subject)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Priority</td><td style="padding: 8px 0;"><span style="color: ${pColor}; font-weight: 600; text-transform: uppercase;">${esc(ticket.priority)}</span></td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Category</td><td style="padding: 8px 0; text-transform: capitalize;">${esc(ticket.category)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Description</td><td style="padding: 8px 0;">${esc(ticket.description)}</td></tr>
          <tr><td style="padding: 8px 0; color: #706e6b;">Client</td><td style="padding: 8px 0;">${esc(client.name)} (${esc(client.email)})</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services Client Portal.</p>
      </div>
    </div>
  `;

  const clientHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Support Ticket Received</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(client.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">We've received your support ticket and our team will review it shortly.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Subject</td><td style="padding: 10px 12px; font-weight: 600;">${esc(ticket.subject)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Priority</td><td style="padding: 10px 12px;"><span style="color: ${pColor}; font-weight: 600; text-transform: uppercase;">${esc(ticket.priority)}</span></td></tr>
        </table>
        <p style="font-size: 14px; margin: 16px 0 0;">You can track the status and add updates to your ticket in the Client Portal under Support.</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Support Team</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Client Ticket: ${esc(ticket.subject)} — ${esc(client.name)}`, adminHtml),
    sendEmail(client.email, `Support Ticket Received: ${ticket.subject}`, clientHtml),
  ]);
}

export async function sendAdminTicketReply(ticket: {
  id: number;
  subject: string;
  priority: string;
}, client: {
  name: string;
  email: string;
}, adminMessage: string) {
  const cfg = await loadEmailConfig();
  const priorityColors: Record<string, string> = {
    urgent: "#ea001e", high: "#fe9339", medium: "#0176d3", low: "#706e6b",
  };
  const pColor = priorityColors[ticket.priority] || "#706e6b";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Reply on Your Support Ticket</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(client.name)},</p>
        <p style="font-size: 14px; margin: 0 0 4px;">Our support team has replied to your ticket <strong>#${ticket.id} — ${esc(ticket.subject)}</strong>:</p>
        <div style="background: #f4f6f9; border-left: 4px solid #0176d3; padding: 14px 16px; margin: 16px 0; border-radius: 0 4px 4px 0;">
          <p style="font-size: 14px; margin: 0; white-space: pre-wrap; color: #032d60;">${esc(adminMessage)}</p>
        </div>
        <p style="font-size: 14px; margin: 0 0 16px;">Log in to your client portal to view the full thread and continue the conversation.</p>
        <div style="text-align: center; margin: 20px 0;">
          <a href="${esc(process.env.CLIENT_PORTAL_URL || "https://siebertrservices.com")}/support" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 600;">View Ticket</a>
        </div>
        <p style="font-size: 11px; color: #999; margin-top: 20px;">Ticket #${ticket.id} · Priority: <span style="color: ${pColor}; text-transform: uppercase; font-weight: 600;">${esc(ticket.priority)}</span></p>
        <p style="font-size: 12px; color: #999; margin-top: 4px;">— Siebert Services Support Team</p>
      </div>
    </div>
  `;

  await sendEmail(client.email, `Re: [#${ticket.id}] ${ticket.subject}`, html);
}

export async function sendTicketStatusUpdate(ticket: {
  id: number;
  subject: string;
  priority: string;
}, client: {
  name: string;
  email: string;
}, newStatus: string) {
  const cfg = await loadEmailConfig();
  const statusLabels: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    resolved: "Resolved",
    closed: "Closed",
  };
  const statusColors: Record<string, string> = {
    open: "#0176d3",
    in_progress: "#fe9339",
    resolved: "#2e844a",
    closed: "#706e6b",
  };
  const label = statusLabels[newStatus] || newStatus;
  const color = statusColors[newStatus] || "#706e6b";

  const statusMessages: Record<string, string> = {
    in_progress: "Our team has started working on your ticket and will keep you updated.",
    resolved: "Your ticket has been marked as resolved. If the issue persists, you can re-open it by replying in the client portal.",
    closed: "Your ticket has been closed. If you have further questions, please don't hesitate to open a new ticket.",
    open: "Your ticket has been re-opened and our team will follow up shortly.",
  };
  const message = statusMessages[newStatus] || "The status of your ticket has been updated.";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Ticket Status Updated</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(client.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">The status of your support ticket <strong>#${ticket.id} — ${esc(ticket.subject)}</strong> has been updated to:</p>
        <div style="text-align: center; margin: 20px 0;">
          <span style="display: inline-block; background: ${color}; color: #fff; padding: 8px 24px; border-radius: 20px; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">${esc(label)}</span>
        </div>
        <p style="font-size: 14px; margin: 0 0 20px; text-align: center;">${message}</p>
        <div style="text-align: center;">
          <a href="${esc(process.env.CLIENT_PORTAL_URL || "https://siebertrservices.com")}/support" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 600;">View Ticket</a>
        </div>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">— Siebert Services Support Team</p>
      </div>
    </div>
  `;

  await sendEmail(client.email, `Ticket #${ticket.id} Status Updated: ${label}`, html);
}

export async function sendProposalToClient(proposal: {
  proposalNumber: string;
  title: string;
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  total: string;
  validUntil?: Date | null;
}) {
  const proposalUrl = `${process.env.CLIENT_PORTAL_URL || "https://siebertrservices.com"}/proposal/${proposal.proposalNumber}`;
  const validDate = proposal.validUntil
    ? new Date(proposal.validUntil).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;
  const totalFormatted = parseFloat(proposal.total).toLocaleString("en-US", { style: "currency", currency: "USD" });

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Your Proposal from Siebert Services</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(proposal.clientName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">We've prepared a proposal for <strong>${esc(proposal.clientCompany)}</strong>. Please review the details below and let us know if you'd like to move forward.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px; margin-bottom: 20px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 150px;">Proposal #</td><td style="padding: 10px 12px; font-weight: 600;">${esc(proposal.proposalNumber)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Title</td><td style="padding: 10px 12px;">${esc(proposal.title)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Total</td><td style="padding: 10px 12px; font-weight: 700; color: #2e844a; font-size: 16px;">${esc(totalFormatted)}</td></tr>
          ${validDate ? `<tr><td style="padding: 10px 12px; color: #706e6b;">Valid Until</td><td style="padding: 10px 12px;">${esc(validDate)}</td></tr>` : ""}
        </table>
        <p style="font-size: 14px; margin: 0 0 20px;">Click the button below to view the full proposal, review line items, and accept or decline.</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(proposalUrl)}" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">Review Proposal</a>
        </div>
        <p style="font-size: 13px; color: #706e6b; margin: 0 0 4px;">Questions? Contact us:</p>
        <ul style="font-size: 13px; color: #706e6b; margin: 4px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:sales@siebertrservices.com" style="color: #0176d3;">sales@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">— Siebert Services Sales Team</p>
      </div>
    </div>
  `;

  await sendEmail(proposal.clientEmail, `Proposal Ready: ${proposal.title} — ${proposal.proposalNumber}`, html);
}

export async function sendProposalResponseNotification(proposal: {
  proposalNumber: string;
  title: string;
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  total: string;
}, action: "accepted" | "rejected") {
  const cfg = await loadEmailConfig();
  const isAccepted = action === "accepted";
  const actionLabel = isAccepted ? "Accepted" : "Declined";
  const actionColor = isAccepted ? "#2e844a" : "#ea001e";
  const totalFormatted = parseFloat(proposal.total).toLocaleString("en-US", { style: "currency", currency: "USD" });

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, ${isAccepted ? "#2e844a" : "#c23934"}); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Proposal ${actionLabel}</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 8px;">${isAccepted ? "Great news!" : "Update:"} <strong>${esc(proposal.clientName)}</strong> from <strong>${esc(proposal.clientCompany)}</strong> has <span style="color: ${actionColor}; font-weight: 700;">${actionLabel.toLowerCase()}</span> proposal <strong>${esc(proposal.proposalNumber)}</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px; margin: 16px 0;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 150px;">Proposal #</td><td style="padding: 10px 12px; font-weight: 600;">${esc(proposal.proposalNumber)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Title</td><td style="padding: 10px 12px;">${esc(proposal.title)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Client</td><td style="padding: 10px 12px;">${esc(proposal.clientName)} — ${esc(proposal.clientEmail)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Company</td><td style="padding: 10px 12px;">${esc(proposal.clientCompany)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Total</td><td style="padding: 10px 12px; font-weight: 700; color: #2e844a;">${esc(totalFormatted)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Response</td><td style="padding: 10px 12px; font-weight: 700; color: ${actionColor};">${esc(actionLabel)}</td></tr>
        </table>
        ${isAccepted ? `<p style="font-size: 14px; margin: 0 0 4px; color: #2e844a; font-weight: 600;">Next step: Follow up with the client to begin onboarding.</p>` : `<p style="font-size: 14px; margin: 0 0 4px;">Consider following up to understand their concerns and explore alternatives.</p>`}
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services platform.</p>
      </div>
    </div>
  `;

  await sendEmail(cfg.notificationEmail, `Proposal ${actionLabel}: ${proposal.proposalNumber} — ${proposal.clientCompany}`, html);
}

export async function sendQuoteStatusUpdate(quote: {
  id: number;
  name: string;
  email: string;
  company: string;
  services: string;
}, newStatus: string) {
  const statusMessages: Record<string, { label: string; message: string; color: string }> = {
    reviewing: {
      label: "Under Review",
      message: "Our team is actively reviewing your quote request. We'll be in touch within 1-2 business days with a detailed proposal.",
      color: "#0176d3",
    },
    quoted: {
      label: "Proposal Ready",
      message: "We've prepared a custom proposal for your request. Check your email for the proposal link, or contact us to schedule a review call.",
      color: "#2e844a",
    },
    closed: {
      label: "Closed",
      message: "This quote request has been closed. If you'd like to re-engage, please don't hesitate to reach out.",
      color: "#706e6b",
    },
  };

  const info = statusMessages[newStatus];
  if (!info) return;

  const services = (() => {
    try { return JSON.parse(quote.services).join(", "); } catch { return quote.services; }
  })();

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Update on Your Quote Request</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(quote.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">We have an update on your quote request for <strong>${esc(services)}</strong> at <strong>${esc(quote.company)}</strong>:</p>
        <div style="text-align: center; margin: 20px 0;">
          <span style="display: inline-block; background: ${info.color}; color: #fff; padding: 8px 24px; border-radius: 20px; font-size: 14px; font-weight: 700;">${esc(info.label)}</span>
        </div>
        <p style="font-size: 14px; margin: 0 0 20px; text-align: center;">${info.message}</p>
        <p style="font-size: 13px; color: #706e6b; margin: 0 0 4px;">Need to discuss? Reach us at:</p>
        <ul style="font-size: 13px; color: #706e6b; margin: 4px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:sales@siebertrservices.com" style="color: #0176d3;">sales@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 24px;">— Siebert Services Sales Team</p>
      </div>
    </div>
  `;

  await sendEmail(quote.email, `Quote Request Update — ${info.label}`, html);
}

export async function sendVivintInquiryNotification(inquiry: {
  type: string;
  name: string;
  email: string;
  phone: string;
  zipCode?: string;
  propertyType?: string;
  currentSystem?: string;
  interestedIn?: string[];
  budget?: string;
  timeframe?: string;
  notes?: string;
}) {
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0176d3, #014fa3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Vivint Inquiry</h1>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; background: #fafafa;">
        <p style="margin: 0 0 20px; font-size: 14px;">A ${inquiry.type} inquiry has been submitted through the Vivint form.</p>
        
        <table style="width: 100%; margin-bottom: 20px; font-size: 13px;">
          <tr style="background: #fff; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; font-weight: 700; color: #374151; width: 30%;">Type:</td>
            <td style="padding: 12px; color: #6b7280;">${inquiry.type.charAt(0).toUpperCase() + inquiry.type.slice(1)}</td>
          </tr>
          <tr style="background: #fff; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; font-weight: 700; color: #374151;">Name:</td>
            <td style="padding: 12px; color: #6b7280;">${inquiry.name}</td>
          </tr>
          <tr style="background: #fff; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; font-weight: 700; color: #374151;">Email:</td>
            <td style="padding: 12px; color: #6b7280;"><a href="mailto:${inquiry.email}" style="color: #0176d3;">${inquiry.email}</a></td>
          </tr>
          <tr style="background: #fff; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; font-weight: 700; color: #374151;">Phone:</td>
            <td style="padding: 12px; color: #6b7280;"><a href="tel:${inquiry.phone}" style="color: #0176d3;">${inquiry.phone}</a></td>
          </tr>
          ${inquiry.zipCode ? `<tr style="background: #fff; border-bottom: 1px solid #e5e7eb;"><td style="padding: 12px; font-weight: 700; color: #374151;">Zip Code:</td><td style="padding: 12px; color: #6b7280;">${inquiry.zipCode}</td></tr>` : ""}
          ${inquiry.propertyType ? `<tr style="background: #fff; border-bottom: 1px solid #e5e7eb;"><td style="padding: 12px; font-weight: 700; color: #374151;">Property Type:</td><td style="padding: 12px; color: #6b7280;">${inquiry.propertyType}</td></tr>` : ""}
          ${inquiry.currentSystem ? `<tr style="background: #fff; border-bottom: 1px solid #e5e7eb;"><td style="padding: 12px; font-weight: 700; color: #374151;">Current System:</td><td style="padding: 12px; color: #6b7280;">${inquiry.currentSystem}</td></tr>` : ""}
          ${inquiry.budget ? `<tr style="background: #fff; border-bottom: 1px solid #e5e7eb;"><td style="padding: 12px; font-weight: 700; color: #374151;">Budget:</td><td style="padding: 12px; color: #6b7280;">${inquiry.budget}</td></tr>` : ""}
          ${inquiry.timeframe ? `<tr style="background: #fff; border-bottom: 1px solid #e5e7eb;"><td style="padding: 12px; font-weight: 700; color: #374151;">Timeframe:</td><td style="padding: 12px; color: #6b7280;">${inquiry.timeframe}</td></tr>` : ""}
        </table>

        ${inquiry.interestedIn && inquiry.interestedIn.length > 0 ? `
          <div style="margin-bottom: 20px;">
            <p style="margin: 0 0 8px; font-weight: 700; font-size: 13px;">Interested In:</p>
            <p style="margin: 0; font-size: 13px; color: #6b7280;">${inquiry.interestedIn.join(", ")}</p>
          </div>
        ` : ""}

        ${inquiry.notes ? `
          <div style="margin-bottom: 20px; padding: 12px; background: #fff; border-left: 4px solid #0176d3; border-radius: 2px;">
            <p style="margin: 0 0 4px; font-weight: 700; font-size: 12px; color: #374151;">Notes:</p>
            <p style="margin: 0; font-size: 13px; color: #6b7280; white-space: pre-wrap;">${inquiry.notes}</p>
          </div>
        ` : ""}

        <p style="margin: 0; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 12px;">
          Reply to <a href="mailto:${inquiry.email}" style="color: #0176d3;">${inquiry.email}</a> to follow up with this lead.
        </p>
      </div>
    </div>
  `;

  await sendEmail(process.env.SALES_EMAIL || "sales@siebertrservices.com", `New Vivint Inquiry — ${inquiry.name}`, html);
}

// ─── Lead Magnets ──────────────────────────────────────────────────────────

const MAGNET_LABELS: Record<string, string> = {
  cybersecurity_assessment: "Free Cybersecurity Risk Assessment",
  downtime_calculator: "Cost of Downtime Calculator",
  hipaa_checklist: "HIPAA Compliance Checklist",
  buyers_guide: "Buyer's Guide: 10 Questions Before Hiring an MSP",
};

export function getLeadMagnetLabel(magnet: string): string {
  return MAGNET_LABELS[magnet] || magnet;
}

export type LeadMagnetKey =
  | "cybersecurity_assessment"
  | "downtime_calculator"
  | "hipaa_checklist"
  | "buyers_guide";

export type LeadMagnetPayload = Record<string, unknown>;

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function renderAssessmentReport(payload: LeadMagnetPayload): { score: number; band: string; bandColor: string; recs: string[] } {
  // payload = { backups: 'yes'|'no'|'unsure', mfa, training, edr, patching, response_plan, vendor_review }
  const yesPoints: Record<string, number> = { yes: 2, partial: 1, no: 0, unsure: 0 };
  const keys = ["backups", "mfa", "training", "edr", "patching", "response_plan", "vendor_review"];
  let score = 0;
  for (const k of keys) score += yesPoints[asString(payload[k], "no")] ?? 0;
  const max = keys.length * 2;
  const pct = Math.round((score / max) * 100);
  let band = "High Risk";
  let bandColor = "#dc2626";
  if (pct >= 75) { band = "Strong Posture"; bandColor = "#16a34a"; }
  else if (pct >= 50) { band = "Moderate Risk"; bandColor = "#f59e0b"; }
  const recs: string[] = [];
  if (asString(payload.backups) !== "yes") recs.push("Implement immutable, off-site backups with regular restore tests (3-2-1 rule).");
  if (asString(payload.mfa) !== "yes") recs.push("Enforce MFA on email, VPN, and all admin accounts immediately — this blocks 99% of credential attacks.");
  if (asString(payload.training) !== "yes") recs.push("Roll out quarterly phishing simulations and security-awareness training for all staff.");
  if (asString(payload.edr) !== "yes") recs.push("Replace legacy antivirus with EDR/MDR (24/7 monitored endpoint detection).");
  if (asString(payload.patching) !== "yes") recs.push("Move to automated patching with monthly compliance reports for OS and third-party apps.");
  if (asString(payload.response_plan) !== "yes") recs.push("Document and tabletop-test an incident response plan, including ransomware playbook.");
  if (asString(payload.vendor_review) !== "yes") recs.push("Run an annual vendor / SaaS security review and require SOC 2 from critical vendors.");
  if (recs.length === 0) recs.push("Strong baseline! We recommend an annual penetration test to validate controls.");
  return { score: pct, band, bandColor, recs };
}

export async function sendLeadMagnetFollowUpEmail(to: string, subject: string, bodyHtml: string, unsubUrl: string): Promise<boolean> {
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 18px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 16px;">Siebert Services</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        ${bodyHtml}
        <p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">— Siebert Services · 866-484-9180 · sales@siebertrservices.com</p>
        <p style="font-size:11px;color:#9ca3af;margin:10px 0 0;line-height:1.5;">
          You're receiving this because you downloaded a Siebert Services resource. Don't want follow-ups?
          <a href="${esc(unsubUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>.
        </p>
      </div>
    </div>
  `;
  return sendEmail(to, subject, html);
}

export async function sendLeadMagnetSubmission(submission: {
  id?: number;
  magnet: LeadMagnetKey;
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  payload: LeadMagnetPayload;
  pdfAttachment?: EmailAttachment;
  unsubscribeUrl?: string;
}, baseUrl: string) {
  const cfg = await loadEmailConfig();
  const label = getLeadMagnetLabel(submission.magnet);

  let bodyHtml = "";
  let subject = `Your ${label} from Siebert Services`;

  if (submission.magnet === "cybersecurity_assessment") {
    const r = renderAssessmentReport(submission.payload);
    bodyHtml = `
      <p style="font-size:14px;margin:0 0 16px;">Hi ${esc(submission.name)},</p>
      <p style="font-size:14px;margin:0 0 16px;">Thanks for completing the Siebert Services Cybersecurity Risk Assessment. Based on your answers, here's a snapshot of your current posture and the highest-impact actions to take next.</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:0 0 20px;">
        <p style="margin:0 0 6px;font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Your Score</p>
        <p style="margin:0 0 4px;font-size:36px;font-weight:800;color:${r.bandColor};">${r.score}<span style="font-size:18px;color:#9ca3af;font-weight:600;">/100</span></p>
        <p style="margin:0;font-size:14px;font-weight:700;color:${r.bandColor};">${r.band}</p>
      </div>
      <p style="font-size:14px;font-weight:700;margin:0 0 8px;color:#111827;">Top recommendations</p>
      <ol style="font-size:14px;color:#374151;margin:0 0 20px;padding-left:20px;">
        ${r.recs.map(rec => `<li style="margin:0 0 8px;">${esc(rec)}</li>`).join("")}
      </ol>
      <p style="font-size:14px;margin:0 0 8px;">Want a deeper review? <a href="${esc(baseUrl)}/contact?source=cybersecurity_assessment" style="color:#0176d3;font-weight:600;">Book a free 30-minute consultation</a> with a Siebert security specialist.</p>
    `;
  } else if (submission.magnet === "downtime_calculator") {
    const employees = asNumber(submission.payload.employees, 0);
    const hourlyCost = asNumber(submission.payload.hourlyCost, 0);
    const hours = asNumber(submission.payload.hours, 0);
    const total = employees * hourlyCost * hours;
    const annualLikely = total * asNumber(submission.payload.outagesPerYear, 4);
    const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    bodyHtml = `
      <p style="font-size:14px;margin:0 0 16px;">Hi ${esc(submission.name)},</p>
      <p style="font-size:14px;margin:0 0 16px;">Here's your personalized downtime cost estimate:</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:0 0 20px;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;">Employees affected</td><td style="padding:6px 0;text-align:right;font-weight:600;">${employees.toLocaleString()}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Avg fully-loaded hourly cost</td><td style="padding:6px 0;text-align:right;font-weight:600;">${fmt(hourlyCost)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Hours of downtime</td><td style="padding:6px 0;text-align:right;font-weight:600;">${hours}</td></tr>
          <tr style="border-top:2px solid #032d60;"><td style="padding:12px 0 0;font-weight:700;color:#111827;">Cost per outage</td><td style="padding:12px 0 0;text-align:right;font-weight:800;font-size:20px;color:#dc2626;">${fmt(total)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;">Estimated annual exposure (at typical 4 outages/yr)</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#dc2626;">${fmt(annualLikely)}</td></tr>
        </table>
      </div>
      <p style="font-size:14px;margin:0 0 8px;">Want to slash that number? Siebert's managed IT plans include 24/7 monitoring, proactive patching, and 1-hour SLA — typically reducing unplanned downtime by 70%+.</p>
      <p style="font-size:14px;margin:0 0 8px;"><a href="${esc(baseUrl)}/contact?source=downtime_calculator" style="color:#0176d3;font-weight:600;">Book a free downtime-reduction consultation →</a></p>
    `;
  } else if (submission.magnet === "hipaa_checklist") {
    bodyHtml = `
      <p style="font-size:14px;margin:0 0 16px;">Hi ${esc(submission.name)},</p>
      <p style="font-size:14px;margin:0 0 16px;">Thanks for downloading the Siebert Services HIPAA Compliance Checklist. Your branded PDF is attached to this email — it covers all 18 administrative, physical, and technical safeguards you need to document.</p>
      <p style="font-size:14px;margin:0 0 16px;">Prefer to view it in your browser? <a href="${esc(baseUrl)}/resources/hipaa-checklist/download?email=${encodeURIComponent(submission.email)}" style="color:#0176d3;font-weight:600;">Open the printable version online</a>.</p>
      <p style="font-size:14px;margin:0 0 8px;">Need help closing gaps? Our compliance team builds HIPAA-ready stacks for medical and dental practices in under 30 days. <a href="${esc(baseUrl)}/contact?source=hipaa_checklist" style="color:#0176d3;font-weight:600;">Book a HIPAA gap assessment →</a></p>
    `;
  } else if (submission.magnet === "buyers_guide") {
    bodyHtml = `
      <p style="font-size:14px;margin:0 0 16px;">Hi ${esc(submission.name)},</p>
      <p style="font-size:14px;margin:0 0 16px;">Your copy of <strong>10 Questions to Ask Before Hiring an MSP</strong> is attached as a PDF — the same evaluation framework our highest-performing clients used to vet Siebert Services.</p>
      <p style="font-size:14px;margin:0 0 16px;">Prefer to view it in your browser? <a href="${esc(baseUrl)}/resources/buyers-guide/download?email=${encodeURIComponent(submission.email)}" style="color:#0176d3;font-weight:600;">Open the printable version online</a>.</p>
      <p style="font-size:14px;margin:0 0 8px;">Want us to walk through the questions live? <a href="${esc(baseUrl)}/contact?source=buyers_guide" style="color:#0176d3;font-weight:600;">Book a 30-minute consultation →</a></p>
    `;
  } else {
    bodyHtml = `<p style="font-size:14px;">Hi ${esc(submission.name)}, thanks for downloading <strong>${esc(label)}</strong>.</p>`;
  }

  const userHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">${esc(label)}</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        ${bodyHtml}
        <p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">— Siebert Services · 866-484-9180 · sales@siebertrservices.com</p>
        ${submission.unsubscribeUrl ? `<p style="font-size:11px;color:#9ca3af;margin:10px 0 0;line-height:1.5;">You'll get a few short follow-up tips on this topic over the next 10 days. Not interested? <a href="${esc(submission.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>.</p>` : ""}
      </div>
    </div>
  `;

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Lead Magnet Download</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:8px 0;color:#706e6b;width:140px;">Magnet</td><td style="padding:8px 0;font-weight:600;">${esc(label)}</td></tr>
          <tr><td style="padding:8px 0;color:#706e6b;">Name</td><td style="padding:8px 0;">${esc(submission.name)}</td></tr>
          <tr><td style="padding:8px 0;color:#706e6b;">Email</td><td style="padding:8px 0;"><a href="mailto:${esc(submission.email)}" style="color:#0176d3;">${esc(submission.email)}</a></td></tr>
          ${submission.company ? `<tr><td style="padding:8px 0;color:#706e6b;">Company</td><td style="padding:8px 0;">${esc(submission.company)}</td></tr>` : ""}
          ${submission.phone ? `<tr><td style="padding:8px 0;color:#706e6b;">Phone</td><td style="padding:8px 0;"><a href="tel:${esc(submission.phone)}" style="color:#0176d3;">${esc(submission.phone)}</a></td></tr>` : ""}
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <p style="font-size:12px;color:#706e6b;margin:0 0 4px;font-weight:700;">Submission payload:</p>
        <pre style="font-size:11px;background:#f9fafb;border:1px solid #e5e7eb;padding:10px;border-radius:4px;overflow:auto;">${esc(JSON.stringify(submission.payload || {}, null, 2))}</pre>
        <p style="font-size:12px;color:#999;margin-top:16px;">Automated notification from siebertrservices.com</p>
      </div>
    </div>
  `;

  const userAttachments = submission.pdfAttachment ? [submission.pdfAttachment] : undefined;
  await Promise.all([
    sendEmail(submission.email, subject, userHtml, userAttachments),
    sendEmail(cfg.notificationEmail, `New Lead Magnet: ${label} — ${esc(submission.name)}${submission.company ? ` (${esc(submission.company)})` : ""}`, adminHtml),
  ]);
}

export async function sendStripeConnectReminder(partner: {
  companyName: string;
  contactName: string;
  email: string;
}) {
  const portalUrl = process.env.PARTNER_PORTAL_URL
    ? process.env.PARTNER_PORTAL_URL.replace(/\/$/, "")
    : "https://siebertrservices.com/partners";
  const profileUrl = `${portalUrl}/profile`;

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Action Required: Connect Your Stripe Account</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">
          We noticed that your partner account at <strong>${esc(partner.companyName)}</strong> does not yet have a Stripe account connected.
          Connecting Stripe is required for us to send commission payouts directly to you.
        </p>
        <p style="font-size: 14px; margin: 0 0 20px;">
          It only takes a few minutes to set up. Once connected, all future commissions will be transferred automatically.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(profileUrl)}" style="display: inline-block; background: #0176d3; color: #fff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; text-decoration: none;">
            Connect Stripe Now
          </a>
        </div>
        <p style="font-size: 13px; color: #706e6b; margin: 0 0 8px;">
          To connect: log in to the Partner Portal, navigate to <strong>Profile</strong>, and click <strong>Connect Stripe Account</strong>.
        </p>
        <p style="font-size: 13px; color: #706e6b; margin: 0 0 0;">
          If you have any questions, please reach out to us at
          <a href="mailto:sales@siebertrservices.com" style="color: #0176d3;">sales@siebertrservices.com</a>
          or call <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a>.
        </p>
        <p style="font-size: 12px; color: #999; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
          — Siebert Services Partner Team
        </p>
      </div>
    </div>
  `;

  return sendEmail(partner.email, "Action Required: Connect Your Stripe Account to Receive Payouts", html);
}

export async function sendPaymentReceiptEmail(invoice: {
  customerEmail: string;
  customerName?: string | null;
  amountPaid: number;
  currency: string;
  invoiceNumber?: string | null;
  description?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
}): Promise<boolean> {
  const cfg = await loadEmailConfig();

  if (!cfg.receiptEmailEnabled) {
    console.log("[Email] Receipt emails disabled — skipping receipt send");
    return false;
  }

  const fmt = (n: number, currency: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(n / 100);

  const amount = fmt(invoice.amountPaid, invoice.currency);
  const dateLine = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const periodLine =
    invoice.periodStart && invoice.periodEnd
      ? `${invoice.periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${invoice.periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : null;

  const greeting = invoice.customerName ? `Hi ${esc(invoice.customerName)},` : "Hi,";
  const introText = cfg.receiptEmailIntro ||
    "Thank you for your payment. Your invoice has been paid and your services are active. A summary is below for your records.";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Payment Receipt</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 13px;">Siebert Services</p>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">${greeting}</p>
        <p style="font-size: 14px; margin: 0 0 20px; color: #444;">${esc(introText)}</p>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9fafb; border-radius: 6px; margin-bottom: 20px;">
          <tr>
            <td style="padding: 10px 14px; color: #706e6b; width: 160px; font-size: 13px;">Amount Paid</td>
            <td style="padding: 10px 14px; font-weight: 700; font-size: 16px; color: #2e844a;">${esc(amount)}</td>
          </tr>
          ${invoice.invoiceNumber ? `<tr><td style="padding: 10px 14px; color: #706e6b; font-size: 13px;">Invoice #</td><td style="padding: 10px 14px;">${esc(invoice.invoiceNumber)}</td></tr>` : ""}
          <tr><td style="padding: 10px 14px; color: #706e6b; font-size: 13px;">Date</td><td style="padding: 10px 14px;">${esc(dateLine)}</td></tr>
          ${periodLine ? `<tr><td style="padding: 10px 14px; color: #706e6b; font-size: 13px;">Service Period</td><td style="padding: 10px 14px;">${esc(periodLine)}</td></tr>` : ""}
          ${invoice.description ? `<tr><td style="padding: 10px 14px; color: #706e6b; font-size: 13px; border-top: 1px solid #e5e5e5;">Description</td><td style="padding: 10px 14px; border-top: 1px solid #e5e5e5;">${esc(invoice.description)}</td></tr>` : ""}
        </table>

        <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px;">
          ${invoice.hostedInvoiceUrl
            ? `<a href="${esc(invoice.hostedInvoiceUrl)}" style="display: inline-block; background: #0176d3; color: #fff; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 6px; text-decoration: none;">View Invoice</a>`
            : `<a href="https://siebertrservices.com/portal" style="display: inline-block; background: #0176d3; color: #fff; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 6px; text-decoration: none;">View Billing &amp; Receipts</a>`}
          ${invoice.invoicePdf ? `<a href="${esc(invoice.invoicePdf)}" style="display: inline-block; background: #fff; color: #0176d3; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 6px; text-decoration: none; border: 1px solid #0176d3;">Download PDF</a>` : ""}
        </div>

        <p style="font-size: 13px; color: #706e6b; margin: 0 0 4px;">Questions about this payment? Contact us:</p>
        <p style="font-size: 13px; margin: 0;">
          <a href="mailto:billing@siebertrservices.com" style="color: #0176d3;">billing@siebertrservices.com</a>
          &nbsp;·&nbsp;
          <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a>
        </p>
        <p style="font-size: 12px; color: #999; margin-top: 24px; border-top: 1px solid #e5e5e5; padding-top: 12px;">
          — Siebert Services Billing Team
        </p>
      </div>
    </div>
  `;

  return sendEmail(
    invoice.customerEmail,
    invoice.invoiceNumber
      ? `Payment Receipt — Invoice #${invoice.invoiceNumber}`
      : `Payment Receipt — ${amount} Paid`,
    html
  );
}

export async function sendClientWelcomeFromQuote(user: {
  name: string;
  email: string;
  company: string;
  temporaryPassword: string;
}) {
  const cfg = await loadEmailConfig();
  const portalUrl = process.env.CLIENT_PORTAL_URL || "https://siebertrservices.com";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Welcome to Siebert Services — Your Account Is Ready</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(user.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Thank you for submitting your quote request! We've automatically created a client portal account for you so you can track your quote, view proposals, and manage your services — all in one place.</p>
        <div style="background: #f4f6f9; border: 1px solid #d8dde6; border-radius: 4px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="font-size: 13px; font-weight: 700; color: #032d60; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.05em;">Your Login Credentials</p>
          <table style="font-size: 14px; border-collapse: collapse;">
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0; width: 90px;">Email:</td><td style="font-weight: 600;">${esc(user.email)}</td></tr>
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0;">Password:</td><td style="font-weight: 600;">${esc(user.temporaryPassword)}</td></tr>
          </table>
        </div>
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px 16px; margin: 0 0 20px;">
          <p style="font-size: 13px; color: #856404; margin: 0;"><strong>Security reminder:</strong> This is a temporary password. You will be prompted to change it when you first log in.</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(portalUrl)}" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 15px; font-weight: 700;">Log In to Client Portal</a>
        </div>
        <p style="font-size: 14px; margin: 0 0 4px;">Questions? Reach us at:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:support@siebertrservices.com" style="color: #0176d3;">support@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Team</p>
      </div>
    </div>
  `;

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Client Account Auto-Provisioned from Quote</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">A new client account was automatically created from a quote submission.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Name</td><td style="padding: 10px 12px; font-weight: 600;">${esc(user.name)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Email</td><td style="padding: 10px 12px;"><a href="mailto:${esc(user.email)}" style="color: #0176d3;">${esc(user.email)}</a></td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Company</td><td style="padding: 10px 12px;">${esc(user.company)}</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">The client has been emailed their temporary credentials.</p>
      </div>
    </div>
  `;

  await Promise.all([
    sendEmail(cfg.notificationEmail, `New Client Account: ${esc(user.name)} — ${esc(user.company)}`, adminHtml),
    sendEmail(user.email, "Welcome to Siebert Services — Your Account Is Ready", html),
  ]);
}

export async function sendClientWelcomeFromImport(user: {
  name: string;
  email: string;
  company: string;
  temporaryPassword: string;
}) {
  const cfg = await loadEmailConfig();
  const portalUrl = process.env.CLIENT_PORTAL_URL || "https://siebertrservices.com";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Welcome to Siebert Services — Your Account Is Ready</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(user.name)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Your Siebert Services client portal account has been created. Use the credentials below to log in, manage your services, view proposals, and access invoices — all in one place.</p>
        <div style="background: #f4f6f9; border: 1px solid #d8dde6; border-radius: 4px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="font-size: 13px; font-weight: 700; color: #032d60; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.05em;">Your Login Credentials</p>
          <table style="font-size: 14px; border-collapse: collapse;">
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0; width: 90px;">Email:</td><td style="font-weight: 600;">${esc(user.email)}</td></tr>
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0;">Password:</td><td style="font-weight: 600;">${esc(user.temporaryPassword)}</td></tr>
          </table>
        </div>
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px 16px; margin: 0 0 20px;">
          <p style="font-size: 13px; color: #856404; margin: 0;"><strong>Security reminder:</strong> This is a temporary password. You will be prompted to change it when you first log in.</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(portalUrl)}" style="display: inline-block; background: #0176d3; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 15px; font-weight: 700;">Log In to Client Portal</a>
        </div>
        <p style="font-size: 14px; margin: 0 0 4px;">Questions? Reach us at:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:support@siebertrservices.com" style="color: #0176d3;">support@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Team</p>
      </div>
    </div>
  `;

  await sendEmail(user.email, "Welcome to Siebert Services — Your Account Is Ready", html);
}

export async function sendPartnerSsoRegistrationNotification(partner: {
  companyName: string;
  contactName: string;
  email: string;
}) {
  const cfg = await loadEmailConfig();
  const adminPortalUrl = process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Partner SSO Self-Registration</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">A new partner has self-registered via Microsoft SSO and is pending approval.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; background: #f9f9f9; border-radius: 4px;">
          <tr><td style="padding: 10px 12px; color: #706e6b; width: 140px;">Company</td><td style="padding: 10px 12px; font-weight: 600;">${esc(partner.companyName)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Contact</td><td style="padding: 10px 12px;">${esc(partner.contactName)}</td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Email</td><td style="padding: 10px 12px;"><a href="mailto:${esc(partner.email)}" style="color: #0176d3;">${esc(partner.email)}</a></td></tr>
          <tr><td style="padding: 10px 12px; color: #706e6b;">Source</td><td style="padding: 10px 12px;">Microsoft SSO</td></tr>
        </table>
        <p style="font-size: 14px; margin: 16px 0 0;">Please log in to the admin panel to review and approve or reject this application.</p>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This is an automated notification from the Siebert Services Partner Portal.</p>
      </div>
    </div>
  `;

  await sendEmail(cfg.notificationEmail, `New Partner SSO Registration (Pending): ${esc(partner.companyName)}`, html);
}

export async function sendPartnerWelcomeFromImport(partner: {
  companyName: string;
  contactName: string;
  email: string;
  temporaryPassword: string;
}) {
  const portalUrl = process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #2e844a); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Welcome to the Siebert Services Partner Network</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Your partner account for <strong>${esc(partner.companyName)}</strong> has been created. Use the credentials below to access the Partner Portal.</p>
        <div style="background: #f4f6f9; border: 1px solid #d8dde6; border-radius: 4px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="font-size: 13px; font-weight: 700; color: #032d60; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.05em;">Your Login Credentials</p>
          <table style="font-size: 14px; border-collapse: collapse;">
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0; width: 90px;">Email:</td><td style="font-weight: 600;">${esc(partner.email)}</td></tr>
            <tr><td style="color: #706e6b; padding: 4px 12px 4px 0;">Password:</td><td style="font-weight: 600;">${esc(partner.temporaryPassword)}</td></tr>
          </table>
        </div>
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px 16px; margin: 0 0 20px;">
          <p style="font-size: 13px; color: #856404; margin: 0;"><strong>Security reminder:</strong> This is a temporary password. Please change it after your first login.</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(portalUrl)}" style="display: inline-block; background: #2e844a; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 15px; font-weight: 700;">Access Partner Portal</a>
        </div>
        <p style="font-size: 14px; margin: 0 0 4px;">Questions? Contact our partner team:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:partners@siebertrservices.com" style="color: #0176d3;">partners@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Partner Team</p>
      </div>
    </div>
  `;

  return sendEmail(partner.email, "Welcome to Siebert Services Partner Network — Your Account Is Ready", html);
}

export async function sendPartnerStripeOnboardingEmail(partner: {
  companyName: string;
  contactName: string;
  email: string;
}, onboardingUrl: string) {
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #2e844a); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Set Up Your Payout Account</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(partner.contactName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;">Great news — your partner account for <strong>${esc(partner.companyName)}</strong> has been approved! To receive commission payouts, please complete your Stripe Connect setup by clicking the button below.</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(onboardingUrl)}" style="display: inline-block; background: #635bff; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">Set Up Payouts</a>
        </div>
        <p style="font-size: 13px; color: #706e6b; margin: 0 0 4px;">This link is single-use and will expire soon. If it has expired, log in to the Partner Portal and connect Stripe from your Profile page.</p>
        <p style="font-size: 14px; margin: 16px 0 4px;">Questions? Contact us:</p>
        <ul style="font-size: 14px; margin: 8px 0 0; padding-left: 20px;">
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
          <li>Email: <a href="mailto:partners@siebertrservices.com" style="color: #0176d3;">partners@siebertrservices.com</a></li>
        </ul>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">— Siebert Services Partner Team</p>
      </div>
    </div>
  `;

  return sendEmail(partner.email, "Action Required: Set Up Your Commission Payout Account", html);
}

export async function sendContractEmail(params: {
  customerName: string;
  customerEmail: string;
  companyName: string;
  planName: string;
  billingCycle: string;
  pricePerUser: number;
  seats: number;
  subscriptionId: string;
  effectiveDate: Date;
  contractPdf: Buffer;
}) {
  const {
    customerName, customerEmail, companyName, planName,
    billingCycle, pricePerUser, seats, subscriptionId,
    effectiveDate, contractPdf,
  } = params;

  const cfg = await loadEmailConfig();
  const billingLabel = billingCycle === "annual" ? "Annual" : "Monthly";
  const intervalLabel = billingCycle === "annual" ? "year" : "month";
  const total = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(pricePerUser * seats);
  const dateStr = effectiveDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const refId = subscriptionId.replace("sub_", "").slice(0, 12).toUpperCase();
  const filename = `Siebert_Services_MSA_${refId}.pdf`;

  const customerHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #032d60; padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Your Managed Services Agreement</h1>
        <p style="color: #7ec8e3; margin: 6px 0 0; font-size: 13px;">Siebert Services LLC</p>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 28px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 15px; margin: 0 0 16px;">Hi ${esc(customerName)},</p>
        <p style="font-size: 14px; color: #333; margin: 0 0 20px;">
          Thank you for subscribing to Siebert Services! Your Managed Services Agreement is attached to this email as a PDF. Please keep it for your records.
        </p>

        <div style="background: #f5f7fa; border-left: 4px solid #0176d3; padding: 16px 20px; border-radius: 0 4px 4px 0; margin: 0 0 24px;">
          <p style="margin: 0 0 8px; font-size: 13px; color: #555; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Agreement Summary</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr><td style="padding: 4px 0; color: #777; width: 45%;">Agreement Reference</td><td style="color: #222; font-weight: 600;">MSA-${esc(refId)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Company</td><td style="color: #222; font-weight: 600;">${esc(companyName || customerName)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Service Plan</td><td style="color: #222; font-weight: 600;">${esc(planName)} Plan</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Billing Cycle</td><td style="color: #222; font-weight: 600;">${esc(billingLabel)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Seats (Users)</td><td style="color: #222; font-weight: 600;">${seats}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Total Charge</td><td style="color: #222; font-weight: 600;">${esc(total)} / ${esc(intervalLabel)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Effective Date</td><td style="color: #222; font-weight: 600;">${esc(dateStr)}</td></tr>
          </table>
        </div>

        <p style="font-size: 13px; color: #555; margin: 0 0 8px;">
          Your PDF contract is attached. By completing your subscription payment, you have agreed to the terms outlined in the Managed Services Agreement.
        </p>
        <p style="font-size: 13px; color: #555; margin: 0 0 24px;">
          Our team will reach out shortly to schedule your onboarding kickoff call and get your services activated within 5–10 business days.
        </p>

        <p style="font-size: 13px; color: #777; margin: 0 0 4px;">Questions? We're here to help:</p>
        <ul style="font-size: 13px; color: #555; margin: 6px 0 20px; padding-left: 20px;">
          <li>Email: <a href="mailto:support@siebertrservices.com" style="color: #0176d3;">support@siebertrservices.com</a></li>
          <li>Phone: <a href="tel:866-484-9180" style="color: #0176d3;">866-484-9180</a></li>
        </ul>

        <p style="font-size: 13px; color: #999; margin: 0;">— The Siebert Services Team</p>
      </div>
    </div>
  `;

  const adminHtml = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a472a; padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 17px;">New Subscription — MSA Generated</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">A new subscription has been activated and a Managed Services Agreement has been generated and emailed to the customer.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px;">
          <tr><td style="padding: 5px 0; color: #777; width: 40%;">Customer</td><td style="color: #222; font-weight: 600;">${esc(customerName)} &lt;${esc(customerEmail)}&gt;</td></tr>
          <tr><td style="padding: 5px 0; color: #777;">Company</td><td style="color: #222;">${esc(companyName || customerName)}</td></tr>
          <tr><td style="padding: 5px 0; color: #777;">Plan</td><td style="color: #222;">${esc(planName)} — ${esc(billingLabel)}</td></tr>
          <tr><td style="padding: 5px 0; color: #777;">Seats</td><td style="color: #222;">${seats}</td></tr>
          <tr><td style="padding: 5px 0; color: #777;">Total</td><td style="color: #222;">${esc(total)} / ${esc(intervalLabel)}</td></tr>
          <tr><td style="padding: 5px 0; color: #777;">Subscription ID</td><td style="color: #222; font-family: monospace; font-size: 12px;">${esc(subscriptionId)}</td></tr>
          <tr><td style="padding: 5px 0; color: #777;">Effective Date</td><td style="color: #222;">${esc(dateStr)}</td></tr>
        </table>
        <p style="font-size: 12px; color: #999; margin: 0;">The signed MSA PDF is attached for your records.</p>
      </div>
    </div>
  `;

  const attachment: EmailAttachment = {
    filename,
    content: contractPdf,
    contentType: "application/pdf",
  };

  const [customerSent, adminSent] = await Promise.allSettled([
    sendEmail(customerEmail, `Your Managed Services Agreement — ${planName} Plan`, customerHtml, [attachment]),
    sendEmail(cfg.notificationEmail, `[New Subscription] MSA — ${companyName || customerName} (${planName})`, adminHtml, [attachment]),
  ]);

  console.log(`[Contract] Customer email: ${(customerSent as PromiseFulfilledResult<boolean>).value ? "sent" : "failed"}, Admin email: ${(adminSent as PromiseFulfilledResult<boolean>).value ? "sent" : "failed"}`);
}

export async function sendEsignNotification(params: {
  to: string;
  adminName: string;
  documentName: string;
  envelopeId: number;
  eventType: "completed" | "declined" | "viewed";
  recipientName?: string;
}): Promise<boolean> {
  const { to, adminName, documentName, envelopeId, eventType, recipientName } = params;

  const portalUrl = process.env.PORTAL_URL || "https://siebertrservices.com/partners";
  const envelopeUrl = `${portalUrl}/admin/esign`;

  const eventLabels: Record<string, string> = {
    completed: "✅ Contract Fully Executed",
    declined:  "❌ Contract Declined",
    viewed:    "👁 Contract Viewed",
  };

  const eventMessages: Record<string, string> = {
    completed: `All parties have signed <strong>${esc(documentName)}</strong>. The executed PDF has been saved to the document store.`,
    declined:  `<strong>${esc(recipientName || "A signer")}</strong> declined to sign <strong>${esc(documentName)}</strong>.`,
    viewed:    `<strong>${esc(recipientName || "A signer")}</strong> has viewed <strong>${esc(documentName)}</strong>.`,
  };

  const subject = `${eventLabels[eventType] || "E-Sign Update"}: ${documentName}`;

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 17px;">${eventLabels[eventType] || "E-Sign Update"}</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(adminName)},</p>
        <p style="font-size: 14px; margin: 0 0 20px;">${eventMessages[eventType] || ""}</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${envelopeUrl}"
             style="background: #0176d3; color: #fff; padding: 12px 28px; border-radius: 6px;
                    text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
            View Envelope Details
          </a>
        </div>
        <p style="font-size: 12px; color: #999; margin: 0;">
          This is an automated notification from the Siebert Services Partner Portal.
        </p>
      </div>
    </div>`;

  return sendEmail(to, subject, html);
}

// ─── Subscription approval flow emails ───────────────────────────────────────

export async function sendSubscriptionPendingEmail(params: {
  customerName: string;
  customerEmail: string;
  planName: string;
  billingCycle: "monthly" | "annual";
  seats: number;
}): Promise<boolean> {
  const { customerName, customerEmail, planName, billingCycle, seats } = params;
  const billingLabel = billingCycle === "annual" ? "Annual" : "Monthly";
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #032d60; padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Signup Received — Under Review</h1>
        <p style="color: #7ec8e3; margin: 6px 0 0; font-size: 13px;">Siebert Services LLC</p>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 28px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 15px; margin: 0 0 16px;">Hi ${esc(customerName)},</p>
        <p style="font-size: 14px; color: #333; margin: 0 0 16px;">
          Thank you for signing up for Siebert Services! We've received your request and our team is reviewing your account.
        </p>
        <p style="font-size: 14px; color: #333; margin: 0 0 20px;">
          <strong>Your card has not been charged yet.</strong> We've placed a temporary pre-authorization hold on your payment method to reserve your spot. This hold will be released if your account is not approved, or converted to a payment once our team approves your application — typically within 1 business day.
        </p>
        <div style="background: #f5f7fa; border-left: 4px solid #0176d3; padding: 16px 20px; border-radius: 0 4px 4px 0; margin: 0 0 24px;">
          <p style="margin: 0 0 8px; font-size: 13px; color: #555; font-weight: bold; text-transform: uppercase;">Your Selected Plan</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr><td style="padding: 4px 0; color: #777; width: 45%;">Plan</td><td style="color: #222; font-weight: 600;">${esc(planName)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Billing</td><td style="color: #222; font-weight: 600;">${esc(billingLabel)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Seats</td><td style="color: #222; font-weight: 600;">${seats}</td></tr>
          </table>
        </div>
        <p style="font-size: 13px; color: #777;">
          Questions? Email us at <a href="mailto:hello@siebertrservices.com" style="color: #0176d3;">hello@siebertrservices.com</a>
        </p>
      </div>
    </div>`;
  return sendEmail(customerEmail, "Your Siebert Services signup is under review", html);
}

export async function sendSubscriptionApprovedEmail(params: {
  customerName: string;
  customerEmail: string;
  planName: string;
  billingCycle: "monthly" | "annual";
  seats: number;
  amount: number;
}): Promise<boolean> {
  const { customerName, customerEmail, planName, billingCycle, seats, amount } = params;
  const billingLabel = billingCycle === "annual" ? "Annual" : "Monthly";
  const intervalLabel = billingCycle === "annual" ? "year" : "month";
  const totalStr = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount * seats);
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #032d60; padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Your Account is Approved!</h1>
        <p style="color: #7ec8e3; margin: 6px 0 0; font-size: 13px;">Siebert Services LLC</p>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 28px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 15px; margin: 0 0 16px;">Hi ${esc(customerName)},</p>
        <p style="font-size: 14px; color: #333; margin: 0 0 16px;">
          Great news — your Siebert Services account has been approved and your subscription is now active! Your first payment has been processed and your Managed Services Agreement is attached.
        </p>
        <div style="background: #f0faf5; border-left: 4px solid #10b981; padding: 16px 20px; border-radius: 0 4px 4px 0; margin: 0 0 24px;">
          <p style="margin: 0 0 8px; font-size: 13px; color: #555; font-weight: bold; text-transform: uppercase;">Subscription Details</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr><td style="padding: 4px 0; color: #777; width: 45%;">Plan</td><td style="color: #222; font-weight: 600;">${esc(planName)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Billing</td><td style="color: #222; font-weight: 600;">${esc(billingLabel)}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Seats</td><td style="color: #222; font-weight: 600;">${seats}</td></tr>
            <tr><td style="padding: 4px 0; color: #777;">Amount Charged</td><td style="color: #222; font-weight: 600;">${esc(totalStr)} / ${esc(intervalLabel)}</td></tr>
          </table>
        </div>
        <p style="font-size: 14px; color: #333; margin: 0 0 16px;">
          Our team will reach out within 1–2 business days to schedule your onboarding kickoff and get your services activated.
        </p>
        <p style="font-size: 13px; color: #777;">
          Questions? Email us at <a href="mailto:hello@siebertrservices.com" style="color: #0176d3;">hello@siebertrservices.com</a>
        </p>
      </div>
    </div>`;
  return sendEmail(customerEmail, "You're approved! Your Siebert Services subscription is active", html);
}

export async function sendSubscriptionRejectedEmail(params: {
  customerName: string;
  customerEmail: string;
  planName: string;
  reason?: string;
}): Promise<boolean> {
  const { customerName, customerEmail, planName, reason } = params;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #032d60; padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Regarding Your Siebert Services Application</h1>
        <p style="color: #7ec8e3; margin: 6px 0 0; font-size: 13px;">Siebert Services LLC</p>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 28px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 15px; margin: 0 0 16px;">Hi ${esc(customerName)},</p>
        <p style="font-size: 14px; color: #333; margin: 0 0 16px;">
          Thank you for your interest in the Siebert Services ${esc(planName)} plan. After reviewing your application, we're unable to proceed with your account at this time.
        </p>
        ${reason ? `<p style="font-size: 14px; color: #555; margin: 0 0 16px;"><strong>Note:</strong> ${esc(reason)}</p>` : ""}
        <p style="font-size: 14px; color: #333; margin: 0 0 16px;">
          <strong>No charge has been made</strong> — the pre-authorization hold on your payment method has been fully released.
        </p>
        <p style="font-size: 14px; color: #333; margin: 0 0 24px;">
          If you have questions or believe this decision was made in error, please reach out to us directly.
        </p>
        <p style="font-size: 13px; color: #777;">
          Contact us at <a href="mailto:hello@siebertrservices.com" style="color: #0176d3;">hello@siebertrservices.com</a>
        </p>
      </div>
    </div>`;
  return sendEmail(customerEmail, "Update on your Siebert Services application", html);
}

// ─── Written Plan Email Helpers ──────────────────────────────────────────────

interface PlanReadyParams {
  clientName: string;
  clientEmail: string;
  company: string;
  planNumber: string;
  reviewUrl: string;
  expiresAt: Date;
  executiveSummary: string;
  personalNote?: string;
}

export interface SendEmailResult {
  ok: boolean;
  error?: "smtp_not_configured" | "smtp_error" | "template_error";
  errorMessage?: string;
}

export async function sendPlanReadyEmail(params: PlanReadyParams): Promise<SendEmailResult> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    console.error("[Email] sendPlanReadyEmail: SMTP credentials not configured (SMTP_USER / SMTP_PASS missing)");
    return { ok: false, error: "smtp_not_configured", errorMessage: "Email credentials are not configured on the server." };
  }

  const { clientName, clientEmail, company, planNumber, reviewUrl, expiresAt, executiveSummary, personalNote } = params;

  let html: string;
  try {
    const expiry = expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const summarySnippet = executiveSummary.length > 300 ? executiveSummary.slice(0, 297) + "…" : executiveSummary;
    html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Your IT Assessment Plan is Ready</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Prepared for ${esc(company)} · Plan ${esc(planNumber)}</p>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 4px 4px; background: #fff;">
        <p style="font-size: 15px; color: #111827; margin: 0 0 16px;">Hi ${esc(clientName)},</p>
        ${personalNote ? `<p style="font-size: 14px; color: #374151; margin: 0 0 20px; padding: 16px; background: #f0f9ff; border-left: 3px solid #0176d3; border-radius: 4px;">${esc(personalNote)}</p>` : ""}
        <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">Siebert Services has prepared a tailored IT Assessment Plan for <strong>${esc(company)}</strong>. Click the button below to review it, ask questions, or provide your approval.</p>
        ${summarySnippet ? `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px;"><p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px; font-weight: 600;">Executive Summary Preview</p><p style="color: #374151; font-size: 14px; margin: 0; line-height: 1.6;">${esc(summarySnippet)}</p></div>` : ""}
        <div style="text-align: center; margin: 24px 0;">
          <a href="${reviewUrl}" style="background: #0176d3; color: #fff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block;">Review Your Plan</a>
        </div>
        <p style="font-size: 13px; color: #6b7280; margin: 20px 0 0;">This plan is valid until <strong>${expiry}</strong>. After that date, you will need to request a new assessment.</p>
        <p style="font-size: 12px; color: #9ca3af; margin: 8px 0 0;">Or copy this link: <a href="${reviewUrl}" style="color: #0176d3; word-break: break-all;">${reviewUrl}</a></p>
      </div>
    </div>`;
  } catch (err: any) {
    console.error("[Email] sendPlanReadyEmail: template error:", err?.message || err);
    return { ok: false, error: "template_error", errorMessage: "Failed to build the email template." };
  }

  const sent = await sendEmail(clientEmail, `Your IT Assessment Plan is Ready — ${esc(company)}`, html);
  if (!sent) {
    return { ok: false, error: "smtp_error", errorMessage: "The mail server rejected the message or an SMTP error occurred." };
  }
  return { ok: true };
}

export async function sendPlanApprovedEmail(plan: {
  clientName: string; clientEmail: string; clientCompany: string;
  signerName: string | null; signerTitle: string | null;
  approvedAt: Date | null; planNumber: string; partnerId: number | null;
}, recipientEmail?: string): Promise<boolean> {
  const cfg = await loadEmailConfig();
  const to = recipientEmail || cfg.notificationEmail;
  const approvedAt = plan.approvedAt ? plan.approvedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "just now";
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Plan Approved ✓</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Plan ${esc(plan.planNumber)} · ${esc(plan.clientCompany)}</p>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 4px 4px; background: #fff;">
        <p style="font-size: 15px; color: #111827; margin: 0 0 20px;">Great news! A client has signed and approved their IT Assessment Plan.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;background:#f8fafc;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 16px;color:#6b7280;width:140px;">Client</td><td style="padding:10px 16px;font-weight:600;">${esc(plan.clientName)}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;">Company</td><td style="padding:10px 16px;">${esc(plan.clientCompany)}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;">Signed By</td><td style="padding:10px 16px;">${esc(plan.signerName || plan.clientName)}${plan.signerTitle ? `, ${esc(plan.signerTitle)}` : ""}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;">Approved At</td><td style="padding:10px 16px;">${approvedAt}</td></tr>
        </table>
        <p style="font-size: 13px; color: #6b7280; margin: 20px 0 0;">Log in to the Partner Portal to view the full signed plan and download a PDF copy.</p>
      </div>
    </div>`;
  return sendEmail(to, `Plan Approved: ${esc(plan.clientCompany)} — ${esc(plan.planNumber)}`, html);
}

export async function sendClientPortalWelcomeEmail(params: {
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  planNumber: string;
  dashboardUrl: string;
  onboardingUrl: string;
}): Promise<SendEmailResult> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    return { ok: false, error: "smtp_not_configured", errorMessage: "SMTP not configured." };
  }
  const { clientName, clientEmail, clientCompany, planNumber, dashboardUrl, onboardingUrl } = params;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 22px;">Welcome to Siebert Services</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 13px;">${esc(clientCompany)} · Plan ${esc(planNumber)}</p>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 4px 4px; background: #fff;">
        <p style="font-size: 15px; color: #111827; margin: 0 0 16px;">Hi ${esc(clientName)},</p>
        <p style="font-size: 14px; color: #374151; margin: 0 0 16px; line-height: 1.6;">
          Thank you for approving your IT Assessment Plan. To get started, please complete a short onboarding so our team can prepare your kickoff smoothly.
        </p>
        <div style="text-align: center; margin: 28px 0 20px;">
          <a href="${onboardingUrl}" style="background: #0176d3; color: #fff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block;">Start Onboarding</a>
        </div>
        <p style="font-size: 13px; color: #6b7280; margin: 20px 0 8px; text-align: center;">
          You can also access your client portal anytime:
        </p>
        <p style="font-size: 13px; text-align: center; margin: 0 0 20px;">
          <a href="${dashboardUrl}" style="color: #0176d3;">Open Client Portal →</a>
        </p>
        <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0; line-height: 1.5;">
          These links are tied to your account and valid for 30 days. If you ever need new ones, just reply to this email.
        </p>
      </div>
    </div>`;
  const sent = await sendEmail(clientEmail, `Welcome to Siebert Services — Let's get ${esc(clientCompany)} onboarded`, html);
  if (!sent) return { ok: false, error: "smtp_error", errorMessage: "Email delivery failed." };
  return { ok: true };
}

export async function sendClientOnboardingCompleteEmail(params: {
  clientName: string;
  clientCompany: string;
  planNumber: string;
  recipientEmail: string;
}): Promise<boolean> {
  const { clientName, clientCompany, planNumber, recipientEmail } = params;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Client Onboarding Complete ✓</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 13px;">${esc(clientCompany)} · Plan ${esc(planNumber)}</p>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 4px 4px; background: #fff;">
        <p style="font-size: 15px; color: #111827; margin: 0 0 16px;"><strong>${esc(clientName)}</strong> at <strong>${esc(clientCompany)}</strong> just completed their post-approval onboarding.</p>
        <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">Review their submitted contacts, billing details, and kickoff preferences in the Partner Portal to schedule next steps.</p>
      </div>
    </div>`;
  return sendEmail(recipientEmail, `Onboarding Complete: ${esc(clientCompany)} — ${esc(planNumber)}`, html);
}

export async function sendPlanCallRequestedEmail(plan: {
  clientName: string; clientEmail: string; clientCompany: string; planNumber: string;
}, recipientEmail?: string): Promise<boolean> {
  const cfg = await loadEmailConfig();
  const to = recipientEmail || cfg.notificationEmail;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Client Requesting a Call</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Plan ${esc(plan.planNumber)} · ${esc(plan.clientCompany)}</p>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 4px 4px; background: #fff;">
        <p style="font-size: 15px; color: #111827; margin: 0 0 16px;"><strong>${esc(plan.clientName)}</strong> at <strong>${esc(plan.clientCompany)}</strong> has reviewed their IT Assessment Plan and would like to schedule a call before making a decision.</p>
        <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">Reach out to them at <a href="mailto:${esc(plan.clientEmail)}" style="color:#0176d3;">${esc(plan.clientEmail)}</a> to schedule a conversation.</p>
        <p style="font-size: 13px; color: #6b7280; margin: 20px 0 0;">Log in to the Partner Portal to view the plan and take next steps.</p>
      </div>
    </div>`;
  return sendEmail(to, `Call Requested: ${esc(plan.clientCompany)} — ${esc(plan.planNumber)}`, html);
}

export async function sendPlanDeclinedEmail(plan: {
  clientName: string; clientEmail: string; clientCompany: string; planNumber: string;
}, reason: string, note?: string, recipientEmail?: string): Promise<boolean> {
  const cfg = await loadEmailConfig();
  const to = recipientEmail || cfg.notificationEmail;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Plan Declined</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Plan ${esc(plan.planNumber)} · ${esc(plan.clientCompany)}</p>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 4px 4px; background: #fff;">
        <p style="font-size: 15px; color: #111827; margin: 0 0 16px;"><strong>${esc(plan.clientName)}</strong> at <strong>${esc(plan.clientCompany)}</strong> has declined the IT Assessment Plan.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;background:#f8fafc;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 16px;color:#6b7280;width:100px;">Reason</td><td style="padding:10px 16px;">${esc(reason || "Not specified")}</td></tr>
          ${note ? `<tr><td style="padding:10px 16px;color:#6b7280;vertical-align:top;">Note</td><td style="padding:10px 16px;">${esc(note)}</td></tr>` : ""}
        </table>
        <p style="font-size: 14px; color: #374151; margin: 20px 0 0;">You can revise the plan and resend it from the Partner Portal, or reach out to ${esc(plan.clientName)} at <a href="mailto:${esc(plan.clientEmail)}" style="color:#0176d3;">${esc(plan.clientEmail)}</a> to follow up.</p>
      </div>
    </div>`;
  return sendEmail(to, `Plan Declined: ${esc(plan.clientCompany)} — ${esc(plan.planNumber)}`, html);
}

export async function sendPlanExpiringEmail(plan: {
  clientName: string; clientEmail: string; clientCompany: string;
  planNumber: string; expiresAt: Date | null; partnerId: number | null;
}, recipientEmail?: string): Promise<boolean> {
  const cfg = await loadEmailConfig();
  const to = recipientEmail || cfg.notificationEmail;
  const expiry = plan.expiresAt ? plan.expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "soon";
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Plan Expiring Soon</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Plan ${esc(plan.planNumber)} · ${esc(plan.clientCompany)}</p>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 4px 4px; background: #fff;">
        <p style="font-size: 15px; color: #111827; margin: 0 0 16px;">The IT Assessment Plan for <strong>${esc(plan.clientCompany)}</strong> has not been signed yet and will expire on <strong>${expiry}</strong>.</p>
        <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">Consider following up with ${esc(plan.clientName)} at <a href="mailto:${esc(plan.clientEmail)}" style="color:#0176d3;">${esc(plan.clientEmail)}</a> to prompt a decision before the plan expires.</p>
        <p style="font-size: 13px; color: #6b7280; margin: 20px 0 0;">Log in to the Partner Portal to resend, revise, or extend the plan.</p>
      </div>
    </div>`;
  return sendEmail(to, `Plan Expiring ${expiry}: ${esc(plan.clientCompany)} — ${esc(plan.planNumber)}`, html);
}

export async function sendPartnerTeamInviteEmail(args: {
  to: string;
  inviteeName: string;
  inviterName: string;
  companyName: string;
  inviteToken: string;
}): Promise<boolean> {
  const portalBase = process.env.PARTNER_PORTAL_URL
    ? process.env.PARTNER_PORTAL_URL.replace(/\/$/, "")
    : (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/partners` : "https://siebertrservices.com/partners");
  const acceptUrl = `${portalBase}/team/accept/${args.inviteToken}`;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 20px 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">You've been invited to ${esc(args.companyName)}</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; margin: 0 0 16px;">Hi ${esc(args.inviteeName)},</p>
        <p style="font-size: 14px; margin: 0 0 16px;"><strong>${esc(args.inviterName)}</strong> has invited you to join the Siebert Services Partner Portal as part of the <strong>${esc(args.companyName)}</strong> team.</p>
        <p style="font-size: 14px; margin: 0 0 16px;">To accept this invitation, sign in with your Microsoft work account using the button below. Your portal access begins immediately after sign-in.</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${esc(acceptUrl)}" style="background: #0176d3; color: #fff; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: 600; display: inline-block;">Accept Invitation</a>
        </div>
        <p style="font-size: 13px; color: #706e6b; margin: 0 0 8px;">Or paste this link into your browser:</p>
        <p style="font-size: 13px; word-break: break-all; margin: 0 0 16px;"><a href="${esc(acceptUrl)}" style="color: #0176d3;">${esc(acceptUrl)}</a></p>
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px 16px; margin: 16px 0;">
          <p style="font-size: 13px; color: #856404; margin: 0;"><strong>Note:</strong> Sign in must use your Microsoft work account that matches <strong>${esc(args.to)}</strong>. This invitation expires in 14 days.</p>
        </div>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">If you didn't expect this invitation, you can safely ignore this email.</p>
      </div>
    </div>`;
  return sendEmail(args.to, `You've been invited to ${args.companyName} on Siebert Services`, html);
}

// ─── Built-in E-Sign: Signing Invitation ─────────────────────────────────────

export async function sendEsignInvite(params: {
  to: string;
  signerName: string;
  documentName: string;
  subject?: string;
  message?: string;
  signingUrl: string;
}): Promise<boolean> {
  const { to, signerName, documentName, subject, message, signingUrl } = params;

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #032d60, #0176d3); padding: 24px; border-radius: 4px 4px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">Please sign: ${esc(documentName)}</h1>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; padding: 28px; border-radius: 0 0 4px 4px;">
        <p style="font-size: 14px; color: #374151; margin: 0 0 12px;">Hi ${esc(signerName)},</p>
        <p style="font-size: 14px; color: #374151; margin: 0 0 20px;">
          Siebert Services has sent you a document for your electronic signature.
        </p>
        ${message ? `<div style="background:#f0f7ff;border-left:4px solid #0176d3;padding:12px 16px;margin-bottom:20px;border-radius:0 6px 6px 0;font-size:13px;color:#1e3a5f;">${esc(message)}</div>` : ""}
        <div style="text-align: center; margin: 28px 0;">
          <a href="${signingUrl}"
             style="background: #0176d3; color: #fff; padding: 14px 32px; border-radius: 8px;
                    text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block;">
            Review &amp; Sign Document
          </a>
        </div>
        <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0 0 8px;">
          This link is unique to you. Do not share it.
        </p>
        <p style="font-size: 12px; color: #d1d5db; text-align: center; margin: 0;">
          Or copy: <span style="color: #6b7280;">${signingUrl}</span>
        </p>
      </div>
    </div>`;

  return sendEmail(to, subject || `Please sign: ${documentName}`, html);
}
