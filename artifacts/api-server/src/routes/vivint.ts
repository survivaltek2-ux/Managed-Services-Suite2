import { Router, Request, Response } from "express";
import { db, vivintInquiriesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { sendVivintInquiryNotification } from "../lib/email.js";
import { upsertContact } from "../lib/crmUpsert.js";

const router = Router();

// POST /api/vivint/inquiries - Submit a Vivint inquiry
router.post("/inquiries", async (req: Request, res: Response) => {
  try {
    const { type, name, email, phone, zipCode, propertyType, currentSystem, interestedIn, budget, timeframe, notes } = req.body;

    if (!type || !name || !email || !phone) {
      res.status(400).json({ error: "validation_error", message: "type, name, email, and phone are required" });
      return;
    }

    const [inquiry] = await db.insert(vivintInquiriesTable).values({
      type,
      name,
      email,
      phone,
      zipCode: zipCode || null,
      propertyType: propertyType || null,
      currentSystem: currentSystem || null,
      interestedIn: interestedIn || [],
      budget: budget || null,
      timeframe: timeframe || null,
      notes: notes || null,
    }).returning();

    upsertContact({
      name,
      email,
      phone: phone || null,
      source: `vivint_${type}`,
    }).then(async ({ contactId, companyId }) => {
      if (contactId || companyId) {
        await db.update(vivintInquiriesTable)
          .set({ crmContactId: contactId, crmCompanyId: companyId })
          .where(eq(vivintInquiriesTable.id, inquiry.id));
      }
    }).catch(err => console.error("[CRM] Vivint upsert error:", err));

    // Send notification email
    sendVivintInquiryNotification({
      type,
      name,
      email,
      phone,
      zipCode: zipCode || undefined,
      propertyType,
      currentSystem,
      interestedIn,
      budget,
      timeframe,
      notes,
    }).catch(err => console.error("[Email] Vivint inquiry notification error:", err));

    res.status(201).json({
      success: true,
      message: "Your inquiry has been received. We'll contact you shortly.",
      id: inquiry.id,
    });
  } catch (err) {
    console.error("[Vivint] Inquiry submission error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to submit inquiry" });
  }
});

// GET /api/vivint/inquiries - Admin endpoint to view all Vivint inquiries
router.get("/inquiries", async (req: Request, res: Response) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const inquiries = await db.select().from(vivintInquiriesTable).orderBy(desc(vivintInquiriesTable.createdAt));
    res.json({ inquiries });
  } catch (err) {
    console.error("[Vivint] Inquiries list error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
