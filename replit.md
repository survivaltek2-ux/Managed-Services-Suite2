# Overview

This project is a pnpm monorepo for Siebert Repair Services LLC DBA Siebert Services, a hybrid MSP/Reseller. It provides a comprehensive suite of web applications, including a client-facing marketing and portal website, a dedicated partner portal, and a shared Express API server. The system manages client interactions, partner relationships, sales processes, and integrates with Technology Solution Distributors (TSDs) like Avant, Telarus, and Intelisys. The core purpose is to streamline operations, enhance client and partner engagement, and automate business processes with a focus on portability and scalability.

Key capabilities include:
- A client portal for support, quotes, and billing.
- A partner portal for deal registration, lead management, and commission tracking.
- An AI chat assistant for client support.
- Automated partner tier promotions.
- A CMS for content, user, and business process management.
- Integration with TSDs for lead, deal, and commission synchronization.

# User Preferences

I prefer iterative development.
Ask before making major changes.
I prefer to use pnpm for package management.
I want to use TypeScript for all development.
I want to ensure the application is portable and not tied to Replit-specific dependencies.
I prefer detailed explanations for complex architectural decisions.
Do not make changes to the folder `lib/api-client-react/`.
Do not make changes to the file `src/lib/email.ts` without prior discussion.

# System Architecture

## Monorepo Structure
The project utilizes a pnpm workspace monorepo with three primary applications under `artifacts/`: `siebert-services` (client website), `partner-portal` (partner website), and `api-server` (Express backend). Shared utilities and configurations are located in `lib/`.

## Technology Stack
- **Backend**: Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod.
- **Frontend**: React + Vite for both client and partner portals.
- **Authentication**: JWT-based, supporting email/password, Microsoft SSO, and Replit OIDC.
- **Build**: esbuild for CJS bundles.
- **API Codegen**: Orval from OpenAPI specifications.

## UI/UX Decisions
- **Siebert Services Website**: Modern design with focus on clear service presentation, intuitive forms, and an accessible client portal.
- **Partner Portal**: Implements the Salesforce Lightning Design System for an enterprise-grade look and feel, including Salesforce-inspired color palette, Inter font, and accessible components.

## Feature Specifications
- **Data Management**: Comprehensive supplier knowledge base (230+ suppliers) and a marketplace database (238 vendors, 245 products), seeded automatically on startup.
- **AI Chat Assistant**: GPT-5.2 powered, streaming SSE, with persistent conversation history.
- **Portals**:
    - **Client Portal**: Support tickets, quote viewing, billing, account management.
    - **Partner Portal**: Dashboard, deal registration (list/kanban), lead management, commission tracking with dispute workflow, document sharing, training, announcements, support cases. Automated partner tier promotion based on YTD revenue (Silver: $100k, Gold: $250k, Platinum: $500k).
- **CMS Admin Panel**: Manages blog, services, testimonials, team, FAQ, contacts, quotes, tickets, proposals, users, and reporting.
- **Written Plan Builder**: Multi-step wizard for partners to generate customized service plans for clients, featuring secure review links, e-signature, revision control, PDF export, and activity timelines.
- **Invoicing System**: Admin creation/management, client viewing in portal.
- **Reporting**: Admin dashboard with key business metrics.

## API Server Structure
Routes are logically organized into modules (e.g., `auth.ts`, `cms.ts`, `partners.ts`). Middleware enforces authentication and authorization.

## Database Schema
PostgreSQL with Drizzle ORM. Key tables manage users, contacts, quotes, tickets, CMS content, partners, deals, leads, commissions, and TSD integration data.

## TSD Integration Specifics
- **Modular Adapters**: Provider-specific logic for Avant, Telarus, and Intelisys.
- **Secure Credentials**: AES-256-GCM encryption for sensitive TSD credentials.
- **MFA Handling**: Special integration for Telarus SMS-based MFA via Zoom Phone webhook.
- **Product Catalog**: Centralized and manageable, feeding into deal registration forms.
- **Webhook Processing**: Handles inbound webhooks from TSDs with HMAC verification.
- **Commission Reconciliation**: Tracks discrepancies between local and TSD records.

## Security Notes
- **Vite & Axios**: Pinned versions and overrides address known vulnerabilities.
- **Email Security**: User-provided data in email templates is escaped.
- **Legal Pages**: Dedicated `/privacy` and `/terms` routes.

