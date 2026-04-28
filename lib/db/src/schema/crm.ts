import { pgTable, text, serial, timestamp, integer, boolean, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const crmEntityEnum = pgEnum("crm_entity_kind", ["contact", "company", "deal", "lead"]);
export const crmActivityTypeEnum = pgEnum("crm_activity_type", ["note", "call", "email", "meeting", "task"]);
export const crmTaskPriorityEnum = pgEnum("crm_task_priority", ["low", "medium", "high", "urgent"]);
export const crmTaskStatusEnum = pgEnum("crm_task_status", ["open", "done", "snoozed"]);
export const crmCustomFieldTypeEnum = pgEnum("crm_custom_field_type", ["text", "number", "date", "select"]);

// ─── Companies ───────────────────────────────────────────────────────────────

export const crmCompaniesTable = pgTable("crm_companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  website: text("website"),
  phone: text("phone"),
  industry: text("industry"),
  size: text("size"),
  street: text("street"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country"),
  notes: text("notes"),
  source: text("source"),
  assignedUserId: integer("assigned_user_id").references(() => usersTable.id),
  partnerId: integer("partner_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqNormalizedName: uniqueIndex("crm_companies_normalized_name_uniq").on(t.normalizedName),
  nameIdx: index("crm_companies_name_idx").on(t.name),
}));

// ─── Contacts ────────────────────────────────────────────────────────────────

export const crmContactsTable = pgTable("crm_contacts", {
  id: serial("id").primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name").notNull(),
  email: text("email"),
  normalizedEmail: text("normalized_email"),
  phone: text("phone"),
  title: text("title"),
  companyId: integer("company_id").references(() => crmCompaniesTable.id),
  source: text("source"),
  notes: text("notes"),
  score: integer("score").notNull().default(0),
  assignedUserId: integer("assigned_user_id").references(() => usersTable.id),
  lifecycleStage: text("lifecycle_stage").notNull().default("lead"), // lead | mql | sql | customer | other
  unsubscribedAt: timestamp("unsubscribed_at"),
  lastActivityAt: timestamp("last_activity_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqNormalizedEmail: uniqueIndex("crm_contacts_normalized_email_uniq").on(t.normalizedEmail),
  fullNameIdx: index("crm_contacts_full_name_idx").on(t.fullName),
  companyIdx: index("crm_contacts_company_idx").on(t.companyId),
}));

// ─── Activities (notes/calls/emails/meetings) ────────────────────────────────

export const crmActivitiesTable = pgTable("crm_activities", {
  id: serial("id").primaryKey(),
  type: crmActivityTypeEnum("type").notNull(),
  subject: text("subject"),
  body: text("body"),
  outcome: text("outcome"),
  durationMinutes: integer("duration_minutes"),
  contactId: integer("contact_id").references(() => crmContactsTable.id),
  companyId: integer("company_id").references(() => crmCompaniesTable.id),
  dealId: integer("deal_id"),
  leadId: integer("lead_id"),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  contactIdx: index("crm_activities_contact_idx").on(t.contactId),
  companyIdx: index("crm_activities_company_idx").on(t.companyId),
  dealIdx: index("crm_activities_deal_idx").on(t.dealId),
  ownerIdx: index("crm_activities_owner_idx").on(t.ownerUserId),
  occurredAtIdx: index("crm_activities_occurred_idx").on(t.occurredAt),
}));

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const crmTasksTable = pgTable("crm_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  dueAt: timestamp("due_at"),
  priority: crmTaskPriorityEnum("priority").notNull().default("medium"),
  status: crmTaskStatusEnum("status").notNull().default("open"),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id),
  contactId: integer("contact_id").references(() => crmContactsTable.id),
  companyId: integer("company_id").references(() => crmCompaniesTable.id),
  dealId: integer("deal_id"),
  leadId: integer("lead_id"),
  reminderSentAt: timestamp("reminder_sent_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("crm_tasks_owner_idx").on(t.ownerUserId),
  dueIdx: index("crm_tasks_due_idx").on(t.dueAt),
  statusIdx: index("crm_tasks_status_idx").on(t.status),
}));

// ─── Pipelines + stages ──────────────────────────────────────────────────────

