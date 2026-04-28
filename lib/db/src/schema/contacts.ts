import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  service: text("service"),
  message: text("message").notNull(),
  source: text("source"),
  crmContactId: integer("crm_contact_id"),
  crmCompanyId: integer("crm_company_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vivintInquiriesTable = pgTable("vivint_inquiries", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  zipCode: text("zip_code"),
  propertyType: text("property_type"),
  currentSystem: text("current_system"),
  interestedIn: jsonb("interested_in").default([]),
  budget: text("budget"),
  timeframe: text("timeframe"),
  notes: text("notes"),
  crmContactId: integer("crm_contact_id"),
  crmCompanyId: integer("crm_company_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true });
export const insertVivintInquirySchema = createInsertSchema(vivintInquiriesTable).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type InsertVivintInquiry = z.infer<typeof insertVivintInquirySchema>;
export type Contact = typeof contactsTable.$inferSelect;
export type VivintInquiry = typeof vivintInquiriesTable.$inferSelect;