## Object Storage (App Storage)
Utilizes Replit App Storage (GCS-backed) for private and public object storage, with API endpoints for presigned upload URLs and object retrieval. Client library `lib/object-storage-web` provides `ObjectUploader` and `useUpload` hooks.

## Referral Network (Standalone Subsite)

The "Siebert Services Referral Network" is a fully-separate referral program for individuals (not formal partners) and lives at `/referrals/` as its own artifact (`artifacts/connectors-portal`, slug `connectors-portal`, port 23106). The product was originally codenamed "Connector Program" — internal identifiers (table names `connectors*`, route prefix `/api/connectors/...`, JWT field `connectorId`, localStorage key `connector_token`, artifact slug `connectors-portal`) all retain the connector naming for stability; only user-facing copy says "Referral Network" / "Network Member" / "Join the Network". previewPath and BASE_PATH in artifact.toml are `/referrals/`. Built deliberately with **zero coupling** to the existing Partner Portal — separate auth, separate DB tables, separate JWT subject, separate localStorage.

**Schema** (`lib/db/src/schema/connectors.ts`): `connectors` (account + status), `connector_referrals` (lead pipeline with status enum: submitted/qualified/in_progress/won/lost/duplicate, ACV tracking, reward tier, payout/clawback timestamps), `connector_payouts` (per-payout ledger with status: pending/approved/paid/void). Three Postgres enums: `connector_status`, `connector_referral_status`, `connector_payout_status`. Tables created via direct SQL (drizzle-kit push has TTY conflicts in this environment).

**API** (`artifacts/api-server/src/routes/connectors.ts`, mounted at `/api/connectors/*`): `POST /auth/signup` (auto-approved on creation), `POST /auth/login`, `GET /me` (returns connector + aggregated stats: totalReferrals/totalQualified/totalWon/totalPaidCents/totalPendingCents), `GET|POST /referrals`, `GET /payouts`. Auth middleware in `artifacts/api-server/src/middlewares/connectorAuth.ts` reuses `JWT_SECRET` but issues tokens with `connectorId` payload to keep them distinct from partner tokens. Active-status check rejects suspended/rejected accounts.

**Reward economics**: Tiered based on ACV — Tier 1 ≤$25K → $150, Tier 2 $25K–$75K → $500, Tier 3 $75K–$200K → $1,250, Tier 4 $200K+ → $2,500. +$500 bonus for referrals with 3+ physical locations. Payout 30 days after first paid invoice with 90-day clawback window.

**Frontend** (React + Vite + wouter v3 + tanstack-query): Pages at `src/pages/` — Landing (marketing/tier showcase), Login, Signup, Dashboard (stats + new-referral form + referrals/payouts tables). `src/lib/connectorsApi.ts` calls absolute `/api/connectors/...` (NOT `${BASE_URL}api/...` — the api-server is mounted at root). `src/lib/auth-context.tsx` exposes `useAuth()`. Wouter v3 requires `<Link href="..." className="...">text</Link>` — never wrap with `<a>` (causes hydration error).

**Reward calculator** (`artifacts/api-server/src/lib/connectorRewards.ts`): pure `computeReward(acvCents, multiLocation)` + `computePayoutDates(invoicePaidAt)`. Used by admin PATCH endpoint; never called from connector-facing routes.

**Admin API** (`artifacts/api-server/src/routes/connectorsAdmin.ts`, mounted alongside main routes, gated by `requirePartnerAuth` + `requirePartnerAdmin`):
- `GET /api/connectors/admin/summary` — pipeline KPIs
- `GET /api/connectors/admin/connectors` — list all network members
- `PATCH /api/connectors/admin/connectors/:id` — update member status (approved/suspended/rejected)
- `GET /api/connectors/admin/referrals` — list all referrals with connector name
- `PATCH /api/connectors/admin/referrals/:id` — move pipeline (set status/ACV/firstInvoicePaidAt); auto-computes rewardTier, rewardAmountCents, payoutDueAt, clawbackUntil, wonAt/qualifiedAt/lostAt timestamps
- `POST /api/connectors/admin/payouts` — create payout record (syncs totalEarnedCents)
- `PATCH /api/connectors/admin/payouts/:id` — update payout status (pending→approved→paid→void)

**MVP scope**: admin UI for the pipeline lives in the Partner Portal admin area as a follow-up — for now, use the admin API directly or via the Partner Portal's admin token. W-9 collection deferred (collect manually when annual earnings exceed $600).

