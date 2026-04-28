import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const partnerTierEnum = pgEnum("partner_tier", ["registered", "silver", "gold", "platinum"]);
export const partnerStatusEnum = pgEnum("partner_status", ["pending", "approved", "rejected", "suspended"]);
export const dealStatusEnum = pgEnum("deal_status", ["registered", "in_progress", "won", "lost", "expired"]);
export const dealStageEnum = pgEnum("deal_stage", ["prospect", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]);
export const resourceTypeEnum = pgEnum("resource_type", ["pdf", "video", "link", "image", "presentation"]);
export const resourceCategoryEnum = pgEnum("resource_category", ["marketing", "sales", "technical", "training", "zoom", "general"]);
export const certStatusEnum = pgEnum("cert_status", ["not_started", "in_progress", "completed", "expired"]);
export const leadStatusEnum = pgEnum("lead_status_partner", ["new", "contacted", "qualified", "converted", "lost"]);

export const partnersTable = pgTable("partners", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  phone: text("phone"),
  website: text("website"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").notNull().default("US"),
  businessType: text("business_type"),
  yearsInBusiness: text("years_in_business"),
  employeeCount: text("employee_count"),
  annualRevenue: text("annual_revenue"),
  specializations: text("specializations").notNull().default("[]"),
  tier: partnerTierEnum("tier").notNull().default("registered"),
  status: partnerStatusEnum("status").notNull().default("pending"),
  totalDeals: integer("total_deals").notNull().default(0),
  totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }).notNull().default("0"),
  ytdRevenue: decimal("ytd_revenue", { precision: 12, scale: 2 }).notNull().default("0"),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull().default("10.00"),
  ssoProvider: text("sso_provider"),
  ssoId: text("sso_id"),
  isAdmin: boolean("is_admin").notNull().default(false),
  clientTicketsEnabled: boolean("client_tickets_enabled").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  lastStripeReminderSentAt: timestamp("last_stripe_reminder_sent_at"),
  // Cached Stripe Connect status (refreshed by Onboarding Command Center)
  stripeConnectStatus: text("stripe_connect_status"), // 'not_started'|'in_progress'|'restricted'|'complete'|'invalid'
  stripeConnectBlockingRequirement: text("stripe_connect_blocking_requirement"),
  stripeConnectRefreshedAt: timestamp("stripe_connect_refreshed_at"),
  // Partner application reminder tracking
  lastApplicationReminderSentAt: timestamp("last_application_reminder_sent_at"),
  applicationReminderCount: integer("application_reminder_count").notNull().default(0),
  stripeReminderCount: integer("stripe_reminder_count").notNull().default(0),
  approvedAt: timestamp("approved_at"),
  resetToken: text("reset_token"),
  resetTokenExpires: timestamp("reset_token_expires"),
  msObjectId: text("ms_object_id"),
  // Microsoft SSO (Entra B2B) invite lifecycle for the admin-controlled
  // "Send Microsoft SSO invite" action.
  ssoInviteSentAt: timestamp("sso_invite_sent_at"),
  ssoInviteSentBy: text("sso_invite_sent_by"),
  partnerstackKey: text("partnerstack_key").unique(),
  partnerstackSyncedAt: timestamp("partnerstack_synced_at"),
  passwordChangedAt: timestamp("password_changed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const partnerDealsTable = pgTable("partner_deals", {
  id: serial("id").primaryKey(),
  // Nullable so admin-created CRM deals (with no partner context) can be
  // stored. Partner-side POST /partner/deals always supplies a partnerId
  // and remains the only path partners can take. See routes/crm.ts for
  // the admin-only POST /admin/crm/deals path.
  partnerId: integer("partner_id").references(() => partnersTable.id),
  title: text("title").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  description: text("description"),
  products: text("products").notNull().default("[]"),
  estimatedValue: decimal("estimated_value", { precision: 12, scale: 2 }),
  actualValue: decimal("actual_value", { precision: 12, scale: 2 }),
  status: dealStatusEnum("status").notNull().default("registered"),
  stage: dealStageEnum("stage").notNull().default("prospect"),
  expectedCloseDate: timestamp("expected_close_date"),
  closedAt: timestamp("closed_at"),
  notes: text("notes"),
  tsdTargets: text("tsd_targets").notNull().default("[]"),
  vendorSelections: text("vendor_selections").notNull().default("[]"),
  crmContactId: integer("crm_contact_id"),
  crmCompanyId: integer("crm_company_id"),
  pipelineStageId: integer("pipeline_stage_id"),
  assignedUserId: integer("assigned_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tsdDealPushStatusEnum = pgEnum("tsd_sync_status", ["pending", "success", "failed"]);

export const tsdVendorMappingsTable = pgTable("tsd_vendor_mappings", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull().unique(),
  tsdIds: text("tsd_ids").notNull().default("[]"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tsdDealPushLogsTable = pgTable("tsd_sync_logs", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => partnerDealsTable.id),
  tsdId: text("tsd_id").notNull(),
  status: tsdDealPushStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  payload: text("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const partnerLeadsTable = pgTable("partner_leads", {
  id: serial("id").primaryKey(),
  // Nullable so admin-created CRM leads (with no partner context) can be
  // stored. Partner-side POST /partner/leads always supplies a partnerId
  // and remains the only path partners can take. See routes/crm.ts for
  // the admin-only POST /admin/crm/leads path.
  partnerId: integer("partner_id").references(() => partnersTable.id),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source"),
  interest: text("interest"),
  status: leadStatusEnum("status").notNull().default("new"),
  notes: text("notes"),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  crmContactId: integer("crm_contact_id"),
  crmCompanyId: integer("crm_company_id"),
  assignedUserId: integer("assigned_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const partnerResourcesTable = pgTable("partner_resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url").notNull(),
  type: resourceTypeEnum("type").notNull().default("pdf"),
  category: resourceCategoryEnum("category").notNull().default("general"),
  minTier: partnerTierEnum("min_tier").notNull().default("registered"),
  featured: boolean("featured").notNull().default(false),
  downloadCount: integer("download_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const partnerCertificationsTable = pgTable("partner_certifications", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  provider: text("provider").notNull().default("Siebert Services"),
  category: text("category").notNull().default("general"),
  duration: text("duration"),
  badgeUrl: text("badge_url"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const partnerCertProgressTable = pgTable("partner_cert_progress", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
  certificationId: integer("certification_id").notNull().references(() => partnerCertificationsTable.id),
  status: certStatusEnum("status").notNull().default("not_started"),
  progressPct: integer("progress_pct").notNull().default(0),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const partnerAnnouncementsTable = pgTable("partner_announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("general"),
  minTier: partnerTierEnum("min_tier").notNull().default("registered"),
  pinned: boolean("pinned").notNull().default(false),
  active: boolean("active").notNull().default(true),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const commissionStatusEnum = pgEnum("commission_status", ["pending", "approved", "paid", "disputed", "rejected"]);
export const partnerTicketStatusEnum = pgEnum("partner_ticket_status", ["open", "in_progress", "waiting", "resolved", "closed"]);
export const partnerTicketPriorityEnum = pgEnum("partner_ticket_priority", ["low", "medium", "high", "urgent"]);

export const partnerCommissionsTable = pgTable("partner_commissions", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
  dealId: integer("deal_id").references(() => partnerDealsTable.id),
  type: text("type").notNull().default("deal"),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  rate: decimal("rate", { precision: 5, scale: 2 }),
  status: commissionStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  tsdDiscrepancy: text("tsd_discrepancy"),
  paidAt: timestamp("paid_at"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  stripeTransferId: text("stripe_transfer_id"),
  payoutMethod: text("payout_method"),
  partnerstackKey: text("partnerstack_key").unique(),
  partnerstackSyncedAt: timestamp("partnerstack_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const partnerstackConfigsTable = pgTable("partnerstack_configs", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  lastPushAt: timestamp("last_push_at"),
  lastPullAt: timestamp("last_pull_at"),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at"),
  totalPartnersSynced: integer("total_partners_synced").notNull().default(0),
  totalCommissionsSynced: integer("total_commissions_synced").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const partnerstackWebhookEventsTable = pgTable("partnerstack_webhook_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("received"),
  error: text("error"),
  rawPayload: text("raw_payload").notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
});

export const partnerstackSyncLogTable = pgTable("partnerstack_sync_log", {
  id: serial("id").primaryKey(),
  direction: text("direction").notNull(),       // "push" | "pull"
  kind: text("kind").notNull(),                 // "partner" | "transaction" | "full_sync"
  success: boolean("success").notNull(),
  partnerCount: integer("partner_count").notNull().default(0),
  transactionCount: integer("transaction_count").notNull().default(0),
  message: text("message"),
  ranAt: timestamp("ran_at").notNull().defaultNow(),
});

export const partnerSupportTicketsTable = pgTable("partner_support_tickets", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("general"),
  priority: partnerTicketPriorityEnum("priority").notNull().default("medium"),
  status: partnerTicketStatusEnum("status").notNull().default("open"),
  assignedTo: text("assigned_to"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const partnerTicketMessagesTable = pgTable("partner_ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => partnerSupportTicketsTable.id),
  senderType: text("sender_type").notNull().default("partner"),
  senderName: text("sender_name").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const documentCategoryEnum = pgEnum("document_category", ["contract", "proposal", "invoice", "report", "agreement", "other"]);

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  content: text("content"),
  storagePath: text("storage_path"),
  category: documentCategoryEnum("category").notNull().default("other"),
  partnerId: integer("partner_id").references(() => partnersTable.id),
  customerCompany: text("customer_company"),
  uploadedBy: text("uploaded_by").notNull().default("admin"),
  tags: text("tags").notNull().default("[]"),
  active: boolean("active").notNull().default(true),
  crmContactId: integer("crm_contact_id"),
  crmCompanyId: integer("crm_company_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tsdProviderEnum = pgEnum("tsd_provider", ["avant", "telarus", "intelisys"]);
export const tsdSyncDirectionEnum = pgEnum("tsd_sync_direction", ["outbound", "inbound"]);
export const tsdProviderSyncStatusEnum = pgEnum("tsd_provider_sync_status", ["success", "failure", "partial"]);
export const tsdSyncEntityEnum = pgEnum("tsd_sync_entity", ["deal", "lead", "commission", "webhook", "opportunity", "account", "contact", "order", "quote", "activity", "task", "vendor"]);

export const tsdConfigsTable = pgTable("tsd_configs", {
  id: serial("id").primaryKey(),
  provider: tsdProviderEnum("provider").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  credentialRef: text("credential_ref"),
  username: text("username"),
  password: text("password"),
  mfaPhone: text("mfa_phone"),
  mfaCode: text("mfa_code"),
  securityToken: text("security_token"),
  webhookSecret: text("webhook_secret"),
  lastLeadSyncAt: timestamp("last_lead_sync_at"),
  lastCommissionSyncAt: timestamp("last_commission_sync_at"),
  lastOpportunitySyncAt: timestamp("last_opportunity_sync_at"),
  lastAccountSyncAt: timestamp("last_account_sync_at"),
  lastContactSyncAt: timestamp("last_contact_sync_at"),
  lastOrderSyncAt: timestamp("last_order_sync_at"),
  lastQuoteSyncAt: timestamp("last_quote_sync_at"),
  lastActivitySyncAt: timestamp("last_activity_sync_at"),
  lastTaskSyncAt: timestamp("last_task_sync_at"),
  lastVendorSyncAt: timestamp("last_vendor_sync_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tsdDealMappingsTable = pgTable("tsd_deal_mappings", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => partnerDealsTable.id),
  provider: tsdProviderEnum("provider").notNull(),
  externalId: text("external_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tsdSyncLogsTable = pgTable("tsd_provider_sync_logs", {
  id: serial("id").primaryKey(),
  provider: tsdProviderEnum("provider").notNull(),
  direction: tsdSyncDirectionEnum("direction").notNull(),
  entityType: tsdSyncEntityEnum("entity_type").notNull(),
  status: tsdProviderSyncStatusEnum("status").notNull(),
  recordsAffected: integer("records_affected").notNull().default(0),
  payloadSummary: text("payload_summary"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tsdProductsTable = pgTable("tsd_products", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  availableAt: text("available_at").notNull().default("[]"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Telarus Synced Data Tables ──────────────────────────────────────────────

export const telarusOpportunitiesTable = pgTable("telarus_opportunities", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  name: text("name").notNull(),
  accountName: text("account_name"),
  accountId: text("account_id"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  stage: text("stage"),
  probability: integer("probability"),
  closeDate: timestamp("close_date"),
  type: text("type"),
  description: text("description"),
  leadSource: text("lead_source"),
  ownerId: text("owner_id"),
  ownerName: text("owner_name"),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telarusAccountsTable = pgTable("telarus_accounts", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  name: text("name").notNull(),
  industry: text("industry"),
  phone: text("phone"),
  website: text("website"),
  billingStreet: text("billing_street"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingPostalCode: text("billing_postal_code"),
  billingCountry: text("billing_country"),
  employeeCount: integer("employee_count"),
  annualRevenue: decimal("annual_revenue", { precision: 14, scale: 2 }),
  type: text("type"),
  description: text("description"),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telarusContactsTable = pgTable("telarus_contacts", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  mobilePhone: text("mobile_phone"),
  title: text("title"),
  department: text("department"),
  accountId: text("account_id"),
  accountName: text("account_name"),
  mailingCity: text("mailing_city"),
  mailingState: text("mailing_state"),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telarusOrdersTable = pgTable("telarus_orders", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  name: text("name").notNull(),
  accountId: text("account_id"),
  accountName: text("account_name"),
  status: text("status"),
  orderAmount: decimal("order_amount", { precision: 12, scale: 2 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  contractId: text("contract_id"),
  type: text("type"),
  description: text("description"),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telarusQuotesTable = pgTable("telarus_quotes", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  name: text("name").notNull(),
  opportunityId: text("opportunity_id"),
  opportunityName: text("opportunity_name"),
  accountId: text("account_id"),
  accountName: text("account_name"),
  status: text("status"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }),
  expirationDate: timestamp("expiration_date"),
  description: text("description"),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telarusActivitiesTable = pgTable("telarus_activities", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  subject: text("subject").notNull(),
  type: text("type"),
  status: text("status"),
  priority: text("priority"),
  description: text("description"),
  accountId: text("account_id"),
  accountName: text("account_name"),
  whoId: text("who_id"),
  whoName: text("who_name"),
  whatId: text("what_id"),
  whatName: text("what_name"),
  activityDate: timestamp("activity_date"),
  durationMinutes: integer("duration_minutes"),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telarusTasksTable = pgTable("telarus_tasks", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  subject: text("subject").notNull(),
  status: text("status"),
  priority: text("priority"),
  description: text("description"),
  whoId: text("who_id"),
  whoName: text("who_name"),
  whatId: text("what_id"),
  whatName: text("what_name"),
  ownerId: text("owner_id"),
  ownerName: text("owner_name"),
  activityDate: timestamp("activity_date"),
  isCompleted: boolean("is_completed").notNull().default(false),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telarusVendorsTable = pgTable("telarus_vendors", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  name: text("name").notNull(),
  accountType: text("account_type"),
  industry: text("industry"),
  phone: text("phone"),
  website: text("website"),
  billingStreet: text("billing_street"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingPostalCode: text("billing_postal_code"),
  billingCountry: text("billing_country"),
  description: text("description"),
  partnerType: text("partner_type"),
  partnerStatus: text("partner_status"),
  numberOfEmployees: integer("number_of_employees"),
  annualRevenue: decimal("annual_revenue", { precision: 14, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  products: text("products").notNull().default("[]"),
  rawData: text("raw_data").notNull().default("{}"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPartnerSchema = createInsertSchema(partnersTable).omit({ id: true, createdAt: true, updatedAt: true, tier: true, status: true, totalDeals: true, totalRevenue: true, ytdRevenue: true, approvedAt: true });
export const insertDealSchema = createInsertSchema(partnerDealsTable).omit({ id: true, createdAt: true, updatedAt: true, partnerId: true, status: true });
export const insertLeadSchema = createInsertSchema(partnerLeadsTable).omit({ id: true, createdAt: true, assignedAt: true, partnerId: true });
export const insertResourceSchema = createInsertSchema(partnerResourcesTable).omit({ id: true, createdAt: true, downloadCount: true });
export const insertCertSchema = createInsertSchema(partnerCertificationsTable).omit({ id: true, createdAt: true });
export const insertAnnouncementSchema = createInsertSchema(partnerAnnouncementsTable).omit({ id: true, createdAt: true });

export const insertCommissionSchema = createInsertSchema(partnerCommissionsTable).omit({ id: true, createdAt: true });
export const insertSupportTicketSchema = createInsertSchema(partnerSupportTicketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTicketMessageSchema = createInsertSchema(partnerTicketMessagesTable).omit({ id: true, createdAt: true });
export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTsdConfigSchema = createInsertSchema(tsdConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTsdSyncLogSchema = createInsertSchema(tsdSyncLogsTable).omit({ id: true, createdAt: true });
export const insertTsdProductSchema = createInsertSchema(tsdProductsTable).omit({ id: true, createdAt: true, updatedAt: true });

export const trainingRequestStatusEnum = pgEnum("training_request_status", ["pending", "scheduled", "completed", "cancelled"]);

export const trainingRequestsTable = pgTable("training_requests", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
  vendorName: text("vendor_name").notNull(),
  topic: text("topic").notNull(),
  preferredDate: text("preferred_date"),
  attendeeCount: integer("attendee_count").notNull().default(1),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  notes: text("notes"),
  status: trainingRequestStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTrainingRequestSchema = createInsertSchema(trainingRequestsTable).omit({ id: true, createdAt: true, updatedAt: true, partnerId: true, status: true });
export type TrainingRequest = typeof trainingRequestsTable.$inferSelect;

export type Partner = typeof partnersTable.$inferSelect;
export type PartnerDeal = typeof partnerDealsTable.$inferSelect;
export type PartnerLead = typeof partnerLeadsTable.$inferSelect;
export type PartnerResource = typeof partnerResourcesTable.$inferSelect;
export type PartnerCertification = typeof partnerCertificationsTable.$inferSelect;
export type PartnerCertProgress = typeof partnerCertProgressTable.$inferSelect;
export type PartnerAnnouncement = typeof partnerAnnouncementsTable.$inferSelect;
export type PartnerCommission = typeof partnerCommissionsTable.$inferSelect;
export type PartnerSupportTicket = typeof partnerSupportTicketsTable.$inferSelect;
export type PartnerTicketMessage = typeof partnerTicketMessagesTable.$inferSelect;
export type Document = typeof documentsTable.$inferSelect;
export type TsdConfig = typeof tsdConfigsTable.$inferSelect;
export type TsdSyncLog = typeof tsdSyncLogsTable.$inferSelect;
export type TsdDealMapping = typeof tsdDealMappingsTable.$inferSelect;
export type TsdVendorMapping = typeof tsdVendorMappingsTable.$inferSelect;
export type TsdDealPushLog = typeof tsdDealPushLogsTable.$inferSelect;
export type TsdProduct = typeof tsdProductsTable.$inferSelect;
export type TelarusOpportunity = typeof telarusOpportunitiesTable.$inferSelect;
export type TelarusAccount = typeof telarusAccountsTable.$inferSelect;
export type TelarusContact = typeof telarusContactsTable.$inferSelect;
export type TelarusOrder = typeof telarusOrdersTable.$inferSelect;
export type TelarusQuote = typeof telarusQuotesTable.$inferSelect;
export type TelarusActivity = typeof telarusActivitiesTable.$inferSelect;
export type TelarusTask = typeof telarusTasksTable.$inferSelect;
export type TelarusVendor = typeof telarusVendorsTable.$inferSelect;
