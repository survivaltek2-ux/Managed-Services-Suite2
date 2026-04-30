# Deployment Guide for Siebert Services

This project can be deployed directly on a Linux server without Docker. The production setup is:

- **PostgreSQL** running on the host or a managed provider
- **Node.js** running the bundled API (`artifacts/api-server/dist/index.cjs`) under `systemd`
- **Three pre-built static frontends** (`siebert-services`, `partner-portal`, `connectors-portal`)
- **Nginx** in front, serving the static bundles and reverse-proxying `/api/*` to the Node app

URL layout in production:

| Path          | Served by                          |
| ------------- | ---------------------------------- |
| `/`           | `siebert-services` static bundle   |
| `/partners/`  | `partner-portal` static bundle     |
| `/referrals/` | `connectors-portal` static bundle  |
| `/api/*`      | Node API server (`api-server`)     |

## Fast Path

On Ubuntu or Debian:

```bash
git clone https://github.com/your-org/managed-services-suite.git /opt/siebert-services
cd /opt/siebert-services
cp .env.example .env
nano .env
DOMAIN=your-domain.com sh ./scripts/deploy-linux.sh
```

That script will:

- install Node.js, pnpm, Nginx, and PostgreSQL if needed
- install workspace dependencies
- build the frontend and API bundles
- create or update the admin user
- install and start a `systemd` service
- install and enable an Nginx site that proxies to the Node app

Optional HTTPS via Let's Encrypt:

```bash
DOMAIN=your-domain.com ENABLE_CERTBOT=true sh ./scripts/deploy-linux.sh
```

## Prerequisites

- Ubuntu or Debian with `apt-get`
- The repo cloned onto the server
- `.env` filled with production values
- DNS for `DOMAIN` pointed at the server if using HTTPS

## Step 1: Copy the Project

```bash
sudo mkdir -p /opt/siebert-services
sudo chown "$USER":"$USER" /opt/siebert-services
git clone https://github.com/your-org/managed-services-suite.git /opt/siebert-services
cd /opt/siebert-services
```

## Step 2: Configure the Environment

```bash
cp .env.example .env
nano .env
```

Set at least:

```env
DATABASE_URL=postgresql://siebert:YOUR_PASSWORD@localhost:5432/siebert_services
JWT_SECRET=replace-with-a-long-random-secret
NODE_ENV=production
PORT=8080
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...
```

Optional but recommended:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password
SMTP_FROM_EMAIL=notifications@siebertrservices.com
SMTP_FROM_NAME=Siebert Services
NOTIFICATION_EMAIL=sales@siebertrservices.com

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://your-domain.com/api/auth/sso/microsoft/callback
```

If you need object storage (file uploads, generated PDFs):

```env
GOOGLE_APPLICATION_CREDENTIALS=/etc/siebert/gcs-service-account.json
GOOGLE_CLOUD_PROJECT=your-gcp-project
PUBLIC_OBJECT_SEARCH_PATHS=your-bucket/public
PRIVATE_OBJECT_DIR=your-bucket/private
```

## Step 3: Create the Database

If Postgres is local:

```bash
sudo -u postgres psql
```

Then:

```sql
CREATE USER siebert WITH PASSWORD 'YOUR_PASSWORD';
CREATE DATABASE siebert_services OWNER siebert;
\q
```

## Step 4: Install, Build, and Prepare the Service

```bash
pnpm install --frozen-lockfile
pnpm run build:deploy
pnpm run db:push
pnpm run setup:admin
```

The production entry point is:

```bash
node --env-file=.env ./artifacts/api-server/dist/index.cjs
```

You can test it directly:

```bash
pnpm start
curl http://127.0.0.1:8080/api/healthz
```

## Step 5: Install the Systemd Service and Nginx

Automatic:

```bash
DOMAIN=your-domain.com sh ./scripts/deploy-linux.sh
```

Manual: see `nginx.conf.example` for the recommended Nginx layout that serves
all three static bundles and proxies `/api/*` to Node.

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/siebert-services
# edit it: replace yourdomain.com with your domain, fix the static roots
sudo ln -sfn /etc/nginx/sites-available/siebert-services /etc/nginx/sites-enabled/siebert-services
sudo nginx -t
sudo systemctl reload nginx
```

You'll also need a systemd unit for the Node API. The `deploy-linux.sh` script
generates one for you; manually it looks like:

```ini
[Unit]
Description=Siebert Services API
After=network.target postgresql.service

[Service]
Type=simple
User=siebert
WorkingDirectory=/opt/siebert-services
Environment=NODE_ENV=production
Environment=PORT=8080
ExecStart=/usr/bin/node --env-file=/opt/siebert-services/.env /opt/siebert-services/artifacts/api-server/dist/index.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now siebert-services
```

Useful commands:

```bash
sudo journalctl -u siebert-services -f
sudo systemctl restart siebert-services
sudo systemctl stop siebert-services
```

## Step 6: Static frontend bundles

Copy or symlink the built frontends into the locations referenced by Nginx:

```bash
sudo mkdir -p /var/www/siebert-services /var/www/partner-portal /var/www/connectors-portal
sudo ln -sfn /opt/siebert-services/artifacts/siebert-services/dist/public  /var/www/siebert-services/public
sudo ln -sfn /opt/siebert-services/artifacts/partner-portal/dist/public    /var/www/partner-portal/public
sudo ln -sfn /opt/siebert-services/artifacts/connectors-portal/dist/public /var/www/connectors-portal/public
```

## Step 7: Add HTTPS (recommended)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## Updating the App

```bash
cd /opt/siebert-services
git pull
pnpm install --frozen-lockfile
pnpm run build:deploy
pnpm run db:push
sudo systemctl restart siebert-services
```

## Verification

After deployment, check:

- `https://your-domain.com/`              — main marketing site
- `https://your-domain.com/partners/`     — partner portal
- `https://your-domain.com/referrals/`    — referral network
- `https://your-domain.com/api/healthz`   — API health

## Notes

- The API and frontends are same-origin in production, so no CORS config is needed.
- Database migrations are run via `pnpm run db:push` (idempotent). The API also runs
  some additive migrations at startup (see `runStartupMigrations()` in
  `artifacts/api-server/src/index.ts`).
- Object storage falls back to Google Application Default Credentials when not
  running on Replit. Set `GOOGLE_APPLICATION_CREDENTIALS` or attach a workload
  identity to your GCP VM / Cloud Run service.
