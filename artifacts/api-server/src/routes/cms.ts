import { Router, type IRouter } from "express";
import { Response, Request, NextFunction } from "express";
import crypto from "crypto";
import { db, siteSettingsTable, servicesTable, testimonialsTable, teamMembersTable, faqItemsTable, blogPostsTable, activityLogTable, usersTable, contactsTable, quotesTable, ticketsTable, ticketMessagesTable, caseStudiesTable, certificationsTable, companyStatsTable, pricingTiersTable, industriesTable } from "@workspace/db";
import { eq, desc, like, or, sql, count } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth.js";
import { requirePartnerAuth, PartnerRequest } from "../middlewares/partnerAuth.js";
import jwt from "jsonwebtoken";
import { getSmtpSettings, testSmtpConnection, invalidateSmtpCache, sendAdminTicketReply, sendTicketStatusUpdate, sendQuoteStatusUpdate, sendClientWelcomeFromQuote } from "../lib/email.js";
import { stripe, isStripeConfigured } from "../lib/stripe.js";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "siebert-services-secret-key-2024";
const router: IRouter = Router();

function requireAdmin(req: AuthRequest, res: Response, next: Function) {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "forbidden", message: "Admin access required" });
    return;
  }
  next();
}

function requireAdminOrPartnerAdmin(req: Request & AuthRequest & PartnerRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId?: number; role?: string; partnerId?: number; isAdmin?: boolean };
    if ((payload.userId && payload.role === "admin") || (payload.partnerId && payload.isAdmin === true)) {
      req.userId = payload.userId;
      req.userRole = payload.role;
      req.partnerId = payload.partnerId;
      req.partnerIsAdmin = payload.isAdmin === true;
      next();
    } else {
      res.status(403).json({ error: "forbidden", message: "Admin access required" });
    }
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
  }
}

async function logActivity(userId: number | undefined, action: string, entity: string, entityId?: number, details?: string) {
  try {
    await db.insert(activityLogTable).values({ userId: userId || null, action, entity, entityId: entityId || null, details: details || null });
  } catch (e) { /* silent */ }
}

// ─── Public CMS Reads ────────────────────────────────────────────────────────

// Allowlist of settings safe to expose publicly (no secrets, no internal config).
const PUBLIC_SETTING_KEYS = new Set<string>([
  "booking_url",
  "company_name",
  "company_phone",
  "company_email",
  "company_address",
  "social_linkedin",
  "social_facebook",
  "social_twitter",
  "social_youtube",
  "hero_title",
  "hero_subtitle",
  "support_phone",
  "emergency_phone",
  "office_hours",
]);

// Public endpoint: only allowlisted, non-sensitive settings.
// IMPORTANT: never expose `smtp_*`, API keys, or any credential here.
router.get("/cms/settings", async (_req, res) => {
  try {
    const settings = await db.select().from(siteSettingsTable);
    const map: Record<string, string> = {};
    for (const s of settings) {
      if (PUBLIC_SETTING_KEYS.has(s.key)) map[s.key] = s.value;
    }
    res.json(map);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load settings" });
  }
});

// Authenticated admin endpoint: full settings (including sensitive keys).
router.get("/admin/cms/settings", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await db.select().from(siteSettingsTable);
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    res.json(map);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load settings" });
  }
});

