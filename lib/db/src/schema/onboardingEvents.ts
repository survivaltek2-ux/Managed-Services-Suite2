import { pgTable, text, serial, timestamp, integer, jsonb, index, boolean } from "drizzle-orm/pg-core";

/**
 * Unified event log across all five onboarding flows in the
 * Onboarding Command Center. Each row captures a single state-changing
 * action so admins can audit "what happened to this entity".
 *
 * `flow` values: 'client_onboarding' | 'partner_application'
 *               | 'partner_team_invite' | 'stripe_connect'
 *               | 'admin_account'
 *
 * `entityId` references the row in the corresponding source table
 * (clientOnboardingTable.id, partnersTable.id, partnerTeamMembersTable.id,
 * partnersTable.id (for stripe_connect), or usersTable.id).
 */
export const onboardingEventsTable = pgTable(
  "onboarding_events",
  {
    id: serial("id").primaryKey(),
    flow: text("flow").notNull(),
    entityId: integer("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull().default("system"), // 'system' | 'admin' | 'partner' | 'client'
    actorId: integer("actor_id"),
    actorLabel: text("actor_label"),
    note: text("note"),
    payload: jsonb("payload").notNull().default("{}"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    flowEntityIdx: index("onboarding_events_flow_entity_idx").on(table.flow, table.entityId, table.createdAt),
    createdIdx: index("onboarding_events_created_idx").on(table.createdAt),
  }),
);

export type OnboardingEvent = typeof onboardingEventsTable.$inferSelect;
export type InsertOnboardingEvent = typeof onboardingEventsTable.$inferInsert;

/**
 * Singleton settings row controlling the Onboarding Command Center —
 * notably the global pause flag and reminder thresholds.
 * Always select the lowest id; writes upsert id=1.
 */
export const onboardingSettingsTable = pgTable("onboarding_settings", {
  id: serial("id").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  // Hours after which a stalled item is considered overdue
  clientOnboardingOverdueHours: integer("client_onboarding_overdue_hours").notNull().default(72),
  partnerApplicationOverdueHours: integer("partner_application_overdue_hours").notNull().default(48),
  partnerTeamInviteOverdueHours: integer("partner_team_invite_overdue_hours").notNull().default(72),
  stripeConnectOverdueHours: integer("stripe_connect_overdue_hours").notNull().default(72),
  adminAccountOverdueHours: integer("admin_account_overdue_hours").notNull().default(72),
  // Cooldown between automated reminders for the same entity (hours)
  reminderCooldownHours: integer("reminder_cooldown_hours").notNull().default(48),
  // Maximum automated reminders per entity (manual sends still allowed)
  maxRemindersPerEntity: integer("max_reminders_per_entity").notNull().default(3),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OnboardingSettings = typeof onboardingSettingsTable.$inferSelect;
