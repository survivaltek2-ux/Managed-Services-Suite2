import { Router, type IRouter } from "express";
import { db, invoicesTable, usersTable } from "@workspace/db";
import { eq, desc, and, isNull, isNotNull, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { isStripeConfigured } from "../lib/stripe.js";
import { sendAppInvoiceViaStripe } from "../lib/stripeQuotesInvoices.js";

const router: IRouter = Router();

// ─── Concurrency guards for Stripe sends ─────────────────────────────────────
// `sendAppInvoiceViaStripe()` is not atomic — it reads `stripeInvoiceId`, calls
// Stripe (which can take seconds), and only then writes the id back. Two
// concurrent send calls for the same invoice (or backfill running while an
// admin clicks the per-row "Stripe" button) would each read NULL, each create
// a Stripe invoice, and the customer would receive duplicate emails.
//
// We serialize per-invoice via an in-flight set, and prevent overlapping
// backfill runs entirely. This is single-process and that's fine — admin
// billing is admin-only and runs on one Node process per environment.
const inFlightStripeSends = new Set<number>();
let backfillInProgress = false;

async function withStripeSendLock<T>(invoiceId: number, fn: () => Promise<T>): Promise<T> {
  if (inFlightStripeSends.has(invoiceId)) {
    throw new Error("Another Stripe send for this invoice is already in progress. Please wait a moment and try again.");
  }
  inFlightStripeSends.add(invoiceId);
  try {
    return await fn();
  } finally {
    inFlightStripeSends.delete(invoiceId);
  }
}

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
    const { userId, title, items = [], taxRate = 0, dueDate, notes, sendViaStripe = false } = req.body;
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

    // Optionally route the new invoice straight through Stripe so the customer
    // gets the hosted invoice email immediately (admin doesn't have to click
    // "Stripe" on the row afterwards). Failures are surfaced in the response
    // but never block the create — the local invoice still exists in draft.
    let stripeResult: { stripeInvoiceId?: string; hostedInvoiceUrl?: string; invoicePdfUrl?: string } | null = null;
    let stripeError: string | null = null;
    if (sendViaStripe && invoice.userId && isStripeConfigured()) {
      try {
        stripeResult = await withStripeSendLock(invoice.id, () => sendAppInvoiceViaStripe(invoice.id));
      } catch (err: any) {
        console.error("[Stripe Invoice Auto-Send] error:", err);
        stripeError = err?.message || "Stripe send failed";
      }
    } else if (sendViaStripe && !invoice.userId) {
      stripeError = "Cannot auto-send via Stripe: no client is associated with this invoice.";
    } else if (sendViaStripe && !isStripeConfigured()) {
      stripeError = "Cannot auto-send via Stripe: Stripe is not configured on this environment.";
    }

    // Re-fetch so the response reflects the post-Stripe state (status flipped
    // to "sent", hosted URL populated, etc.) rather than the original draft row.
    const [fresh] = stripeResult
      ? await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id))
      : [invoice];

    res.status(201).json({ ...fresh, stripeError });
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
    const result = await withStripeSendLock(id, () => sendAppInvoiceViaStripe(id));
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[Stripe Invoice Send] error:", err);
    const msg = err?.message || "Failed to send invoice via Stripe";
    // Surface validation-style errors as 400 so the UI can show the message;
    // genuine Stripe API failures stay 500. The "already in progress" message
    // from the in-flight lock is also user-actionable, not a server bug.
    const isUserError = /already been sent|no associated client|no email|no line items|not found|already in progress/i.test(msg);
    res.status(isUserError ? 400 : 500).json({ error: "stripe_send_failed", message: msg });
  }
});

/**
 * One-shot backfill: push every eligible local invoice into Stripe so the
 * customer receives the hosted invoice email. "Eligible" = the invoice has a
 * userId, the customer has an email, the invoice is in draft/sent/viewed/overdue
 * state (not paid/void), and it has not already been pushed to Stripe. This is
 * a manual admin action, not on a schedule, so it's safe to expose as POST.
 */
router.post("/admin/invoices/backfill-stripe", requireAdmin, async (_req, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "stripe_not_configured", message: "Stripe is not configured on this environment." });
    return;
  }
  // Refuse a second backfill while one is already running. Two simultaneous
  // backfill calls would otherwise both query the same NULL-stripeInvoiceId
  // candidates and double-send to Stripe before either could write the id back.
  if (backfillInProgress) {
    res.status(409).json({ error: "backfill_in_progress", message: "A Stripe backfill is already running. Please wait for it to finish before starting another." });
    return;
  }
  backfillInProgress = true;
  try {
    const candidates = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        userId: invoicesTable.userId,
        email: usersTable.email,
      })
      .from(invoicesTable)
      .leftJoin(usersTable, eq(invoicesTable.userId, usersTable.id))
      .where(and(
        isNull(invoicesTable.stripeInvoiceId),
        isNotNull(invoicesTable.userId),
        inArray(invoicesTable.status, ["draft", "sent", "viewed", "overdue"]),
      ));

    const results: Array<{ id: number; invoiceNumber: string; status: "sent" | "skipped" | "failed"; reason?: string }> = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of candidates) {
      if (!c.email) {
        results.push({ id: c.id, invoiceNumber: c.invoiceNumber, status: "skipped", reason: "Customer has no email on file" });
        skipped++;
        continue;
      }
      try {
        // Per-invoice lock guards against the (unlikely but possible) case where
        // an admin hits the per-row "Stripe" button at the same instant the
        // backfill loop reaches that invoice.
        await withStripeSendLock(c.id, () => sendAppInvoiceViaStripe(c.id));
        results.push({ id: c.id, invoiceNumber: c.invoiceNumber, status: "sent" });
        sent++;
      } catch (err: any) {
        const msg = err?.message || "Stripe send failed";
        results.push({ id: c.id, invoiceNumber: c.invoiceNumber, status: "failed", reason: msg });
        failed++;
        console.error(`[Backfill] invoice ${c.id} (${c.invoiceNumber}) failed:`, msg);
      }
    }

    res.json({
      total: candidates.length,
      sent,
      skipped,
      failed,
      results,
    });
  } catch (err: any) {
    console.error("[Backfill] error:", err);
    res.status(500).json({ error: "backfill_failed", message: err?.message || "Backfill failed" });
  } finally {
    backfillInProgress = false;
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
