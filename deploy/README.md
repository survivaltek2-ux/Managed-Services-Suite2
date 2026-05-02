# Deployment Guide

This folder contains everything you need to deploy Siebert Services on any server.

## Quick Start Options

### Option A — Linux VPS / Bare Metal (Ubuntu/Debian)

The one-command installer sets up Node.js, PostgreSQL, nginx, and a systemd
service automatically.

```bash
# 1. Clone the repo on your server
git clone <your-repo-url> /opt/siebert
cd /opt/siebert

# 2. Create your environment file
cp .env.example .env
nano .env          # fill in DATABASE_URL, JWT_SECRET, etc.

# 3. Run the installer
DOMAIN=yourdomain.com sh scripts/deploy-linux.sh
```

To enable automatic HTTPS (Let's Encrypt):
```bash
DOMAIN=yourdomain.com ENABLE_CERTBOT=true sh scripts/deploy-linux.sh
```

---

### Option B — Docker Compose (any OS with Docker)

```bash
# 1. Clone the repo
git clone <your-repo-url> siebert
cd siebert

# 2. Create your environment file
cp .env.example .env
nano .env          # set JWT_SECRET, POSTGRES_PASSWORD, and any optional services

# 3. Start everything
docker compose up -d

# App runs at http://localhost:8080
```

The compose file spins up a managed PostgreSQL database alongside the app.
No external database required.

---

### Option C — Manual (any Node 22+ host)

```bash
pnpm install --frozen-lockfile
pnpm run build:deploy
pnpm run db:push         # apply database schema
pnpm run setup:admin     # create first admin user
node --env-file=.env artifacts/api-server/dist/index.cjs
```

---

## URL Structure

All three portals are served by the single API server:

| URL path       | Portal                  |
|----------------|-------------------------|
| `/`            | Main marketing site     |
| `/partners/`   | Partner portal          |
| `/referrals/`  | Connectors/referral portal |
| `/api/`        | REST API                |

---

## Required Environment Variables

| Variable         | Description                              |
|------------------|------------------------------------------|
| `DATABASE_URL`   | PostgreSQL connection string             |
| `JWT_SECRET`     | Long random string (32+ chars)           |
| `NODE_ENV`       | Set to `production`                      |
| `PORT`           | Server port (default `8080`)             |

See `.env.example` for the full list including optional integrations (SMTP,
Stripe, Microsoft SSO, Google Cloud Storage, etc.).

---

## Updating the App

```bash
git pull
pnpm install --frozen-lockfile
pnpm run build:deploy
sudo systemctl restart siebert-services   # Option A
# or: docker compose up -d --build        # Option B
```

---

## Files in this folder

| File                    | Purpose                                       |
|-------------------------|-----------------------------------------------|
| `nginx.conf`            | nginx virtual-host config (Option A)          |
| `siebert-services.service` | systemd unit file template (Option A)      |
| `github-actions.yml`    | CI/CD workflow — auto-build on push to main   |
| `README.md`             | This file                                     |
