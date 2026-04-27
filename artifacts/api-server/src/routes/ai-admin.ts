import { Router } from "express";
import { db, partnersTable, partnerLeadsTable, partnerDealsTable, partnerCommissionsTable, invoicesTable, contactsTable, marketplaceVendorsTable, marketplaceOrdersTable, marketplaceProductsTable, pageSectionsTable } from "@workspace/db";
import { eq, desc, sql, like, or, and } from "drizzle-orm";
import { requirePartnerAuth, requirePartnerAdmin, type PartnerRequest } from "../middlewares/partnerAuth.js";
import { openai, AI_MODEL } from "@workspace/integrations-openai-ai-server";

const router = Router();

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_stats",
      description: "Get a high-level dashboard overview: counts of partners, leads, deals, commissions, invoices, and contacts. Use this when the user asks for a summary or overview.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_partners",
      description: "List partners. Filter by status (pending, approved, rejected, suspended) or tier (registered, silver, gold, platinum). Returns company name, email, status, tier, revenue.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "approved", "rejected", "suspended", "all"], description: "Filter by partner status" },
          tier: { type: "string", enum: ["registered", "silver", "gold", "platinum", "all"], description: "Filter by partner tier" },
          limit: { type: "number", description: "Max results to return (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_partner",
      description: "Update a partner's status or tier. Use when admin wants to approve, reject, suspend a partner, or change their tier.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Partner ID" },
          status: { type: "string", enum: ["pending", "approved", "rejected", "suspended"], description: "New status" },
          tier: { type: "string", enum: ["registered", "silver", "gold", "platinum"], description: "New tier" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_leads",
      description: "List partner leads. Filter by status (new, contacted, qualified, converted, lost). Returns lead name, company, contact info, assigned partner, status.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["new", "contacted", "qualified", "converted", "lost", "all"], description: "Filter by lead status" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_lead",
      description: "Update a lead's status or notes.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Lead ID" },
          status: { type: "string", enum: ["new", "contacted", "qualified", "converted", "lost"] },
          notes: { type: "string", description: "Notes to set on the lead" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_deals",
      description: "List registered deals. Filter by status (registered, in_progress, won, lost, expired). Returns deal name, customer, partner, value, status.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["registered", "in_progress", "won", "lost", "expired", "all"], description: "Filter by deal status" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_commissions",
      description: "List partner commissions. Filter by status (pending, approved, paid, disputed, rejected). Returns partner, amount, product, status.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "approved", "paid", "disputed", "rejected", "all"], description: "Filter by commission status" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_commission",
      description: "Approve, reject, or mark a commission as paid.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Commission ID" },
          status: { type: "string", enum: ["pending", "approved", "paid", "rejected"] },
        },
        required: ["id", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_invoices",
      description: "List invoices. Returns client name, amount, status (draft, sent, paid, overdue), due date.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "sent", "paid", "overdue", "all"], description: "Filter by invoice status" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_contacts",
      description: "List contact form submissions / inquiries. Returns name, email, service interest, message, date.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 20)" },
          search: { type: "string", description: "Optional search by name or email" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_marketplace",
      description: "Get marketplace overview: vendors, products, and recent orders.",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", enum: ["vendors", "products", "orders", "all"], description: "Which section to retrieve" },
          limit: { type: "number", description: "Max results per section (default 15)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_page_content",
      description: "Get the current saved content for a website page (heroTitle, heroSubtitle, etc.).",
      parameters: {
        type: "object",
        properties: {
          pageSlug: { type: "string", description: "The page slug, e.g. 'home', 'att-business', 'ringcentral'" },
        },
        required: ["pageSlug"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_page_content",
      description: "Update content fields on a website page. Use for editing heroTitle, heroSubtitle, heroDescription, etc.",
      parameters: {
        type: "object",
        properties: {
          pageSlug: { type: "string", description: "The page slug, e.g. 'att-business'" },
          fields: {
            type: "object",
            description: "Key-value pairs of section fields to update, e.g. {heroTitle: 'New Title', heroDescription: 'New desc'}",
            additionalProperties: { type: "string" },
          },
        },
        required: ["pageSlug", "fields"],
      },
    },
  },
] as const;

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_stats": {
      const [partnerCount] = await db.select({ count: sql<number>`count(*)` }).from(partnersTable);
      const [leadCount] = await db.select({ count: sql<number>`count(*)` }).from(partnerLeadsTable);
      const [dealCount] = await db.select({ count: sql<number>`count(*)` }).from(partnerDealsTable);
      const [commissionCount] = await db.select({ count: sql<number>`count(*)` }).from(partnerCommissionsTable);
      const [invoiceCount] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable);
      const [contactCount] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable);
      const [vendorCount] = await db.select({ count: sql<number>`count(*)` }).from(marketplaceVendorsTable);
      const [pendingPartners] = await db.select({ count: sql<number>`count(*)` }).from(partnersTable).where(eq(partnersTable.status, "pending"));
      const [pendingLeads] = await db.select({ count: sql<number>`count(*)` }).from(partnerLeadsTable).where(eq(partnerLeadsTable.status, "new"));
      const [pendingCommissions] = await db.select({ count: sql<number>`count(*)` }).from(partnerCommissionsTable).where(eq(partnerCommissionsTable.status, "pending"));
      return {
        partners: { total: Number(partnerCount.count), pending_approval: Number(pendingPartners.count) },
        leads: { total: Number(leadCount.count), new: Number(pendingLeads.count) },
        deals: { total: Number(dealCount.count) },
        commissions: { total: Number(commissionCount.count), pending: Number(pendingCommissions.count) },
        invoices: { total: Number(invoiceCount.count) },
        contacts: { total: Number(contactCount.count) },
        marketplace_vendors: Number(vendorCount.count),
      };
    }

    case "get_partners": {
      const status = args.status as string || "all";
      const tier = args.tier as string || "all";
      const limit = Number(args.limit) || 20;
      let query = db.select({
        id: partnersTable.id,
        company: partnersTable.company,
        email: partnersTable.email,
        status: partnersTable.status,
        tier: partnersTable.tier,
        ytdRevenue: partnersTable.ytdRevenue,
        createdAt: partnersTable.createdAt,
      }).from(partnersTable).orderBy(desc(partnersTable.createdAt)).limit(limit);
      if (status !== "all") query = query.where(eq(partnersTable.status, status as "pending" | "approved" | "rejected" | "suspended")) as typeof query;
      return await query;
    }

    case "update_partner": {
      const { id, status, tier } = args as { id: number; status?: string; tier?: string };
      if (status && tier) {
        await db.update(partnersTable).set({ status: status as "pending" | "approved" | "rejected" | "suspended", tier: tier as "registered" | "silver" | "gold" | "platinum", updatedAt: new Date() }).where(eq(partnersTable.id, id));
      } else if (status) {
        await db.update(partnersTable).set({ status: status as "pending" | "approved" | "rejected" | "suspended", updatedAt: new Date() }).where(eq(partnersTable.id, id));
      } else if (tier) {
        await db.update(partnersTable).set({ tier: tier as "registered" | "silver" | "gold" | "platinum", updatedAt: new Date() }).where(eq(partnersTable.id, id));
      }
      return { success: true, message: `Partner ${id} updated successfully.` };
    }

    case "get_leads": {
      const status = args.status as string || "all";
      const limit = Number(args.limit) || 20;
      let query = db.select({
        id: partnerLeadsTable.id,
        name: partnerLeadsTable.name,
        company: partnerLeadsTable.company,
        email: partnerLeadsTable.email,
        phone: partnerLeadsTable.phone,
        status: partnerLeadsTable.status,
        notes: partnerLeadsTable.notes,
        createdAt: partnerLeadsTable.createdAt,
      }).from(partnerLeadsTable).orderBy(desc(partnerLeadsTable.createdAt)).limit(limit);
      if (status !== "all") query = query.where(eq(partnerLeadsTable.status, status as "new" | "contacted" | "qualified" | "converted" | "lost")) as typeof query;
      return await query;
    }

    case "update_lead": {
      const { id, status, notes } = args as { id: number; status?: string; notes?: string };
      if (status && notes !== undefined) {
        await db.update(partnerLeadsTable).set({ status: status as "new" | "contacted" | "qualified" | "converted" | "lost", notes, updatedAt: new Date() }).where(eq(partnerLeadsTable.id, id));
      } else if (status) {
        await db.update(partnerLeadsTable).set({ status: status as "new" | "contacted" | "qualified" | "converted" | "lost", updatedAt: new Date() }).where(eq(partnerLeadsTable.id, id));
      } else if (notes !== undefined) {
        await db.update(partnerLeadsTable).set({ notes, updatedAt: new Date() }).where(eq(partnerLeadsTable.id, id));
      }
      return { success: true, message: `Lead ${id} updated successfully.` };
    }

    case "get_deals": {
      const status = args.status as string || "all";
      const limit = Number(args.limit) || 20;
      let query = db.select({
        id: partnerDealsTable.id,
        dealName: partnerDealsTable.dealName,
        customerName: partnerDealsTable.customerName,
        customerEmail: partnerDealsTable.customerEmail,
        status: partnerDealsTable.status,
        stage: partnerDealsTable.stage,
        estimatedValue: partnerDealsTable.estimatedValue,
        createdAt: partnerDealsTable.createdAt,
      }).from(partnerDealsTable).orderBy(desc(partnerDealsTable.createdAt)).limit(limit);
      if (status !== "all") query = query.where(eq(partnerDealsTable.status, status as "registered" | "in_progress" | "won" | "lost" | "expired")) as typeof query;
      return await query;
    }

    case "get_commissions": {
      const status = args.status as string || "all";
      const limit = Number(args.limit) || 20;
      let query = db.select({
        id: partnerCommissionsTable.id,
        productName: partnerCommissionsTable.productName,
        vendorName: partnerCommissionsTable.vendorName,
        amount: partnerCommissionsTable.amount,
        status: partnerCommissionsTable.status,
        periodStart: partnerCommissionsTable.periodStart,
        periodEnd: partnerCommissionsTable.periodEnd,
        createdAt: partnerCommissionsTable.createdAt,
      }).from(partnerCommissionsTable).orderBy(desc(partnerCommissionsTable.createdAt)).limit(limit);
      if (status !== "all") query = query.where(eq(partnerCommissionsTable.status, status as "pending" | "approved" | "paid" | "disputed" | "rejected")) as typeof query;
      return await query;
    }

    case "update_commission": {
      const { id, status } = args as { id: number; status: string };
      await db.update(partnerCommissionsTable).set({ status: status as "pending" | "approved" | "paid" | "disputed" | "rejected", updatedAt: new Date() }).where(eq(partnerCommissionsTable.id, id));
      return { success: true, message: `Commission ${id} marked as ${status}.` };
    }

    case "get_invoices": {
      const status = args.status as string || "all";
      const limit = Number(args.limit) || 20;
      let query = db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)).limit(limit);
      if (status !== "all") query = query.where(eq(invoicesTable.status, status as "draft" | "sent" | "paid" | "overdue")) as typeof query;
      return await query;
    }

    case "get_contacts": {
      const limit = Number(args.limit) || 20;
      const search = args.search as string | undefined;
      let query = db.select({
        id: contactsTable.id,
        name: contactsTable.name,
        email: contactsTable.email,
        phone: contactsTable.phone,
        service: contactsTable.service,
        message: contactsTable.message,
        createdAt: contactsTable.createdAt,
      }).from(contactsTable).orderBy(desc(contactsTable.createdAt)).limit(limit);
      if (search) query = query.where(or(like(contactsTable.name, `%${search}%`), like(contactsTable.email, `%${search}%`))) as typeof query;
      return await query;
    }

    case "get_marketplace": {
      const section = args.section as string || "all";
      const limit = Number(args.limit) || 15;
      const result: Record<string, unknown> = {};
      if (section === "vendors" || section === "all") {
        result.vendors = await db.select({ id: marketplaceVendorsTable.id, name: marketplaceVendorsTable.name, status: marketplaceVendorsTable.status, commissionPercent: marketplaceVendorsTable.commissionPercent }).from(marketplaceVendorsTable).orderBy(desc(marketplaceVendorsTable.createdAt)).limit(limit);
      }
      if (section === "products" || section === "all") {
        result.products = await db.select({ id: marketplaceProductsTable.id, title: marketplaceProductsTable.title, category: marketplaceProductsTable.category, status: marketplaceProductsTable.status, commissionRate: marketplaceProductsTable.commissionRate }).from(marketplaceProductsTable).limit(limit);
      }
      if (section === "orders" || section === "all") {
        result.orders = await db.select().from(marketplaceOrdersTable).orderBy(desc(marketplaceOrdersTable.createdAt)).limit(limit);
      }
      return result;
    }

    case "get_page_content": {
      const { pageSlug } = args as { pageSlug: string };
      const sections = await db.select().from(pageSectionsTable).where(eq(pageSectionsTable.pageSlug, pageSlug));
      const content: Record<string, string> = {};
      for (const s of sections) content[s.sectionKey] = s.content;
      return { pageSlug, content, note: Object.keys(content).length === 0 ? "No saved overrides — page is using default content" : undefined };
    }

    case "update_page_content": {
      const { pageSlug, fields } = args as { pageSlug: string; fields: Record<string, string> };
      for (const [key, content] of Object.entries(fields)) {
        const existing = await db.select().from(pageSectionsTable).where(and(eq(pageSectionsTable.pageSlug, pageSlug), eq(pageSectionsTable.sectionKey, key)));
        if (existing.length > 0) {
          await db.update(pageSectionsTable).set({ content, updatedAt: new Date() }).where(and(eq(pageSectionsTable.pageSlug, pageSlug), eq(pageSectionsTable.sectionKey, key)));
        } else {
          await db.insert(pageSectionsTable).values({ pageSlug, sectionKey: key, content });
        }
      }
      return { success: true, message: `Updated ${Object.keys(fields).length} field(s) on page "${pageSlug}".`, updated: fields };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

router.post("/admin/ai-assistant", requirePartnerAuth, requirePartnerAdmin, async (req: PartnerRequest, res) => {
  try {
    const { messages } = req.body as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const systemPrompt = `You are an AI admin assistant for Siebert Services, a B2B MSP and technology reseller. You help the admin manage all business operations.

You can:
- View and update partners, leads, deals, commissions, invoices, contacts, and marketplace data
- Read and update website page content (heroTitle, heroSubtitle, heroDescription, etc.)
- Answer questions about business metrics and provide summaries

Always use your tools to fetch real data before answering questions about specific records or counts. Do not guess — call the tool.

When updating data, confirm what you changed. When showing lists, format them clearly with key details. Be concise, professional, and action-oriented.

Available page slugs for content editing: home, comcast-business, spectrum-business, att-business, verizon-business, cox-business, ringcentral, microsoft-365, 8x8, t-mobile-business, lumen, cisco-meraki, fortinet, adt-business, palo-alto-networks, altice, dell, hp, extreme-networks, juniper-networks, vivint, zoom-partner`;

    const apiMessages: Parameters<OpenAIClient["chat"]["completions"]["create"]>[0]["messages"] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const send = (obj: Record<string, unknown>) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    let iterations = 0;
    const MAX_ITERATIONS = 8;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: apiMessages,
        tools: TOOLS,
        tool_choice: "auto",
        stream: false,
      });

      const choice = response.choices[0];
      const msg = choice.message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        apiMessages.push(msg);

        for (const call of msg.tool_calls) {
          const toolName = call.function.name;
          let toolArgs: Record<string, unknown> = {};
          try { toolArgs = JSON.parse(call.function.arguments); } catch { /* empty */ }

          send({ type: "tool_call", name: toolName, args: toolArgs });

          let result: unknown;
          try {
            result = await executeTool(toolName, toolArgs);
          } catch (err) {
            result = { error: String(err) };
          }

          send({ type: "tool_result", name: toolName, result });

          apiMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      const finalText = msg.content ?? "";
      if (finalText) {
        send({ type: "content", text: finalText });
      }
      send({ type: "done", fullText: finalText });
      res.end();
      return;
    }

    send({ type: "done", fullText: "Reached maximum tool call iterations." });
    res.end();
  } catch (err) {
    console.error("[ai-admin] Error:", err);
    const e = err as { status?: number; code?: string; message?: string };
    let reason = "Please try again.";
    if (e?.status === 401 || e?.status === 403) reason = "AI service authentication failed.";
    else if (e?.status === 404 || e?.code === "model_not_found") reason = "Model unavailable.";
    else if (e?.status === 429) reason = "Rate limited by AI service.";
    else if (e?.status === 408 || e?.code === "ETIMEDOUT") reason = "AI service timed out.";
    else if (e?.status && e.status >= 500) reason = "AI service unavailable.";
    else if (typeof e?.message === "string" && e.message) reason = e.message.slice(0, 160);
    res.write(`data: ${JSON.stringify({ type: "error", message: `AI assistant failed: ${reason}` })}\n\n`);
    res.end();
  }
});

export default router;