router.get("/cms/services", async (_req, res) => {
  try {
    const services = await db.select().from(servicesTable)
      .where(eq(servicesTable.active, true));
    res.json(services.map(s => ({ ...s, features: JSON.parse(s.features) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load services" });
  }
});

router.get("/cms/testimonials", async (_req, res) => {
  try {
    const items = await db.select().from(testimonialsTable)
      .where(eq(testimonialsTable.active, true));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load testimonials" });
  }
});

router.get("/cms/team", async (_req, res) => {
  try {
    const members = await db.select().from(teamMembersTable)
      .where(eq(teamMembersTable.active, true));
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load team" });
  }
});

router.get("/cms/faq", async (_req, res) => {
  try {
    const items = await db.select().from(faqItemsTable)
      .where(eq(faqItemsTable.active, true));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load FAQ" });
  }
});

router.get("/cms/blog", async (_req, res) => {
  try {
    const posts = await db.select().from(blogPostsTable)
      .where(eq(blogPostsTable.status, "published"))
      .orderBy(desc(blogPostsTable.publishedAt));
    res.json(posts.map(p => ({ ...p, tags: JSON.parse(p.tags) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load blog posts" });
  }
});

router.get("/cms/blog/:slug", async (req, res) => {
  try {
    const [post] = await db.select().from(blogPostsTable)
      .where(eq(blogPostsTable.slug, req.params.slug as string))
      .limit(1);
    if (!post || post.status !== "published") {
      res.status(404).json({ error: "not_found", message: "Blog post not found" });
      return;
    }
    res.json({ ...post, tags: JSON.parse(post.tags) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load blog post" });
  }
});

// ─── Admin CMS Writes ─────────────────────────────────────────────────────────

// Dashboard Stats
router.get("/admin/dashboard/stats", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [contactCount] = await db.select({ count: count() }).from(contactsTable);
    const [quoteCount] = await db.select({ count: count() }).from(quotesTable);
    const [ticketCount] = await db.select({ count: count() }).from(ticketsTable);
    const [openTickets] = await db.select({ count: count() }).from(ticketsTable).where(eq(ticketsTable.status, "open"));
    const [blogCount] = await db.select({ count: count() }).from(blogPostsTable);
    const [userCount] = await db.select({ count: count() }).from(usersTable);

    const recentContacts = await db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt)).limit(5);
    const recentQuotes = await db.select().from(quotesTable).orderBy(desc(quotesTable.createdAt)).limit(5);

    res.json({
      contacts: contactCount.count,
      quotes: quoteCount.count,
      tickets: ticketCount.count,
      openTickets: openTickets.count,
      blogPosts: blogCount.count,
      users: userCount.count,
      recentContacts,
      recentQuotes: recentQuotes.map(q => ({ ...q, services: JSON.parse(q.services) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load dashboard stats" });
  }
});

// Settings
router.put("/admin/cms/settings", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, string> = req.body;
    for (const [key, value] of Object.entries(updates)) {
      const existing = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
      if (existing.length > 0) {
        await db.update(siteSettingsTable).set({ value, updatedAt: new Date() }).where(eq(siteSettingsTable.key, key));
      } else {
        await db.insert(siteSettingsTable).values({ key, value });
      }
    }
    await logActivity(req.userId, "update", "settings", undefined, `Updated ${Object.keys(updates).length} settings`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update settings" });
  }
});

// SMTP Settings
router.get("/admin/smtp", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await getSmtpSettings();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load SMTP settings" });
  }
});

const EMAIL_DB_KEYS = [
  "smtp_host", "smtp_port", "smtp_user", "smtp_pass",
  "smtp_from_email", "smtp_from_name", "notification_email",
];
const MASKED_PLACEHOLDER = "••••••••";
const MASKED_KEYS = new Set(["smtp_pass"]);

router.put("/admin/smtp", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const body: Record<string, string> = req.body;
    for (const key of EMAIL_DB_KEYS) {
      if (!(key in body)) continue;
      if (MASKED_KEYS.has(key) && body[key] === MASKED_PLACEHOLDER) continue;
      const value = String(body[key]);
      const existing = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
      if (existing.length > 0) {
        await db.update(siteSettingsTable).set({ value, updatedAt: new Date() }).where(eq(siteSettingsTable.key, key));
      } else {
        await db.insert(siteSettingsTable).values({ key, value });
      }
    }
    invalidateSmtpCache();
    await logActivity(req.userId, "update", "smtp_settings", undefined, "Updated email configuration");
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to save email settings" });
  }
});

router.post("/admin/smtp/test", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await testSmtpConnection();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Unexpected error during test" });
  }
});

// Services CRUD
router.get("/admin/cms/services", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const services = await db.select().from(servicesTable);
    res.json(services.map(s => ({ ...s, features: JSON.parse(s.features) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load services" });
  }
});

router.post("/admin/cms/services", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, icon, category, features, sortOrder, active } = req.body;
    const [service] = await db.insert(servicesTable).values({
      title, description,
      icon: icon || "Monitor",
      category: category || "general",
      features: JSON.stringify(features || []),
      sortOrder: sortOrder || 0,
      active: active !== false,
    }).returning();
    await logActivity(req.userId, "create", "service", service.id, `Created service: ${title}`);
    res.status(201).json({ ...service, features: JSON.parse(service.features) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create service" });
  }
});

router.put("/admin/cms/services/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { title, description, icon, category, features, sortOrder, active } = req.body;
    const [service] = await db.update(servicesTable).set({
      title, description,
      icon: icon || "Monitor",
      category: category || "general",
      features: JSON.stringify(features || []),
      sortOrder: sortOrder ?? 0,
      active: active !== false,
      updatedAt: new Date(),
    }).where(eq(servicesTable.id, id)).returning();
    if (!service) { res.status(404).json({ error: "not_found", message: "Service not found" }); return; }
    await logActivity(req.userId, "update", "service", id, `Updated service: ${title}`);
    res.json({ ...service, features: JSON.parse(service.features) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update service" });
  }
});

router.delete("/admin/cms/services/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(servicesTable).where(eq(servicesTable.id, id));
    await logActivity(req.userId, "delete", "service", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete service" });
  }
});

// Testimonials CRUD
router.get("/admin/cms/testimonials", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(testimonialsTable);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load testimonials" });
  }
});

router.post("/admin/cms/testimonials", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, company, role, content, rating, active, sortOrder } = req.body;
    const [item] = await db.insert(testimonialsTable).values({
      name, company, role: role || null, content,
      rating: rating || 5, active: active !== false, sortOrder: sortOrder || 0,
    }).returning();
    await logActivity(req.userId, "create", "testimonial", item.id, `Created testimonial from: ${name}`);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create testimonial" });
  }
});

router.put("/admin/cms/testimonials/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, company, role, content, rating, active, sortOrder } = req.body;
    const [item] = await db.update(testimonialsTable).set({
      name, company, role: role || null, content,
      rating: rating || 5, active: active !== false, sortOrder: sortOrder ?? 0,
    }).where(eq(testimonialsTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "not_found", message: "Testimonial not found" }); return; }
    await logActivity(req.userId, "update", "testimonial", id);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update testimonial" });
  }
});

router.delete("/admin/cms/testimonials/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(testimonialsTable).where(eq(testimonialsTable.id, id));
    await logActivity(req.userId, "delete", "testimonial", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete testimonial" });
  }
});

// Team Members CRUD
router.get("/admin/cms/team", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const members = await db.select().from(teamMembersTable);
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load team members" });
  }
});

