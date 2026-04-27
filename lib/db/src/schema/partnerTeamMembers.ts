import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";

export const partnerTeamMemberStatusEnum = pgEnum("partner_team_member_status", [
  "pending",
  "active",
  "revoked",
]);

export const partnerTeamMembersTable = pgTable(
  "partner_team_members",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    status: partnerTeamMemberStatusEnum("status").notNull().default("pending"),

    ssoProvider: text("sso_provider"),
    ssoId: text("sso_id"),

    inviteToken: text("invite_token"),
    inviteTokenExpires: timestamp("invite_token_expires"),

    canViewDeals: boolean("can_view_deals").notNull().default(true),
    canCreateDeals: boolean("can_create_deals").notNull().default(false),
    canViewLeads: boolean("can_view_leads").notNull().default(true),
    canCreateLeads: boolean("can_create_leads").notNull().default(false),
    canViewCommissions: boolean("can_view_commissions").notNull().default(false),
    canViewResources: boolean("can_view_resources").notNull().default(true),
    canCreatePlans: boolean("can_create_plans").notNull().default(false),

    invitedAt: timestamp("invited_at").notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at"),
    lastLoginAt: timestamp("last_login_at"),
    // Reminder tracking for the Onboarding Command Center
    lastReminderSentAt: timestamp("last_reminder_sent_at"),
    reminderCount: integer("reminder_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // Email is globally unique across all partner team rosters so SSO callback
    // can resolve the inviting partner unambiguously by email alone.
    emailIdx: uniqueIndex("partner_team_members_email_uq").on(table.email),
  }),
);

export type PartnerTeamMember = typeof partnerTeamMembersTable.$inferSelect;
export type InsertPartnerTeamMember = typeof partnerTeamMembersTable.$inferInsert;
