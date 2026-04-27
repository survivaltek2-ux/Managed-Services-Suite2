import { Router, type IRouter } from "express";
import { Response } from "express";
import { db, quotesTable, quoteProposalsTable, quoteLineItemsTable, usersTable } from "@workspace/db";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth.js";
import { sendQuoteRequestNotification, sendProposalToClient, sendProposalResponseNotification } from "../lib/email.js";
import { normalizeEmail, tryConsume } from "../lib/abuseControls.js";

const router: IRouter = Router();

function requireAdmin(req: AuthRequest, res: Response, next: Function) {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "forbidden", message: "Admin access required" });
    return;
  }
  next();
}

function generateProposalNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SS-${y}${m}-${rand}`;
}

router.post("/quotes", async (req, res) => {
  try {
    const { name, email: rawEmail, phone, company, companySize, services, budget, timeline, details, requestedTier } = req.body;
    if (!name || !rawEmail || !company || !services || !Array.isArray(services) || services.length === 0) {
      res.status(400).json({ error: "validation_error", message: "name, email, company, and services are required" });
      return;
    }
    const email = normalizeEmail(rawEmail);

    // Per-recipient throttle: prevents quote-form bombing of a single victim
    // address across many source IPs. Sliding 24h window, max 2 submissions
    // for any given recipient (the quote flow is more expensive than contact
    // because it triggers internal notification + customer-facing quote email
    // and creates a CRM row).
    if (!tryConsume(`quote:${email}`, 2, 24 * 60 * 60 * 1000)) {
      res.status(201).json({ id: 0, services: [] });
      return;
    }

    // Same-day dedup: if this email already submitted a quote in the last
    // hour, treat as a duplicate and return the existing row without sending
    // another quote email or creating another CRM record.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recentQuote] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(sql`lower(${quotesTable.email})`, email), gte(quotesTable.createdAt, oneHourAgo)))
      .limit(1);
    if (recentQuote) {
      res.status(201).json({ ...recentQuote, services: (() => { try { return JSON.parse(recentQuote.services); } catch { return [recentQuote.services]; } })() });
      return;
    }

    const tierSlug = typeof requestedTier === "string" && requestedTier.trim()
      ? requestedTier.trim().toLowerCase().slice(0, 64)
      : null;

    const [quote] = await db.insert(quotesTable).values({
      name, email,
      phone: phone || null, company,
      companySize: companySize || null,
      services: JSON.stringify(services),
      budget: budget || null,
      timeline: timeline || null,
      details: details || null,
      requestedTier: tierSlug,
    }).returning();

    sendQuoteRequestNotification({
      name, email, phone, company, companySize,
      services: quote.services, budget, timeline, details,
      requestedTier: tierSlug ?? undefined,
    }).catch(err => console.error("[Email] Quote notification error:", err));

    // Auto-provisioning removed: creating user accounts from unverified public form
    // submissions allows attackers to flood the users table with arbitrary email
    // addresses. Client accounts are created manually by an admin after the quote
    // is reviewed and the email address is confirmed as legitimate.

    res.status(201).json({ ...quote, services: JSON.parse(quote.services) });
  } catch (err) {
    console.error("Quote error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to submit quote request" });
  }
});

// ─── Quote Requests (Admin) ──────────────────────────────────────────────────

router.get("/admin/quotes", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const quotes = await db.select().from(quotesTable).orderBy(desc(quotesTable.createdAt));
    res.json(quotes.map(q => ({ ...q, services: (() => { try { return JSON.parse(q.services); } catch { return [q.services]; } })() })));
  } catch (err) {
    console.error("Admin quotes error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load quotes" });
  }
});

router.put("/admin/quotes/:id/status", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { status } = req.body;
    const [quote] = await db.update(quotesTable).set({ status }).where(eq(quotesTable.id, id)).returning();
    if (!quote) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ...quote, services: (() => { try { return JSON.parse(quote.services); } catch { return [quote.services]; } })() });
  } catch (err) {
    console.error("Update quote status error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update quote status" });
  }
});

router.delete("/admin/quotes/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(quotesTable).where(eq(quotesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete quote error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to delete quote" });
  }
});

// ─── Proposal Management (Admin) ────────────────────────────────────────────

router.get("/admin/proposals", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const proposals = await db.select().from(quoteProposalsTable).orderBy(desc(quoteProposalsTable.createdAt));
    const withItems = await Promise.all(proposals.map(async (p) => {
      const items = await db.select().from(quoteLineItemsTable)
        .where(eq(quoteLineItemsTable.proposalId, p.id))
        .orderBy(quoteLineItemsTable.sortOrder);
      return { ...p, lineItems: items };
    }));
    res.json(withItems);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load proposals" });
  }
});

router.get("/admin/proposals/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [proposal] = await db.select().from(quoteProposalsTable).where(eq(quoteProposalsTable.id, id)).limit(1);
    if (!proposal) { res.status(404).json({ error: "not_found" }); return; }
    const items = await db.select().from(quoteLineItemsTable)
      .where(eq(quoteLineItemsTable.proposalId, id))
      .orderBy(quoteLineItemsTable.sortOrder);
    res.json({ ...proposal, lineItems: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load proposal" });
  }
});

router.post("/admin/proposals", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { quoteId, clientName, clientEmail, clientCompany, clientPhone, title, summary, lineItems, discount, discountType, tax, validUntil, terms, notes } = req.body;
    if (!clientName || !clientEmail || !clientCompany || !title) {
      res.status(400).json({ error: "validation_error", message: "clientName, clientEmail, clientCompany, and title are required" });
      return;
    }

    const proposalNumber = generateProposalNumber();
    const subtotal = (lineItems || []).reduce((sum: number, item: any) => sum + (parseFloat(item.unitPrice) * (item.quantity || 1)), 0);
    const discountVal = parseFloat(discount || "0");
    const discountAmount = discountType === "percent" ? subtotal * (discountVal / 100) : discountVal;
    const taxVal = parseFloat(tax || "0");
    const taxAmount = (subtotal - discountAmount) * (taxVal / 100);
    const total = subtotal - discountAmount + taxAmount;

    const [proposal] = await db.insert(quoteProposalsTable).values({
      quoteId: quoteId || null,
      proposalNumber,
      clientName, clientEmail, clientCompany,
      clientPhone: clientPhone || null,
      title, summary: summary || null,
      subtotal: subtotal.toFixed(2),
      discount: discountAmount.toFixed(2),
      discountType: discountType || "fixed",
      tax: taxAmount.toFixed(2),
      total: total.toFixed(2),
      validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 86400000),
      terms: terms || null, notes: notes || null,
    }).returning();

    if (lineItems && lineItems.length > 0) {
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        await db.insert(quoteLineItemsTable).values({
          proposalId: proposal.id,
          name: item.name,
          description: item.description || null,
          category: item.category || "service",
          quantity: item.quantity || 1,
          unitPrice: parseFloat(item.unitPrice).toFixed(2),
          unit: item.unit || "each",
          recurring: item.recurring || false,
          recurringInterval: item.recurringInterval || null,
          total: (parseFloat(item.unitPrice) * (item.quantity || 1)).toFixed(2),
          sortOrder: i,
        });
      }
    }

    const items = await db.select().from(quoteLineItemsTable)
      .where(eq(quoteLineItemsTable.proposalId, proposal.id))
      .orderBy(quoteLineItemsTable.sortOrder);

    res.status(201).json({ ...proposal, lineItems: items });
  } catch (err) {
    console.error("Create proposal error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create proposal" });
  }
});

router.put("/admin/proposals/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { clientName, clientEmail, clientCompany, clientPhone, title, summary, lineItems, discount, discountType, tax, validUntil, terms, notes, status } = req.body;

    const subtotal = (lineItems || []).reduce((sum: number, item: any) => sum + (parseFloat(item.unitPrice) * (item.quantity || 1)), 0);
    const discountVal = parseFloat(discount || "0");
    const discountAmount = discountType === "percent" ? subtotal * (discountVal / 100) : discountVal;
    const taxVal = parseFloat(tax || "0");
    const taxAmount = (subtotal - discountAmount) * (taxVal / 100);
    const total = subtotal - discountAmount + taxAmount;

    const updates: any = {
      clientName, clientEmail, clientCompany,
      clientPhone: clientPhone || null,
      title, summary: summary || null,
      subtotal: subtotal.toFixed(2),
      discount: discountAmount.toFixed(2),
      discountType: discountType || "fixed",
      tax: taxAmount.toFixed(2),
      total: total.toFixed(2),
      validUntil: validUntil ? new Date(validUntil) : undefined,
      terms: terms || null, notes: notes || null,
      updatedAt: new Date(),
    };
    if (status) {
      updates.status = status;
      if (status === "sent") updates.sentAt = new Date();
    }

    const [proposal] = await db.update(quoteProposalsTable).set(updates).where(eq(quoteProposalsTable.id, id)).returning();
    if (!proposal) { res.status(404).json({ error: "not_found" }); return; }

    if (lineItems) {
      await db.delete(quoteLineItemsTable).where(eq(quoteLineItemsTable.proposalId, id));
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        await db.insert(quoteLineItemsTable).values({
          proposalId: id,
          name: item.name,
          description: item.description || null,
          category: item.category || "service",
          quantity: item.quantity || 1,
          unitPrice: parseFloat(item.unitPrice).toFixed(2),
          unit: item.unit || "each",
          recurring: item.recurring || false,
          recurringInterval: item.recurringInterval || null,
          total: (parseFloat(item.unitPrice) * (item.quantity || 1)).toFixed(2),
          sortOrder: i,
        });
      }
    }

    const items = await db.select().from(quoteLineItemsTable)
      .where(eq(quoteLineItemsTable.proposalId, id))
      .orderBy(quoteLineItemsTable.sortOrder);

    res.json({ ...proposal, lineItems: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update proposal" });
  }
});

router.put("/admin/proposals/:id/send", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [proposal] = await db.update(quoteProposalsTable).set({
      status: "sent", sentAt: new Date(), updatedAt: new Date(),
    }).where(eq(quoteProposalsTable.id, id)).returning();
    if (!proposal) { res.status(404).json({ error: "not_found" }); return; }

    sendProposalToClient({
      proposalNumber: proposal.proposalNumber,
      title: proposal.title,
      clientName: proposal.clientName,
      clientEmail: proposal.clientEmail,
      clientCompany: proposal.clientCompany,
      total: proposal.total,
      validUntil: proposal.validUntil,
    }).catch(err => console.error("[Email] Proposal send notification error:", err));

    res.json(proposal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to send proposal" });
  }
});

router.delete("/admin/proposals/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(quoteLineItemsTable).where(eq(quoteLineItemsTable.proposalId, id));
    await db.delete(quoteProposalsTable).where(eq(quoteProposalsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete proposal" });
  }
});

// ─── Public Proposal View ──────────────────────────────────────────────────

router.get("/proposals/:number", async (req, res) => {
  try {
    const [proposal] = await db.select().from(quoteProposalsTable)
      .where(eq(quoteProposalsTable.proposalNumber, req.params.number as string))
      .limit(1);
    if (!proposal) { res.status(404).json({ error: "not_found", message: "Proposal not found" }); return; }

    if (!proposal.viewedAt && proposal.status === "sent") {
      await db.update(quoteProposalsTable).set({ viewedAt: new Date(), status: "viewed" }).where(eq(quoteProposalsTable.id, proposal.id));
      proposal.viewedAt = new Date();
      (proposal as any).status = "viewed";
    }

    const items = await db.select().from(quoteLineItemsTable)
      .where(eq(quoteLineItemsTable.proposalId, proposal.id))
      .orderBy(quoteLineItemsTable.sortOrder);

    res.json({ ...proposal, lineItems: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load proposal" });
  }
});

router.post("/proposals/:number/respond", async (req, res) => {
  try {
    const { action, signature } = req.body;
    if (!["accepted", "rejected"].includes(action)) {
      res.status(400).json({ error: "validation_error", message: "action must be 'accepted' or 'rejected'" });
      return;
    }
    const [proposal] = await db.select().from(quoteProposalsTable)
      .where(eq(quoteProposalsTable.proposalNumber, req.params.number as string))
      .limit(1);
    if (!proposal) { res.status(404).json({ error: "not_found" }); return; }
    if (["accepted", "rejected", "expired"].includes(proposal.status)) {
      res.status(400).json({ error: "invalid_state", message: "This proposal has already been responded to" });
      return;
    }

    const [updated] = await db.update(quoteProposalsTable).set({
      status: action,
      respondedAt: new Date(),
      clientSignature: action === "accepted" ? (signature || "Accepted") : null,
      updatedAt: new Date(),
    }).where(eq(quoteProposalsTable.id, proposal.id)).returning();

    sendProposalResponseNotification({
      proposalNumber: proposal.proposalNumber,
      title: proposal.title,
      clientName: proposal.clientName,
      clientEmail: proposal.clientEmail,
      clientCompany: proposal.clientCompany,
      total: proposal.total,
    }, action as "accepted" | "rejected").catch(err => console.error("[Email] Proposal response notification error:", err));

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to respond to proposal" });
  }
});

// ─── Customer: My Quotes & Proposals ────────────────────────────────────────

router.get("/my/quotes", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!user) { res.status(404).json({ error: "not_found" }); return; }

    const quotes = await db.select().from(quotesTable)
      .where(eq(quotesTable.email, user.email))
      .orderBy(desc(quotesTable.createdAt));

    const proposals = await db.select().from(quoteProposalsTable)
      .where(eq(quoteProposalsTable.clientEmail, user.email))
      .orderBy(desc(quoteProposalsTable.createdAt));

    res.json({
      quotes: quotes.map(q => ({ ...q, services: (() => { try { return JSON.parse(q.services); } catch { return [q.services]; } })() })),
      proposals,
    });
  } catch (err) {
    console.error("My quotes error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load your quotes" });
  }
});

export default router;