router.post("/admin/cms/team", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, role, bio, imageUrl, sortOrder, active } = req.body;
    const [member] = await db.insert(teamMembersTable).values({
      name, role, bio: bio || null, imageUrl: imageUrl || null,
      sortOrder: sortOrder || 0, active: active !== false,
    }).returning();
    await logActivity(req.userId, "create", "team_member", member.id, `Added team member: ${name}`);
    res.status(201).json(member);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create team member" });
  }
});

router.put("/admin/cms/team/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, role, bio, imageUrl, sortOrder, active } = req.body;
    const [member] = await db.update(teamMembersTable).set({
      name, role, bio: bio || null, imageUrl: imageUrl || null,
      sortOrder: sortOrder ?? 0, active: active !== false,
    }).where(eq(teamMembersTable.id, id)).returning();
    if (!member) { res.status(404).json({ error: "not_found", message: "Team member not found" }); return; }
    await logActivity(req.userId, "update", "team_member", id);
    res.json(member);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update team member" });
  }
});

router.delete("/admin/cms/team/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(teamMembersTable).where(eq(teamMembersTable.id, id));
    await logActivity(req.userId, "delete", "team_member", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete team member" });
  }
});

// FAQ CRUD
router.get("/admin/cms/faq", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(faqItemsTable);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load FAQ" });
  }
});

router.post("/admin/cms/faq", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { question, answer, category, sortOrder, active } = req.body;
    const [item] = await db.insert(faqItemsTable).values({
      question, answer, category: category || "general",
      sortOrder: sortOrder || 0, active: active !== false,
    }).returning();
    await logActivity(req.userId, "create", "faq", item.id);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create FAQ item" });
  }
});

router.put("/admin/cms/faq/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { question, answer, category, sortOrder, active } = req.body;
    const [item] = await db.update(faqItemsTable).set({
      question, answer, category: category || "general",
      sortOrder: sortOrder ?? 0, active: active !== false,
    }).where(eq(faqItemsTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "not_found", message: "FAQ item not found" }); return; }
    await logActivity(req.userId, "update", "faq", id);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update FAQ item" });
  }
});

router.delete("/admin/cms/faq/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(faqItemsTable).where(eq(faqItemsTable.id, id));
    await logActivity(req.userId, "delete", "faq", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete FAQ item" });
  }
});

// ─── Blog CRUD ──────────────────────────────────────────────────────────────

router.get("/admin/cms/blog", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const posts = await db.select().from(blogPostsTable).orderBy(desc(blogPostsTable.createdAt));
    res.json(posts.map(p => ({ ...p, tags: JSON.parse(p.tags) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load blog posts" });
  }
});

router.post("/admin/cms/blog", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { title, slug, excerpt, content, coverImage, author, category, tags, status, featured, scheduledAt, contentType } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: "validation_error", message: "title and content are required" });
      return;
    }
    const autoSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const [post] = await db.insert(blogPostsTable).values({
      title, slug: autoSlug, excerpt: excerpt || null, content,
      coverImage: coverImage || null, author: author || "Siebert Services",
      category: category || "general", tags: JSON.stringify(tags || []),
      status: status || "draft", featured: featured || false,
      publishedAt: status === "published" ? new Date() : null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      contentType: contentType || "news",
    }).returning();
    await logActivity(req.userId, "create", "blog_post", post.id, `Created blog post: ${title}`);
    res.status(201).json({ ...post, tags: JSON.parse(post.tags) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create blog post" });
  }
});

router.put("/admin/cms/blog/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { title, slug, excerpt, content, coverImage, author, category, tags, status, featured, scheduledAt, contentType } = req.body;
    const existing = await db.select().from(blogPostsTable).where(eq(blogPostsTable.id, id)).limit(1);
    const wasPublished = existing[0]?.status === "published";
    const [post] = await db.update(blogPostsTable).set({
      title, slug, excerpt: excerpt || null, content,
      coverImage: coverImage || null, author: author || "Siebert Services",
      category: category || "general", tags: JSON.stringify(tags || []),
      status: status || "draft", featured: featured || false,
      publishedAt: status === "published" && !wasPublished ? new Date() : existing[0]?.publishedAt,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      contentType: contentType || existing[0]?.contentType || "news",
      updatedAt: new Date(),
    }).where(eq(blogPostsTable.id, id)).returning();
    if (!post) { res.status(404).json({ error: "not_found", message: "Blog post not found" }); return; }
    await logActivity(req.userId, "update", "blog_post", id, `Updated blog post: ${title}`);
    res.json({ ...post, tags: JSON.parse(post.tags) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update blog post" });
  }
});

router.delete("/admin/cms/blog/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(blogPostsTable).where(eq(blogPostsTable.id, id));
    await logActivity(req.userId, "delete", "blog_post", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete blog post" });
  }
});

// ─── Case Studies ────────────────────────────────────────────────────────────

