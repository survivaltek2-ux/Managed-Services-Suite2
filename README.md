# Siebert Services

Monorepo for the Siebert Services product suite:

| Artifact              | URL path     | Purpose                                              |
| --------------------- | ------------ | ---------------------------------------------------- |
| `siebert-services`    | `/`          | Main marketing site                                  |
| `partner-portal`      | `/partners/` | Logged-in portal for formal partners (deals, MSAs, CRM) |
| `connectors-portal`   | `/referrals/`| Standalone referral program for individuals          |
| `api-server`          | `/api/*`     | Express API serving all of the above                 |
| `mockup-sandbox`      | `/__mockup`  | Internal component preview harness (dev only)        |

All web artifacts and the API are deployed together behind a single domain.
Frontends are built to static bundles and the API is a single Node process.

## Stack

- **Runtime:** Node.js 22+, pnpm workspace
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, wouter (routing), @tanstack/react-query
- **Backend:** Express 5, Drizzle ORM, PostgreSQL 16
- **Auth:** JWT (separate token namespaces for users, partners, connectors), optional Microsoft SSO
- **Optional:** Stripe billing, Google Cloud Storage (object storage), SMTP email,
  Zoom Phone SMS, PartnerStack / Impact referral tracking

## Local development

Requires Node.js 22+, pnpm 9+, and a PostgreSQL 16 server.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# edit .env: set DATABASE_URL, JWT_SECRET, AI_INTEGRATIONS_OPENAI_API_KEY at minimum

# 3. Push schema
pnpm run db:push

# 4. Create the first admin user
pnpm run setup:admin

# 5. Run each artifact in its own terminal
pnpm --filter @workspace/api-server         run dev   # http://localhost:8080
pnpm --filter @workspace/siebert-services   run dev   # http://localhost:3000/
pnpm --filter @workspace/partner-portal     run dev   # http://localhost:3001/partners/
pnpm --filter @workspace/connectors-portal  run dev   # http://localhost:3002/referrals/
```

Each Vite dev server proxies `/api` to `http://localhost:8080` so the API and
frontend are same-origin during development.

Override defaults via env vars:

```bash
PORT=4000 BASE_PATH=/foo/ API_PROXY_TARGET=http://localhost:9000 \
  pnpm --filter @workspace/connectors-portal run dev
```

## Production build

```bash
pnpm install --frozen-lockfile
pnpm run build:deploy
```

That builds all 3 web artifacts and the API server. Output:

- `artifacts/siebert-services/dist/public/`
- `artifacts/partner-portal/dist/public/`
- `artifacts/connectors-portal/dist/public/`
- `artifacts/api-server/dist/index.cjs`

## Production runtime

The API server is the single Node entry point. Static frontend bundles are
served by Nginx (or any static host) and `/api/*` is reverse-proxied to Node.

```bash
node --env-file=.env ./artifacts/api-server/dist/index.cjs
# or:
pnpm start
```

See `nginx.conf.example` for an Nginx config and `DEPLOYMENT_GUIDE.md` for an
end-to-end Linux deployment walkthrough (including a one-shot
`scripts/deploy-linux.sh` for Ubuntu/Debian).

## Optional services

| Service              | Required env vars                                                      | Notes                                                                                          |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Email                | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`  | Without these, transactional emails are skipped (logged only).                                 |
| Microsoft SSO        | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`| Without these, only password / SSO-other login is available.                                   |
| Object storage (GCS) | `GOOGLE_APPLICATION_CREDENTIALS`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` | Required only for file uploads & generated PDF storage. ADC works on GCP VMs without a key file. |
| Stripe billing       | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CLIENT_ID` | Required only for paid subscriptions / Stripe Connect.                                         |
| Referral tracking    | `PARTNERSTACK_*`, `IMPACT_*`                                            | Optional integrations.                                                                         |

See `.env.example` for the full list with comments.

## Repo layout

```
artifacts/
  api-server/         # Express API (single deployable Node process)
  siebert-services/   # Marketing site (Vite/React)
  partner-portal/     # Partner portal (Vite/React)
  connectors-portal/  # Referral network (Vite/React)
  mockup-sandbox/     # Component preview harness (dev tool, not deployed)
lib/
  db/                 # Drizzle schema + client
  api-spec/           # OpenAPI source of truth
  api-zod/            # Zod schemas generated from api-spec
  api-client-react/   # Typed React-Query hooks generated from api-spec
  integrations/       # OpenAI / TypeScript-SDK adapters
  object-storage-web/ # Uppy uploader components for the frontends
  replit-auth-web/    # (Optional) Replit Auth helper, unused outside Replit
scripts/              # Admin / vendor-seed / deploy helpers
migrations/           # Generated Drizzle migrations (kept for reference)
```

## Notes for migrating off Replit

This codebase originated on Replit. To produce a clean tree for any other host:

```bash
sh ./scripts/strip-replit.sh
```

That removes `.replit`, `.replit-artifact/`, `.replitignore`, `replit.md`,
`.cache/replit/`, `.config/replit/`, `scripts/post-merge.sh`, and any other
Replit-only files. The application code itself does not depend on Replit at
runtime:

- **Object storage** falls back to standard Google Application Default
  Credentials (ADC) when no Replit sidecar is detected. URL signing uses the
  GCS V4 signing flow, which requires a service-account JSON key
  (`GOOGLE_APPLICATION_CREDENTIALS`).
- **"Sign in with Replit" routes** (`/api/login`, `/api/callback` from
  `routes/replit-auth.ts` / `routes/replitAuth.ts`) only function when
  `REPL_ID` is set. Off Replit, these routes return errors on request, but the
  server still boots normally — those routes are lazy-initialized. Use
  password login or Microsoft SSO instead. If you don't need them at all,
  unmount them in `artifacts/api-server/src/app.ts`.
