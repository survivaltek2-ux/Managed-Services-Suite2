import { and, eq, isNull, lte } from "drizzle-orm";
import nodemailer from "nodemailer";
import {
  db,
  crmTasksTable,
  crmActivitiesTable,
  usersTable,
} from "@workspace/db";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

let timer: NodeJS.Timeout | null = null;

export function startCrmTaskReminderScheduler(): void {
  if (timer) return;
  setTimeout(() => { void runOnce().catch((e) => console.error("[CrmTaskReminders] startup tick:", e)); }, STARTUP_DELAY_MS);
  timer = setInterval(() => { void runOnce().catch((e) => console.error("[CrmTaskReminders] tick:", e)); }, CHECK_INTERVAL_MS);
  console.log(`[CrmTaskReminders] scheduler started (every ${CHECK_INTERVAL_MS / 60000}min)`);
}

export function stopCrmTaskReminderScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function runOnce(): Promise<void> {
  const now = new Date();
  const due = await db
    .select({
      id: crmTasksTable.id,
      title: crmTasksTable.title,
      description: crmTasksTable.description,
      dueAt: crmTasksTable.dueAt,
      priority: crmTasksTable.priority,
      ownerUserId: crmTasksTable.ownerUserId,
      contactId: crmTasksTable.contactId,
      companyId: crmTasksTable.companyId,
      dealId: crmTasksTable.dealId,
      ownerEmail: usersTable.email,
      ownerName: usersTable.name,
    })
    .from(crmTasksTable)
    .leftJoin(usersTable, eq(crmTasksTable.ownerUserId, usersTable.id))
    .where(
      and(
        eq(crmTasksTable.status, "open"),
        lte(crmTasksTable.dueAt, now),
        isNull(crmTasksTable.reminderSentAt),
      ),
    )
    .limit(100);

  if (due.length === 0) return;
  console.log(`[CrmTaskReminders] processing ${due.length} due task(s)`);

  for (const t of due) {
    try {
      // 1) Always create an in-app notification activity so the task surfaces
      //    on the related contact/company/deal timeline regardless of email.
      await db.insert(crmActivitiesTable).values({
        type: "task",
        subject: `Task due: ${t.title}`,
        body: t.description ?? null,
        ownerUserId: t.ownerUserId,
        contactId: t.contactId ?? null,
        companyId: t.companyId ?? null,
        dealId: t.dealId ?? null,
        occurredAt: now,
      });

      // 2) Email the owner if address + SMTP creds are present (best-effort).
      if (t.ownerEmail) {
        await sendTaskReminderEmail({
          to: t.ownerEmail,
          ownerName: t.ownerName ?? "there",
          title: t.title,
          description: t.description,
          dueAt: t.dueAt,
          priority: t.priority,
        }).catch((e) => console.error(`[CrmTaskReminders] send email task=${t.id}:`, e));
      }

      // 3) Mark idempotent so we don't repeat.
      await db.update(crmTasksTable)
        .set({ reminderSentAt: now })
        .where(eq(crmTasksTable.id, t.id));
    } catch (err) {
      console.error(`[CrmTaskReminders] task ${t.id} failed:`, err);
    }
  }
}

async function sendTaskReminderEmail(args: {
  to: string;
  ownerName: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  priority: string;
}): Promise<void> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return;
  const SMTP_HOST = process.env.SMTP_HOST || "smtp-relay.brevo.com";
  const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
  const fromName = process.env.SMTP_FROM_NAME || "Siebert Services CRM";
  const fromAddress = process.env.SMTP_FROM_EMAIL || smtpUser;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT !== 465,
    auth: { user: smtpUser, pass: smtpPass },
    tls: { minVersion: "TLSv1.2" },
  });
  const dueStr = args.dueAt ? new Date(args.dueAt).toLocaleString("en-US") : "now";
  const subject = `[CRM] Task reminder: ${args.title}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;">
      <p>Hi ${esc(args.ownerName)},</p>
      <p>A task you own is due:</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Task</td><td><strong>${esc(args.title)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Due</td><td>${esc(dueStr)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Priority</td><td>${esc(args.priority)}</td></tr>
      </table>
      ${args.description ? `<p style="margin-top:12px;">${esc(args.description).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="margin-top:18px;color:#666;font-size:12px;">— Siebert Services CRM</p>
    </div>
  `;
  await transport.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to: args.to,
    subject,
    html,
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