router.get("/cms/case-studies", async (_req, res) => {
  try {
    const items = await db.select().from(caseStudiesTable)
      .where(eq(caseStudiesTable.active, true))
      .orderBy(desc(caseStudiesTable.featured), caseStudiesTable.sortOrder);
    res.json(items.map(c => ({
      ...c,
      metrics: safeParse(c.metrics, []),
      services: safeParse(c.services, []),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load case studies" });
  }
});

router.get("/cms/case-studies/:slug", async (req, res) => {
  try {
    const [item] = await db.select().from(caseStudiesTable)
      .where(eq(caseStudiesTable.slug, req.params.slug as string)).limit(1);
    if (!item || !item.active) {
      res.status(404).json({ error: "not_found", message: "Case study not found" });
      return;
    }
    res.json({ ...item, metrics: safeParse(item.metrics, []), services: safeParse(item.services, []) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load case study" });
  }
});

router.get("/admin/cms/case-studies", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(caseStudiesTable).orderBy(desc(caseStudiesTable.createdAt));
    res.json(items.map(c => ({ ...c, metrics: safeParse(c.metrics, []), services: safeParse(c.services, []) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load case studies" });
  }
});

router.post("/admin/cms/case-studies", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body;
    if (!b.title || !b.summary) {
      res.status(400).json({ error: "validation_error", message: "title and summary are required" });
      return;
    }
    const slug = (b.slug || b.title).toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const [item] = await db.insert(caseStudiesTable).values({
      slug, title: b.title, client: b.client || "Confidential",
      industry: b.industry || "General",
      summary: b.summary, problem: b.problem || "", solution: b.solution || "", result: b.result || "",
      metrics: JSON.stringify(b.metrics || []),
      services: JSON.stringify(b.services || []),
      coverImage: b.coverImage || null, logoUrl: b.logoUrl || null,
      quote: b.quote || null, quoteAuthor: b.quoteAuthor || null, quoteRole: b.quoteRole || null,
      featured: !!b.featured, active: b.active !== false, sortOrder: b.sortOrder || 0,
    }).returning();
    await logActivity(req.userId, "create", "case_study", item.id, `Created case study: ${b.title}`);
    res.status(201).json({ ...item, metrics: safeParse(item.metrics, []), services: safeParse(item.services, []) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create case study" });
  }
});

router.put("/admin/cms/case-studies/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const b = req.body;
    const [item] = await db.update(caseStudiesTable).set({
      slug: b.slug, title: b.title, client: b.client || "Confidential",
      industry: b.industry || "General",
      summary: b.summary, problem: b.problem || "", solution: b.solution || "", result: b.result || "",
      metrics: JSON.stringify(b.metrics || []),
      services: JSON.stringify(b.services || []),
      coverImage: b.coverImage || null, logoUrl: b.logoUrl || null,
      quote: b.quote || null, quoteAuthor: b.quoteAuthor || null, quoteRole: b.quoteRole || null,
      featured: !!b.featured, active: b.active !== false, sortOrder: b.sortOrder ?? 0,
      updatedAt: new Date(),
    }).where(eq(caseStudiesTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "not_found", message: "Case study not found" }); return; }
    await logActivity(req.userId, "update", "case_study", id);
    res.json({ ...item, metrics: safeParse(item.metrics, []), services: safeParse(item.services, []) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update case study" });
  }
});

router.delete("/admin/cms/case-studies/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(caseStudiesTable).where(eq(caseStudiesTable.id, id));
    await logActivity(req.userId, "delete", "case_study", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete case study" });
  }
});

// ─── Certifications ──────────────────────────────────────────────────────────

router.get("/cms/certifications", async (_req, res) => {
  try {
    const items = await db.select().from(certificationsTable)
      .where(eq(certificationsTable.active, true))
      .orderBy(certificationsTable.sortOrder);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load certifications" });
  }
});

router.get("/admin/cms/certifications", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(certificationsTable).orderBy(certificationsTable.sortOrder);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load certifications" });
  }
});

router.post("/admin/cms/certifications", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, category, logoUrl, url, sortOrder, active } = req.body;
    const [item] = await db.insert(certificationsTable).values({
      name, category: category || "partner", logoUrl: logoUrl || null, url: url || null,
      sortOrder: sortOrder || 0, active: active !== false,
    }).returning();
    await logActivity(req.userId, "create", "certification", item.id, `Added certification: ${name}`);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create certification" });
  }
});

router.put("/admin/cms/certifications/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, category, logoUrl, url, sortOrder, active } = req.body;
    const [item] = await db.update(certificationsTable).set({
      name, category: category || "partner", logoUrl: logoUrl || null, url: url || null,
      sortOrder: sortOrder ?? 0, active: active !== false,
    }).where(eq(certificationsTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "not_found", message: "Certification not found" }); return; }
    await logActivity(req.userId, "update", "certification", id);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update certification" });
  }
});

router.delete("/admin/cms/certifications/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(certificationsTable).where(eq(certificationsTable.id, id));
    await logActivity(req.userId, "delete", "certification", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete certification" });
  }
});

// ─── Company Stats ───────────────────────────────────────────────────────────

router.get("/cms/company-stats", async (_req, res) => {
  try {
    const items = await db.select().from(companyStatsTable)
      .where(eq(companyStatsTable.active, true))
      .orderBy(companyStatsTable.sortOrder);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load stats" });
  }
});

router.get("/admin/cms/company-stats", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(companyStatsTable).orderBy(companyStatsTable.sortOrder);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load stats" });
  }
});

router.post("/admin/cms/company-stats", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { label, value, suffix, icon, sortOrder, active } = req.body;
    const [item] = await db.insert(companyStatsTable).values({
      label, value: String(value), suffix: suffix || null, icon: icon || "TrendingUp",
      sortOrder: sortOrder || 0, active: active !== false,
    }).returning();
    await logActivity(req.userId, "create", "company_stat", item.id, `Added stat: ${label}`);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create stat" });
  }
});

router.put("/admin/cms/company-stats/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { label, value, suffix, icon, sortOrder, active } = req.body;
    const [item] = await db.update(companyStatsTable).set({
      label, value: String(value), suffix: suffix || null, icon: icon || "TrendingUp",
      sortOrder: sortOrder ?? 0, active: active !== false,
    }).where(eq(companyStatsTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "not_found", message: "Stat not found" }); return; }
    await logActivity(req.userId, "update", "company_stat", id);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update stat" });
  }
});

