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