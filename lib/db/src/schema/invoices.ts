import { pgTable, text, serial, timestamp, pgEnum, integer, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "viewed", "paid", "overdue", "void"]);

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  partnerId: integer("partner_id"),
  invoiceNumber: text("invoice_number").notNull().unique(),
  title: text("title").notNull().default("Invoice"),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  items: text("items").notNull().default("[]"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  tax: decimal("tax", { precision: 12, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 12, scale: 2 }).notNull().default("0"),
  dueDate: timestamp("due_date"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  // Hosted Stripe invoice page + PDF, populated after the invoice is finalized
  // and sent through Stripe. Lets the admin UI surface a "View on Stripe" link
  // and the client receives Stripe's branded payment page directly.
  hostedInvoiceUrl: text("hosted_invoice_url"),
  invoicePdfUrl: text("invoice_pdf_url"),
  stripeSentAt: timestamp("stripe_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Invoice = typeof invoicesTable.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