export const crmPipelinesTable = pgTable("crm_pipelines", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const crmPipelineStagesTable = pgTable("crm_pipeline_stages", {
  id: serial("id").primaryKey(),
  pipelineId: integer("pipeline_id").notNull().references(() => crmPipelinesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
  color: text("color"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqPipelineSlug: uniqueIndex("crm_pipeline_stages_pipeline_slug_uniq").on(t.pipelineId, t.slug),
}));

// ─── Tags ────────────────────────────────────────────────────────────────────

export const crmTagsTable = pgTable("crm_tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#0176d3"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const crmContactTagsTable = pgTable("crm_contact_tags", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => crmContactsTable.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => crmTagsTable.id, { onDelete: "cascade" }),
}, (t) => ({
  uniq: uniqueIndex("crm_contact_tags_uniq").on(t.contactId, t.tagId),
}));

export const crmCompanyTagsTable = pgTable("crm_company_tags", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => crmCompaniesTable.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => crmTagsTable.id, { onDelete: "cascade" }),
}, (t) => ({
  uniq: uniqueIndex("crm_company_tags_uniq").on(t.companyId, t.tagId),
}));

export const crmDealTagsTable = pgTable("crm_deal_tags", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull(),
  tagId: integer("tag_id").notNull().references(() => crmTagsTable.id, { onDelete: "cascade" }),
}, (t) => ({
  uniq: uniqueIndex("crm_deal_tags_uniq").on(t.dealId, t.tagId),
}));

// ─── Custom fields ───────────────────────────────────────────────────────────

export const crmCustomFieldsTable = pgTable("crm_custom_fields", {
  id: serial("id").primaryKey(),
  entity: crmEntityEnum("entity").notNull(),
  label: text("label").notNull(),
  key: text("key").notNull(),
  type: crmCustomFieldTypeEnum("type").notNull().default("text"),
  options: jsonb("options").default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqEntityKey: uniqueIndex("crm_custom_fields_entity_key_uniq").on(t.entity, t.key),
}));

export const crmCustomFieldValuesTable = pgTable("crm_custom_field_values", {
  id: serial("id").primaryKey(),
  fieldId: integer("field_id").notNull().references(() => crmCustomFieldsTable.id, { onDelete: "cascade" }),
  entity: crmEntityEnum("entity").notNull(),
  entityId: integer("entity_id").notNull(),
  value: text("value"),
}, (t) => ({
  uniqFieldEntity: uniqueIndex("crm_custom_field_values_uniq").on(t.fieldId, t.entity, t.entityId),
  entityIdx: index("crm_custom_field_values_entity_idx").on(t.entity, t.entityId),
}));

// ─── Saved views ─────────────────────────────────────────────────────────────

export const crmSavedViewsTable = pgTable("crm_saved_views", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(), // contact|company|lead|deal|task|activity
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default({}),
  shared: boolean("shared").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  ownerEntityIdx: index("crm_saved_views_owner_entity_idx").on(t.ownerUserId, t.entity),
}));

// ─── Schemas + types ─────────────────────────────────────────────────────────

export const insertCrmContactSchema = createInsertSchema(crmContactsTable).omit({
  id: true, createdAt: true, updatedAt: true, normalizedEmail: true, fullName: true,
});
export const insertCrmCompanySchema = createInsertSchema(crmCompaniesTable).omit({
  id: true, createdAt: true, updatedAt: true, normalizedName: true,
});
export const insertCrmActivitySchema = createInsertSchema(crmActivitiesTable).omit({ id: true, createdAt: true });
export const insertCrmTaskSchema = createInsertSchema(crmTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCrmPipelineSchema = createInsertSchema(crmPipelinesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCrmPipelineStageSchema = createInsertSchema(crmPipelineStagesTable).omit({ id: true, createdAt: true });
export const insertCrmTagSchema = createInsertSchema(crmTagsTable).omit({ id: true, createdAt: true });
export const insertCrmCustomFieldSchema = createInsertSchema(crmCustomFieldsTable).omit({ id: true, createdAt: true });
export const insertCrmSavedViewSchema = createInsertSchema(crmSavedViewsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type CrmContact = typeof crmContactsTable.$inferSelect;
export type CrmCompany = typeof crmCompaniesTable.$inferSelect;
export type CrmActivity = typeof crmActivitiesTable.$inferSelect;
export type CrmTask = typeof crmTasksTable.$inferSelect;
export type CrmPipeline = typeof crmPipelinesTable.$inferSelect;
export type CrmPipelineStage = typeof crmPipelineStagesTable.$inferSelect;
export type CrmTag = typeof crmTagsTable.$inferSelect;
export type CrmCustomField = typeof crmCustomFieldsTable.$inferSelect;
export type CrmCustomFieldValue = typeof crmCustomFieldValuesTable.$inferSelect;
export type CrmSavedView = typeof crmSavedViewsTable.$inferSelect;

export type InsertCrmContact = z.infer<typeof insertCrmContactSchema>;
export type InsertCrmCompany = z.infer<typeof insertCrmCompanySchema>;
export type InsertCrmActivity = z.infer<typeof insertCrmActivitySchema>;
export type InsertCrmTask = z.infer<typeof insertCrmTaskSchema>;
