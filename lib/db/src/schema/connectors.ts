import { pgTable, text, serial, timestamp, integer, pgEnum, decimal } from "drizzle-orm/pg-core";

export const connectorStatusEnum = pgEnum("connector_status", [
  "pending",
  "approved",
  "rejected",
  "suspended",
]);

export const connectorReferralStatusEnum = pgEnum("connector_referral_status", [
  "submitted",
  "qualified",
  "in_progress",
  "won",
  "lost",
  "duplicate",
]);

export const connectorPayoutStatusEnum = pgEnum("connector_payout_status", [
  "pending",
  "approved",
  "paid",
  "void",
]);

export const connectorsTable = pgTable("connectors", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  occupation: text("occupation"),
  howHeard: text("how_heard"),
  status: connectorStatusEnum("status").notNull().default("approved"),
  totalReferrals: integer("total_referrals").notNull().default(0),
  totalEarnedCents: integer("total_earned_cents").notNull().default(0),
  approvedAt: timestamp("approved_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const connectorReferralsTable = pgTable("connector_referrals", {
  id: serial("id").primaryKey(),
  connectorId: integer("connector_id").notNull().references(() => connectorsTable.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  contactTitle: text("contact_title"),
  companySize: text("company_size"),
  multiLocation: text("multi_location"), // 'yes' | 'no' | 'unknown'
  servicesNeeded: text("services_needed").notNull().default("[]"),
  notes: text("notes"),
  status: connectorReferralStatusEnum("status").notNull().default("submitted"),
  estimatedAcvCents: integer("estimated_acv_cents"),
  actualAcvCents: integer("actual_acv_cents"),
  rewardAmountCents: integer("reward_amount_cents"),
  rewardTier: text("reward_tier"), // tier1..tier4 (matches the program design)
  adminNotes: text("admin_notes"),
  qualifiedAt: timestamp("qualified_at"),
  wonAt: timestamp("won_at"),
  firstInvoicePaidAt: timestamp("first_invoice_paid_at"),
  payoutDueAt: timestamp("payout_due_at"),
  clawbackUntil: timestamp("clawback_until"),
  lostAt: timestamp("lost_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const connectorPayoutsTable = pgTable("connector_payouts", {
  id: serial("id").primaryKey(),
  connectorId: integer("connector_id").notNull().references(() => connectorsTable.id, { onDelete: "cascade" }),
  referralId: integer("referral_id").references(() => connectorReferralsTable.id, { onDelete: "set null" }),
  amountCents: integer("amount_cents").notNull(),
  rewardTier: text("reward_tier"),
  status: connectorPayoutStatusEnum("status").notNull().default("pending"),
  payoutMethod: text("payout_method"), // 'check' | 'ach' | 'paypal' | 'venmo' | 'stripe'
  payoutReference: text("payout_reference"),
  notes: text("notes"),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  voidedAt: timestamp("voided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Connector = typeof connectorsTable.$inferSelect;
export type ConnectorReferral = typeof connectorReferralsTable.$inferSelect;
export type ConnectorPayout = typeof connectorPayoutsTable.$inferSelect;