## CRM (Task #197)
A first-class CRM lives inside the Partner Portal admin area at `/partners/admin/crm/*`. It is a separate subsystem from the read-only public-facing forms and from the existing Leads/Deals workflows, but it links bidirectionally to all of them.

**Schema** (in `lib/db/src/schema/crm.ts`): `crm_contacts`, `crm_companies`, `crm_activities`, `crm_tasks`, `crm_pipelines` + `crm_pipeline_stages`, `crm_tags` + per-entity tag join tables (`crm_contact_tags`, `crm_company_tags`, `crm_deal_tags`), `crm_custom_fields` + `crm_custom_field_values`, `crm_saved_views`, `crm_task_notifications`. Existing record sources (`partner_leads`, `partner_deals`, `quotes`, `contacts`, `vivint_inquiries`, `lead_magnet_submissions`, `partner_support_tickets`, `documents`, `written_plans`) gained `crm_contact_id` / `crm_company_id` link columns and (where missing) an `assigned_user_id` ownership column.

**Bootstrap + backfill** (`artifacts/api-server/src/lib/crm-bootstrap.ts`, called from `index.ts` startup): creates all CRM tables idempotently, adds the link/ownership columns via `ADD COLUMN IF NOT EXISTS`, walks every existing source by normalized email + company name to seed `crm_contacts` and `crm_companies`, and seeds a default "Sales Pipeline" with the existing deal-stage values. Repeat starts are no-ops thanks to `applied_migrations`.

**API** (`artifacts/api-server/src/routes/crm.ts`, mounted at `/api/admin/crm/*` with admin auth): dashboard KPIs + recent activity + my open tasks; full CRUD for contacts/companies/deals/leads with global and per-entity timelines; activities (note/call/email/meeting); tasks (mine/team, snooze, done); pipelines + stages CRUD with reorder; tags CRUD + apply/unapply per entity; custom fields CRUD + per-record values; saved views per (entity, user); convert-lead transaction; CSV export + import for contacts and companies; global `/admin/crm/search?q=` returning grouped contacts/companies/deals/leads. Existing public/partner endpoints (contact form, quote, vivint, lead-magnet, partner leads/deals create) upsert `crm_contacts`/`crm_companies` in the background.

**Portal UI** (`artifacts/partner-portal/src/pages/admin/crm/`): `CrmDashboard`, `CrmContacts`, `CrmCompanies`, `CrmActivities`, `CrmTasks`, `CrmSettings`, `CrmContactDetail`, `CrmCompanyDetail`, plus shared `SavedViewsBar.tsx`. Detail pages have header with owner picker + tags + quick actions, plus tabs for Timeline / Log / Tasks / Details (custom-field editor). List pages (Contacts, Companies, Tasks) render a `SavedViewsBar` that loads/applies/saves/deletes per-user (and shared) saved filter sets. The portal layout's admin nav now exposes a top-level **CRM** group; the global header search hits the CRM search endpoint. A "Convert Lead" dialog is wired into `AdminLeads.tsx`. The Deals Kanban (`Deals.tsx`) now reads `crm_pipelines` and exposes a pipeline picker that swaps the kanban columns to whichever pipeline's stages the admin selects. Auth uses the existing `partner_token` localStorage JWT.

**Owner-scoped auth + scheduling**: Read endpoints use `requireAuth` (not `requireAdmin`) so any signed-in client/admin can use the CRM, but list queries are scoped via `ownerReadScope` so non-admins only see their own contacts/companies, their own activities, and (regardless of requested scope) their own tasks. Detail GETs return 403 when a non-admin requests an entity not assigned to them. Mutations remain admin-only. A 5-minute task-reminder scheduler (`artifacts/api-server/src/lib/crmTaskReminders.ts`, started from `index.ts`) finds open tasks past their due time with no `reminderSentAt`, inserts a system activity, emails the assigned owner (when `SMTP_USER`/`SMTP_PASS` are present), and stamps `reminderSentAt`. Per-contact and per-company timelines now also surface partner_support_tickets, partner_lead status transitions, and partner_deal stage updates as discrete events.

## Stripe Auto-Billing + 12-Month Contract Commitment (this task)
**Schema** (`lib/db/src/schema/billing.ts`): `subscriptionsTable` gained `initial_term_months` (default 12) and `commitment_ends_at` columns. Startup migrations in `artifacts/api-server/src/index.ts` add the columns idempotently and one-time backfill `commitment_ends_at = COALESCE(currentPeriodStart, createdAt) + 12 months` for legacy rows (gated by `applied_migrations` sentinel `backfill_subscription_commitment_v1`).

