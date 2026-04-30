# Threat Model

## Project Overview

This project is a pnpm monorepo for Siebert Services with three production applications: a public marketing site (`artifacts/siebert-services`), a partner portal (`artifacts/partner-portal`), and a shared Express API server (`artifacts/api-server`). The backend uses Express 5, PostgreSQL, Drizzle ORM, JWT-based authentication, object storage, Stripe billing, Microsoft/Replit SSO integrations, OpenAI-powered chat features, and multiple distributor/webhook integrations.

Production scope for this scan is the shared API server and both built frontends. `artifacts/mockup-sandbox`, ad hoc scripts, tests, and agent-only helper code are out of scope unless production reachability is demonstrated. Per platform assumptions, production traffic is TLS-terminated by the platform and `NODE_ENV=production`.

## Assets

- **User and partner accounts** — user records, partner records, passwords, reset tokens, JWTs, SSO-linked identities, role assignments, and passwordless email-login codes. Compromise enables impersonation and privilege escalation.
- **Business records and PII** — contacts, quotes, invoices, tickets, client onboarding data, written plans, signed documents, partner deals/leads/commissions, and lead magnet submissions. These include names, emails, phone numbers, company details, billing metadata, and commercial information.
- **Private documents and generated PDFs** — agreements, proposals, onboarding artifacts, signed documents, and lead-magnet PDFs stored in object storage or database-backed document flows.
- **Payment and payout state** — Stripe customer IDs, subscriptions, invoice/payment status, partner payout data, and approval workflows.
- **Integration secrets and external-service trust** — Stripe secrets, webhook secrets, TSD credentials, Microsoft/OIDC credentials, OpenAI access, Zoom webhook traffic, and encrypted integration secrets.
- **Tracked deployment configuration** — repository-visible files such as `.replit` can expose real production tenant identifiers, redirect URIs, or confidential client secrets and must be treated as sensitive.
- **Operational resources** — object storage capacity, OpenAI token spend, email sending, and webhook or third-party lookup processors that can be abused for cost or availability impact.

## Trust Boundaries

