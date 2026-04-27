import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const clientPortalTokensTable = pgTable("client_portal_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  partnerId: integer("partner_id"),
  planId: integer("plan_id"),
  clientEmail: text("client_email").notNull(),
  clientName: text("client_name").notNull(),
  clientCompany: text("client_company").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clientOnboardingTable = pgTable("client_onboarding", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id"),
  planId: integer("plan_id"),
  clientEmail: text("client_email").notNull(),
  clientCompany: text("client_company").notNull(),
  status: text("status").notNull().default("in_progress"),
  currentStep: text("current_step").notNull().default("welcome"),
  stepData: jsonb("step_data").notNull().default("{}"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  // Reminder tracking for the Onboarding Command Center
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  reminderCount: integer("reminder_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ClientPortalToken = typeof clientPortalTokensTable.$inferSelect;
export type ClientOnboarding = typeof clientOnboardingTable.$inferSelect;
