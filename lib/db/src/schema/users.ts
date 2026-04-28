import { pgTable, text, serial, timestamp, pgEnum, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["client", "admin"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  company: text("company").notNull(),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("client"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  ssoProvider: text("sso_provider"),
  ssoId: text("sso_id"),
  stripeCustomerId: text("stripe_customer_id"),
  resetToken: text("reset_token"),
  resetTokenExpires: timestamp("reset_token_expires"),
  msObjectId: text("ms_object_id"),
  // Microsoft SSO (Entra B2B) invite lifecycle for the admin-controlled
  // "Send Microsoft SSO invite" action. ssoInviteSentBy stores a human
  // label (e.g. "admin@example.com" or "Acme Co (partner)") so we don't
  // need a polymorphic FK across users/partners.
  ssoInviteSentAt: timestamp("sso_invite_sent_at"),
  ssoInviteSentBy: text("sso_invite_sent_by"),
  lastLoginAt: timestamp("last_login_at"),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiresAt: timestamp("email_verification_expires_at"),
  emailVerifiedAt: timestamp("email_verified_at"),
  // Admin/employee onboarding lifecycle tracking
  invitationSentAt: timestamp("invitation_sent_at"),
  lastWelcomeSentAt: timestamp("last_welcome_sent_at"),
  welcomeReminderCount: integer("welcome_reminder_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, role: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