router.delete("/admin/cms/company-stats/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(companyStatsTable).where(eq(companyStatsTable.id, id));
    await logActivity(req.userId, "delete", "company_stat", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete stat" });
  }
});

// ─── Pricing Tiers ───────────────────────────────────────────────────────────

function parsePricingTier(t: any) {
  return {
    ...t,
    features: JSON.parse(t.features || "[]"),
    excludedFeatures: JSON.parse(t.excludedFeatures || "[]"),
  };
}

router.get("/cms/pricing-tiers", async (_req, res) => {
  try {
    const items = await db.select().from(pricingTiersTable)
      .where(eq(pricingTiersTable.active, true))
      .orderBy(pricingTiersTable.sortOrder);
    res.json(items.map(parsePricingTier));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load pricing tiers" });
  }
});

router.get("/admin/cms/pricing-tiers", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(pricingTiersTable).orderBy(pricingTiersTable.sortOrder);
    res.json(items.map(parsePricingTier));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load pricing tiers" });
  }
});

router.post("/admin/cms/pricing-tiers", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug, name, tagline, startingPrice, annualPrice, priceUnit, pricePrefix, mostPopular, features, excludedFeatures, ctaLabel, ctaLink, sortOrder, active, autoActivate, stripeProductId, stripeMonthlyPriceId, stripeAnnualPriceId } = req.body;
    const autoSlug = slug || String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const [item] = await db.insert(pricingTiersTable).values({
      slug: autoSlug,
      name,
      tagline: tagline || "",
      startingPrice: String(startingPrice ?? "0"),
      annualPrice: String(annualPrice ?? "0"),
      priceUnit: priceUnit || "per user / month",
      pricePrefix: pricePrefix || "Starting at",
      mostPopular: !!mostPopular,
      features: JSON.stringify(features || []),
      excludedFeatures: JSON.stringify(excludedFeatures || []),
      ctaLabel: ctaLabel || "Get Started",
      ctaLink: ctaLink || "/quote",
      sortOrder: sortOrder || 0,
      active: active !== false,
      autoActivate: autoActivate === true || autoActivate === "true",
      stripeProductId: stripeProductId || null,
      stripeMonthlyPriceId: stripeMonthlyPriceId || null,
      stripeAnnualPriceId: stripeAnnualPriceId || null,
    }).returning();
    await logActivity(req.userId, "create", "pricing_tier", item.id, `Added pricing tier: ${name}`);
    res.status(201).json(parsePricingTier(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create pricing tier" });
  }
});

function parsePriceCents(priceText: string): number | null {
  const digits = String(priceText).replace(/[^0-9.]/g, "");
  const num = parseFloat(digits);
  if (!isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

router.put("/admin/cms/pricing-tiers/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { slug, name, tagline, startingPrice, annualPrice, priceUnit, pricePrefix, mostPopular, features, excludedFeatures, ctaLabel, ctaLink, sortOrder, active, autoActivate, stripeProductId: bodyStripeProductId, stripeMonthlyPriceId: bodyMonthlyId, stripeAnnualPriceId: bodyAnnualId } = req.body;

    const [existing] = await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found", message: "Pricing tier not found" }); return; }

    const newMonthlyStr = String(startingPrice ?? "0");
    const newAnnualStr = String(annualPrice ?? "0");

    const newMonthlyCents = parsePriceCents(newMonthlyStr);
    const newAnnualCents = parsePriceCents(newAnnualStr);
    const oldMonthlyCents = parsePriceCents(existing.startingPrice);
    const oldAnnualCents = parsePriceCents(existing.annualPrice);

    const monthlyChanged = newMonthlyCents !== oldMonthlyCents;
    const annualChanged = newAnnualCents !== oldAnnualCents;

    const effectiveProductId = 'stripeProductId' in req.body
      ? (bodyStripeProductId || null)
      : (existing.stripeProductId || null);
    let resolvedMonthlyId = bodyMonthlyId !== undefined ? (bodyMonthlyId || null) : existing.stripeMonthlyPriceId;
    let resolvedAnnualId = bodyAnnualId !== undefined ? (bodyAnnualId || null) : existing.stripeAnnualPriceId;

    if (isStripeConfigured() && stripe) {
      if (monthlyChanged) {
        if (newMonthlyCents !== null && effectiveProductId) {
          const newPrice = await stripe.prices.create({
            product: effectiveProductId,
            unit_amount: newMonthlyCents,
            currency: "usd",
            recurring: { interval: "month" },
          });
          resolvedMonthlyId = newPrice.id;
          console.log(`[pricing-tier ${id}] New Stripe monthly price: ${newPrice.id} ($${newMonthlyCents / 100}/mo)`);
          if (existing.stripeMonthlyPriceId) {
            try { await stripe.prices.update(existing.stripeMonthlyPriceId, { active: false }); } catch (e) { console.warn(`[pricing-tier ${id}] Could not deactivate old monthly price ${existing.stripeMonthlyPriceId}:`, e); }
          }
        } else {
          // Price changed but no parseable amount or no stripeProductId. Clear the stale
          // Stripe price ID so the next checkout can auto-create a fresh one at the
          // correct amount rather than charging the wrong old price.
          resolvedMonthlyId = null;
          if (!effectiveProductId) console.warn(`[pricing-tier ${id}] Monthly price changed but no stripeProductId — clearing stale price ID`);
        }
      }
      if (annualChanged) {
        if (newAnnualCents !== null && effectiveProductId) {
          const newPrice = await stripe.prices.create({
            product: effectiveProductId,
            unit_amount: newAnnualCents,
            currency: "usd",
            recurring: { interval: "year" },
          });
          resolvedAnnualId = newPrice.id;
          console.log(`[pricing-tier ${id}] New Stripe annual price: ${newPrice.id} ($${newAnnualCents / 100}/yr)`);
          if (existing.stripeAnnualPriceId) {
            try { await stripe.prices.update(existing.stripeAnnualPriceId, { active: false }); } catch (e) { console.warn(`[pricing-tier ${id}] Could not deactivate old annual price ${existing.stripeAnnualPriceId}:`, e); }
          }
        } else {
          // Same rationale as monthly: clear stale ID so checkout regenerates correctly.
          resolvedAnnualId = null;
          if (!effectiveProductId) console.warn(`[pricing-tier ${id}] Annual price changed but no stripeProductId — clearing stale price ID`);
        }
      }
    } else if (!isStripeConfigured()) {
      if (monthlyChanged) resolvedMonthlyId = null;
      if (annualChanged) resolvedAnnualId = null;
    }

    const [item] = await db.update(pricingTiersTable).set({
      slug,
      name,
      tagline: tagline || "",
      startingPrice: newMonthlyStr,
      annualPrice: newAnnualStr,
      priceUnit: priceUnit || "per user / month",
      pricePrefix: pricePrefix || "Starting at",
      mostPopular: !!mostPopular,
      features: JSON.stringify(features || []),
      excludedFeatures: JSON.stringify(excludedFeatures || []),
      ctaLabel: ctaLabel || "Get Started",
      ctaLink: ctaLink || "/quote",
      sortOrder: sortOrder ?? 0,
      active: active !== false,
      autoActivate: autoActivate === true || autoActivate === "true",
      stripeProductId: effectiveProductId,
      stripeMonthlyPriceId: resolvedMonthlyId,
      stripeAnnualPriceId: resolvedAnnualId,
      updatedAt: new Date(),
    }).where(eq(pricingTiersTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "not_found", message: "Pricing tier not found" }); return; }
    await logActivity(req.userId, "update", "pricing_tier", id, `Updated pricing tier: ${name}${monthlyChanged || annualChanged ? " (price changed)" : ""}`);
    res.json(parsePricingTier(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update pricing tier" });
  }
});

router.delete("/admin/cms/pricing-tiers/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(pricingTiersTable).where(eq(pricingTiersTable.id, id));
    await logActivity(req.userId, "delete", "pricing_tier", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete pricing tier" });
  }
});

