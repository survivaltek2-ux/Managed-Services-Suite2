import { pgTable, text, serial, timestamp, integer, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Audit events for the Azure AD authorization layer. Every access decision
 * (allow / deny / would-deny in audit mode), every login surface, every
 * SCIM provisioning event, and every admin app-role assignment lands here.
 * Records are immutable and the `forwardedAt` column is set once a mirror
 * has been pushed to the configured external sink (e.g. Sentinel webhook).
 */
export const azureAdEventsTable = pgTable("azure_ad_events", {
  id: serial("id").primaryKey(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  eventType: text("event_type").notNull(),
  email: text("email"),
  azureOid: text("azure_oid"),
  source: text("source").notNull(),
  decision: text("decision").notNull().default("info"),
  reason: text("reason"),
  rolloutMode: text("rollout_mode"),
  details: jsonb("details").notNull().default({}),
  forwardedAt: timestamp("forwarded_at"),
  forwardError: text("forward_error"),
}, (t) => ({
  emailIdx: index("azure_ad_events_email_idx").on(t.email),
  occurredIdx: index("azure_ad_events_occurred_idx").on(t.occurredAt),
}));

/**
 * Bearer tokens that authenticate the configured Azure AD provisioning
 * endpoint when it talks to our SCIM 2.0 server. Tokens are stored hashed.
 * `lastSeenAt` is updated by the SCIM router so admins can confirm the
 * connector is alive.
 */
export const azureAdScimTokensTable = pgTable("azure_ad_scim_tokens", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPreview: text("token_preview").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at"),
  revokedAt: timestamp("revoked_at"),
}, (t) => ({
  tokenHashIdx: uniqueIndex("azure_ad_scim_tokens_hash_uq").on(t.tokenHash),
}));

/**
 * Maps an Azure AD security/M365 group object id onto a specific partner
 * company. When a directory pull or SCIM update reports that a user's group
 * membership added/removed the group, the user is added to or revoked from
 * that partner's team roster automatically.
 */
export const azureAdGroupBindingsTable = pgTable("azure_ad_group_bindings", {
  id: serial("id").primaryKey(),
  groupOid: text("group_oid").notNull(),
  groupDisplayName: text("group_display_name").notNull().default(""),
  partnerId: integer("partner_id").notNull(),
  isCompanyAdmin: boolean("is_company_admin").notNull().default(false),
  permissionsJson: jsonb("permissions_json").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  groupPartnerIdx: uniqueIndex("azure_ad_group_bindings_uq").on(t.groupOid, t.partnerId),
}));

/**
 * Server-side revocation list for issued JWTs. When a partner-portal admin
 * or Azure-side app-role removal demands an instant kill, we insert the
 * token's jti here so the auth middleware refuses it on the very next
 * request. Old rows are pruned after `expiresAt`.
 */
export const azureAdRevokedSessionsTable = pgTable("azure_ad_revoked_sessions", {
  id: serial("id").primaryKey(),
  jti: text("jti").notNull(),
  reason: text("reason").notNull().default("manual"),
  revokedAt: timestamp("revoked_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
}, (t) => ({
  jtiIdx: uniqueIndex("azure_ad_revoked_sessions_jti_uq").on(t.jti),
}));

/**
 * Singleton row that tracks global security actions such as
 * "revoke all sessions issued before timestamp X".  Keyed by `key`
 * with only one row per key (the middleware only ever reads key = 'main').
 */
export const securitySettingsTable = pgTable("security_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  sessionsRevokedBefore: timestamp("sessions_revoked_before"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id"),
  updatedByEmail: text("updated_by_email"),
});

export type AzureAdEvent = typeof azureAdEventsTable.$inferSelect;
export type AzureAdScimToken = typeof azureAdScimTokensTable.$inferSelect;
export type AzureAdGroupBinding = typeof azureAdGroupBindingsTable.$inferSelect;
export type AzureAdRevokedSession = typeof azureAdRevokedSessionsTable.$inferSelect;
export type SecuritySettings = typeof securitySettingsTable.$inferSelect;
