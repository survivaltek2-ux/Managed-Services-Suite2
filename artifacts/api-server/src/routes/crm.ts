import { Router, type IRouter, type Response } from "express";
import {
  db,
  crmContactsTable,
  crmCompaniesTable,
  crmActivitiesTable,
  crmTasksTable,
  crmPipelinesTable,
  crmPipelineStagesTable,
  crmTagsTable,
  crmContactTagsTable,
  crmCompanyTagsTable,
  crmDealTagsTable,
  crmCustomFieldsTable,
  crmCustomFieldValuesTable,
  crmSavedViewsTable,
  partnerDealsTable,
  partnerLeadsTable,
  quotesTable,
  contactsTable,
  vivintInquiriesTable,
  leadMagnetSubmissionsTable,
  leadMagnetSequenceSendsTable,
  partnerTicketMessagesTable,
  documentsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or, desc, asc, sql, ilike, isNull, inArray, gte, lte, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { normalizeEmail, normalizeCompanyName, buildFullName, upsertContact, upsertCompany } from "../lib/crmUpsert.js";
import { sendCrmEmail } from "../lib/email.js";

const router: IRouter = Router();

// ─── Access model ─────────────────────────────────────────────────────────────
// CRM is admin-only end-to-end (per task T009: owners are sourced from
// `/admin/users`, the main-site users table). Every route below is gated
// with `requireAuth, requireAdmin`. Frontend mirrors this by wrapping all
// /admin/crm/* routes in AdminProtectedRoute.
//
// The owner/share helpers below — ownerReadScope / requireReadAccess /
// requireWriteAccess and the crm_shares table — are kept as defense-in-
// depth and as the foundation for a future "team CRM" expansion that
// would let non-admin main-site users see records they own or are
// shared on. Under the current admin-only gating, they are no-ops:
// req.userRole === "admin" short-circuits each helper. The crm_shares
// admin endpoints (/admin/crm/share/*) remain useful so admins can
// pre-populate share grants for that future expansion.
// ─────────────────────────────────────────────────────────────────────────────

// Restricts non-admin reads to records the caller owns OR has been
// explicitly shared with via crm_shares. Returns `undefined` for admins
// (no extra filter) so admin queries are unchanged. Pass the owner
// column, the entity name + id column to also pull in shared-with-me rows.
type ShareEntity = "contact" | "company" | "deal" | "lead";
function ownerReadScope(
  req: AuthRequest,
  ownerCol: AnyPgColumn,
  entity?: ShareEntity,
  idCol?: AnyPgColumn,
): SQL | undefined {
  if (req.userRole === "admin") return undefined;
  const ownerCheck = eq(ownerCol, req.userId!);
  if (entity && idCol) {
    const sharedCheck = sql`${idCol} IN (SELECT entity_id FROM crm_shares WHERE entity = ${entity} AND user_id = ${req.userId!})`;
    return or(ownerCheck, sharedCheck) as SQL;
  }
  return ownerCheck as SQL;
}

// Write-access predicate for primary CRM entities. Admins always pass;
// non-admins must own the row OR have an explicit share grant.
async function canWriteCrmRecord(
  req: AuthRequest,
  entity: ShareEntity,
  id: number,
): Promise<boolean> {
  if (req.userRole === "admin") return true;
  if (!req.userId || !id) return false;
  const tableMap: Record<ShareEntity, string> = {
    contact: "crm_contacts",
    company: "crm_companies",
    deal: "partner_deals",
    lead: "partner_leads",
  };
  const tbl = tableMap[entity];
  const r = await db.execute<{ ok: number }>(sql`
    SELECT 1 AS ok WHERE EXISTS (
      SELECT 1 FROM ${sql.raw(tbl)}
      WHERE id = ${id} AND assigned_user_id = ${req.userId}
    ) OR EXISTS (
      SELECT 1 FROM crm_shares
      WHERE entity = ${entity} AND entity_id = ${id} AND user_id = ${req.userId}
    )
  `);
  return (r.rows?.length ?? 0) > 0;
}

// Express helper: 403s the response if the caller can't write the record.
async function requireWriteAccess(
  req: AuthRequest,
  res: Response,
  entity: ShareEntity,
  id: number,
): Promise<boolean> {
  if (await canWriteCrmRecord(req, entity, id)) return true;
  res.status(403).json({ error: "forbidden", message: "You do not have access to this record." });
  return false;
}

// Read-access uses the same predicate as write access: admin OR assigned
// owner OR explicit share grant. Any GET that exposes per-record data must
// gate through this helper so that the share table is consulted (req#11).
async function requireReadAccess(
  req: AuthRequest,
  res: Response,
  entity: ShareEntity,
  id: number,
): Promise<boolean> {
  if (await canWriteCrmRecord(req, entity, id)) return true;
  res.status(403).json({ error: "forbidden", message: "You do not have access to this record." });
  return false;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function toInt(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const head = headers.map(csvEscape).join(",");
  const body = rows.map(r => headers.map(h => csvEscape(r[h])).join(",")).join("\n");
  return head + "\n" + body;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let val = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { val += '"'; i++; }
      else if (c === '"') inQuote = false;
      else val += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { cur.push(val); val = ""; }
      else if (c === "\n") { cur.push(val); rows.push(cur); cur = []; val = ""; }
      else if (c === "\r") { /* skip */ }
      else val += c;
    }
  }
  if (val !== "" || cur.length > 0) { cur.push(val); rows.push(cur); }
  return rows.filter(r => r.some(c => c !== ""));
}

