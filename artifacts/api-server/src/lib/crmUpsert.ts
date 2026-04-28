import { db, crmContactsTable, crmCompaniesTable, crmActivitiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  if (!e || !e.includes("@")) return null;
  return e;
}

export function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|llp|plc|gmbh)\b\.?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildFullName(name?: string | null, first?: string | null, last?: string | null): string {
  if (name && name.trim()) return name.trim();
  const fn = (first || "").trim();
  const ln = (last || "").trim();
  const joined = `${fn} ${ln}`.trim();
  return joined || "(no name)";
}

export interface UpsertCompanyInput {
  name?: string | null;
  website?: string | null;
  phone?: string | null;
  industry?: string | null;
  source?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  partnerId?: number | null;
}

export async function upsertCompany(input: UpsertCompanyInput): Promise<number | null> {
  const normalized = normalizeCompanyName(input.name);
  if (!normalized || !input.name) return null;
  const existing = await db.select({ id: crmCompaniesTable.id })
    .from(crmCompaniesTable)
    .where(eq(crmCompaniesTable.normalizedName, normalized))
    .limit(1);
  if (existing[0]) {
    // Soft fill blanks only — never overwrite admin-curated data
    await db.update(crmCompaniesTable).set({
      website: sql`COALESCE(${crmCompaniesTable.website}, ${input.website ?? null})`,
      phone: sql`COALESCE(${crmCompaniesTable.phone}, ${input.phone ?? null})`,
      industry: sql`COALESCE(${crmCompaniesTable.industry}, ${input.industry ?? null})`,
      city: sql`COALESCE(${crmCompaniesTable.city}, ${input.city ?? null})`,
      state: sql`COALESCE(${crmCompaniesTable.state}, ${input.state ?? null})`,
      zip: sql`COALESCE(${crmCompaniesTable.zip}, ${input.zip ?? null})`,
      partnerId: sql`COALESCE(${crmCompaniesTable.partnerId}, ${input.partnerId ?? null})`,
      updatedAt: new Date(),
    }).where(eq(crmCompaniesTable.id, existing[0].id));
    return existing[0].id;
  }
  const [row] = await db.insert(crmCompaniesTable).values({
    name: input.name,
    normalizedName: normalized,
    website: input.website || null,
    phone: input.phone || null,
    industry: input.industry || null,
    source: input.source || null,
    city: input.city || null,
    state: input.state || null,
    zip: input.zip || null,
    partnerId: input.partnerId || null,
  }).returning({ id: crmCompaniesTable.id });
  return row.id;
}

export interface UpsertContactInput {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  companyName?: string | null;
  companyId?: number | null;
  source?: string | null;
  partnerId?: number | null;
}

export async function upsertContact(input: UpsertContactInput): Promise<{ contactId: number | null; companyId: number | null }> {
  const normalizedEmail = normalizeEmail(input.email);
  const fullName = buildFullName(input.name, input.firstName, input.lastName);
  let companyId: number | null = input.companyId ?? null;
  if (!companyId && input.companyName) {
    companyId = await upsertCompany({ name: input.companyName, source: input.source, partnerId: input.partnerId ?? null });
  }
  if (!normalizedEmail && !fullName) return { contactId: null, companyId };

  if (normalizedEmail) {
    const existing = await db.select({ id: crmContactsTable.id })
      .from(crmContactsTable)
      .where(eq(crmContactsTable.normalizedEmail, normalizedEmail))
      .limit(1);
    if (existing[0]) {
      await db.update(crmContactsTable).set({
        fullName: sql`CASE WHEN ${crmContactsTable.fullName} IS NULL OR ${crmContactsTable.fullName} = '(no name)' THEN ${fullName} ELSE ${crmContactsTable.fullName} END`,
        firstName: sql`COALESCE(${crmContactsTable.firstName}, ${input.firstName ?? null})`,
        lastName: sql`COALESCE(${crmContactsTable.lastName}, ${input.lastName ?? null})`,
        phone: sql`COALESCE(${crmContactsTable.phone}, ${input.phone ?? null})`,
        title: sql`COALESCE(${crmContactsTable.title}, ${input.title ?? null})`,
        companyId: sql`COALESCE(${crmContactsTable.companyId}, ${companyId ?? null})`,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(crmContactsTable.id, existing[0].id));
      return { contactId: existing[0].id, companyId };
    }
  }

  const [row] = await db.insert(crmContactsTable).values({
    firstName: input.firstName || null,
    lastName: input.lastName || null,
    fullName,
    email: input.email || null,
    normalizedEmail,
    phone: input.phone || null,
    title: input.title || null,
    companyId: companyId ?? null,
    source: input.source || null,
    lastActivityAt: new Date(),
  }).returning({ id: crmContactsTable.id });
  return { contactId: row.id, companyId };
}

/** Log a system-generated activity (e.g. "lead created", "deal moved"). */
export async function logSystemActivity(opts: {
  contactId?: number | null;
  companyId?: number | null;
  dealId?: number | null;
  leadId?: number | null;
  subject: string;
  body?: string;
  ownerUserId?: number | null;
}): Promise<void> {
  if (!opts.contactId && !opts.companyId && !opts.dealId && !opts.leadId) return;
  try {
    await db.insert(crmActivitiesTable).values({
      type: "note",
      subject: opts.subject,
      body: opts.body || null,
      contactId: opts.contactId ?? null,
      companyId: opts.companyId ?? null,
      dealId: opts.dealId ?? null,
      leadId: opts.leadId ?? null,
      ownerUserId: opts.ownerUserId ?? null,
    });
  } catch (err) {
    console.error("[CRM] logSystemActivity failed:", err);
  }
}

/**
 * Fire-and-forget upsert from any public/partner submission. Catches errors so
 * the caller's primary flow is never blocked by CRM failures.
 */
export function upsertContactSafe(input: UpsertContactInput): Promise<{ contactId: number | null; companyId: number | null }> {
  return upsertContact(input).catch(err => {
    console.error("[CRM] upsertContact failed:", err);
    return { contactId: null, companyId: null };
  });
}
