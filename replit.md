# Overview

This project is a pnpm monorepo containing a comprehensive suite of web applications for **Siebert Repair Services LLC DBA Siebert Services**, an MSP/Reseller. It includes a full-featured marketing and client portal website, a dedicated partner portal, and a shared Express API server. The system is designed to manage client interactions, partner relationships, sales processes, and integrations with Technology Solution Distributors (TSDs). The architecture prioritizes portability, allowing deployment on any Node.js host.

**Key Capabilities:**
- Client-facing website with services, contact, quoting, and client portal functionalities.
- Partner portal for deal registration, lead management, commissions, and resources.
- Robust API server supporting both frontends, including authentication, CMS, and integrations.
- AI chat assistant for client support.
- Integration with major Technology Solution Distributors (Avant, Telarus, Intelisys) for lead, deal, and commission synchronization.
- Automated partner tier promotion based on revenue.
- Comprehensive admin panel for content, user, and business process management, including invoicing and reporting.

# User Preferences

I prefer iterative development.
Ask before making major changes.
I prefer to use pnpm for package management.
I want to use TypeScript for all development.
I want to ensure the application is portable and not tied to Replit-specific dependencies.
I prefer detailed explanations for complex architectural decisions.
Do not make changes to the folder `lib/api-client-react/`.
Do not make changes to the file `src/lib/email.ts` without prior discussion.

**Brand positioning — IMPORTANT:** Siebert Services is a **hybrid MSP** (managed services provider AND reseller / agent). All copy, headlines, hero text, meta descriptions, JSON-LD service descriptions, page titles, and AI chat persona must reflect the hybrid MSP positioning — never describe the company as a pure reseller, pure MSP, or generic "IT company". When in doubt, lean on phrasing like "hybrid MSP", "managed services + procurement", or "one partner for managed IT and the hardware/SaaS to run it".

**Reviews & testimonials:** Only real, authentic client reviews/testimonials are allowed on the site. Never seed, hardcode, or fall back to placeholder testimonials or fake Google reviews — sections must hide themselves until real entries exist.

# System Architecture

## Monorepo Structure
The project uses a pnpm workspace monorepo with three main applications under `artifacts/`: `siebert-services` (client website), `partner-portal` (partner website), and `api-server` (Express backend). Shared libraries like API specifications, generated clients, Zod schemas, and Drizzle ORM configurations are located in `lib/`.

## Technology Stack
- **Backend**: Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod.
- **Frontend**: React + Vite (for both `siebert-services` and `partner-portal`).
- **Authentication**: JWT-based (bcryptjs, jsonwebtoken), supporting email/password, Microsoft SSO, Okta SSO, and Replit OIDC.
- **Build**: esbuild for CJS bundles.
- **API Codegen**: Orval from OpenAPI specifications.

## UI/UX Decisions
- **Siebert Services Website**: Standard modern web design with a focus on clear service presentation, intuitive forms, and an accessible client portal.
- **Partner Portal**: Implements the Salesforce Lightning Design System, featuring Salesforce-inspired color palette, typography (Inter font), and component styling (e.g., `sf-card`, `sf-table`, `sf-btn`). This ensures a consistent, enterprise-grade look and feel. Components are designed for accessibility, including modals with ARIA attributes.