// ═════════════════════════════════════════════════════════════════════════════
// Dashboard
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/dashboard", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const exec = async <T extends Record<string, unknown>>(query: SQL<unknown>): Promise<T[]> => {
      const r = await db.execute<T>(query);
      return (r.rows ?? []) as T[];
    };
    const [contactCount] = await exec<{ count: number }>(sql`SELECT count(*)::int AS count FROM crm_contacts`);
    const [companyCount] = await exec<{ count: number }>(sql`SELECT count(*)::int AS count FROM crm_companies`);
    const [openDeals] = await exec<{ count: number; sum: string | null }>(
      sql`SELECT count(*)::int AS count, COALESCE(SUM(estimated_value), 0)::text AS sum
          FROM partner_deals WHERE status NOT IN ('won', 'lost', 'expired')`
    );
    const [openLeads] = await exec<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM partner_leads WHERE status NOT IN ('converted','lost')`
    );
    const [openTasks] = await exec<{ count: number; overdue: number; mine: number }>(
      sql`SELECT count(*)::int AS count,
                 COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at < now() AND status='open')::int AS overdue,
                 COUNT(*) FILTER (WHERE owner_user_id = ${userId} AND status='open')::int AS mine
          FROM crm_tasks WHERE status='open'`
    );
    const [newContacts30d] = await exec<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM crm_contacts WHERE created_at >= ${since.toISOString()}`
    );

    const recentActivity = await db.select().from(crmActivitiesTable)
      .orderBy(desc(crmActivitiesTable.occurredAt)).limit(15);

    const myTasks = await db.select().from(crmTasksTable)
      .where(and(eq(crmTasksTable.ownerUserId, userId), eq(crmTasksTable.status, "open")))
      .orderBy(asc(crmTasksTable.dueAt)).limit(10);

    res.json({
      kpis: {
        contacts: contactCount?.count ?? 0,
        companies: companyCount?.count ?? 0,
        openDeals: openDeals?.count ?? 0,
        openDealsValue: Number(openDeals?.sum ?? "0"),
        openLeads: openLeads?.count ?? 0,
        openTasks: openTasks?.count ?? 0,
        overdueTasks: openTasks?.overdue ?? 0,
        myOpenTasks: openTasks?.mine ?? 0,
        newContacts30d: newContacts30d?.count ?? 0,
      },
      recentActivity,
      myTasks,
    });
  } catch (err) {
    console.error("[CRM] dashboard:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load dashboard" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Global CRM search
// ═════════════════════════════════════════════════════════════════════════════

// Global CRM search is available to every authenticated portal user.
// Non-admins only see records they own or have been explicitly shared with.
router.get("/admin/crm/search", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) { res.json({ contacts: [], companies: [], deals: [], leads: [] }); return; }
    const like = `%${q}%`;
    const contactScope = ownerReadScope(req, crmContactsTable.assignedUserId, "contact", crmContactsTable.id);
    const companyScope = ownerReadScope(req, crmCompaniesTable.assignedUserId, "company", crmCompaniesTable.id);
    const dealScope = ownerReadScope(req, partnerDealsTable.assignedUserId, "deal", partnerDealsTable.id);
    const leadScope = ownerReadScope(req, partnerLeadsTable.assignedUserId, "lead", partnerLeadsTable.id);
    const [contacts, companies, deals, leads] = await Promise.all([
      db.select({ id: crmContactsTable.id, name: crmContactsTable.fullName, email: crmContactsTable.email, phone: crmContactsTable.phone })
        .from(crmContactsTable)
        .where(and(or(ilike(crmContactsTable.fullName, like), ilike(crmContactsTable.email, like), ilike(crmContactsTable.phone, like)), contactScope ?? sql`true`))
        .limit(8),
      db.select({ id: crmCompaniesTable.id, name: crmCompaniesTable.name, website: crmCompaniesTable.website })
        .from(crmCompaniesTable)
        .where(and(or(ilike(crmCompaniesTable.name, like), ilike(crmCompaniesTable.website, like)), companyScope ?? sql`true`))
        .limit(8),
      db.select({ id: partnerDealsTable.id, title: partnerDealsTable.title, customerName: partnerDealsTable.customerName, stage: partnerDealsTable.stage })
        .from(partnerDealsTable)
        .where(and(or(ilike(partnerDealsTable.title, like), ilike(partnerDealsTable.customerName, like)), dealScope ?? sql`true`))
        .limit(8),
      db.select({ id: partnerLeadsTable.id, contactName: partnerLeadsTable.contactName, companyName: partnerLeadsTable.companyName, status: partnerLeadsTable.status })
        .from(partnerLeadsTable)
        .where(and(or(ilike(partnerLeadsTable.contactName, like), ilike(partnerLeadsTable.companyName, like), ilike(partnerLeadsTable.email, like)), leadScope ?? sql`true`))
        .limit(8),
    ]);
    res.json({ contacts, companies, deals, leads });
  } catch (err) {
    console.error("[CRM] search:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Contacts
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/contacts", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const ownerFilter = String(req.query.owner ?? "all"); // 'me' | 'unassigned' | numeric id | 'all'
    const lifecycle = String(req.query.lifecycle ?? "");
    const tagId = req.query.tagId ? toInt(req.query.tagId) : null;
    const limit = Math.min(toInt(req.query.limit, 100), 500);
    const offset = toInt(req.query.offset, 0);
    const sortBy = String(req.query.sortBy ?? "lastActivityAt");
    const sortDir = String(req.query.sortDir ?? "desc");

    const conds: SQL<unknown>[] = [];
    if (q) {
      // `or()` returns SQL<unknown> | undefined; the non-null assert is safe
      // because we always pass at least one defined predicate.
      const term = or(
        ilike(crmContactsTable.fullName, `%${q}%`),
        ilike(crmContactsTable.email, `%${q}%`),
        ilike(crmContactsTable.phone, `%${q}%`),
      );
      if (term) conds.push(term);
    }
    if (ownerFilter === "me") conds.push(eq(crmContactsTable.assignedUserId, req.userId!));
    else if (ownerFilter === "unassigned") conds.push(isNull(crmContactsTable.assignedUserId));
    else if (/^\d+$/.test(ownerFilter)) conds.push(eq(crmContactsTable.assignedUserId, Number(ownerFilter)));
    if (lifecycle) conds.push(eq(crmContactsTable.lifecycleStage, lifecycle));
    const scope = ownerReadScope(req, crmContactsTable.assignedUserId, "contact", crmContactsTable.id);
    if (scope) conds.push(scope);

    let baseQuery = db.select({
      id: crmContactsTable.id,
      fullName: crmContactsTable.fullName,
      email: crmContactsTable.email,
      phone: crmContactsTable.phone,
      title: crmContactsTable.title,
      companyId: crmContactsTable.companyId,
      companyName: crmCompaniesTable.name,
      ownerUserId: crmContactsTable.assignedUserId,
      ownerName: usersTable.name,
      lifecycleStage: crmContactsTable.lifecycleStage,
      score: crmContactsTable.score,
      source: crmContactsTable.source,
      lastActivityAt: crmContactsTable.lastActivityAt,
      createdAt: crmContactsTable.createdAt,
    }).from(crmContactsTable)
      .leftJoin(crmCompaniesTable, eq(crmContactsTable.companyId, crmCompaniesTable.id))
      .leftJoin(usersTable, eq(crmContactsTable.assignedUserId, usersTable.id));

    if (tagId) {
      const ids = await db.select({ contactId: crmContactTagsTable.contactId })
        .from(crmContactTagsTable).where(eq(crmContactTagsTable.tagId, tagId));
      const idList = ids.map(r => r.contactId);
      if (idList.length === 0) { res.json({ rows: [], total: 0 }); return; }
      conds.push(inArray(crmContactsTable.id, idList));
    }

    const where = conds.length ? and(...conds) : undefined;
    const sortCol = sortBy === "fullName" ? crmContactsTable.fullName
      : sortBy === "createdAt" ? crmContactsTable.createdAt
      : crmContactsTable.lastActivityAt;
    const rows = await baseQuery
      .where(where)
      .orderBy(sortDir === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(limit).offset(offset);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(crmContactsTable)
      .where(where);
    res.json({ rows, total: count, limit, offset });
  } catch (err) {
    console.error("[CRM] list contacts:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/crm/contacts/export.csv", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: crmContactsTable.id,
      fullName: crmContactsTable.fullName,
      firstName: crmContactsTable.firstName,
      lastName: crmContactsTable.lastName,
      email: crmContactsTable.email,
      phone: crmContactsTable.phone,
      title: crmContactsTable.title,
      company: crmCompaniesTable.name,
      lifecycleStage: crmContactsTable.lifecycleStage,
      source: crmContactsTable.source,
      createdAt: crmContactsTable.createdAt,
    }).from(crmContactsTable)
      .leftJoin(crmCompaniesTable, eq(crmContactsTable.companyId, crmCompaniesTable.id));
    const csv = rowsToCsv(
      ["id","fullName","firstName","lastName","email","phone","title","company","lifecycleStage","source","createdAt"],
      rows as unknown as Record<string, unknown>[],
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="contacts-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("[CRM] export contacts:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/contacts/import", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { csv, dryRun, mapping } = req.body as { csv: string; dryRun?: boolean; mapping?: Record<string,string> };
    if (typeof csv !== "string" || !csv.trim()) {
      res.status(400).json({ error: "validation_error", message: "csv body required" }); return;
    }
    const rows = parseCsv(csv);
    if (rows.length < 1) { res.json({ inserted: 0, updated: 0, skipped: 0, total: 0 }); return; }
    const headers = rows[0].map(h => h.trim());
    // mapping: csvHeader -> contactField; if explicitly set to "" the column is skipped.
    // If not present at all, fall back to identity-by-lowercase auto-detection.
    const map: Record<string, string | null> = {};
    headers.forEach(h => {
      if (mapping && Object.prototype.hasOwnProperty.call(mapping, h)) {
        const v = (mapping[h] ?? "").trim();
        map[h] = v === "" ? null : v;
        return;
      }
      const lc = h.toLowerCase();
      if (["fullname","name","full_name"].includes(lc)) map[h] = "fullName";
      else if (["firstname","first","first_name"].includes(lc)) map[h] = "firstName";
      else if (["lastname","last","last_name"].includes(lc)) map[h] = "lastName";
      else if (["email","emailaddress","email_address"].includes(lc)) map[h] = "email";
      else if (["phone","phonenumber"].includes(lc)) map[h] = "phone";
      else if (["title","jobtitle","job_title"].includes(lc)) map[h] = "title";
      else if (["company","companyname","organization"].includes(lc)) map[h] = "companyName";
      else if (lc === "source") map[h] = "source";
      else map[h] = null;
    });
    let inserted = 0, updated = 0, skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        const target = map[h];
        if (!target) return; // skipped column
        obj[target] = row[idx];
      });
      if (!obj.email && !obj.fullName && !obj.firstName && !obj.lastName) { skipped++; continue; }
      if (dryRun) { inserted++; continue; }
      const before = obj.email
        ? await db.select({ id: crmContactsTable.id }).from(crmContactsTable)
            .where(eq(crmContactsTable.normalizedEmail, normalizeEmail(String(obj.email)) ?? "")).limit(1)
        : [];
      await upsertContact(obj);
      if (before[0]) updated++; else inserted++;
    }
    res.json({ inserted, updated, skipped, total: rows.length - 1, dryRun: !!dryRun });
  } catch (err) {
    console.error("[CRM] import contacts:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.get("/admin/crm/contacts/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await requireReadAccess(req, res, "contact", id))) return;
    const [contact] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, id)).limit(1);
    if (!contact) { res.status(404).json({ error: "not_found" }); return; }
    const [company] = contact.companyId
      ? await db.select().from(crmCompaniesTable).where(eq(crmCompaniesTable.id, contact.companyId)).limit(1)
      : [null];
    const tags = await db.select({ id: crmTagsTable.id, name: crmTagsTable.name, color: crmTagsTable.color })
      .from(crmContactTagsTable)
      .innerJoin(crmTagsTable, eq(crmContactTagsTable.tagId, crmTagsTable.id))
      .where(eq(crmContactTagsTable.contactId, id));
    const customValues = await db.select({
      id: crmCustomFieldValuesTable.id,
      fieldId: crmCustomFieldValuesTable.fieldId,
      value: crmCustomFieldValuesTable.value,
      label: crmCustomFieldsTable.label,
      key: crmCustomFieldsTable.key,
      type: crmCustomFieldsTable.type,
    }).from(crmCustomFieldValuesTable)
      .innerJoin(crmCustomFieldsTable, eq(crmCustomFieldValuesTable.fieldId, crmCustomFieldsTable.id))
      .where(and(eq(crmCustomFieldValuesTable.entity, "contact"), eq(crmCustomFieldValuesTable.entityId, id)));
    res.json({ ...contact, company, tags, customValues });
  } catch (err) {
    console.error("[CRM] get contact:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/contacts", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { result } = await (async () => {
      const body = req.body || {};
      const { contactId, companyId } = await upsertContact({
        firstName: body.firstName, lastName: body.lastName,
        name: body.fullName || body.name,
        email: body.email, phone: body.phone, title: body.title,
        companyName: body.companyName, companyId: body.companyId,
        source: body.source || "manual",
      });
      if (contactId && (body.assignedUserId || body.lifecycleStage || body.notes)) {
        await db.update(crmContactsTable).set({
          assignedUserId: body.assignedUserId ?? null,
          lifecycleStage: body.lifecycleStage ?? "lead",
          notes: body.notes ?? null,
          updatedAt: new Date(),
        }).where(eq(crmContactsTable.id, contactId));
      }
      return { result: { contactId, companyId } };
    })();
    res.status(201).json(result);
  } catch (err) {
    console.error("[CRM] create contact:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.put("/admin/crm/contacts/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = toInt(req.params.id);
  if (!(await requireWriteAccess(req, res, "contact", id))) return;
  try {
    const body = req.body || {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["firstName","lastName","email","phone","title","notes","source","lifecycleStage","assignedUserId","companyId","score"];
    for (const f of fields) if (f in body) updates[f] = body[f];
    if (body.fullName) updates.fullName = body.fullName;
    else if (body.firstName !== undefined || body.lastName !== undefined) {
      updates.fullName = buildFullName(body.fullName, body.firstName ?? null, body.lastName ?? null);
    }
    if (body.email !== undefined) updates.normalizedEmail = normalizeEmail(body.email);
    await db.update(crmContactsTable).set(updates).where(eq(crmContactsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] update contact:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/contacts/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    await db.delete(crmContactsTable).where(eq(crmContactsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete contact:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/contacts/:id/merge", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const intoId = toInt(req.body?.intoId);
    if (!id || !intoId || id === intoId) { res.status(400).json({ error: "validation_error" }); return; }
    // Re-point activity, tasks, related-table links from id -> intoId, then delete the duplicate.
    await db.execute(sql`UPDATE crm_activities SET contact_id = ${intoId} WHERE contact_id = ${id}`);
    await db.execute(sql`UPDATE crm_tasks      SET contact_id = ${intoId} WHERE contact_id = ${id}`);
    await db.execute(sql`UPDATE contacts                SET crm_contact_id = ${intoId} WHERE crm_contact_id = ${id}`);
    await db.execute(sql`UPDATE quotes                  SET crm_contact_id = ${intoId} WHERE crm_contact_id = ${id}`);
    await db.execute(sql`UPDATE quote_proposals         SET crm_contact_id = ${intoId} WHERE crm_contact_id = ${id}`);
    await db.execute(sql`UPDATE vivint_inquiries        SET crm_contact_id = ${intoId} WHERE crm_contact_id = ${id}`);
    await db.execute(sql`UPDATE lead_magnet_submissions SET crm_contact_id = ${intoId} WHERE crm_contact_id = ${id}`);
    await db.execute(sql`UPDATE partner_leads           SET crm_contact_id = ${intoId} WHERE crm_contact_id = ${id}`);
    await db.execute(sql`UPDATE partner_deals           SET crm_contact_id = ${intoId} WHERE crm_contact_id = ${id}`);
    await db.execute(sql`DELETE FROM crm_contact_tags WHERE contact_id = ${id}`);
    await db.delete(crmContactsTable).where(eq(crmContactsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] merge contact:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// Per-contact timeline — merges activities + related records chronologically.
router.get("/admin/crm/contacts/:id/timeline", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    // Visibility: admin OR record owner OR explicit share grant (req#11).
    if (!(await requireReadAccess(req, res, "contact", id))) return;
    const acts = await db.select().from(crmActivitiesTable)
      .where(eq(crmActivitiesTable.contactId, id))
      .orderBy(desc(crmActivitiesTable.occurredAt)).limit(200);
    const quotes = await db.select({ id: quotesTable.id, services: quotesTable.services, status: quotesTable.status, createdAt: quotesTable.createdAt })
      .from(quotesTable).where(eq(quotesTable.crmContactId, id)).orderBy(desc(quotesTable.createdAt));
    const submissions = await db.select({ id: leadMagnetSubmissionsTable.id, magnet: leadMagnetSubmissionsTable.magnet, createdAt: leadMagnetSubmissionsTable.createdAt })
      .from(leadMagnetSubmissionsTable).where(eq(leadMagnetSubmissionsTable.crmContactId, id)).orderBy(desc(leadMagnetSubmissionsTable.createdAt));
    const inquiries = await db.select({ id: vivintInquiriesTable.id, type: vivintInquiriesTable.type, createdAt: vivintInquiriesTable.createdAt })
      .from(vivintInquiriesTable).where(eq(vivintInquiriesTable.crmContactId, id)).orderBy(desc(vivintInquiriesTable.createdAt));
    const partnerLeads = await db.select({ id: partnerLeadsTable.id, status: partnerLeadsTable.status, source: partnerLeadsTable.source, createdAt: partnerLeadsTable.createdAt })
      .from(partnerLeadsTable).where(eq(partnerLeadsTable.crmContactId, id)).orderBy(desc(partnerLeadsTable.createdAt));
    const deals = await db.select({ id: partnerDealsTable.id, title: partnerDealsTable.title, stage: partnerDealsTable.stage, status: partnerDealsTable.status, createdAt: partnerDealsTable.createdAt, updatedAt: partnerDealsTable.updatedAt })
      .from(partnerDealsTable).where(eq(partnerDealsTable.crmContactId, id)).orderBy(desc(partnerDealsTable.createdAt));
    // Support tickets + their messages — column added at bootstrap, query via raw SQL to avoid schema thrash.
    const ticketsRes = await db.execute<{ id: number; subject: string; status: string; priority: string; createdAt: Date; updatedAt: Date }>(sql`
      SELECT id, subject, status, priority, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM partner_support_tickets WHERE crm_contact_id = ${id} ORDER BY created_at DESC LIMIT 50
    `);
    const tickets = ticketsRes.rows;
    // Surface every reply on those tickets so the timeline reflects the
    // actual conversation, not just the ticket header (review #14).
    const ticketIds = tickets.map(t => t.id);
    const ticketMessages = ticketIds.length > 0
      ? await db.select({ id: partnerTicketMessagesTable.id, ticketId: partnerTicketMessagesTable.ticketId, senderType: partnerTicketMessagesTable.senderType, senderName: partnerTicketMessagesTable.senderName, message: partnerTicketMessagesTable.message, createdAt: partnerTicketMessagesTable.createdAt })
          .from(partnerTicketMessagesTable).where(inArray(partnerTicketMessagesTable.ticketId, ticketIds))
          .orderBy(desc(partnerTicketMessagesTable.createdAt)).limit(200)
      : [];
    // Nurture-email sends (lead-magnet drip sequence) keyed via the
    // contact's lead-magnet submissions.
    const submissionIds = submissions.map(s => s.id);
    const nurtureSends = submissionIds.length > 0
      ? await db.select({ id: leadMagnetSequenceSendsTable.id, submissionId: leadMagnetSequenceSendsTable.submissionId, step: leadMagnetSequenceSendsTable.step, status: leadMagnetSequenceSendsTable.status, sentAt: leadMagnetSequenceSendsTable.sentAt })
          .from(leadMagnetSequenceSendsTable).where(inArray(leadMagnetSequenceSendsTable.submissionId, submissionIds))
          .orderBy(desc(leadMagnetSequenceSendsTable.sentAt)).limit(200)
      : [];
    // Documents linked to this contact (Files tab on detail).
    const docRows = await db.select({ id: documentsTable.id, name: documentsTable.name, category: documentsTable.category, filename: documentsTable.filename, createdAt: documentsTable.createdAt })
      .from(documentsTable).where(eq(documentsTable.crmContactId, id)).orderBy(desc(documentsTable.createdAt));
    const docs = docRows.map(d => ({ ...d, fileUrl: `/api/admin/documents/${d.id}/download` }));
    const events = [
      ...acts.map(a => ({ kind: "activity", at: a.occurredAt, payload: a })),
      ...quotes.map(q => ({ kind: "quote", at: q.createdAt, payload: q })),
      ...submissions.map(s => ({ kind: "lead_magnet", at: s.createdAt, payload: s })),
      ...inquiries.map(i => ({ kind: "vivint_inquiry", at: i.createdAt, payload: i })),
      ...partnerLeads.map(l => ({ kind: "partner_lead", at: l.createdAt, payload: l })),
      // Surface lead status changes — leads with status != "new" have transitioned past intake.
      ...partnerLeads.filter(l => l.status && l.status !== "new")
        .map(l => ({ kind: "partner_lead_status", at: l.createdAt, payload: { id: l.id, status: l.status } })),
      ...deals.map(d => ({ kind: "partner_deal", at: d.createdAt, payload: d })),
      // Surface deal stage updates as their own timeline events.
      ...deals.filter(d => d.updatedAt && d.createdAt && d.updatedAt.getTime() - d.createdAt.getTime() > 1000)
        .map(d => ({ kind: "partner_deal_stage", at: d.updatedAt, payload: { id: d.id, title: d.title, stage: d.stage, status: d.status } })),
      ...tickets.map(t => ({ kind: "support_ticket", at: t.createdAt, payload: t })),
      ...ticketMessages.map(m => ({ kind: "ticket_message", at: m.createdAt, payload: m })),
      ...nurtureSends.map(n => ({ kind: "nurture_email", at: n.sentAt, payload: n })),
      ...docs.map(d => ({ kind: "document", at: d.createdAt, payload: d })),
    ].sort((a, b) => ((b.at as Date | null)?.getTime?.() ?? 0) - ((a.at as Date | null)?.getTime?.() ?? 0));
    res.json({ events, deals, leads: partnerLeads, quotes, tickets, ticketMessages, nurtureSends, documents: docs });
  } catch (err) {
    console.error("[CRM] contact timeline:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Companies
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/companies", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const ownerFilter = String(req.query.owner ?? "all");
    const tagId = req.query.tagId ? toInt(req.query.tagId) : null;
    const sortBy = String(req.query.sortBy ?? "updatedAt");
    const sortDir = String(req.query.sortDir ?? "desc");
    const limit = Math.min(toInt(req.query.limit, 100), 500);
    const offset = toInt(req.query.offset, 0);
    const conds: SQL<unknown>[] = [];
    if (q) {
      const term = or(ilike(crmCompaniesTable.name, `%${q}%`), ilike(crmCompaniesTable.website, `%${q}%`), ilike(crmCompaniesTable.industry, `%${q}%`));
      if (term) conds.push(term);
    }
    if (ownerFilter === "me") conds.push(eq(crmCompaniesTable.assignedUserId, req.userId!));
    else if (ownerFilter === "unassigned") conds.push(isNull(crmCompaniesTable.assignedUserId));
    else if (/^\d+$/.test(ownerFilter)) conds.push(eq(crmCompaniesTable.assignedUserId, Number(ownerFilter)));
    if (tagId) {
      const ids = await db.select({ companyId: crmCompanyTagsTable.companyId })
        .from(crmCompanyTagsTable).where(eq(crmCompanyTagsTable.tagId, tagId));
      const idList = ids.map(r => r.companyId);
      if (idList.length === 0) { res.json({ rows: [], total: 0 }); return; }
      conds.push(inArray(crmCompaniesTable.id, idList));
    }
    const scope = ownerReadScope(req, crmCompaniesTable.assignedUserId, "company", crmCompaniesTable.id);
    if (scope) conds.push(scope);
    const where = conds.length ? and(...conds) : undefined;
    const sortCol = sortBy === "name" ? crmCompaniesTable.name
      : sortBy === "createdAt" ? crmCompaniesTable.createdAt
      : crmCompaniesTable.updatedAt;

    const rows = await db.select({
      id: crmCompaniesTable.id,
      name: crmCompaniesTable.name,
      website: crmCompaniesTable.website,
      industry: crmCompaniesTable.industry,
      city: crmCompaniesTable.city,
      state: crmCompaniesTable.state,
      ownerUserId: crmCompaniesTable.assignedUserId,
      ownerName: usersTable.name,
      contactCount: sql<number>`(SELECT COUNT(*)::int FROM crm_contacts cc WHERE cc.company_id = ${crmCompaniesTable.id})`,
      dealCount: sql<number>`(SELECT COUNT(*)::int FROM partner_deals pd WHERE pd.crm_company_id = ${crmCompaniesTable.id})`,
      createdAt: crmCompaniesTable.createdAt,
    }).from(crmCompaniesTable)
      .leftJoin(usersTable, eq(crmCompaniesTable.assignedUserId, usersTable.id))
      .where(where)
      .orderBy(sortDir === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(limit).offset(offset);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(crmCompaniesTable).where(where);
    res.json({ rows, total: count, limit, offset });
  } catch (err) {
    console.error("[CRM] list companies:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/crm/companies/export.csv", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(crmCompaniesTable);
    const csv = rowsToCsv(
      ["id","name","website","industry","phone","city","state","zip","source","createdAt"],
      rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString() })) as unknown as Record<string, unknown>[],
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="companies-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("[CRM] export companies:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/companies/import", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { csv, dryRun, mapping } = req.body as { csv: string; dryRun?: boolean; mapping?: Record<string, string> };
    if (typeof csv !== "string" || !csv.trim()) {
      res.status(400).json({ error: "validation_error", message: "csv body required" }); return;
    }
    const rows = parseCsv(csv);
    if (rows.length < 1) { res.json({ inserted: 0, updated: 0, skipped: 0, total: 0 }); return; }
    const headers = rows[0].map(h => h.trim());
    const map: Record<string, string | null> = {};
    headers.forEach(h => {
      if (mapping && Object.prototype.hasOwnProperty.call(mapping, h)) {
        const v = (mapping[h] ?? "").trim();
        map[h] = v === "" ? null : v;
        return;
      }
      const lc = h.toLowerCase();
      if (["name", "company", "companyname", "company_name", "organization"].includes(lc)) map[h] = "name";
      else if (["website", "url", "domain"].includes(lc)) map[h] = "website";
      else if (["phone", "phonenumber"].includes(lc)) map[h] = "phone";
      else if (["industry", "sector", "vertical"].includes(lc)) map[h] = "industry";
      else if (["city"].includes(lc)) map[h] = "city";
      else if (["state", "region", "province"].includes(lc)) map[h] = "state";
      else if (["zip", "zipcode", "postal", "postalcode", "postal_code"].includes(lc)) map[h] = "zip";
      else if (lc === "source") map[h] = "source";
      else map[h] = null;
    });
    let inserted = 0, updated = 0, skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj: Record<string, string | null> = {};
      headers.forEach((h, idx) => {
        const target = map[h];
        if (!target) return;
        obj[target] = row[idx] ?? null;
      });
      if (!obj.name || !obj.name.trim()) { skipped++; continue; }
      const normalized = normalizeCompanyName(obj.name);
      if (!normalized) { skipped++; continue; }
      if (dryRun) { inserted++; continue; }
      const before = await db.select({ id: crmCompaniesTable.id })
        .from(crmCompaniesTable)
        .where(eq(crmCompaniesTable.normalizedName, normalized))
        .limit(1);
      const id = await upsertCompany({
        name: obj.name,
        website: obj.website,
        phone: obj.phone,
        industry: obj.industry,
        city: obj.city,
        state: obj.state,
        zip: obj.zip,
        source: obj.source,
      });
      if (!id) { skipped++; continue; }
      if (before[0]) updated++; else inserted++;
    }
    res.json({ inserted, updated, skipped, total: rows.length - 1, dryRun: !!dryRun });
  } catch (err) {
    console.error("[CRM] import companies:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.get("/admin/crm/companies/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await requireReadAccess(req, res, "company", id))) return;
    const [company] = await db.select().from(crmCompaniesTable).where(eq(crmCompaniesTable.id, id)).limit(1);
    if (!company) { res.status(404).json({ error: "not_found" }); return; }
    const contacts = await db.select().from(crmContactsTable).where(eq(crmContactsTable.companyId, id));
    const tags = await db.select({ id: crmTagsTable.id, name: crmTagsTable.name, color: crmTagsTable.color })
      .from(crmCompanyTagsTable)
      .innerJoin(crmTagsTable, eq(crmCompanyTagsTable.tagId, crmTagsTable.id))
      .where(eq(crmCompanyTagsTable.companyId, id));
    const customValues = await db.select({
      id: crmCustomFieldValuesTable.id, fieldId: crmCustomFieldValuesTable.fieldId, value: crmCustomFieldValuesTable.value,
      label: crmCustomFieldsTable.label, key: crmCustomFieldsTable.key, type: crmCustomFieldsTable.type,
    }).from(crmCustomFieldValuesTable)
      .innerJoin(crmCustomFieldsTable, eq(crmCustomFieldValuesTable.fieldId, crmCustomFieldsTable.id))
      .where(and(eq(crmCustomFieldValuesTable.entity, "company"), eq(crmCustomFieldValuesTable.entityId, id)));
    res.json({ ...company, contacts, tags, customValues });
  } catch (err) {
    console.error("[CRM] get company:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/companies", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    if (!body.name) { res.status(400).json({ error: "validation_error", message: "name required" }); return; }
    const normalized = normalizeCompanyName(body.name);
    if (!normalized) { res.status(400).json({ error: "validation_error" }); return; }
    const existing = await db.select().from(crmCompaniesTable).where(eq(crmCompaniesTable.normalizedName, normalized)).limit(1);
    if (existing[0]) { res.json({ id: existing[0].id, existed: true }); return; }
    const [row] = await db.insert(crmCompaniesTable).values({
      name: body.name,
      normalizedName: normalized,
      website: body.website || null,
      phone: body.phone || null,
      industry: body.industry || null,
      size: body.size || null,
      street: body.street || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      country: body.country || null,
      notes: body.notes || null,
      source: body.source || "manual",
      assignedUserId: body.assignedUserId || null,
      partnerId: body.partnerId || null,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[CRM] create company:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/admin/crm/companies/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = toInt(req.params.id);
  if (!(await requireWriteAccess(req, res, "company", id))) return;
  try {
    const body = req.body || {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["name","website","phone","industry","size","street","city","state","zip","country","notes","source","assignedUserId"];
    for (const f of fields) if (f in body) updates[f] = body[f];
    if (body.name) updates.normalizedName = normalizeCompanyName(body.name);
    await db.update(crmCompaniesTable).set(updates).where(eq(crmCompaniesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] update company:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/companies/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    await db.update(crmContactsTable).set({ companyId: null }).where(eq(crmContactsTable.companyId, id));
    await db.delete(crmCompaniesTable).where(eq(crmCompaniesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete company:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/crm/companies/:id/timeline", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    // Visibility: admin OR record owner OR explicit share grant (req#11).
    if (!(await requireReadAccess(req, res, "company", id))) return;
    const acts = await db.select().from(crmActivitiesTable)
      .where(eq(crmActivitiesTable.companyId, id))
      .orderBy(desc(crmActivitiesTable.occurredAt)).limit(200);
    const deals = await db.select().from(partnerDealsTable).where(eq(partnerDealsTable.crmCompanyId, id));
    const docRows = await db.select({ id: documentsTable.id, name: documentsTable.name, category: documentsTable.category, filename: documentsTable.filename, createdAt: documentsTable.createdAt })
      .from(documentsTable).where(eq(documentsTable.crmCompanyId, id));
    const docs = docRows.map(d => ({ ...d, fileUrl: `/api/admin/documents/${d.id}/download` }));
    const leads = await db.select({ id: partnerLeadsTable.id, status: partnerLeadsTable.status, source: partnerLeadsTable.source, createdAt: partnerLeadsTable.createdAt })
      .from(partnerLeadsTable).where(eq(partnerLeadsTable.crmCompanyId, id)).orderBy(desc(partnerLeadsTable.createdAt));
    const ticketsRes = await db.execute<{ id: number; subject: string; status: string; priority: string; createdAt: Date; updatedAt: Date }>(sql`
      SELECT id, subject, status, priority, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM partner_support_tickets WHERE crm_company_id = ${id} ORDER BY created_at DESC LIMIT 50
    `);
    const tickets = ticketsRes.rows;
    const ticketIds = tickets.map(t => t.id);
    // Pull every reply on the company's tickets (review #14).
    const ticketMessages = ticketIds.length > 0
      ? await db.select({ id: partnerTicketMessagesTable.id, ticketId: partnerTicketMessagesTable.ticketId, senderType: partnerTicketMessagesTable.senderType, senderName: partnerTicketMessagesTable.senderName, message: partnerTicketMessagesTable.message, createdAt: partnerTicketMessagesTable.createdAt })
          .from(partnerTicketMessagesTable).where(inArray(partnerTicketMessagesTable.ticketId, ticketIds))
          .orderBy(desc(partnerTicketMessagesTable.createdAt)).limit(200)
      : [];
    // Nurture sends are routed via lead-magnet submissions; gather by the
    // company's contact set so we still surface drip emails on the timeline.
    const contactIds = (await db.select({ id: crmContactsTable.id }).from(crmContactsTable).where(eq(crmContactsTable.companyId, id))).map(r => r.id);
    const submissionIds = contactIds.length > 0
      ? (await db.select({ id: leadMagnetSubmissionsTable.id }).from(leadMagnetSubmissionsTable).where(inArray(leadMagnetSubmissionsTable.crmContactId, contactIds))).map(r => r.id)
      : [];
    const nurtureSends = submissionIds.length > 0
      ? await db.select({ id: leadMagnetSequenceSendsTable.id, submissionId: leadMagnetSequenceSendsTable.submissionId, step: leadMagnetSequenceSendsTable.step, status: leadMagnetSequenceSendsTable.status, sentAt: leadMagnetSequenceSendsTable.sentAt })
          .from(leadMagnetSequenceSendsTable).where(inArray(leadMagnetSequenceSendsTable.submissionId, submissionIds))
          .orderBy(desc(leadMagnetSequenceSendsTable.sentAt)).limit(200)
      : [];
    // Tasks scoped to this company (Tasks tab on detail).
    const tasks = await db.select().from(crmTasksTable)
      .where(eq(crmTasksTable.companyId, id))
      .orderBy(desc(crmTasksTable.createdAt));
    const events = [
      ...acts.map(a => ({ kind: "activity", at: a.occurredAt, payload: a })),
      ...deals.map(d => ({ kind: "partner_deal", at: d.createdAt, payload: d })),
      ...deals.filter(d => d.updatedAt && d.createdAt && d.updatedAt.getTime() - d.createdAt.getTime() > 1000)
        .map(d => ({ kind: "partner_deal_stage", at: d.updatedAt, payload: { id: d.id, title: d.title, stage: d.stage, status: d.status } })),
      ...leads.map(l => ({ kind: "partner_lead", at: l.createdAt, payload: l })),
      ...leads.filter(l => l.status && l.status !== "new")
        .map(l => ({ kind: "partner_lead_status", at: l.createdAt, payload: { id: l.id, status: l.status } })),
      ...docs.map(d => ({ kind: "document", at: d.createdAt, payload: d })),
      ...tickets.map(t => ({ kind: "support_ticket", at: t.createdAt, payload: t })),
      ...ticketMessages.map(m => ({ kind: "ticket_message", at: m.createdAt, payload: m })),
      ...nurtureSends.map(n => ({ kind: "nurture_email", at: n.sentAt, payload: n })),
      ...tasks.map(t => ({ kind: "task", at: t.createdAt, payload: t })),
    ].sort((a, b) => ((b.at as Date | null)?.getTime?.() ?? 0) - ((a.at as Date | null)?.getTime?.() ?? 0));
    res.json({ events, deals, documents: docs, leads, tickets, ticketMessages, nurtureSends, tasks });
  } catch (err) {
    console.error("[CRM] company timeline:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Activities
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/activities", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const conds: SQL<unknown>[] = [];
    if (req.query.contactId) conds.push(eq(crmActivitiesTable.contactId, toInt(req.query.contactId)));
    if (req.query.companyId) conds.push(eq(crmActivitiesTable.companyId, toInt(req.query.companyId)));
    if (req.query.dealId) conds.push(eq(crmActivitiesTable.dealId, toInt(req.query.dealId)));
    if (req.query.type) conds.push(eq(crmActivitiesTable.type, String(req.query.type) as typeof crmActivitiesTable.type._.data));
    // Owner filter: explicit numeric id, "me", or "unassigned"; default no filter.
    const ownerParam = String(req.query.ownerUserId ?? req.query.owner ?? "");
    if (ownerParam === "me") conds.push(eq(crmActivitiesTable.ownerUserId, req.userId!));
    else if (ownerParam === "unassigned") conds.push(isNull(crmActivitiesTable.ownerUserId));
    else if (/^\d+$/.test(ownerParam)) conds.push(eq(crmActivitiesTable.ownerUserId, Number(ownerParam)));
    // Date range (inclusive). Accept ISO strings or yyyy-mm-dd.
    if (req.query.from) {
      const d = new Date(String(req.query.from));
      if (!Number.isNaN(d.getTime())) conds.push(gte(crmActivitiesTable.occurredAt, d));
    }
    if (req.query.to) {
      const d = new Date(String(req.query.to));
      if (!Number.isNaN(d.getTime())) conds.push(lte(crmActivitiesTable.occurredAt, d));
    }
    // Non-admins can only see their own activities.
    if (req.userRole !== "admin") conds.push(eq(crmActivitiesTable.ownerUserId, req.userId!));
    const limit = Math.min(toInt(req.query.limit, 50), 200);
    const rows = await db.select().from(crmActivitiesTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(crmActivitiesTable.occurredAt)).limit(limit);
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] list activities:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// Any authenticated user can log an activity, but only against a record
// they own or have been shared on (when one is referenced).
router.post("/admin/crm/activities", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.type) { res.status(400).json({ error: "validation_error", message: "type required" }); return; }
    if (b.contactId && !(await requireWriteAccess(req, res, "contact", toInt(b.contactId)))) return;
    if (b.companyId && !(await requireWriteAccess(req, res, "company", toInt(b.companyId)))) return;
    if (b.dealId && !(await requireWriteAccess(req, res, "deal", toInt(b.dealId)))) return;
    if (b.leadId && !(await requireWriteAccess(req, res, "lead", toInt(b.leadId)))) return;
    const [row] = await db.insert(crmActivitiesTable).values({
      type: b.type,
      subject: b.subject || null,
      body: b.body || null,
      outcome: b.outcome || null,
      durationMinutes: b.durationMinutes ?? null,
      contactId: b.contactId ?? null,
      companyId: b.companyId ?? null,
      dealId: b.dealId ?? null,
      leadId: b.leadId ?? null,
      ownerUserId: req.userId!,
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
    }).returning();
    if (b.contactId) {
      await db.update(crmContactsTable).set({ lastActivityAt: new Date() })
        .where(eq(crmContactsTable.id, b.contactId));
    }
    res.status(201).json(row);
  } catch (err) {
    console.error("[CRM] create activity:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// Owners of an activity (or admins) can delete it.
router.delete("/admin/crm/activities/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const [act] = await db.select().from(crmActivitiesTable).where(eq(crmActivitiesTable.id, id)).limit(1);
    if (!act) { res.status(404).json({ error: "not_found" }); return; }
    if (req.userRole !== "admin" && act.ownerUserId !== req.userId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    await db.delete(crmActivitiesTable).where(eq(crmActivitiesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete activity:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// Send a real one-off email to a CRM contact via configured SMTP transport,
// then atomically log it as an Email activity. Either both succeed or the
// activity row is rolled back so the timeline never shows a phantom send.
router.post("/admin/crm/contacts/:id/email", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = toInt(req.params.id);
  if (!(await requireWriteAccess(req, res, "contact", id))) return;
  try {
    const subject = String(req.body?.subject ?? "").trim();
    const body = String(req.body?.body ?? "").trim();
    if (!subject && !body) {
      res.status(400).json({ error: "validation_error", message: "subject or body required" });
      return;
    }
    const [contact] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, id)).limit(1);
    if (!contact) { res.status(404).json({ error: "not_found" }); return; }
    if (!contact.email) {
      res.status(400).json({ error: "validation_error", message: "Contact has no email on file" });
      return;
    }

    let senderName: string | undefined;
    if (req.userId) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
      senderName = u?.name ?? undefined;
    }

    // Create the activity row first so we can roll it back if SMTP fails.
    const [activity] = await db.insert(crmActivitiesTable).values({
      type: "email",
      subject: subject || `Email to ${contact.email}`,
      body,
      contactId: id,
      companyId: contact.companyId ?? null,
      ownerUserId: req.userId!,
      occurredAt: new Date(),
    }).returning();

    let sent = false;
    try {
      sent = await sendCrmEmail({ to: contact.email, subject: subject || "(no subject)", body, fromName: senderName });
    } catch (sendErr) {
      console.error("[CRM] sendCrmEmail threw:", sendErr);
      sent = false;
    }

    if (!sent) {
      await db.delete(crmActivitiesTable).where(eq(crmActivitiesTable.id, activity.id));
      res.status(502).json({ error: "send_failed", message: "Email transport rejected the message. No activity was logged." });
      return;
    }

    await db.update(crmContactsTable).set({ lastActivityAt: new Date() }).where(eq(crmContactsTable.id, id));
    res.status(201).json({ ok: true, activity });
  } catch (err) {
    console.error("[CRM] send contact email:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Tasks
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/tasks", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const scope = String(req.query.scope ?? "mine"); // mine | team | all
    const status = String(req.query.status ?? "open");
    const conds: SQL<unknown>[] = [];
    if (status !== "all") conds.push(eq(crmTasksTable.status, status as typeof crmTasksTable.status._.data));
    if (scope === "mine") conds.push(eq(crmTasksTable.ownerUserId, req.userId!));
    // Non-admins can only see their own tasks regardless of requested scope.
    if (req.userRole !== "admin" && scope !== "mine") conds.push(eq(crmTasksTable.ownerUserId, req.userId!));
    if (req.query.contactId) conds.push(eq(crmTasksTable.contactId, toInt(req.query.contactId)));
    if (req.query.companyId) conds.push(eq(crmTasksTable.companyId, toInt(req.query.companyId)));
    if (req.query.dealId) conds.push(eq(crmTasksTable.dealId, toInt(req.query.dealId)));
    const rows = await db.select({
      id: crmTasksTable.id, title: crmTasksTable.title, description: crmTasksTable.description,
      dueAt: crmTasksTable.dueAt, priority: crmTasksTable.priority, status: crmTasksTable.status,
      ownerUserId: crmTasksTable.ownerUserId, ownerName: usersTable.name,
      contactId: crmTasksTable.contactId, companyId: crmTasksTable.companyId, dealId: crmTasksTable.dealId,
      contactName: crmContactsTable.fullName, companyName: crmCompaniesTable.name,
      createdAt: crmTasksTable.createdAt, completedAt: crmTasksTable.completedAt,
    }).from(crmTasksTable)
      .leftJoin(usersTable, eq(crmTasksTable.ownerUserId, usersTable.id))
      .leftJoin(crmContactsTable, eq(crmTasksTable.contactId, crmContactsTable.id))
      .leftJoin(crmCompaniesTable, eq(crmTasksTable.companyId, crmCompaniesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(crmTasksTable.dueAt));
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] list tasks:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// Any authenticated user can create a task. If a related record is
// referenced, the caller must own/be-shared on that record.
router.post("/admin/crm/tasks", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.title) { res.status(400).json({ error: "validation_error", message: "title required" }); return; }
    if (b.contactId && !(await requireWriteAccess(req, res, "contact", toInt(b.contactId)))) return;
    if (b.companyId && !(await requireWriteAccess(req, res, "company", toInt(b.companyId)))) return;
    if (b.dealId && !(await requireWriteAccess(req, res, "deal", toInt(b.dealId)))) return;
    if (b.leadId && !(await requireWriteAccess(req, res, "lead", toInt(b.leadId)))) return;
    if (req.userRole !== "admin" && b.ownerUserId && Number(b.ownerUserId) !== req.userId) {
      res.status(403).json({ error: "forbidden", message: "Only admins can assign tasks to other users." });
      return;
    }
    const [row] = await db.insert(crmTasksTable).values({
      title: b.title,
      description: b.description || null,
      dueAt: b.dueAt ? new Date(b.dueAt) : null,
      priority: b.priority || "medium",
      status: b.status || "open",
      ownerUserId: b.ownerUserId ?? req.userId!,
      contactId: b.contactId ?? null,
      companyId: b.companyId ?? null,
      dealId: b.dealId ?? null,
      leadId: b.leadId ?? null,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[CRM] create task:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/admin/crm/tasks/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const [t] = await db.select().from(crmTasksTable).where(eq(crmTasksTable.id, id)).limit(1);
    if (!t) { res.status(404).json({ error: "not_found" }); return; }
    const b = req.body || {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    // Mutable fields. ownerUserId / linked-entity reassignment is admin-only;
    // since the whole route is admin-gated this is enforced by requireAdmin,
    // but we keep an explicit allow-list so the contract is obvious.
    const allowed = ["title","description","priority","status","ownerUserId","contactId","companyId","dealId","leadId"];
    for (const f of allowed) {
      if (f in b) updates[f] = b[f];
    }
    if ("dueAt" in b) updates.dueAt = b.dueAt ? new Date(b.dueAt) : null;
    if (b.status === "done" && !updates.completedAt) updates.completedAt = new Date();
    await db.update(crmTasksTable).set(updates).where(eq(crmTasksTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] update task:", err);
    res.status(500).json({ error: "server_error" });
  }
});

async function loadTaskOrForbid(req: AuthRequest, res: Response, id: number) {
  const [t] = await db.select().from(crmTasksTable).where(eq(crmTasksTable.id, id)).limit(1);
  if (!t) { res.status(404).json({ error: "not_found" }); return null; }
  if (req.userRole !== "admin" && t.ownerUserId !== req.userId) {
    res.status(403).json({ error: "forbidden" }); return null;
  }
  return t;
}

router.post("/admin/crm/tasks/:id/done", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await loadTaskOrForbid(req, res, id))) return;
    await db.update(crmTasksTable).set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(crmTasksTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] mark task done:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/tasks/:id/snooze", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await loadTaskOrForbid(req, res, id))) return;
    const days = toInt(req.body?.days, 1);
    const newDue = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await db.update(crmTasksTable).set({ status: "snoozed", dueAt: newDue, updatedAt: new Date() })
      .where(eq(crmTasksTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] snooze task:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/tasks/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await loadTaskOrForbid(req, res, id))) return;
    await db.delete(crmTasksTable).where(eq(crmTasksTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete task:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Pipelines + stages
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/pipelines", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const pipelines = await db.select().from(crmPipelinesTable)
      .where(eq(crmPipelinesTable.archived, false))
      .orderBy(asc(crmPipelinesTable.sortOrder));
    const stages = await db.select().from(crmPipelineStagesTable).orderBy(asc(crmPipelineStagesTable.sortOrder));
    res.json({ pipelines, stages });
  } catch (err) {
    console.error("[CRM] pipelines:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/pipelines", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.name) { res.status(400).json({ error: "validation_error" }); return; }
    const [row] = await db.insert(crmPipelinesTable).values({
      name: b.name, description: b.description || null,
      isDefault: !!b.isDefault, sortOrder: b.sortOrder ?? 0,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[CRM] create pipeline:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/admin/crm/pipelines/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const b = req.body || {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const f of ["name","description","isDefault","sortOrder","archived"]) if (f in b) updates[f] = b[f];
    await db.update(crmPipelinesTable).set(updates).where(eq(crmPipelinesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] update pipeline:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/pipelines/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await db.update(crmPipelinesTable).set({ archived: true, updatedAt: new Date() })
      .where(eq(crmPipelinesTable.id, toInt(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete pipeline:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/pipelines/:pid/stages", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const pid = toInt(req.params.pid);
    const b = req.body || {};
    if (!b.name) { res.status(400).json({ error: "validation_error" }); return; }
    const slug = b.slug || String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const [row] = await db.insert(crmPipelineStagesTable).values({
      pipelineId: pid, name: b.name, slug, sortOrder: b.sortOrder ?? 0,
      isWon: !!b.isWon, isLost: !!b.isLost, color: b.color || null,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[CRM] create stage:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/admin/crm/pipelines/:pid/stages/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const b = req.body || {};
    const updates: Record<string, unknown> = {};
    for (const f of ["name","sortOrder","isWon","isLost","color"]) if (f in b) updates[f] = b[f];
    await db.update(crmPipelineStagesTable).set(updates).where(eq(crmPipelineStagesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] update stage:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// Move a deal to a different pipeline stage. The pipeline stage row is the
// canonical source of truth for that deal's position on the Kanban — the
// legacy `stage` enum column is mirrored only when the stage slug happens to
// match a known enum value, which lets admins create custom stages
// ("Initial Discovery", "Champion") without touching the enum.
// Pipeline stage moves are a core CRM workflow. Owners and explicitly shared
// users can drag a deal across the Kanban; only the underlying stage schema
// (CRM Settings) stays admin-only.
router.patch("/admin/crm/deals/:id/pipeline-stage", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = toInt(req.params.id);
  if (!(await requireWriteAccess(req, res, "deal", id))) return;
  try {
    const dealId = toInt(req.params.id);
    const stageId = req.body?.pipelineStageId == null ? null : toInt(req.body.pipelineStageId);

    let mirrorEnum: string | null = null;
    let pipelineId: number | null = null;
    if (stageId != null) {
      const [stage] = await db.select().from(crmPipelineStagesTable).where(eq(crmPipelineStagesTable.id, stageId)).limit(1);
      if (!stage) { res.status(404).json({ error: "stage_not_found" }); return; }
      pipelineId = stage.pipelineId;
      const ENUM_VALUES = new Set(["prospect", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]);
      if (ENUM_VALUES.has(stage.slug)) mirrorEnum = stage.slug;
    }

    const update: Record<string, unknown> = { pipelineStageId: stageId, updatedAt: new Date() };
    if (mirrorEnum) update.stage = mirrorEnum;

    const [row] = await db.update(partnerDealsTable)
      .set(update as Partial<typeof partnerDealsTable.$inferInsert>)
      .where(eq(partnerDealsTable.id, dealId)).returning();
    if (!row) { res.status(404).json({ error: "deal_not_found" }); return; }

    res.json({ ok: true, dealId, pipelineStageId: stageId, pipelineId });
  } catch (err) {
    console.error("[CRM] update deal pipeline-stage:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/pipelines/:pid/stages/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(crmPipelineStagesTable).where(eq(crmPipelineStagesTable.id, toInt(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete stage:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Tags
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/tags", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(crmTagsTable).orderBy(asc(crmTagsTable.name));
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] tags:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/tags", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.name) { res.status(400).json({ error: "validation_error" }); return; }
    const [row] = await db.insert(crmTagsTable).values({ name: b.name, color: b.color || "#0176d3" }).returning();
    res.status(201).json(row);
  } catch (err) {
    if (String((err as { code?: unknown } | null)?.code) === "23505") {
      const [existing] = await db.select().from(crmTagsTable).where(eq(crmTagsTable.name, req.body.name)).limit(1);
      res.json(existing); return;
    }
    console.error("[CRM] create tag:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/tags/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(crmTagsTable).where(eq(crmTagsTable.id, toInt(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete tag:", err);
    res.status(500).json({ error: "server_error" });
  }
});

async function applyTag(entity: "contacts"|"companies"|"deals", id: number, tagId: number) {
  if (!tagId || !id) return;
  try {
    if (entity === "contacts") {
      await db.insert(crmContactTagsTable).values({ contactId: id, tagId });
    } else if (entity === "companies") {
      await db.insert(crmCompanyTagsTable).values({ companyId: id, tagId });
    } else {
      await db.insert(crmDealTagsTable).values({ dealId: id, tagId });
    }
  } catch (err) {
    if (String((err as { code?: unknown } | null)?.code) !== "23505") throw err;
  }
}

async function removeTag(entity: "contacts"|"companies"|"deals", id: number, tagId: number) {
  if (entity === "contacts") {
    await db.delete(crmContactTagsTable).where(and(eq(crmContactTagsTable.contactId, id), eq(crmContactTagsTable.tagId, tagId)));
  } else if (entity === "companies") {
    await db.delete(crmCompanyTagsTable).where(and(eq(crmCompanyTagsTable.companyId, id), eq(crmCompanyTagsTable.tagId, tagId)));
  } else {
    await db.delete(crmDealTagsTable).where(and(eq(crmDealTagsTable.dealId, id), eq(crmDealTagsTable.tagId, tagId)));
  }
}

const TAG_ENTITY_TO_SHARE: Record<"contacts"|"companies"|"deals", ShareEntity> = {
  contacts: "contact", companies: "company", deals: "deal",
};
for (const entity of ["contacts", "companies", "deals"] as const) {
  router.get(`/admin/crm/${entity}/:id/tags`, requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = toInt(req.params.id);
      if (!(await requireReadAccess(req, res, TAG_ENTITY_TO_SHARE[entity], id))) return;
      let rows: Record<string, unknown>[] = [];
      if (entity === "contacts") {
        rows = await db.select({ id: crmTagsTable.id, name: crmTagsTable.name, color: crmTagsTable.color })
          .from(crmContactTagsTable)
          .innerJoin(crmTagsTable, eq(crmContactTagsTable.tagId, crmTagsTable.id))
          .where(eq(crmContactTagsTable.contactId, id));
      } else if (entity === "companies") {
        rows = await db.select({ id: crmTagsTable.id, name: crmTagsTable.name, color: crmTagsTable.color })
          .from(crmCompanyTagsTable)
          .innerJoin(crmTagsTable, eq(crmCompanyTagsTable.tagId, crmTagsTable.id))
          .where(eq(crmCompanyTagsTable.companyId, id));
      } else {
        rows = await db.select({ id: crmTagsTable.id, name: crmTagsTable.name, color: crmTagsTable.color })
          .from(crmDealTagsTable)
          .innerJoin(crmTagsTable, eq(crmDealTagsTable.tagId, crmTagsTable.id))
          .where(eq(crmDealTagsTable.dealId, id));
      }
      res.json({ rows });
    } catch (err) {
      console.error("[CRM] list entity tags:", err);
      res.status(500).json({ error: "server_error" });
    }
  });
  router.post(`/admin/crm/${entity}/:id/tags`, requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const id = toInt(req.params.id);
    if (!(await requireWriteAccess(req, res, TAG_ENTITY_TO_SHARE[entity], id))) return;
    try {
      const tagId = toInt(req.body?.tagId);
      if (!tagId) { res.status(400).json({ error: "validation_error" }); return; }
      await applyTag(entity, id, tagId);
      res.json({ ok: true });
    } catch (err) {
      console.error("[CRM] tag entity:", err);
      res.status(500).json({ error: "server_error" });
    }
  });
  router.delete(`/admin/crm/${entity}/:id/tags/:tagId`, requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const id = toInt(req.params.id);
    if (!(await requireWriteAccess(req, res, TAG_ENTITY_TO_SHARE[entity], id))) return;
    try {
      await removeTag(entity, id, toInt(req.params.tagId));
      res.json({ ok: true });
    } catch (err) {
      console.error("[CRM] untag entity:", err);
      res.status(500).json({ error: "server_error" });
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Custom fields
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/custom-fields", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const entity = req.query.entity ? String(req.query.entity) : null;
    const where = entity ? eq(crmCustomFieldsTable.entity, entity as typeof crmCustomFieldsTable.entity._.data) : undefined;
    const rows = await db.select().from(crmCustomFieldsTable).where(where).orderBy(asc(crmCustomFieldsTable.sortOrder));
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] custom fields:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/custom-fields", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.entity || !b.label || !b.key) { res.status(400).json({ error: "validation_error" }); return; }
    const [row] = await db.insert(crmCustomFieldsTable).values({
      entity: b.entity, label: b.label, key: b.key,
      type: b.type || "text", options: b.options || [], sortOrder: b.sortOrder ?? 0,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[CRM] create custom field:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/custom-fields/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(crmCustomFieldsTable).where(eq(crmCustomFieldsTable.id, toInt(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete custom field:", err);
    res.status(500).json({ error: "server_error" });
  }
});

for (const entity of ["contacts", "companies", "deals"] as const) {
  const singular = entity === "contacts" ? "contact" : entity === "companies" ? "company" : "deal";
  const shareEntity = singular as ShareEntity;
  router.get(`/admin/crm/${entity}/:id/field-values`, requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = toInt(req.params.id);
      if (!(await requireReadAccess(req, res, shareEntity, id))) return;
      const rows = await db.select({
        fieldId: crmCustomFieldValuesTable.fieldId,
        value: crmCustomFieldValuesTable.value,
      }).from(crmCustomFieldValuesTable)
        .where(and(eq(crmCustomFieldValuesTable.entity, singular), eq(crmCustomFieldValuesTable.entityId, id)));
      res.json({ rows });
    } catch (err) {
      console.error("[CRM] field values:", err);
      res.status(500).json({ error: "server_error" });
    }
  });
}

router.put("/admin/crm/custom-fields/:fid/values", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const fieldId = toInt(req.params.fid);
    const b = req.body || {};
    if (!b.entity || !b.entityId) { res.status(400).json({ error: "validation_error" }); return; }
    const shareEntity = b.entity === "contact" ? "contact" : b.entity === "company" ? "company" : b.entity === "deal" ? "deal" : null;
    if (shareEntity && !(await requireWriteAccess(req, res, shareEntity as ShareEntity, toInt(b.entityId)))) return;
    const existing = await db.select().from(crmCustomFieldValuesTable)
      .where(and(eq(crmCustomFieldValuesTable.fieldId, fieldId), eq(crmCustomFieldValuesTable.entity, b.entity), eq(crmCustomFieldValuesTable.entityId, b.entityId))).limit(1);
    if (existing[0]) {
      await db.update(crmCustomFieldValuesTable).set({ value: b.value ?? null }).where(eq(crmCustomFieldValuesTable.id, existing[0].id));
    } else {
      await db.insert(crmCustomFieldValuesTable).values({ fieldId, entity: b.entity, entityId: b.entityId, value: b.value ?? null });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] set custom field value:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Saved views
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/saved-views", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const entity = String(req.query.entity ?? "");
    const conds: SQL<unknown>[] = [or(eq(crmSavedViewsTable.ownerUserId, req.userId!), eq(crmSavedViewsTable.shared, true))!];
    if (entity) conds.push(eq(crmSavedViewsTable.entity, entity));
    const rows = await db.select().from(crmSavedViewsTable).where(and(...conds)).orderBy(asc(crmSavedViewsTable.name));
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] saved views:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/saved-views", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.entity || !b.name) { res.status(400).json({ error: "validation_error" }); return; }
    const [row] = await db.insert(crmSavedViewsTable).values({
      ownerUserId: req.userId!, entity: b.entity, name: b.name,
      filters: b.filters || {}, shared: !!b.shared,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[CRM] create saved view:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/admin/crm/saved-views/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    await db.delete(crmSavedViewsTable).where(and(eq(crmSavedViewsTable.id, id), eq(crmSavedViewsTable.ownerUserId, req.userId!)));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] delete saved view:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Admin-CRM read endpoints for leads + deals
// ─────────────────────────────────────────────────────────────────────────────
// The legacy /partner/leads + /partner/deals endpoints return [] for main-site
// admins (they're scoped to a single partnerId). The CRM list pages need to
// see every record the caller is entitled to: admins → all rows; everyone
// else → owned + explicitly shared. ownerReadScope handles that uniformly.
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/leads", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const scope = ownerReadScope(req, partnerLeadsTable.assignedUserId, "lead", partnerLeadsTable.id);
    const q = db.select().from(partnerLeadsTable);
    const rows = scope ? await q.where(scope).orderBy(desc(partnerLeadsTable.assignedAt))
                       : await q.orderBy(desc(partnerLeadsTable.assignedAt));
    res.json(rows);
  } catch (err) {
    console.error("[CRM] list leads:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/crm/deals", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const scope = ownerReadScope(req, partnerDealsTable.assignedUserId, "deal", partnerDealsTable.id);
    const q = db.select().from(partnerDealsTable);
    const rows = scope ? await q.where(scope).orderBy(desc(partnerDealsTable.createdAt))
                       : await q.orderBy(desc(partnerDealsTable.createdAt));
    res.json(rows.map(d => ({
      ...d,
      products: safeJson(d.products, [] as unknown[]),
      tsdTargets: safeJson(d.tsdTargets, [] as unknown[]),
      vendorSelections: safeJson(d.vendorSelections, [] as unknown[]),
    })));
  } catch (err) {
    console.error("[CRM] list deals:", err);
    res.status(500).json({ error: "server_error" });
  }
});

function safeJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== "string") return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

// ─── Admin lead/deal create + lead status update ─────────────────────────────
// The partner-side endpoints (POST /partner/leads, POST /partner/deals,
// PUT /partner/leads/:id) explicitly 403 main-site admin tokens because they
// require a partnerId. The hooks in the portal route admin sessions here so
// admins can create leads/deals from the CRM UI without a partner context.

router.post("/admin/crm/leads", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { companyName, contactName, email, phone, interest, notes, source, partnerId, assignedUserId } = req.body ?? {};
    if (!companyName || !contactName || !interest) {
      res.status(400).json({ error: "invalid_input", message: "Company name, contact name, and interest are required" });
      return;
    }
    const [lead] = await db.insert(partnerLeadsTable).values({
      partnerId: typeof partnerId === "number" ? partnerId : null,
      companyName: String(companyName).trim(),
      contactName: String(contactName).trim(),
      email: email ? String(email).trim() : null,
      phone: phone ? String(phone).trim() : null,
      interest: String(interest).trim(),
      notes: notes ? String(notes).trim() : null,
      source: source ? String(source) : "admin_crm",
      assignedUserId: typeof assignedUserId === "number" ? assignedUserId : req.userId!,
    }).returning();

    upsertContact({
      name: String(contactName).trim(),
      email: email ? String(email).trim() : null,
      phone: phone ? String(phone).trim() : null,
      companyName: String(companyName).trim(),
      source: "admin_crm_lead",
    }).then(async ({ contactId, companyId }) => {
      if (contactId || companyId) {
        await db.update(partnerLeadsTable)
          .set({ crmContactId: contactId, crmCompanyId: companyId })
          .where(eq(partnerLeadsTable.id, lead.id));
      }
    }).catch(err => console.error("[CRM] admin lead upsert error:", err));

    res.status(201).json(lead);
  } catch (err) {
    console.error("[CRM] create lead:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create lead" });
  }
});

router.put("/admin/crm/leads/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const { status, notes, assignedUserId } = req.body ?? {};
    const updates: Partial<typeof partnerLeadsTable.$inferInsert> = {};
    if (status != null) updates.status = String(status) as typeof partnerLeadsTable.$inferInsert["status"];
    if (notes !== undefined) updates.notes = notes == null ? null : String(notes);
    if (typeof assignedUserId === "number") updates.assignedUserId = assignedUserId;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "invalid_input", message: "No fields to update" });
      return;
    }
    const [lead] = await db.update(partnerLeadsTable).set(updates)
      .where(eq(partnerLeadsTable.id, id)).returning();
    if (!lead) { res.status(404).json({ error: "not_found", message: "Lead not found" }); return; }
    res.json(lead);
  } catch (err) {
    console.error("[CRM] update lead:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update lead" });
  }
});

router.post("/admin/crm/deals", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const {
      title, customerName, customerEmail, customerPhone, description,
      products, vendorSelections, estimatedValue, stage, expectedCloseDate,
      notes, tsdTargets, partnerId, assignedUserId,
    } = req.body ?? {};
    if (!title || !customerName) {
      res.status(400).json({ error: "validation_error", message: "title and customerName are required" });
      return;
    }
    const [deal] = await db.insert(partnerDealsTable).values({
      partnerId: typeof partnerId === "number" ? partnerId : null,
      title: String(title),
      customerName: String(customerName),
      customerEmail: customerEmail ? String(customerEmail) : null,
      customerPhone: customerPhone ? String(customerPhone) : null,
      description: description ? String(description) : null,
      products: JSON.stringify(Array.isArray(products) ? products : []),
      vendorSelections: JSON.stringify(Array.isArray(vendorSelections) ? vendorSelections : []),
      estimatedValue: estimatedValue != null ? String(estimatedValue) : null,
      stage: stage || "prospect",
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      notes: notes ? String(notes) : null,
      tsdTargets: JSON.stringify(Array.isArray(tsdTargets) ? tsdTargets : []),
      assignedUserId: typeof assignedUserId === "number" ? assignedUserId : req.userId!,
    }).returning();

    upsertContact({
      name: String(customerName),
      email: customerEmail ? String(customerEmail) : null,
      phone: customerPhone ? String(customerPhone) : null,
      companyName: String(customerName),
      source: "admin_crm_deal",
    }).then(async ({ contactId, companyId }) => {
      if (contactId || companyId) {
        await db.update(partnerDealsTable)
          .set({ crmContactId: contactId, crmCompanyId: companyId })
          .where(eq(partnerDealsTable.id, deal.id));
      }
    }).catch(err => console.error("[CRM] admin deal upsert error:", err));

    res.status(201).json({
      ...deal,
      products: safeJson(deal.products, [] as unknown[]),
      tsdTargets: safeJson(deal.tsdTargets, [] as unknown[]),
      vendorSelections: safeJson(deal.vendorSelections, [] as unknown[]),
    });
  } catch (err) {
    console.error("[CRM] create deal:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create deal" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Convert lead → contact + company + deal
// ═════════════════════════════════════════════════════════════════════════════

// Lead conversion is a core CRM workflow. Admin-only under the current
// access model; the per-record write check (requireWriteAccess) is a no-op
// for admin sessions and remains in place as defense-in-depth for the
// future "team CRM" expansion documented at the top of this file.
router.post("/admin/crm/leads/:id/convert", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await requireWriteAccess(req, res, "lead", id))) return;
    const [lead] = await db.select().from(partnerLeadsTable).where(eq(partnerLeadsTable.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "not_found" }); return; }
    const { contactId, companyId } = await upsertContact({
      name: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      companyName: lead.companyName,
      source: lead.source || "partner_lead",
    });
    const dealValueRaw = req.body?.dealValue;
    const dealValueStr = (typeof dealValueRaw === "number" && Number.isFinite(dealValueRaw))
      ? dealValueRaw.toFixed(2)
      : (typeof dealValueRaw === "string" && dealValueRaw.trim() !== "" && Number.isFinite(Number(dealValueRaw)))
        ? Number(dealValueRaw).toFixed(2)
        : null;
    const [deal] = await db.insert(partnerDealsTable).values({
      partnerId: lead.partnerId,
      title: req.body?.dealTitle || `${lead.companyName} — ${lead.contactName}`,
      customerName: lead.companyName,
      customerEmail: lead.email,
      customerPhone: lead.phone,
      description: lead.notes,
      estimatedValue: dealValueStr,
      crmContactId: contactId,
      crmCompanyId: companyId,
      assignedUserId: req.userId!,
    }).returning();
    await db.update(partnerLeadsTable).set({
      status: "converted",
      crmContactId: contactId,
      crmCompanyId: companyId,
    }).where(eq(partnerLeadsTable.id, id));
    await db.insert(crmActivitiesTable).values({
      type: "note",
      subject: "Lead converted",
      body: `Converted lead #${id} to contact, company, and deal #${deal.id}`,
      contactId, companyId, dealId: deal.id, leadId: id,
      ownerUserId: req.userId!,
    });
    res.json({ contactId, companyId, dealId: deal.id });
  } catch (err) {
    console.error("[CRM] convert lead:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Record sharing — admins grant non-admin users access to specific records
// ═════════════════════════════════════════════════════════════════════════════

const SHARE_ENTITIES = new Set<ShareEntity>(["contact", "company", "deal", "lead"]);

router.get("/admin/crm/share/:entity/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const entity = req.params.entity as ShareEntity;
    if (!SHARE_ENTITIES.has(entity)) { res.status(400).json({ error: "invalid_entity" }); return; }
    const id = toInt(req.params.id);
    const r = await db.execute<{ id: number; userId: number; createdAt: Date; name: string | null; email: string | null }>(sql`
      SELECT s.id, s.user_id AS "userId", s.created_at AS "createdAt",
             u.name, u.email
      FROM crm_shares s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.entity = ${entity} AND s.entity_id = ${id}
      ORDER BY s.created_at DESC
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    console.error("[CRM] list shares:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/crm/share/:entity/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const entity = req.params.entity as ShareEntity;
    if (!SHARE_ENTITIES.has(entity)) { res.status(400).json({ error: "invalid_entity" }); return; }
    const id = toInt(req.params.id);
    const userId = toInt(req.body?.userId);
    if (!userId) { res.status(400).json({ error: "validation_error", message: "userId required" }); return; }
    await db.execute(sql`
      INSERT INTO crm_shares (entity, entity_id, user_id, granted_by_user_id)
      VALUES (${entity}, ${id}, ${userId}, ${req.userId!})
      ON CONFLICT (entity, entity_id, user_id) DO NOTHING
    `);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[CRM] add share:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.delete("/admin/crm/share/:entity/:id/:userId", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const entity = req.params.entity as ShareEntity;
    if (!SHARE_ENTITIES.has(entity)) { res.status(400).json({ error: "invalid_entity" }); return; }
    const id = toInt(req.params.id);
    const userId = toInt(req.params.userId);
    await db.execute(sql`
      DELETE FROM crm_shares WHERE entity = ${entity} AND entity_id = ${id} AND user_id = ${userId}
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[CRM] remove share:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Deal detail + timeline (CRM deal profile)
// ═════════════════════════════════════════════════════════════════════════════

router.get("/admin/crm/deals/:id/files", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await requireReadAccess(req, res, "deal", id))) return;
    const [deal] = await db.select().from(partnerDealsTable).where(eq(partnerDealsTable.id, id)).limit(1);
    if (!deal) { res.json({ rows: [] }); return; }
    // Documents are linked to a CRM company; surface every doc attached to
    // the deal's company as the deal's file list. Falls back to empty if the
    // deal has no linked company yet.
    if (!deal.crmCompanyId) { res.json({ rows: [] }); return; }
    const rows = await db.select({
      id: documentsTable.id, name: documentsTable.name, filename: documentsTable.filename,
      category: documentsTable.category, createdAt: documentsTable.createdAt,
    }).from(documentsTable).where(eq(documentsTable.crmCompanyId, deal.crmCompanyId))
      .orderBy(desc(documentsTable.createdAt)).limit(100);
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] deal files:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/crm/deals/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await requireReadAccess(req, res, "deal", id))) return;
    const [deal] = await db.select().from(partnerDealsTable).where(eq(partnerDealsTable.id, id)).limit(1);
    if (!deal) { res.status(404).json({ error: "not_found" }); return; }
    type DealContact = { id: number; fullName: string; email: string | null; phone: string | null };
    type DealCompany = { id: number; name: string; website: string | null };
    let contact: DealContact | null = null, company: DealCompany | null = null;
    let ownerName: string | null = null, stageName: string | null = null;
    if (deal.crmContactId) {
      const [c] = await db.select({ id: crmContactsTable.id, fullName: crmContactsTable.fullName, email: crmContactsTable.email, phone: crmContactsTable.phone })
        .from(crmContactsTable).where(eq(crmContactsTable.id, deal.crmContactId)).limit(1);
      contact = c ?? null;
    }
    if (deal.crmCompanyId) {
      const [co] = await db.select({ id: crmCompaniesTable.id, name: crmCompaniesTable.name, website: crmCompaniesTable.website })
        .from(crmCompaniesTable).where(eq(crmCompaniesTable.id, deal.crmCompanyId)).limit(1);
      company = co ?? null;
    }
    if (deal.assignedUserId) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, deal.assignedUserId)).limit(1);
      ownerName = u?.name ?? null;
    }
    if (deal.pipelineStageId) {
      const [s] = await db.select({ name: crmPipelineStagesTable.name })
        .from(crmPipelineStagesTable).where(eq(crmPipelineStagesTable.id, deal.pipelineStageId)).limit(1);
      stageName = s?.name ?? null;
    }
    res.json({ deal, contact, company, ownerName, stageName });
  } catch (err) {
    console.error("[CRM] deal detail:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/crm/deals/:id/timeline", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (!(await requireReadAccess(req, res, "deal", id))) return;
    const [deal] = await db.select().from(partnerDealsTable).where(eq(partnerDealsTable.id, id)).limit(1);
    if (!deal) { res.status(404).json({ error: "not_found" }); return; }
    const conds: SQL[] = [eq(crmActivitiesTable.dealId, id)];
    if (deal.crmContactId) conds.push(eq(crmActivitiesTable.contactId, deal.crmContactId));
    if (deal.crmCompanyId) conds.push(eq(crmActivitiesTable.companyId, deal.crmCompanyId));
    const rows = await db.select().from(crmActivitiesTable)
      .where(or(...conds))
      .orderBy(desc(crmActivitiesTable.occurredAt))
      .limit(200);
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] deal timeline:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Admin user list (owner picker)
// ═════════════════════════════════════════════════════════════════════════════

// Owner picker. Admins see every active main-site user (so they can assign
// records). Non-admins only see themselves — they can't reassign records they
// don't own anyway, but the frontend still queries this list to render names
// alongside owner badges, so a 403 here would cascade into broken pages.
router.get("/admin/crm/users", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  if (req.userRole !== "admin") {
    const [self] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    res.json({ rows: self ? [self] : [] });
    return;
  }
  return adminUsersList(req, res);
});

async function adminUsersList(_req: AuthRequest, res: Response) {
  try {
    const rows = await db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role,
    }).from(usersTable).orderBy(asc(usersTable.name));
    res.json({ rows });
  } catch (err) {
    console.error("[CRM] users:", err);
    res.status(500).json({ error: "server_error" });
  }
}

export default router;