**Contract templates** (`artifacts/api-server/src/lib/contract.ts`): Both `buildBusinessContract` and `buildConsumerContract` accept `initialTermMonths` + `commitmentEndsAt`, render an "Initial Term" + "After Initial Term" billing summary, and include early-termination liability language in Section 2 (formal MSA wording for business, plain-English for consumer). The consumer "Your Acceptance" block explicitly references the initial-term commitment + month-to-month renewal phase.

**Subscription create + approve** (`artifacts/api-server/src/routes/stripe-billing.ts`): Admin POST `/admin/billing/subscriptions` accepts `customerType` (business|consumer) and `initialTermMonths` (1–60, default 12), persists them on the subscription row, and computes `commitmentEndsAt` from the actual current period start. The approve flow recomputes/preserves `commitmentEndsAt` and passes both into `generateMSAContract`.

**Cancel enforcement** (same file, `PUT /admin/billing/subscriptions/:id/cancel`): If `commitmentEndsAt > now` and the request body lacks `overrideCommitment: true`, the endpoint returns 409 `commitment_active` with the months-remaining message. The portal UI catches the 409, prompts the admin to confirm waiving the early-termination clause, and re-submits with the override flag.

**Auto-send invoices via Stripe** (`artifacts/api-server/src/routes/invoices.ts`): Admin POST `/admin/invoices` accepts `sendViaStripe: boolean` (default false in the API, default true in the AdminInvoices UI). When set with a userId + Stripe configured, the invoice is immediately routed through `sendAppInvoiceViaStripe()` so the customer gets Stripe's hosted invoice email. Failures are surfaced in the response as `stripeError` without rolling back the local invoice.

**Backfill to Stripe** (same file, `POST /admin/invoices/backfill-stripe`, admin-only): Selects every invoice with `stripeInvoiceId IS NULL`, `userId IS NOT NULL`, status in (draft|sent|viewed|overdue), and a customer email; pushes each through Stripe; returns sent/skipped/failed counts + per-invoice results.

**Concurrency safety**: `invoices.ts` defines `inFlightStripeSends: Set<number>` (per-invoice mutex via `withStripeSendLock(id, fn)`) and `backfillInProgress: boolean` (global mutex). All three Stripe-send call sites — admin POST `/admin/invoices` auto-send, single-invoice POST `/admin/invoices/:id/send-stripe`, and the backfill loop — go through `withStripeSendLock` so the same invoice can never be sent twice in parallel. A second backfill request while one is running returns 409 `backfill_in_progress`.

**Portal UI**: `AdminInvoices.tsx` adds the "Send via Stripe immediately" checkbox in the Create dialog (default on) and a "Backfill to Stripe" header button. `AdminBilling.tsx` adds Customer Type + Initial Term (months) fields to the Create Subscription dialog, a "Commitment" column showing "Locked → date" (amber) or "Month-to-month" (emerald) per row, and the override-confirm flow in `cancelSubscription`.

## Microsoft SSO Invite Lifecycle (Task #191)
Admins (and partner company admins for their own team) can (re)invite any account — clients, partners, partner team members, Stripe Connect contacts, admin users — as Entra B2B guests. Status is tracked via `msObjectId` (linked when present), `ssoInviteSentAt`, and `ssoInviteSentBy` columns on `users`, `partners`, `partner_team_members`, and `client_onboarding`. Endpoints: `POST /api/admin/onboarding/:flow/:id/send-sso-invite` (admin) and `POST /api/partner/team/:id/send-sso-invite` (partner company admin). Raw Microsoft Graph error bodies are surfaced verbatim to the UI. All actions are recorded as `sso_invite_sent`/`sso_invite_resent`/`sso_invite_failed` events in the onboarding audit trail. Status is shown in the admin Onboarding Command Center (SSO column + Microsoft SSO drawer section) and partner Team page (Microsoft SSO column + Send/Re-send SSO invite button).

# External Dependencies

- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **API Framework**: Express
- **Validation**: Zod
- **Email Service**: Nodemailer (via SMTP)
- **Authentication**: `bcryptjs`, `jsonwebtoken`, Microsoft SSO, Replit OIDC (`openid-client`)
- **AI Integration**: OpenAI API (for GPT-5.2)
- **TSD Integrations**: Avant, Telarus, Intelisys
- **Video Conferencing/SMS**: Zoom (Server-to-Server OAuth, Zoom Phone API webhook)
- **Monorepo Tool**: pnpm workspaces