## Feature Specifications
- **230+ Supplier Knowledge Base**: `artifacts/api-server/src/data/suppliers.ts` — all 232 supplier partners with name, website, industry, categories, and key products. Used both as a DB seed source and as AI discovery context.
- **Marketplace DB**: 238 approved vendors + 245 active products seeded from the supplier catalog. Category breakdown: Connectivity (72), Security (43), Contact Center (28), Communications (20), Data Centers (17), Managed IT (10), Cloud (9), Networking (8), etc.
- **Startup DB Seeding**: `artifacts/api-server/src/db-seed.ts` — runs on every startup, checks vendor count, and auto-seeds all 232 suppliers if fewer than 100 exist. Idempotent and non-fatal. Ensures the production database is populated on first deploy.
- **AI Chat Assistant**: GPT-5.2 powered, streaming SSE, conversation history persisted.
- **Client Portal**: Support tickets, quote viewing, billing, account management.
- **Partner Portal**: Dashboard with KPIs, deal registration (list/kanban), lead management, commission tracking (with dispute workflow), document sharing, training, announcements, support cases. Automated partner tier promotion (Silver: $100k, Gold: $250k, Platinum: $500k YTD revenue).
- **CMS Admin Panel**: Comprehensive management for blog, services, testimonials, team, FAQ, contacts, quotes, tickets, proposals, users, and reporting.
- **Written Plan Builder**: Multi-step questionnaire wizard for partners to generate customized service plans. Plans are sent to clients via a secure, token-based review link (no login required) where clients can sign (canvas/typed signature), decline, or request a call. Full revision/versioning, PDF export, admin oversight view, 6-hour expiry reminder cron, and activity timeline.
- **Invoicing System**: Admin creation/management, client viewing in portal.
- **Reporting**: Admin dashboard with key business metrics (clients, tickets, quotes, proposals, revenue, invoice status breakdown).

## API Server Structure
The `api-server` organizes routes logically into modules for authentication (`auth.ts`), CMS (`cms.ts`), quotes (`quotes.ts`), partners (`partners.ts`), documents (`documents.ts`), and support tickets (`tickets.ts`), and chat (`chat.ts`). Middleware handles authentication and authorization (`requireAuth`, `requireAdmin`).

## Database Schema
The database uses PostgreSQL and Drizzle ORM. Key tables include `users`, `contacts`, `quotes`, `tickets`, `chat_messages`, `blog_posts`, `activity_log`, `quote_proposals`, `settings`, `services`, `testimonials`, `team_members`, `faqs`, `partners`, `partner_deals`, `partner_leads`, `partner_resources`, `partner_commissions`, and tables for TSD integration (`tsd_configs`, `tsd_sync_logs`, `tsd_deal_mappings`, `tsd_products`).

## TSD Integration Specifics
- **Modular Adapters**: Uses `lib/integrations-tsd/` for provider-specific logic (AvantAdapter, TelarusAdapter, IntelisysAdapter).
- **Secure Credential Management**: Encrypts sensitive TSD credentials (API keys, passwords, MFA codes) using AES-256-GCM with `TSD_SECRETS_KEY`.
- **MFA Handling**: Special integration for Telarus SMS-based MFA via a Zoom Phone webhook, automatically extracting and storing MFA codes.
- **Product Catalog**: Centralized, manageable product catalog that feeds into deal registration forms, replacing hardcoded options.
- **Webhook Processing**: Handles inbound webhooks from TSDs for real-time updates on deals, leads, and commissions, with HMAC verification.
- **Commission Reconciliation**: Tracks discrepancies between local and TSD commission records using `tsd_deal_mappings` and `tsd_discrepancy` fields.

# Security Notes

- **Vite**: Pinned to `^7.3.2` in the pnpm workspace catalog to address CVE file-system bypass (GHSA-v2wj-q39q-566r)
- **axios override**: Added `"axios": ">=1.15.0"` in root `package.json` pnpm overrides to patch SSRF vulnerabilities (GHSA-3p68-rc4w-qgx5, GHSA-fvcv-3m26-pcqx). Mailgun was removed; outbound email goes through Microsoft 365 SMTP only.
- **Email templates**: All user-provided data in `email.ts` HTML templates is escaped through the `esc()` helper function
- **Legal pages**: `/privacy` and `/terms` both exist with proper routes in App.tsx

## Object Storage (App Storage)