- **Browser / API boundary** — all frontend requests into `artifacts/api-server/src/routes/*`. The browser is untrusted, including authenticated users who may attempt horizontal or vertical privilege escalation.
- **First-party UI / third-party script boundary** — `artifacts/siebert-services` serves privileged and tokenized routes from a browser shell that can load third-party JavaScript. Any external script on that shell must be treated as fully trusted code unless sensitive routes are isolated, because it can read web storage, DOM state, and URL-borne capability tokens.
- **Public / authenticated / admin boundary** — many routes are intentionally public, others require user JWTs, partner JWTs, or admin privileges. This is the highest-risk boundary because the codebase mixes multiple auth schemes.
- **User / partner / admin boundary** — user JWTs, partner JWTs, partner team-member sessions, and main-site admin JWTs all reach overlapping backend areas. Server-side role enforcement must remain strict, especially on `/api/admin/*` paths that are reachable from the partner portal.
- **API / database boundary** — the API server has broad PostgreSQL access. Authorization or query-scoping mistakes here can expose or tamper with high-value data.
- **API / object storage boundary** — uploaded and generated files cross into private or public object-storage paths. Access control must not rely on obscurity.
- **API / external service boundary** — Stripe, OpenAI, Microsoft Graph, TSDs, PartnerStack, Zoom, Google Places, and e-sign providers all send or receive privileged data. Webhooks and callbacks are untrusted until verified.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/siebert-services/src/main.tsx`, `artifacts/partner-portal/src/main.tsx`
- **Sensitive browser shell files:** `artifacts/siebert-services/index.html`, `artifacts/siebert-services/src/lib/auth.tsx`, `artifacts/siebert-services/src/pages/Admin.tsx`, `artifacts/siebert-services/src/pages/Portal.tsx`, `artifacts/siebert-services/src/pages/Welcome.tsx`, `artifacts/siebert-services/src/pages/ManageSubscription.tsx`, `artifacts/siebert-services/src/pages/ResetPassword.tsx`, `artifacts/siebert-services/src/pages/ProposalView.tsx`
 - **Highest-risk backend areas:** `src/middlewares/auth.ts`, `src/middlewares/partnerAuth.ts`, `src/routes/auth.ts`, `src/routes/sso.ts`, `src/routes/partners.ts`, `src/routes/marketplace.ts`, `src/routes/openai.ts`, `src/routes/chat.ts`, `src/routes/cms.ts`, `src/routes/documents.ts`, `src/routes/customers.ts`, `src/routes/ai-admin.ts`, `src/routes/quotes.ts`, `src/routes/partner-proposals.ts`, `src/routes/storage.ts`, `src/routes/service-availability.ts`, `src/routes/places.ts`, `src/routes/stripe-billing.ts`, `src/routes/stripe-webhooks.ts`, `src/routes/webhooks.ts`, `src/routes/esign.ts`, `src/routes/client-portal.ts`, `src/routes/written-plans.ts`
- **Public surfaces:** quote/contact/lead-magnet submission routes, public proposal view/respond routes, public written-plan review routes, public client-portal token routes, public e-sign signer routes, public passwordless email-code login routes, password-reset and SSO callback flows, chatbot/OpenAI onboarding flows, Google Places proxy routes, service-availability lookups, webhook routes, storage upload/object endpoints
- **Authenticated/admin surfaces:** `/api/admin/*`, `/api/partner/*`, document management, proposal management, reports, partner management, CMS/admin configuration, CRM-style inquiry handling, and any route shared between internal admins and partner-company admins
- **Usually dev-only / ignore unless proven reachable:** `artifacts/mockup-sandbox`, `.agents/`, `scripts/`, `tests/`

## Threat Categories

### Spoofing

The application relies on JWTs for users and partners plus several SSO and webhook trust relationships. The system must reject forged or weakly signed tokens, must not silently fall back to predictable default secrets, and must verify webhook authenticity before mutating state. Partner, team-member, and main-site admin identities must remain non-interchangeable, and real bearer tokens should not be exposed in URL query parameters during SSO handoff.

### Tampering

Authenticated and public callers can reach billing, content, partner-management, document, and onboarding flows. The API must enforce server-side authorization on every state-changing route, must prevent ordinary users from invoking admin-only actions, and must treat tokenized public flows as narrowly scoped capabilities rather than broad write access. Emailed client-portal, plan-review, e-sign, and proposal links should be unguessable, server-expiring, and consumed atomically when their intended action completes.

### Information Disclosure

The platform stores PII, partner business data, invoices, tickets, documents, chat transcripts, and generated PDFs. API routes and object-storage access must not expose data based only on guessable identifiers or missing role checks. Error handling and admin list endpoints must not leak secrets, reset tokens, Stripe identifiers, or internal integration metadata. Public bearer links to proposals, plans, onboarding portals, or private objects must be treated as sensitive credentials with clear expiry and scope boundaries.
Sensitive frontend routes must also avoid sharing a browser shell with third-party scripts when those routes persist JWTs in web storage or carry reset, billing, verification, or proposal tokens in the URL or page state. In that architecture, any loaded external script effectively receives access to the same secrets as first-party code.

### Denial of Service

Public-facing endpoints can trigger storage uploads, AI usage, email sends, and expensive backend work. The system should bound payload sizes, rate-limit high-cost public routes, and avoid unauthenticated access patterns that let attackers consume OpenAI credits, storage, email capacity, or third-party API quotas. Public quota-proxy endpoints such as Google Places deserve repeated scrutiny when cache keys or anti-abuse controls are influenced by caller-controlled parameters.

### Elevation of Privilege

This codebase has many adjacent privilege boundaries: public users, registered client users, partner users, partner admins, team members with partial permissions, and main-site admins. Every route under admin or partner-management namespaces must enforce the intended role server-side; frontend-only gating is not sufficient. Routes that mix user-table identities, partner-table identities, or sentinel admin identities deserve repeated scrutiny because cross-table numeric ID collisions can turn a role check into accidental impersonation or privilege escalation. Private object storage, document download flows, CRM/admin APIs, AI-admin tooling, marketplace management/order routes, and proposal/document management must not be reachable by lower-privileged accounts.