// ─── Google Reviews (cached) ────────────────────────────────────────────────

const REVIEWS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let reviewsCache: { fetchedAt: number; payload: any } | null = null;

router.get("/cms/google-reviews", async (_req, res) => {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const placeIdSetting = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "google_place_id")).limit(1);
    const placeId = placeIdSetting[0]?.value || process.env.GOOGLE_PLACE_ID || "";

    if (!apiKey || !placeId) {
      res.json({ configured: false, reviews: [], rating: null, total: 0 });
      return;
    }

    if (reviewsCache && Date.now() - reviewsCache.fetchedAt < REVIEWS_TTL_MS) {
      res.json(reviewsCache.payload);
      return;
    }

    const params = new URLSearchParams({
      place_id: placeId,
      key: apiKey,
      fields: "name,rating,user_ratings_total,reviews,url",
    });
    const r = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
    const data: any = await r.json();
    if (data.status !== "OK") {
      res.json({ configured: true, error: data.status, reviews: [], rating: null, total: 0 });
      return;
    }
    const result = data.result || {};
    const payload = {
      configured: true,
      name: result.name,
      rating: result.rating ?? null,
      total: result.user_ratings_total ?? 0,
      url: result.url || null,
      reviews: (result.reviews || []).map((rv: any) => ({
        author: rv.author_name,
        avatar: rv.profile_photo_url,
        rating: rv.rating,
        text: rv.text,
        relativeTime: rv.relative_time_description,
        time: rv.time,
      })),
    };
    reviewsCache = { fetchedAt: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    console.error("[google-reviews] Error:", err);
    res.json({ configured: false, reviews: [], rating: null, total: 0 });
  }
});

// helper used above
function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// ─── User Management ────────────────────────────────────────────────────────

router.get("/admin/users", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email,
      company: usersTable.company, phone: usersTable.phone, role: usersTable.role,
      createdAt: usersTable.createdAt, mustChangePassword: usersTable.mustChangePassword,
    }).from(usersTable).orderBy(desc(usersTable.createdAt));
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load users" });
  }
});

router.post("/admin/users", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email: rawEmail, password, company, phone, role } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    
    if (!name || !email || !password || !company) {
      res.status(400).json({ error: "validation_error", message: "name, email, password, and company are required" });
      return;
    }

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "conflict", message: "An account with this email already exists" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db.insert(usersTable).values({
      name,
      email,
      password: hashedPassword,
      company,
      phone: phone || null,
      role: role || "client",
    }).returning();

    await logActivity(req.userId, "create", "user", user.id);
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      company: user.company,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create user" });
  }
});

router.put("/admin/users/:id/role", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { role } = req.body;
    if (!["client", "admin"].includes(role)) {
      res.status(400).json({ error: "validation_error", message: "Invalid role" });
      return;
    }
    const [user] = await db.update(usersTable).set({ role }).where(eq(usersTable.id, id)).returning();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId, "update", "user", id, `Changed role to: ${role}`);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update user role" });
  }
});

