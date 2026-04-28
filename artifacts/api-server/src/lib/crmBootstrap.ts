import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotently creates every CRM table, the link columns on existing tables,
 * and runs a one-time backfill that populates crm_contacts / crm_companies
 * from every existing record source.
 *
 * Uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so safe to call
 * on every boot. Backfill is gated by the `applied_migrations` tracker.
 */
export async function runCrmBootstrap(): Promise<void> {
  // ── enums ─────────────────────────────────────────────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_entity_kind') THEN
        CREATE TYPE crm_entity_kind AS ENUM ('contact','company','deal','lead');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_activity_type') THEN
        CREATE TYPE crm_activity_type AS ENUM ('note','call','email','meeting','task');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_task_priority') THEN
        CREATE TYPE crm_task_priority AS ENUM ('low','medium','high','urgent');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_task_status') THEN
        CREATE TYPE crm_task_status AS ENUM ('open','done','snoozed');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_custom_field_type') THEN
        CREATE TYPE crm_custom_field_type AS ENUM ('text','number','date','select');
      END IF;
    END $$
  `);

  // ── companies ─────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_companies (
      id serial PRIMARY KEY,
      name text NOT NULL,
      normalized_name text NOT NULL,
      website text,
      phone text,
      industry text,
      size text,
      street text,
      city text,
      state text,
      zip text,
      country text,
      notes text,
      source text,
      assigned_user_id integer REFERENCES users(id),
      partner_id integer,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_companies_normalized_name_uniq ON crm_companies(normalized_name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_companies_name_idx ON crm_companies(name)`);

  // ── contacts ──────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id serial PRIMARY KEY,
      first_name text,
      last_name text,
      full_name text NOT NULL,
      email text,
      normalized_email text,
      phone text,
      title text,
      company_id integer REFERENCES crm_companies(id),
      source text,
      notes text,
      score integer NOT NULL DEFAULT 0,
      assigned_user_id integer REFERENCES users(id),
      lifecycle_stage text NOT NULL DEFAULT 'lead',
      unsubscribed_at timestamp,
      last_activity_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_normalized_email_uniq ON crm_contacts(normalized_email) WHERE normalized_email IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_contacts_full_name_idx ON crm_contacts(full_name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_contacts_company_idx ON crm_contacts(company_id)`);

  // ── activities ────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_activities (
      id serial PRIMARY KEY,
      type crm_activity_type NOT NULL,
      subject text,
      body text,
      outcome text,
      duration_minutes integer,
      contact_id integer REFERENCES crm_contacts(id),
      company_id integer REFERENCES crm_companies(id),
      deal_id integer,
      lead_id integer,
      owner_user_id integer REFERENCES users(id),
      occurred_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_activities_contact_idx ON crm_activities(contact_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_activities_company_idx ON crm_activities(company_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_activities_deal_idx ON crm_activities(deal_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_activities_owner_idx ON crm_activities(owner_user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_activities_occurred_idx ON crm_activities(occurred_at)`);

  // ── tasks ─────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_tasks (
      id serial PRIMARY KEY,
      title text NOT NULL,
      description text,
      due_at timestamp,
      priority crm_task_priority NOT NULL DEFAULT 'medium',
      status crm_task_status NOT NULL DEFAULT 'open',
      owner_user_id integer REFERENCES users(id),
      contact_id integer REFERENCES crm_contacts(id),
      company_id integer REFERENCES crm_companies(id),
      deal_id integer,
      lead_id integer,
      reminder_sent_at timestamp,
      completed_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_tasks_owner_idx ON crm_tasks(owner_user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_tasks_due_idx ON crm_tasks(due_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_tasks_status_idx ON crm_tasks(status)`);

  // ── pipelines + stages ────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_pipelines (
      id serial PRIMARY KEY,
      name text NOT NULL,
      description text,
      is_default boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      archived boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
      id serial PRIMARY KEY,
      pipeline_id integer NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
      name text NOT NULL,
      slug text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      is_won boolean NOT NULL DEFAULT false,
      is_lost boolean NOT NULL DEFAULT false,
      color text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stages_pipeline_slug_uniq ON crm_pipeline_stages(pipeline_id, slug)`);

  // ── tags ──────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_tags (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      color text NOT NULL DEFAULT '#0176d3',
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_contact_tags (
      id serial PRIMARY KEY,
      contact_id integer NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      tag_id integer NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_contact_tags_uniq ON crm_contact_tags(contact_id, tag_id)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_company_tags (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
      tag_id integer NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_company_tags_uniq ON crm_company_tags(company_id, tag_id)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_deal_tags (
      id serial PRIMARY KEY,
      deal_id integer NOT NULL,
      tag_id integer NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_deal_tags_uniq ON crm_deal_tags(deal_id, tag_id)`);

  // ── custom fields ─────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_custom_fields (
      id serial PRIMARY KEY,
      entity crm_entity_kind NOT NULL,
      label text NOT NULL,
      key text NOT NULL,
      type crm_custom_field_type NOT NULL DEFAULT 'text',
      options jsonb DEFAULT '[]',
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_custom_fields_entity_key_uniq ON crm_custom_fields(entity, key)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_custom_field_values (
      id serial PRIMARY KEY,
      field_id integer NOT NULL REFERENCES crm_custom_fields(id) ON DELETE CASCADE,
      entity crm_entity_kind NOT NULL,
      entity_id integer NOT NULL,
      value text
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_custom_field_values_uniq ON crm_custom_field_values(field_id, entity, entity_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_custom_field_values_entity_idx ON crm_custom_field_values(entity, entity_id)`);

  // ── saved views ───────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_saved_views (
      id serial PRIMARY KEY,
      owner_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity text NOT NULL,
      name text NOT NULL,
      filters jsonb NOT NULL DEFAULT '{}',
      shared boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_saved_views_owner_entity_idx ON crm_saved_views(owner_user_id, entity)`);

  // ── explicit record sharing (per requirement #11: owners + shared users) ──
  // Lets admins grant a non-admin user read/write access to a specific
  // contact / company / deal / lead they don't own. ownerReadScope and the
  // write-access helper join against this table to enforce
  // "owned OR explicitly shared" visibility for non-admins.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_shares (
      id serial PRIMARY KEY,
      entity crm_entity_kind NOT NULL,
      entity_id integer NOT NULL,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_by_user_id integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crm_shares_uniq ON crm_shares(entity, entity_id, user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS crm_shares_user_entity_idx ON crm_shares(user_id, entity)`);

  // ── link columns on existing tables ───────────────────────────────────
  const linkTables: { table: string; addOwner?: boolean }[] = [
    { table: "partner_leads", addOwner: true },
    { table: "partner_deals", addOwner: true },
    { table: "quotes", addOwner: true },
    { table: "contacts", addOwner: true },
    { table: "vivint_inquiries", addOwner: true },
    { table: "lead_magnet_submissions" },
    { table: "partner_support_tickets" },
    { table: "documents" },
    { table: "written_plans" },
    { table: "quote_proposals" },
  ];
  for (const t of linkTables) {
    await db.execute(sql.raw(`ALTER TABLE ${t.table} ADD COLUMN IF NOT EXISTS crm_contact_id integer`));
    await db.execute(sql.raw(`ALTER TABLE ${t.table} ADD COLUMN IF NOT EXISTS crm_company_id integer`));
    if (t.addOwner) {
      await db.execute(sql.raw(`ALTER TABLE ${t.table} ADD COLUMN IF NOT EXISTS assigned_user_id integer`));
    }
  }
  // contacts.source was added to the schema as part of CRM work — patch the
  // legacy DB so insertions matching the new shape don't crash.
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source text`);
  // partner_deals also gets a pipeline_stage_id so the kanban can use custom pipelines
  await db.execute(sql`ALTER TABLE partner_deals ADD COLUMN IF NOT EXISTS pipeline_stage_id integer`);

  // partner_id is being relaxed to nullable on partner_deals + partner_leads
  // so admin-created CRM records (with no partner context) can be stored.
  // Partner-side endpoints continue to require + supply a partnerId; this
  // only affects admin POST /admin/crm/{leads,deals}.
  await db.execute(sql`ALTER TABLE partner_deals ALTER COLUMN partner_id DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE partner_leads ALTER COLUMN partner_id DROP NOT NULL`);

  // ── default pipeline ──────────────────────────────────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM crm_pipelines WHERE is_default = true) THEN
        INSERT INTO crm_pipelines (name, description, is_default, sort_order)
        VALUES ('Sales Pipeline', 'Default pipeline for new business deals', true, 0);
      END IF;
    END $$
  `);
  // Seed default stages mapping to existing deal_stage enum
  await db.execute(sql`
    DO $$
    DECLARE pid integer;
    BEGIN
      SELECT id INTO pid FROM crm_pipelines WHERE is_default = true LIMIT 1;
      IF pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_pipeline_stages WHERE pipeline_id = pid) THEN
        INSERT INTO crm_pipeline_stages (pipeline_id, name, slug, sort_order, is_won, is_lost) VALUES
          (pid, 'Prospect',      'prospect',      0, false, false),
          (pid, 'Qualification', 'qualification', 1, false, false),
          (pid, 'Proposal',      'proposal',      2, false, false),
          (pid, 'Negotiation',   'negotiation',   3, false, false),
          (pid, 'Closed Won',    'closed_won',    4, true,  false),
          (pid, 'Closed Lost',   'closed_lost',   5, false, true);
      END IF;
    END $$
  `);

  // ── one-time backfill ────────────────────────────────────────────────
  await db.execute(sql`
    DO $$
    DECLARE def_pid integer;
    BEGIN
      IF EXISTS (SELECT 1 FROM applied_migrations WHERE name = 'crm_backfill_v1') THEN RETURN; END IF;

      -- public contact submissions
      INSERT INTO crm_companies (name, normalized_name, source)
      SELECT DISTINCT ON (lower(trim(regexp_replace(company, '[.,]', '', 'g'))))
        company,
        regexp_replace(lower(trim(regexp_replace(company, '[.,]', '', 'g'))), '\\s+', ' ', 'g'),
        'contact_form'
      FROM contacts
      WHERE company IS NOT NULL AND length(trim(company)) > 0
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO crm_companies (name, normalized_name, source)
      SELECT DISTINCT ON (lower(trim(regexp_replace(company, '[.,]', '', 'g'))))
        company,
        regexp_replace(lower(trim(regexp_replace(company, '[.,]', '', 'g'))), '\\s+', ' ', 'g'),
        'quote'
      FROM quotes
      WHERE company IS NOT NULL AND length(trim(company)) > 0
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO crm_companies (name, normalized_name, source)
      SELECT DISTINCT ON (lower(trim(regexp_replace(client_company, '[.,]', '', 'g'))))
        client_company,
        regexp_replace(lower(trim(regexp_replace(client_company, '[.,]', '', 'g'))), '\\s+', ' ', 'g'),
        'proposal'
      FROM quote_proposals
      WHERE client_company IS NOT NULL AND length(trim(client_company)) > 0
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO crm_companies (name, normalized_name, source)
      SELECT DISTINCT ON (lower(trim(regexp_replace(customer_name, '[.,]', '', 'g'))))
        customer_name,
        regexp_replace(lower(trim(regexp_replace(customer_name, '[.,]', '', 'g'))), '\\s+', ' ', 'g'),
        'partner_deal'
      FROM partner_deals
      WHERE customer_name IS NOT NULL AND length(trim(customer_name)) > 0
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO crm_companies (name, normalized_name, source)
      SELECT DISTINCT ON (lower(trim(regexp_replace(company_name, '[.,]', '', 'g'))))
        company_name,
        regexp_replace(lower(trim(regexp_replace(company_name, '[.,]', '', 'g'))), '\\s+', ' ', 'g'),
        'partner_lead'
      FROM partner_leads
      WHERE company_name IS NOT NULL AND length(trim(company_name)) > 0
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO crm_companies (name, normalized_name, source)
      SELECT DISTINCT ON (lower(trim(regexp_replace(customer_company, '[.,]', '', 'g'))))
        customer_company,
        regexp_replace(lower(trim(regexp_replace(customer_company, '[.,]', '', 'g'))), '\\s+', ' ', 'g'),
        'document'
      FROM documents
      WHERE customer_company IS NOT NULL AND length(trim(customer_company)) > 0
      ON CONFLICT (normalized_name) DO NOTHING;

      -- contacts from contact form
      INSERT INTO crm_contacts (full_name, email, normalized_email, phone, source, company_id, last_activity_at)
      SELECT DISTINCT ON (lower(trim(c.email)))
        c.name,
        c.email,
        lower(trim(c.email)),
        c.phone,
        'contact_form',
        co.id,
        c.created_at
      FROM contacts c
      LEFT JOIN crm_companies co ON co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(c.company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
      WHERE c.email IS NOT NULL AND length(trim(c.email)) > 0
      ON CONFLICT (normalized_email) WHERE normalized_email IS NOT NULL DO NOTHING;

      -- contacts from quotes
      INSERT INTO crm_contacts (full_name, email, normalized_email, phone, source, company_id, last_activity_at)
      SELECT DISTINCT ON (lower(trim(q.email)))
        q.name,
        q.email,
        lower(trim(q.email)),
        q.phone,
        'quote',
        co.id,
        q.created_at
      FROM quotes q
      LEFT JOIN crm_companies co ON co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(q.company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
      WHERE q.email IS NOT NULL AND length(trim(q.email)) > 0
      ON CONFLICT (normalized_email) WHERE normalized_email IS NOT NULL DO NOTHING;

      -- contacts from proposal client info
      INSERT INTO crm_contacts (full_name, email, normalized_email, phone, source, company_id, last_activity_at)
      SELECT DISTINCT ON (lower(trim(p.client_email)))
        p.client_name,
        p.client_email,
        lower(trim(p.client_email)),
        p.client_phone,
        'proposal',
        co.id,
        p.created_at
      FROM quote_proposals p
      LEFT JOIN crm_companies co ON co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(p.client_company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
      WHERE p.client_email IS NOT NULL AND length(trim(p.client_email)) > 0
      ON CONFLICT (normalized_email) WHERE normalized_email IS NOT NULL DO NOTHING;

      -- contacts from vivint
      INSERT INTO crm_contacts (full_name, email, normalized_email, phone, source, last_activity_at)
      SELECT DISTINCT ON (lower(trim(v.email)))
        v.name, v.email, lower(trim(v.email)), v.phone, 'vivint', v.created_at
      FROM vivint_inquiries v
      WHERE v.email IS NOT NULL AND length(trim(v.email)) > 0
      ON CONFLICT (normalized_email) WHERE normalized_email IS NOT NULL DO NOTHING;

      -- contacts from lead magnets
      INSERT INTO crm_contacts (full_name, email, normalized_email, phone, source, company_id, last_activity_at)
      SELECT DISTINCT ON (lower(trim(lm.email)))
        lm.name, lm.email, lower(trim(lm.email)), lm.phone, 'lead_magnet:' || lm.magnet, co.id, lm.created_at
      FROM lead_magnet_submissions lm
      LEFT JOIN crm_companies co ON co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(lm.company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
      WHERE lm.email IS NOT NULL AND length(trim(lm.email)) > 0
      ON CONFLICT (normalized_email) WHERE normalized_email IS NOT NULL DO NOTHING;

      -- contacts from partner_leads
      INSERT INTO crm_contacts (full_name, email, normalized_email, phone, source, company_id, last_activity_at)
      SELECT DISTINCT ON (lower(trim(pl.email)))
        pl.contact_name, pl.email, lower(trim(pl.email)), pl.phone, 'partner_lead', co.id, pl.created_at
      FROM partner_leads pl
      LEFT JOIN crm_companies co ON co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(pl.company_name, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
      WHERE pl.email IS NOT NULL AND length(trim(pl.email)) > 0
      ON CONFLICT (normalized_email) WHERE normalized_email IS NOT NULL DO NOTHING;

      -- contacts from partner_deals customer email
      INSERT INTO crm_contacts (full_name, email, normalized_email, phone, source, company_id, last_activity_at)
      SELECT DISTINCT ON (lower(trim(pd.customer_email)))
        pd.customer_name, pd.customer_email, lower(trim(pd.customer_email)), pd.customer_phone, 'partner_deal', co.id, pd.created_at
      FROM partner_deals pd
      LEFT JOIN crm_companies co ON co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(pd.customer_name, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
      WHERE pd.customer_email IS NOT NULL AND length(trim(pd.customer_email)) > 0
      ON CONFLICT (normalized_email) WHERE normalized_email IS NOT NULL DO NOTHING;

      -- back-link existing rows to the new crm_contacts / crm_companies
      UPDATE contacts SET crm_contact_id = c.id
        FROM crm_contacts c WHERE c.normalized_email = lower(trim(contacts.email)) AND contacts.crm_contact_id IS NULL;
      UPDATE quotes SET crm_contact_id = c.id
        FROM crm_contacts c WHERE c.normalized_email = lower(trim(quotes.email)) AND quotes.crm_contact_id IS NULL;
      UPDATE quote_proposals SET crm_contact_id = c.id
        FROM crm_contacts c WHERE c.normalized_email = lower(trim(quote_proposals.client_email)) AND quote_proposals.crm_contact_id IS NULL;
      UPDATE vivint_inquiries SET crm_contact_id = c.id
        FROM crm_contacts c WHERE c.normalized_email = lower(trim(vivint_inquiries.email)) AND vivint_inquiries.crm_contact_id IS NULL;
      UPDATE lead_magnet_submissions SET crm_contact_id = c.id
        FROM crm_contacts c WHERE c.normalized_email = lower(trim(lead_magnet_submissions.email)) AND lead_magnet_submissions.crm_contact_id IS NULL;
      UPDATE partner_leads SET crm_contact_id = c.id
        FROM crm_contacts c WHERE partner_leads.email IS NOT NULL AND c.normalized_email = lower(trim(partner_leads.email)) AND partner_leads.crm_contact_id IS NULL;
      UPDATE partner_deals SET crm_contact_id = c.id
        FROM crm_contacts c WHERE partner_deals.customer_email IS NOT NULL AND c.normalized_email = lower(trim(partner_deals.customer_email)) AND partner_deals.crm_contact_id IS NULL;

      UPDATE contacts SET crm_company_id = co.id
        FROM crm_companies co WHERE co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(contacts.company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
        AND contacts.crm_company_id IS NULL AND contacts.company IS NOT NULL;
      UPDATE quotes SET crm_company_id = co.id
        FROM crm_companies co WHERE co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(quotes.company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
        AND quotes.crm_company_id IS NULL AND quotes.company IS NOT NULL;
      UPDATE quote_proposals SET crm_company_id = co.id
        FROM crm_companies co WHERE co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(quote_proposals.client_company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
        AND quote_proposals.crm_company_id IS NULL;
      UPDATE partner_deals SET crm_company_id = co.id
        FROM crm_companies co WHERE co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(partner_deals.customer_name, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
        AND partner_deals.crm_company_id IS NULL;
      UPDATE partner_leads SET crm_company_id = co.id
        FROM crm_companies co WHERE co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(partner_leads.company_name, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
        AND partner_leads.crm_company_id IS NULL;
      UPDATE documents SET crm_company_id = co.id
        FROM crm_companies co WHERE co.normalized_name = regexp_replace(lower(trim(regexp_replace(COALESCE(documents.customer_company, ''), '[.,]', '', 'g'))), '\\s+', ' ', 'g')
        AND documents.crm_company_id IS NULL AND documents.customer_company IS NOT NULL;

      -- map partner_deals.stage to crm_pipeline_stages on the default pipeline
      SELECT id INTO def_pid FROM crm_pipelines WHERE is_default = true LIMIT 1;
      IF def_pid IS NOT NULL THEN
        UPDATE partner_deals pd SET pipeline_stage_id = ps.id
          FROM crm_pipeline_stages ps
          WHERE ps.pipeline_id = def_pid
            AND ps.slug = pd.stage::text
            AND pd.pipeline_stage_id IS NULL;
      END IF;

      INSERT INTO applied_migrations (name) VALUES ('crm_backfill_v1');
    END $$
  `);

  // ─── Owner backfill ──────────────────────────────────────────────────────
  // requireWriteAccess uses partner_leads.assigned_user_id and
  // partner_deals.assigned_user_id to authorize non-admin actions (owner OR
  // share). Legacy rows ingested before the CRM existed have no owner, so
  // backfill them to a fallback admin user so the predicate is well-defined.
  // Admins always pass `requireWriteAccess` regardless, but downstream tools
  // (audit reports, "my records" filters) treat null as orphaned.
  await db.execute(sql`
    DO $$
    DECLARE fallback_user int;
    BEGIN
      IF EXISTS (SELECT 1 FROM applied_migrations WHERE name = 'crm_owner_backfill_v1') THEN
        RETURN;
      END IF;

      SELECT id INTO fallback_user
        FROM users
        WHERE role = 'admin'
        ORDER BY id ASC
        LIMIT 1;

      IF fallback_user IS NOT NULL THEN
        UPDATE partner_leads
          SET assigned_user_id = fallback_user
          WHERE assigned_user_id IS NULL;
        UPDATE partner_deals
          SET assigned_user_id = fallback_user
          WHERE assigned_user_id IS NULL;
        UPDATE crm_contacts
          SET assigned_user_id = fallback_user
          WHERE assigned_user_id IS NULL;
        UPDATE crm_companies
          SET assigned_user_id = fallback_user
          WHERE assigned_user_id IS NULL;
      END IF;

      INSERT INTO applied_migrations (name) VALUES ('crm_owner_backfill_v1');
    END $$
  `);

  console.log("[CRM] Bootstrap + backfill complete");
}
