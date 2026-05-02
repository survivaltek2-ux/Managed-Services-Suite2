# ── Stage 1: install all dependencies ────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm

# Copy the full workspace so pnpm can resolve all workspace:* references
COPY . .

RUN pnpm install --frozen-lockfile

# ── Stage 2: build everything ─────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

# Type-check lib packages (project references), then build all deploy targets
RUN pnpm run typecheck:libs && pnpm run build:deploy

# ── Stage 3: lean production image ───────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN npm install -g pnpm

# Workspace manifests + lockfile (needed for pnpm --prod install)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/                                      lib/
COPY artifacts/api-server/package.json         artifacts/api-server/package.json
COPY artifacts/siebert-services/package.json   artifacts/siebert-services/package.json
COPY artifacts/partner-portal/package.json     artifacts/partner-portal/package.json
COPY artifacts/connectors-portal/package.json  artifacts/connectors-portal/package.json

RUN pnpm install --frozen-lockfile --prod

# Server bundle
COPY --from=builder /app/artifacts/api-server/dist \
                    artifacts/api-server/dist

# Frontend static files
COPY --from=builder /app/artifacts/siebert-services/dist \
                    artifacts/siebert-services/dist
COPY --from=builder /app/artifacts/partner-portal/dist \
                    artifacts/partner-portal/dist
COPY --from=builder /app/artifacts/connectors-portal/dist \
                    artifacts/connectors-portal/dist

EXPOSE 8080

# Reads secrets from a .env file mounted at runtime (see docker-compose.yml).
# To pass secrets via env vars instead, remove --env-file and set them in
# the container environment directly.
CMD ["node", "--env-file=.env", "artifacts/api-server/dist/index.cjs"]