router.delete("/admin/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (id === req.userId) {
      res.status(400).json({ error: "validation_error", message: "Cannot delete your own account" });
      return;
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));
    await logActivity(req.userId, "delete", "user", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete user" });
  }
});

router.post("/admin/users/:id/resend-welcome", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    if (!user.mustChangePassword) {
      res.status(400).json({ error: "invalid_request", message: "This account has already set a permanent password" });
      return;
    }

    const temporaryPassword = crypto.randomBytes(8).toString("base64url").slice(0, 12);
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    await db.update(usersTable).set({ password: hashedPassword, mustChangePassword: true }).where(eq(usersTable.id, id));

    sendClientWelcomeFromQuote({
      name: user.name,
      email: user.email,
      company: user.company || "",
      temporaryPassword,
    }).catch(err => console.error("[Email] Resend welcome error:", err));

    await logActivity(req.userId, "update", "user", id, "Resent welcome email with new temporary password");
    res.json({ success: true, message: "Welcome email resent successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to resend welcome email" });
  }
});

// ─── Enhanced Contacts / Quotes / Tickets ─────────────────────────────────────

router.get("/admin/contacts", requireAdminOrPartnerAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const items = await db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load contacts" });
  }
});

router.delete("/admin/contacts/:id", requireAdminOrPartnerAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(contactsTable).where(eq(contactsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete contact" });
  }
});

router.get("/admin/quotes", requireAdminOrPartnerAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const items = await db.select().from(quotesTable).orderBy(desc(quotesTable.createdAt));
    res.json(items.map(q => ({ ...q, services: JSON.parse(q.services) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load quotes" });
  }
});

router.put("/admin/quotes/:id/status", requireAdminOrPartnerAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { status, internalNotes, assignedTo } = req.body;
    const updates: any = {};
    if (status) updates.status = status;
    if (internalNotes !== undefined) updates.internalNotes = internalNotes;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    const [quote] = await db.update(quotesTable).set(updates).where(eq(quotesTable.id, id)).returning();
    if (!quote) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId, "update", "quote", id, `Status changed to: ${status}`);

    if (status && ["reviewing", "quoted", "closed"].includes(status)) {
      sendQuoteStatusUpdate(
        { id: quote.id, name: quote.name, email: quote.email, company: quote.company, services: quote.services },
        status,
      ).catch(err => console.error("[Email] Quote status notification error:", err));
    }

    res.json({ ...quote, services: JSON.parse(quote.services) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update quote" });
  }
});

router.delete("/admin/quotes/:id", requireAdminOrPartnerAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(quotesTable).where(eq(quotesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete quote" });
  }
});

router.get("/admin/tickets", requireAuth, requireAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const items = await db.select().from(ticketsTable).orderBy(desc(ticketsTable.createdAt));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load tickets" });
  }
});

router.get("/admin/tickets/:id", requireAuth, requireAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id)).limit(1);
    if (!ticket) { res.status(404).json({ error: "not_found" }); return; }
    const messages = await db.select().from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, id))
      .orderBy(ticketMessagesTable.createdAt);
    res.json({ ...ticket, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load ticket" });
  }
});

router.post("/admin/tickets/:id/messages", requireAuth, requireAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { message } = req.body;
    if (!message) { res.status(400).json({ error: "validation_error", message: "message is required" }); return; }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id)).limit(1);
    if (!ticket) { res.status(404).json({ error: "not_found" }); return; }

    const [msg] = await db.insert(ticketMessagesTable).values({
      ticketId: id,
      senderType: "admin",
      senderName: "Siebert Services Support",
      message,
    }).returning();

    if (ticket.status === "resolved" || ticket.status === "closed") {
      await db.update(ticketsTable).set({ status: "in_progress", updatedAt: new Date() }).where(eq(ticketsTable.id, id));
    } else {
      await db.update(ticketsTable).set({ updatedAt: new Date() }).where(eq(ticketsTable.id, id));
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ticket.userId)).limit(1);
    if (user) {
      sendAdminTicketReply(
        { id: ticket.id, subject: ticket.subject, priority: ticket.priority },
        { name: user.name, email: user.email },
        message,
      ).catch(err => console.error("[Email] Admin ticket reply notification error:", err));
    }

    await logActivity(req.userId, "create", "ticket_message", id, `Admin replied to ticket #${id}`);
    res.status(201).json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to send reply" });
  }
});

router.put("/admin/tickets/:id/status", requireAuth, requireAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { status } = req.body;
    const [ticket] = await db.update(ticketsTable).set({ status, updatedAt: new Date() }).where(eq(ticketsTable.id, id)).returning();
    if (!ticket) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId, "update", "ticket", id, `Status changed to: ${status}`);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ticket.userId)).limit(1);
    if (user && ["in_progress", "resolved", "closed"].includes(status)) {
      sendTicketStatusUpdate(
        { id: ticket.id, subject: ticket.subject, priority: ticket.priority },
        { name: user.name, email: user.email },
        status,
      ).catch(err => console.error("[Email] Ticket status update notification error:", err));
    }

    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update ticket" });
  }
});

router.delete("/admin/tickets/:id", requireAuth, requireAdmin, async (req: AuthRequest & PartnerRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(ticketsTable).where(eq(ticketsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete ticket" });
  }
});

// ─── Activity Log ───────────────────────────────────────────────────────────

router.get("/admin/activity", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const activities = await db.select().from(activityLogTable)
      .orderBy(desc(activityLogTable.createdAt))
      .limit(limit);
    res.json(activities);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load activity log" });
  }
});

