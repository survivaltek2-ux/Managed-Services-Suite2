import { Router, Response } from "express";
import { randomBytes } from "crypto";
import { db, quoteProposalsTable, quoteLineItemsTable, proposalTemplatesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requirePartnerAuth, PartnerRequest, TeamMemberPermissions, MAIN_SITE_ADMIN_SENTINEL } from "../middlewares/partnerAuth.js";
import { sendProposalToClient } from "../lib/email.js";

const router = Router();

function teamMemberCan(req: PartnerRequest, res: Response, permission: keyof TeamMemberPermissions): boolean {
  if (req.teamMemberId) {
    if (!req.teamMemberPermissions || !req.teamMemberPermissions[permission]) {
      res.status(403).json({ error: "forbidden", message: "You don't have permission to perform this action." });
      return false;
    }
  }
  return true;
}

function generateProposalNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SS-${y}${m}-${rand}`;
}

function generateProposalToken(): string {
  return randomBytes(32).toString("hex");
}

function calcTotals(lineItems: any[], discount: string, discountType: string, tax: string) {
  const subtotal = (lineItems || []).reduce((sum: number, item: any) =>
    sum + (parseFloat(item.unitPrice || "0") * (item.quantity || 1)), 0);
  const discountVal = parseFloat(discount || "0");
  const discountAmount = discountType === "percent" ? subtotal * (discountVal / 100) : discountVal;
  const taxVal = parseFloat(tax || "0");
  const taxAmount = (subtotal - discountAmount) * (taxVal / 100);
  const total = subtotal - discountAmount + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

async function getProposalWithItems(proposalId: number) {
  const [proposal] = await db.select().from(quoteProposalsTable)
    .where(eq(quoteProposalsTable.id, proposalId)).limit(1);
  if (!proposal) return null;
  const items = await db.select().from(quoteLineItemsTable)
    .where(eq(quoteLineItemsTable.proposalId, proposalId))
    .orderBy(quoteLineItemsTable.sortOrder);
  return { ...proposal, lineItems: items };
}

// ─── Proposals CRUD ──────────────────────────────────────────────────────────

router.get("/", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const partnerId = req.partnerId!;
    const proposals = await db.select().from(quoteProposalsTable)
      .where(partnerId === MAIN_SITE_ADMIN_SENTINEL ? undefined : eq(quoteProposalsTable.partnerId, partnerId))
      .orderBy(desc(quoteProposalsTable.createdAt));
    const withItems = await Promise.all(proposals.map(async (p) => {
      const items = await db.select().from(quoteLineItemsTable)
        .where(eq(quoteLineItemsTable.proposalId, p.id))
        .orderBy(quoteLineItemsTable.sortOrder);
      return { ...p, lineItems: items };
    }));
    res.json({ proposals: withItems });
  } catch (err) {
    console.error("[PartnerProposals] list error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load proposals" });
  }
});

router.post("/", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const { clientName, clientEmail, clientCompany, clientPhone, title, summary, lineItems, discount, discountType, tax, validUntil, terms, notes } = req.body;
    if (!clientName || !clientEmail || !clientCompany || !title) {
      res.status(400).json({ error: "validation_error", message: "clientName, clientEmail, clientCompany, and title are required" });
      return;
    }
    const { subtotal, discountAmount, taxAmount, total } = calcTotals(lineItems || [], discount, discountType, tax);
    const proposalNumber = generateProposalNumber();
    const proposalToken = generateProposalToken();
    const [proposal] = await db.insert(quoteProposalsTable).values({
      partnerId: req.partnerId === MAIN_SITE_ADMIN_SENTINEL ? null : req.partnerId,
      proposalNumber,
      proposalToken,
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
          unitPrice: parseFloat(item.unitPrice || "0").toFixed(2),
          unit: item.unit || "each",
          recurring: item.recurring || false,
          recurringInterval: item.recurringInterval || null,
          total: (parseFloat(item.unitPrice || "0") * (item.quantity || 1)).toFixed(2),
          sortOrder: i,
        });
      }
    }
    const result = await getProposalWithItems(proposal.id);
    res.status(201).json(result);
  } catch (err) {
    console.error("[PartnerProposals] create error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create proposal" });
  }
});

router.put("/:id", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseInt(req.params.id as string);
    const { clientName, clientEmail, clientCompany, clientPhone, title, summary, lineItems, discount, discountType, tax, validUntil, terms, notes, status } = req.body;
    const { subtotal, discountAmount, taxAmount, total } = calcTotals(lineItems || [], discount, discountType, tax);

    // Verify ownership
    const [existing] = await db.select().from(quoteProposalsTable).where(eq(quoteProposalsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }

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
      version: (existing.version || 1) + 1,
      updatedAt: new Date(),
    };
    if (status) {
      updates.status = status;
      if (status === "sent") updates.sentAt = new Date();
    }

    await db.update(quoteProposalsTable).set(updates).where(eq(quoteProposalsTable.id, id));

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
          unitPrice: parseFloat(item.unitPrice || "0").toFixed(2),
          unit: item.unit || "each",
          recurring: item.recurring || false,
          recurringInterval: item.recurringInterval || null,
          total: (parseFloat(item.unitPrice || "0") * (item.quantity || 1)).toFixed(2),
          sortOrder: i,
        });
      }
    }
    const result = await getProposalWithItems(id);
    res.json(result);
  } catch (err) {
    console.error("[PartnerProposals] update error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update proposal" });
  }
});

router.delete("/:id", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(quoteProposalsTable).where(eq(quoteProposalsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    await db.delete(quoteLineItemsTable).where(eq(quoteLineItemsTable.proposalId, id));
    await db.delete(quoteProposalsTable).where(eq(quoteProposalsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[PartnerProposals] delete error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to delete proposal" });
  }
});

// ─── Send to Client ──────────────────────────────────────────────────────────

router.put("/:id/send", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(quoteProposalsTable).where(eq(quoteProposalsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }

    const [proposal] = await db.update(quoteProposalsTable).set({
      status: "sent", sentAt: new Date(), updatedAt: new Date(),
    }).where(eq(quoteProposalsTable.id, id)).returning();

    if (!proposal.proposalToken) {
      res.status(500).json({ error: "server_error", message: "Proposal is missing a secure token; please contact support." });
      return;
    }
    sendProposalToClient({
      proposalNumber: proposal.proposalNumber,
      proposalToken: proposal.proposalToken,
      title: proposal.title,
      clientName: proposal.clientName,
      clientEmail: proposal.clientEmail,
      clientCompany: proposal.clientCompany,
      total: proposal.total,
      validUntil: proposal.validUntil,
    }).catch(err => console.error("[Email] Proposal send error:", err));

    res.json(proposal);
  } catch (err) {
    console.error("[PartnerProposals] send error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to send proposal" });
  }
});

// ─── Client History ──────────────────────────────────────────────────────────

router.get("/clients", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const partnerId = req.partnerId!;
    const proposals = await db.select({
      clientName: quoteProposalsTable.clientName,
      clientEmail: quoteProposalsTable.clientEmail,
      clientCompany: quoteProposalsTable.clientCompany,
      clientPhone: quoteProposalsTable.clientPhone,
    }).from(quoteProposalsTable)
      .where(partnerId === MAIN_SITE_ADMIN_SENTINEL ? undefined : eq(quoteProposalsTable.partnerId, partnerId))
      .orderBy(desc(quoteProposalsTable.createdAt));

    // Deduplicate by email
    const seen = new Set<string>();
    const clients = proposals.filter(p => {
      if (seen.has(p.clientEmail)) return false;
      seen.add(p.clientEmail);
      return true;
    });

    res.json({ clients });
  } catch (err) {
    console.error("[PartnerProposals] clients error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load clients" });
  }
});

// ─── Templates ───────────────────────────────────────────────────────────────

router.get("/templates", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const partnerId = req.partnerId!;
    const templates = await db.select().from(proposalTemplatesTable)
      .orderBy(desc(proposalTemplatesTable.createdAt));
    // Return global templates + partner's own templates
    const filtered = templates.filter(t =>
      t.isGlobal ||
      partnerId === MAIN_SITE_ADMIN_SENTINEL ||
      t.partnerId === partnerId
    );
    res.json({ templates: filtered });
  } catch (err) {
    console.error("[PartnerProposals] templates list error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load templates" });
  }
});

router.post("/templates", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const { name, description, title, summary, terms, discountType, discount, tax, lineItems, isGlobal } = req.body;
    if (!name || !title) {
      res.status(400).json({ error: "validation_error", message: "name and title are required" });
      return;
    }
    const partnerId = req.partnerId === MAIN_SITE_ADMIN_SENTINEL ? null : req.partnerId;
    const [template] = await db.insert(proposalTemplatesTable).values({
      partnerId,
      name, description: description || null,
      title, summary: summary || null,
      terms: terms || null,
      discountType: discountType || "fixed",
      discount: parseFloat(discount || "0").toFixed(2),
      tax: parseFloat(tax || "0").toFixed(2),
      lineItems: lineItems || [],
      isGlobal: (isGlobal && req.partnerId === MAIN_SITE_ADMIN_SENTINEL) ? true : false,
    }).returning();
    res.status(201).json(template);
  } catch (err) {
    console.error("[PartnerProposals] template create error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create template" });
  }
});

router.put("/templates/:id", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(proposalTemplatesTable).where(eq(proposalTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const { name, description, title, summary, terms, discountType, discount, tax, lineItems, isGlobal } = req.body;
    const [template] = await db.update(proposalTemplatesTable).set({
      name, description: description || null,
      title, summary: summary || null,
      terms: terms || null,
      discountType: discountType || "fixed",
      discount: parseFloat(discount || "0").toFixed(2),
      tax: parseFloat(tax || "0").toFixed(2),
      lineItems: lineItems || [],
      isGlobal: (isGlobal && req.partnerId === MAIN_SITE_ADMIN_SENTINEL) ? true : false,
      updatedAt: new Date(),
    }).where(eq(proposalTemplatesTable.id, id)).returning();
    res.json(template);
  } catch (err) {
    console.error("[PartnerProposals] template update error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update template" });
  }
});

router.delete("/templates/:id", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(proposalTemplatesTable).where(eq(proposalTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    await db.delete(proposalTemplatesTable).where(eq(proposalTemplatesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[PartnerProposals] template delete error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to delete template" });
  }
});

export default router;