Replit App Storage (GCS-backed) is provisioned and active. The following environment variables are set:
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` — GCS bucket ID for the workspace
- `PUBLIC_OBJECT_SEARCH_PATHS` — search paths for public assets served at `/api/storage/public-objects/*`
- `PRIVATE_OBJECT_DIR` — directory for user-uploaded objects served at `/api/storage/objects/*`

**API endpoints** (mounted in `artifacts/api-server/src/routes/storage.ts`):
- `POST /api/storage/uploads/request-url` — request a presigned GCS URL for direct upload; returns `{ uploadURL, objectPath }` where `objectPath` (e.g. `uploads/<uuid>`) can be passed directly to the retrieval hook
- `GET /api/storage/objects/{objectPath}` — serve a private uploaded object
- `GET /api/storage/public-objects/{filePath}` — serve public assets (no auth)

**Client library** at `lib/object-storage-web` exports `ObjectUploader` (Uppy-based modal) and `useUpload` (hook for programmatic uploads).

# External Dependencies

- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **API Framework**: Express
- **Validation**: Zod
- **Email Service**: Nodemailer (via SMTP)
- **Authentication**:
    - `bcryptjs` for password hashing
    - `jsonwebtoken` for JWT generation and verification
    - Microsoft SSO
    - Okta SSO (requires `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET`, `OKTA_DOMAIN`, `OKTA_REDIRECT_URI`)
    - Replit OIDC (via `openid-client`)
- **AI Integration**: OpenAI API (for GPT-5.2)
- **TSD Integrations**:
    - Avant (API key)
    - Telarus (username/password, SMS MFA via Zoom Phone webhook)
    - Intelisys (API key, partner ID)
- **Zoom**:
    - Zoom Server-to-Server OAuth (`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_SECRET`)
    - Zoom Phone API (for SMS webhook at `POST /api/webhooks/zoom/sms`)
- **Monorepo Tool**: pnpm workspaces

## Deployment Configuration

- **`PUBLIC_URL`** (production environment, set to `https://siebertrservices.com`): Canonical site URL the API server uses to build Stripe Checkout `success_url`/`cancel_url` redirects (see `artifacts/api-server/src/routes/stripe-billing.ts` → `getBaseUrl()`). Pinning this avoids any chance of a checkout redirect landing on a stale Replit preview hostname or an internal hostname if a proxy header is missing. The server falls back, in order, to `PUBLIC_BASE_URL`, the `X-Forwarded-Host`/`Host` request headers, then `REPLIT_DOMAINS` / `REPLIT_DEV_DOMAIN`, then `localhost:$PORT`. The resolved value is logged in two places in the API server logs: once at boot from `artifacts/api-server/src/index.ts` as `[Stripe Checkout] Boot-time public base URL = …`, and again on the first incoming checkout request from `stripe-billing.ts` as `[Stripe Checkout] Resolved base URL = …` (the request-time line reflects what the actual request headers produced, which can differ from the boot-time line if `PUBLIC_URL` is unset and a proxy supplied a different `X-Forwarded-Host`). Either line is sufficient to verify production is using the canonical host. If the canonical hostname ever changes (e.g. corrected to `siebertservices.com`), update this env var in production.

## Lead Magnets (Task #33)

Four high-converting lead magnets live under `/resources/*` in the Siebert Services site:

- `/resources/cybersecurity-assessment` — 7-question quiz; emails a tailored security score + top fixes
- `/resources/downtime-calculator` — interactive calculator; emails PDF summary
- `/resources/hipaa-checklist` — gated PDF (printable HTML at `/resources/hipaa-checklist/download`)
- `/resources/buyers-guide` — gated PDF (printable HTML at `/resources/buyers-guide/download`)
- `/resources/:slug/thanks` — generic thank-you page after submission
- `/resources` — index page listing all magnets

Implementation:
- DB: `lead_magnet_submissions` table with `lead_magnet` enum (in `lib/db/src/schema/lead-magnets.ts`)
- API: `POST /api/lead-magnets/submit`, admin `GET/DELETE /api/admin/lead-magnets` (in `artifacts/api-server/src/routes/lead-magnets.ts`)
- Email: `sendLeadMagnetSubmission()` in `artifacts/api-server/src/lib/email.ts` — sends user copy with personalized content + admin notification
- Components: `artifacts/siebert-services/src/components/leadMagnets/` — magnet config, `LeadMagnetForm`, `LeadMagnetCTA`, `ExitIntentPopup`
- CTA placements: every service page (auto-mapped via `getMagnetForService`), homepage Resources section, blog post footer, exit-intent modal site-wide, navbar "Resources" link
- Admin: new "Lead Magnets" tab in Admin.tsx with filtering, payload viewer, delete

PDF strategy: printable HTML pages with browser save-as-PDF (no PDF lib dependency).

## MSA Contract Template

A complete Master Services Agreement (MSA) PDF template for sales use is stored in `attached_assets/contracts/`:
- `siebert-msa-template.pdf` — the ready-to-use PDF (download this for sales use)
- `scripts/generate-msa-pdf.cjs` — **canonical source** — pdfkit script that generates the PDF (requires `npm install pdfkit`)
- `siebert-msa-template.md` — human-readable Markdown reference; does NOT automatically stay in sync with the generator script

To regenerate the PDF after editing the generator script: `cd /tmp/pdf-gen && npm install pdfkit && node /path/to/workspace/scripts/generate-msa-pdf.cjs`

The template covers: MSA body (§1–20), Signature Page, Schedule A (Services/Tiers), Schedule B (SLA), Schedule C (Fees), Schedule D (Customer Responsibilities), Schedule E (Data Protection), and 7 Optional Addenda. Governing law: New York. Venue: Orange County, NY. Pricing mirrors the published Essentials/Business/Enterprise tiers ($89/$76, $149/$127, $229/$195 per user/month/annual). All placeholders use `[BRACKETED]` syntax for easy find-and-replace.

## Onboarding Command Center (Task #189)

Unified admin view across all 5 onboarding flows: client onboarding, partner applications, partner team invites, Stripe Connect, admin/employee accounts.

Implementation:
- DB: `onboarding_events` and `onboarding_settings` tables (`lib/db/src/schema/onboardingEvents.ts`); reminder/timestamp columns added to `partners`, `client_portal_tokens`, `partner_team_members`, `users`. Migrations are idempotent (CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS) in `artifacts/api-server/src/index.ts runStartupMigrations`.
- Backend libs: `lib/onboardingEvents.ts` (record/load helpers), `lib/stripeConnectStatus.ts` (refresh + compute), `lib/onboardingReminders.ts` (6h scheduler with cooldown + max-per-entity + paused flag).
- Email helpers (`lib/email.ts`): `sendClientOnboardingReminderEmail`, `sendPartnerApplicationReminderEmail`, `sendUserWelcomeReminderEmail` (existing `sendStripeConnectReminder`, `sendPartnerTeamInviteEmail` reused).
- API: `routes/onboarding-admin.ts` — GET overview/health/detail/settings, POST remind, POST stripe-connect/:id/refresh, GET export.csv, PATCH settings. All admin-only (`requireAuth + requireAdmin`).
- Event recording wired into: `routes/auth.ts` (admin user create), `routes/partners.ts` (status changes, stripe reminders), `routes/partner-team.ts` (invite + resend), `routes/client-portal.ts` (step_advanced + completed).
- Frontend: `pages/admin/OnboardingCommandCenter.tsx` (filters/search/detail-drawer/timeline/CSV/threshold settings/pause), `components/OnboardingHealthWidget.tsx` (admin Dashboard widget), nav link "Onboarding Command Center" in PortalLayout (both `ADMIN_NAV_ITEMS` and `adminLinks`), route `/admin/onboarding`.

Design notes: `db.execute()` returns `{ rows: [...] }` (not an array) on this stack — use `result.rows[0]`. Auto reminder for partner team invites reuses the existing valid token (skips if expired); manual remind generates a new token only after the email send succeeds.
