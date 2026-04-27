# Threat Model

## Project Overview

This project is a pnpm monorepo for Siebert Services with three production applications: a public marketing site (`artifacts/siebert-services`), a partner portal (`artifacts/partner-portal`), and a shared Express API server (`artifacts/api-server`). The backend uses Express 5, PostgreSQL, Drizzle ORM, JWT-based authentication, object storage, Stripe billing, Microsoft/Okta/Replit SSO integrations, OpenAI-powered chat features, and multiple distributor/webhook integrations.

Production scope for this scan is the shared API server and both built frontends. `artifacts/mockup-sandbox`, ad hoc scripts, tests, and agent-only helper code are out of scope unless production reachability is demonstrated. Per platform assumptions, production traffic is TLS-terminated by the platform and `NODE_ENV=production`.

## Assets

- **User and partner accounts** — user records, partner records, passwords, reset tokens, JWTs, SSO-linked identities, and role assignments. Compromise enables impersonation and privilege escalation.
- **Business records and PII** — contacts, quotes, invoices, tickets, client onboarding data, written plans, signed documents, partner deals/leads/commissions, and lead magnet submissions. These include names, emails, phone numbers, company details, billing metadata, and commercial information.
- **Private documents and generated PDFs** — agreements, proposals, onboarding artifacts, signed documents, and lead-magnet PDFs stored in object storage or database-backed document flows.
- **Payment and payout state** — Stripe customer IDs, subscriptions, invoice/payment status, partner payout data, and approval workflows.
- **Integration secrets and external-service trust** — Stripe secrets, webhook secrets, TSD credentials, Microsoft/Okta/OIDC credentials, OpenAI access, Zoom webhook traffic, and encrypted integration secrets.
- **Operational resources** — object storage capacity, OpenAI token spend, email sending, and webhook processors that can be abused for cost or availability impact.

## Trust Boundaries

- **Browser / API boundary** — all frontend requests into `artifacts/api-server/src/routes/*`. The browser is untrusted, including authenticated users who may attempt horizontal or vertical privilege escalation.
- **Public / authenticated / admin boundary** — many routes are intentionally public, others require user JWTs, partner JWTs, or admin privileges. This is the highest-risk boundary because the codebase mixes multiple auth schemes.
- **User / partner / admin boundary** — user JWTs, partner JWTs, partner team-member sessions, and main-site admin JWTs all reach overlapping backend areas. Server-side role enforcement must remain strict.
- **API / database boundary** — the API server has broad PostgreSQL access. Authorization or query-scoping mistakes here can expose or tamper with high-value data.
- **API / object storage boundary** — uploaded and generated files cross into private or public object-storage paths. Access control must not rely on obscurity.
- **API / external service boundary** — Stripe, OpenAI, Microsoft Graph, TSDs, PartnerStack, Zoom, and e-sign providers all send or receive privileged data. Webhooks and callbacks are untrusted until verified.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/siebert-services/src/main.tsx`, `artifacts/partner-portal/src/main.tsx`
- **Highest-risk backend areas:** `src/middlewares/auth.ts`, `src/middlewares/partnerAuth.ts`, `src/routes/auth.ts`, `src/routes/partners.ts`, `src/routes/openai.ts`, `src/routes/chat.ts`, `src/routes/storage.ts`, `src/routes/stripe-billing.ts`, `src/routes/stripe-webhooks.ts`, `src/routes/webhooks.ts`, `src/routes/esign.ts`, `src/routes/client-portal.ts`, `src/routes/written-plans.ts`
- **Public surfaces:** quote/contact/lead-magnet submission routes, public written-plan review routes, public client-portal token routes, chatbot/OpenAI routes, webhook routes, storage upload/object endpoints
- **Authenticated/admin surfaces:** `/api/admin/*`, `/api/partner/*`, `/api/billing/*`, document management, reports, partner management, CMS/admin configuration
- **Usually dev-only / ignore unless proven reachable:** `artifacts/mockup-sandbox`, `.agents/`, `scripts/`, `tests/`

## Threat Categories

### Spoofing

The application relies on JWTs for users and partners plus several SSO and webhook trust relationships. The system must reject forged or weakly signed tokens, must not silently fall back to predictable default secrets, and must verify webhook authenticity before mutating state. Partner, team-member, and main-site admin identities must remain non-interchangeable.

### Tampering

Authenticated and public callers can reach billing, content, partner-management, document, and onboarding flows. The API must enforce server-side authorization on every state-changing route, must prevent ordinary users from invoking admin-only actions, and must treat tokenized public flows as narrowly scoped capabilities rather than broad write access. Emailed client-portal and plan-review links should be rotated or revoked when their intended action completes, rather than acting as long-lived reusable account credentials.

### Information Disclosure

The platform stores PII, partner business data, invoices, tickets, documents, chat transcripts, and generated PDFs. API routes and object-storage access must not expose data based only on guessable identifiers or missing role checks. Error handling and admin list endpoints must not leak secrets, reset tokens, Stripe identifiers, or internal integration metadata. Public bearer links to plans, onboarding portals, or private objects must be treated as sensitive credentials with clear expiry and scope boundaries.

### Denial of Service

Public-facing endpoints can trigger storage uploads, AI usage, email sends, and expensive backend work. The system should bound payload sizes, rate-limit high-cost public routes, and avoid unauthenticated access patterns that let attackers consume OpenAI credits, storage, or third-party API quotas.

### Elevation of Privilege

This codebase has many adjacent privilege boundaries: public users, registered client users, partner users, partner admins, and main-site admins. Every route under admin or partner-management namespaces must enforce the intended role server-side; frontend-only gating is not sufficient. Private object storage, document download flows, and billing/admin APIs must not be reachable by lower-privileged accounts.
