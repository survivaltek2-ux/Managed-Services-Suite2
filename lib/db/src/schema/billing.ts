import { pgTable, text, serial, timestamp, pgEnum, integer, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "trialing", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"]);

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  partnerId: integer("partner_id"),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripePriceId: text("stripe_price_id").notNull(),
  stripeProductId: text("stripe_product_id"),
  planId: text("plan_id").notNull(),
  planName: text("plan_name").notNull(),
  status: subscriptionStatusEnum("status").notNull().default("incomplete"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: timestamp("canceled_at"),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  // Pre-authorization / approval flow
  approvalStatus: text("approval_status").notNull().default("approved"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  seats: integer("seats"),
  // Customer classification
  customerType: text("customer_type").default("business"),
  // Auto-activation flag: true when the plan bypassed the admin approval workflow
  autoActivated: boolean("auto_activated").notNull().default(false),
  // Minimum-term commitment (set on create from the active contract template).
  // initialTermMonths controls the contract terms wording; commitmentEndsAt is
  // the actual enforcement date used by the cancel-subscription endpoint.
  initialTermMonths: integer("initial_term_months").notNull().default(12),
  commitmentEndsAt: timestamp("commitment_ends_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

/**
 * One-time management nonces issued at checkout creation time.
 * The nonce replaces the Stripe session_id in the success_url so that
 * the Stripe object identifier is never exposed in a browser-visible URL.
 * Each nonce is single-use and short-lived (15 minutes).
 */
export const billingManageNoncesTable = pgTable("billing_manage_nonces", {
  id: serial("id").primaryKey(),
  nonce: text("nonce").notNull().unique(),
  stripeSessionId: text("stripe_session_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
