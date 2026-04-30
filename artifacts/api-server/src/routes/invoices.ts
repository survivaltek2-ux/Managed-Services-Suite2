import { Router, type IRouter } from "express";
import { db, invoicesTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { isStripeConfigured } from "../lib/stripe.js";
import { sendAppInvoiceViaStripe } from "../lib/stripeQuotesInvoices.js";

const router: IRouter = Router();

function generateInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `INV-${year}-${rand}`;
}

function recalcTotals(items: any[], taxRate = 0): { subtotal: string; tax: string; total: string } {
  const subtotal = items.reduce((s, item) => s + (parseFloat(item.qty || 1) * parseFloat(item.unitPrice || 0)), 0);
  const tax = subtotal * (taxRate / 100);
  return {
    subtotal: subtotal.toFixed(2),
    tax: tax.toFixed(2),
    total: (subtotal + tax).toFixed(2),
  };
}

// ─── Admin Routes ─────────────────────────────────────────────────────────────

router.get("/admin/invoices", requireAdmin, async (_req, res) => {
  try {
    const invoices = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        title: invoicesTable.title,
        status: invoicesTable.status,
        subtotal: invoicesTable.subtotal,
        tax: invoicesTable.tax,
        total: invoicesTable.total,
        dueDate: invoicesTable.dueDate,
        paidAt: invoicesTable.paidAt,
        notes: invoicesTable.notes,
        items: invoicesTable.items,
        userId: invoicesTable.userId,
        createdAt: invoicesTable.createdAt,
        updatedAt: invoicesTable.updatedAt,
        stripeInvoiceId: invoicesTable.stripeInvoiceId,
        hostedInvoiceUrl: invoicesTable.hostedInvoiceUrl,
        invoicePdfUrl: invoicesTable.invoicePdfUrl,
        stripeSentAt: invoicesTable.stripeSentAt,
        clientName: usersTable.name,
        clientEmail: usersTable.email,
        clientCompany: usersTable.company,
      })
      .from(invoicesTable)
      .leftJoin(usersTable, eq(invoicesTable.userId, usersTable.id))
      .orderBy(desc(invoicesTable.createdAt));
    res.json(invoices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load invoices" });
  }
});

router.post("/admin/invoices", requireAdmin, async (req, res) => {
  try {
    const { userId, title, items = [], taxRate = 0, dueDate, notes } = req.body;
    const parsedItems = Array.isArray(items) ? items : JSON.parse(items || "[]");
    const totals = recalcTotals(parsedItems, taxRate);
    const invoiceNumber = generateInvoiceNumber();
    const [invoice] = await db.insert(invoicesTable).values({
      userId: userId ? parseInt(userId) : null,
      invoiceNumber,
      title: title || "Invoice",
      status: "draft",
      items: JSON.stringify(parsedItems),
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes || null,
    }).returning();
    res.status(201).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create invoice" });
  }
});

router.put("/admin/invoices/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { userId, title, status, items, taxRate = 0, dueDate, notes } = req.body;
    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (status !== undefined) {
      updates.status = status;
      if (status === "paid") updates.paidAt = new Date();
    }
    if (userId !== undefined) updates.userId = userId ? parseInt(userId) : null;
    if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
    if (notes !== undefined) updates.notes = notes;
    if (items !== undefined) {
      const parsedItems = Array.isArray(items) ? items : JSON.parse(items || "[]");
      const totals = recalcTotals(parsedItems, taxRate);
      updates.items = JSON.stringify(parsedItems);
      updates.subtotal = totals.subtotal;
      updates.tax = totals.tax;
      updates.total = totals.total;
    }
    const [invoice] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
    if (!invoice) { res.status(404).json({ error: "not_found" }); return; }
    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update invoice" });
  }
});

router.post("/admin/invoices/:id/send", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [invoice] = await db.update(invoicesTable)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(invoicesTable.id, id))
      .returning();
    if (!invoice) { res.status(404).json({ error: "not_found" }); return; }
    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to send invoice" });
  }
});

/**
 * Send an app-managed invoice through Stripe so the client receives Stripe's
 * branded hosted invoice email + payment page. The admin's existing local
 * "send" action stays available for invoices that don't need card payment.
 */
router.post("/admin/invoices/:id/send-stripe", requireAdmin, async (req, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "stripe_not_configured", message: "Stripe is not configured on this environment." });
    return;
  }
  try {
    const id = parseInt(req.params.id);
    const result = await sendAppInvoiceViaStripe(id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[Stripe Invoice Send] error:", err);
    const msg = err?.message || "Failed to send invoice via Stripe";
    // Surface validation-style errors as 400 so the UI can show the message;
    // genuine Stripe API failures stay 500.
    const isUserError = /already been sent|no associated client|no email|no line items|not found/i.test(msg);
    res.status(isUserError ? 400 : 500).json({ error: "stripe_send_failed", message: msg });
  }
});

router.delete("/admin/invoices/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete invoice" });
  }
});

// ─── Client Routes ─────────────────────────────────────────────────────────────

router.get("/invoices", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.userId, userId))
      .orderBy(desc(invoicesTable.createdAt));
    res.json({ invoices: invoices.map(inv => ({
      ...inv,
      items: JSON.parse(inv.items || "[]"),
    })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load invoices" });
  }
});

router.get("/invoices/:id", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;
    const id = parseInt(req.params.id);
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!invoice) { res.status(404).json({ error: "not_found" }); return; }
    if (invoice.userId !== userId) { res.status(403).json({ error: "forbidden" }); return; }
    res.json({ ...invoice, items: JSON.parse(invoice.items || "[]") });
    if (invoice.status === "sent") {
      await db.update(invoicesTable).set({ status: "viewed", updatedAt: new Date() }).where(eq(invoicesTable.id, id));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load invoice" });
  }
});

export default router;