// ─── CSV Exports ────────────────────────────────────────────────────────────

router.get("/admin/export/contacts", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt));
    const csv = generateCSV(items, ["id", "name", "email", "phone", "company", "service", "message", "createdAt"]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to export contacts" });
  }
});

router.get("/admin/export/quotes", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(quotesTable).orderBy(desc(quotesTable.createdAt));
    const csv = generateCSV(items, ["id", "name", "email", "phone", "company", "companySize", "services", "budget", "timeline", "status", "createdAt"]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=quotes.csv");
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to export quotes" });
  }
});

router.get("/admin/export/tickets", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(ticketsTable).orderBy(desc(ticketsTable.createdAt));
    const csv = generateCSV(items, ["id", "subject", "description", "priority", "category", "status", "createdAt"]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=tickets.csv");
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to export tickets" });
  }
});

function generateCSV(data: any[], fields: string[]): string {
  const header = fields.join(",");
  const rows = data.map(item =>
    fields.map(f => {
      const val = item[f];
      if (val === null || val === undefined) return "";
      const str = String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")
  );
  return [header, ...rows].join("\n");
}

// ─── Industries ──────────────────────────────────────────────────────────────

function parseIndustry(t: any) {
  return {
    ...t,
    painPoints: JSON.parse(t.painPoints || "[]"),
    regulations: JSON.parse(t.regulations || "[]"),
    softwareStacks: JSON.parse(t.softwareStacks || "[]"),
    whatWeDo: JSON.parse(t.whatWeDo || "[]"),
    relatedServices: JSON.parse(t.relatedServices || "[]"),
    hero: {
      eyebrow: t.heroEyebrow || "",
      title: t.heroTitle || "",
      subtitle: t.heroSubtitle || "",
    },
    testimonial: {
      quote: t.testimonialQuote || "",
      name: t.testimonialName || "",
      role: t.testimonialRole || "",
      company: t.testimonialCompany || "",
    },
  };
}

function normalizeIndustryBody(body: any) {
  const safe = (v: any) => (v == null ? "" : String(v));
  const hero = body.hero || {};
  const testimonial = body.testimonial || {};
  return {
    slug: safe(body.slug),
    name: safe(body.name),
    shortLabel: safe(body.shortLabel),
    navTitle: safe(body.navTitle),
    metaDescription: safe(body.metaDescription),
    heroEyebrow: safe(body.heroEyebrow ?? hero.eyebrow),
    heroTitle: safe(body.heroTitle ?? hero.title),
    heroSubtitle: safe(body.heroSubtitle ?? hero.subtitle),
    painPoints: JSON.stringify(body.painPoints || []),
    regulations: JSON.stringify(body.regulations || []),
    softwareStacks: JSON.stringify(body.softwareStacks || []),
    whatWeDo: JSON.stringify(body.whatWeDo || []),
    testimonialQuote: safe(body.testimonialQuote ?? testimonial.quote),
    testimonialName: safe(body.testimonialName ?? testimonial.name),
    testimonialRole: safe(body.testimonialRole ?? testimonial.role),
    testimonialCompany: safe(body.testimonialCompany ?? testimonial.company),
    caseStudyHint: safe(body.caseStudyHint),
    relatedServices: JSON.stringify(body.relatedServices || []),
    ctaLabel: safe(body.ctaLabel) || "Book a consultation",
    sortOrder: Number(body.sortOrder) || 0,
    active: body.active !== false,
  };
}

router.get("/cms/industries", async (_req, res) => {
  try {
    const items = await db.select().from(industriesTable)
      .where(eq(industriesTable.active, true))
      .orderBy(industriesTable.sortOrder);
    res.json(items.map(parseIndustry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load industries" });
  }
});

router.get("/cms/industries/:slug", async (req, res) => {
  try {
    const [item] = await db.select().from(industriesTable)
      .where(eq(industriesTable.slug, req.params.slug as string)).limit(1);
    if (!item) { res.status(404).json({ error: "not_found", message: "Industry not found" }); return; }
    res.json(parseIndustry(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load industry" });
  }
});

router.get("/admin/cms/industries", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await db.select().from(industriesTable).orderBy(industriesTable.sortOrder);
    res.json(items.map(parseIndustry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load industries" });
  }
});

router.post("/admin/cms/industries", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const values = normalizeIndustryBody(req.body);
    if (!values.slug) {
      values.slug = String(values.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    if (!values.slug || !values.name) {
      res.status(400).json({ error: "bad_request", message: "slug and name are required" });
      return;
    }
    const [item] = await db.insert(industriesTable).values(values).returning();
    await logActivity(req.userId, "create", "industry", item.id, `Added industry: ${values.name}`);
    res.status(201).json(parseIndustry(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to create industry" });
  }
});

router.put("/admin/cms/industries/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const values = normalizeIndustryBody(req.body);
    const [item] = await db.update(industriesTable).set({
      ...values,
      updatedAt: new Date(),
    }).where(eq(industriesTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "not_found", message: "Industry not found" }); return; }
    await logActivity(req.userId, "update", "industry", id);
    res.json(parseIndustry(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update industry" });
  }
});

router.delete("/admin/cms/industries/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(industriesTable).where(eq(industriesTable.id, id));
    await logActivity(req.userId, "delete", "industry", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete industry" });
  }
});

export default router;
