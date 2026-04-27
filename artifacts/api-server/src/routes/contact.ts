import { Router, type IRouter } from "express";
import { Response } from "express";
import { db, contactsTable } from "@workspace/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth.js";
import { sendContactFormNotification } from "../lib/email.js";

const router: IRouter = Router();

function requireAdmin(req: AuthRequest, res: Response, next: Function) {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "forbidden", message: "Admin access required" });
    return;
  }
  next();
}

router.get("/admin/contacts", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const contacts = await db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt));
    res.json(contacts);
  } catch (err) {
    console.error("Admin contacts error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load contacts" });
  }
});

router.delete("/admin/contacts/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(contactsTable).where(eq(contactsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete contact error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to delete contact" });
  }
});

router.post("/contact", async (req, res) => {
  try {
    const { name, email, phone, company, service, message } = req.body;
    if (!name || !email || !message) {
      res.status(400).json({ error: "validation_error", message: "name, email, and message are required" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Deduplicate: if this email already submitted a contact form in the last hour,
    // acknowledge silently without inserting a new row or triggering another email.
    // This prevents subscription-bombing by stacking internal notification emails.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recentContact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.email, normalizedEmail), gte(contactsTable.createdAt, oneHourAgo)))
      .limit(1);

    if (recentContact) {
      res.status(201).json({ id: recentContact.id });
      return;
    }

    const [contact] = await db.insert(contactsTable).values({
      name,
      email: normalizedEmail,
      phone: phone || null,
      company: company || null,
      service: service || null,
      message,
    }).returning();

    sendContactFormNotification({ name, email: normalizedEmail, phone, company, service, message })
      .catch(err => console.error("[Email] Contact notification error:", err));

    res.status(201).json(contact);
  } catch (err) {
    console.error("Contact error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to submit contact form" });
  }
});

export default router;
