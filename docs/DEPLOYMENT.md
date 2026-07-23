# 🚀 CompDesk — Deployment Guide

This guide covers every way to deploy CompDesk: from a quick local test to a full production setup behind Nginx or Apache with SSL.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
4. [Option B: Standalone Node.js](#option-b-standalone-nodejs)
5. [Option C: Nginx Reverse Proxy (Production)](#option-c-nginx-reverse-proxy-production)
6. [Option D: Apache Reverse Proxy](#option-d-apache-reverse-proxy)
7. [Database Setup](#database-setup)
8. [IP Tracking & Proxy Headers](#ip-tracking--proxy-headers)
9. [SSL/HTTPS Setup](#sslhttps-setup)
10. [Updating CompDesk](#updating-compdesk)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | 20+ | Runtime |
| **npm** | 10+ | Package manager |
| **PostgreSQL** | 16+ | Database (via Docker or standalone) |
| **Docker** + Docker Compose | Latest | Container deployment (optional) |
| **Git** | Any | Cloning + updates |

### Install Node.js (Linux/Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v    # Should show v20.x
npm -v     # Should show 10.x
```

### Install Docker (Linux/Ubuntu)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in, then:
docker --version
docker compose version
```

---

## Environment Configuration

**Before deploying, create and edit your `.env` file:**

```bash
cp .env.example .env
nano .env
```

### Required Variables

```env
# ── Database ────────────────────────────────────────────────────
DATABASE_URL="postgresql://compdesk:YOUR_STRONG_PASSWORD@localhost:5432/compdesk?schema=public"

# ── Auth ─────────────────────────────────────────────────────────
AUTH_URL="https://compdesk.yourorg.com"
AUTH_SECRET="$(openssl rand -base64 32)"           # Generate with this command

# ── Microsoft Entra ID (SSO) ────────────────────────────────────
# Leave empty if not using SSO — local login will still work
AZURE_AD_CLIENT_ID=""
AZURE_AD_CLIENT_SECRET=""
AZURE_AD_TENANT_ID=""
```

### Generate Secrets

```bash
# Generate AUTH_SECRET (run once, copy to .env)
openssl rand -base64 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Optional Variables

```env
# ── SMTP (email notifications) ──────────────────────────────────
SMTP_HOST="smtp.office365.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="noreply@yourorg.com"
SMTP_PASS="your-smtp-password"
SMTP_FROM="CompDesk <noreply@yourorg.com>"

# ── External API ────────────────────────────────────────────────
API_KEY="generate-a-strong-api-key"

# ── Webhooks ────────────────────────────────────────────────────
WEBHOOK_URL=""
WEBHOOK_SECRET="generate-a-strong-webhook-secret"

# ── App Settings ────────────────────────────────────────────────
NODE_ENV="production"
LOG_LEVEL="info"
```

---

## Option A: Docker Compose (Recommended)

The easiest way to deploy. One command starts both the database and the app.

### Step 1: Clone and Configure

```bash
git clone https://github.com/your-org/compdesk.git
cd compdesk
cp .env.example .env
nano .env    # Edit all values
```

### Step 2: Start Everything

```bash
docker compose up --build -d
```

This starts:
- **PostgreSQL 16** on port 5432 (internal)
- **CompDesk app** on port 3000

### Step 3: Seed the Database (First-Time Only)

```bash
# Run the seed script inside the container
docker compose exec app npx prisma db seed
```

### Step 4: Verify

```bash
docker compose ps          # Check both containers are "Up"
docker compose logs app    # Check for errors
curl http://localhost:3000  # Should return HTML
```

### Management Commands

```bash
docker compose down          # Stop everything
docker compose up -d         # Start in background
docker compose logs -f app   # Follow app logs
docker compose restart app   # Restart app only
```

### Custom Port

To change the port, edit `docker-compose.yml`:

```yaml
ports:
  - '8080:3000'   # Access on port 8080 instead of 3000
```

---

## Option B: Standalone Node.js

Deploy without Docker — just Node.js + a PostgreSQL server.

### Step 1: Install Dependencies

```bash
git clone https://github.com/your-org/compdesk.git
cd compdesk
npm ci --production=false
```

### Step 2: Configure Environment

```bash
cp .env.example .env
nano .env    # Set DATABASE_URL to your PostgreSQL server
```

### Step 3: Setup Database

```bash
# Run migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Seed initial data (first-time only)
npm run db:seed
```

### Step 4: Build for Production

```bash
npm run build
```

### Step 5: Start the Server

```bash
# Option 1: Using the standalone output (recommended for production)
node .next/standalone/server.js

# Option 2: Using next start (development-like)
# Note: doesn't work with output: standalone, use option 1
```

### Step 6: Keep it Running (systemd)

Create `/etc/systemd/system/compdesk.service`:

```ini
[Unit]
Description=CompDesk Application
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/compdesk
EnvironmentFile=/opt/compdesk/.env
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable compdesk
sudo systemctl start compdesk
sudo systemctl status compdesk
```

---

## Option C: Nginx Reverse Proxy (Production)

Best for production. Nginx handles SSL, gzip, and forwards to the Node.js app.

### Step 1: Install Nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### Step 2: Configure Nginx

Create `/etc/nginx/sites-available/compdesk`:

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name compdesk.yourorg.com;
    return 301 https://$host$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name compdesk.yourorg.com;

    # SSL certificates (use Let's Encrypt or your own)
    ssl_certificate /etc/letsencrypt/live/compdesk.yourorg.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/compdesk.yourorg.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # ⚠️ CRITICAL FOR IP TRACKING — these headers forward the real client IP
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # File upload size (match CompDesk's limit)
    client_max_body_size 10M;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 256;
}
```

### Step 3: Enable the Site

```bash
sudo ln -s /etc/nginx/sites-available/compdesk /etc/nginx/sites-enabled/
sudo nginx -t           # Test config syntax
sudo systemctl reload nginx
```

### Step 4: Get SSL Certificate (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d compdesk.yourorg.com
# Follow prompts, certbot auto-renews
```

---

## Option D: Apache Reverse Proxy

If your server runs Apache instead of Nginx.

### Step 1: Install Apache + Required Modules

```bash
sudo apt-get update
sudo apt-get install -y apache2
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite ssl headers
sudo systemctl restart apache2
```

### Step 2: Configure Apache

Create `/etc/apache2/sites-available/compdesk.conf`:

```apache
<VirtualHost *:80>
    ServerName compdesk.yourorg.com
    RewriteEngine On
    RewriteRule ^(.*)$ https://%{HTTP_HOST}$1 [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName compdesk.yourorg.com

    # SSL
    SSLEngine On
    SSLCertificateFile /etc/letsencrypt/live/compdesk.yourorg.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/compdesk.yourorg.com/privkey.pem

    # ⚠️ CRITICAL FOR IP TRACKING — forward real client IP
    ProxyPreserveHost On
    RequestHeader set X-Real-IP "%{REMOTE_ADDR}s"
    RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"
    RequestHeader set X-Forwarded-Proto "https"

    # Reverse proxy to Node.js app
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

    # WebSocket support (for HMR in dev, optional in prod)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule /(.*) ws://127.0.0.1:3000/$1 [P,L]

    # Security headers
    Header always set X-Frame-Options "DENY"
    Header always set X-Content-Type-Options "nosniff"

    # File upload limit
    LimitRequestBody 10485760
</VirtualHost>
```

### Step 3: Enable and Restart

```bash
sudo a2ensite compdesk.conf
sudo apache2ctl configtest   # Should say "Syntax OK"
sudo systemctl reload apache2
```

### Step 4: SSL with Certbot

```bash
sudo apt-get install -y certbot python3-certbot-apache
sudo certbot --apache -d compdesk.yourorg.com
```

---

## Database Setup

### Using Docker (Easiest)

The `docker compose up -d db` command starts a PostgreSQL 16 container automatically. The data is stored in a Docker volume (`pgdata`) and persists across restarts.

### Using a Standalone PostgreSQL Server

```bash
# Install PostgreSQL 16
sudo apt-get install -y postgresql-16

# Create the database and user
sudo -u postgres psql
```

```sql
CREATE USER compdesk WITH PASSWORD 'YOUR_STRONG_PASSWORD';
CREATE DATABASE compdesk OWNER compdesk;
GRANT ALL PRIVILEGES ON DATABASE compdesk TO compdesk;
\q
```

Then set in your `.env`:

```env
DATABASE_URL="postgresql://compdesk:YOUR_STRONG_PASSWORD@localhost:5432/compdesk?schema=public"
```

### Run Migrations

```bash
npx prisma migrate deploy    # Apply all migrations
npm run db:seed              # Seed initial data (first-time only)
```

---

## IP Tracking & Proxy Headers

CompDesk tracks IP addresses in audit logs for security. **This works correctly with all deployment methods**, but you must ensure your reverse proxy forwards the real client IP.

### How It Works

CompDesk reads the client IP from these headers (in order):
1. `X-Forwarded-For` — Set by Nginx/Apache/Docker
2. `X-Real-IP` — Set by Nginx
3. Falls back to the connection IP

### Docker + Reverse Proxy

Docker does **NOT** cause IP tracking problems as long as your reverse proxy (Nginx or Apache) sets the `X-Real-IP` and `X-Forwarded-For` headers. The configs above already include these.

### Verifying IP Tracking

After deploying, log in and check the **Admin → Logs** page. You should see your real public IP, not `127.0.0.1` or a Docker network IP. If you see an internal IP, your reverse proxy headers are misconfigured.

---

## SSL/HTTPS Setup

**HTTPS is required for production** because:
- Microsoft Entra ID SSO requires HTTPS callback URLs
- Auth.js (NextAuth) cookies are `Secure` in production
- HSTS headers are enabled

### Let's Encrypt (Free)

```bash
sudo apt-get install -y certbot
# For Nginx:
sudo certbot --nginx -d compdesk.yourorg.com
# For Apache:
sudo certbot --apache -d compdesk.yourorg.com
# Auto-renewal is configured automatically
```

### Self-Signed (Testing Only)

```bash
sudo openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout /etc/ssl/private/compdesk.key \
    -out /etc/ssl/certs/compdesk.crt \
    -subj "/CN=compdesk.yourorg.com"
```

---

## Updating CompDesk

### With Docker

```bash
cd /opt/compdesk
git pull origin main
docker compose up --build -d
# Migrations run automatically on startup (Dockerfile CMD)
```

### Without Docker

```bash
cd /opt/compdesk
git pull origin main
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
sudo systemctl restart compdesk
```

---

## Troubleshooting

### "next start" fails with "standalone" error

Use `node .next/standalone/server.js` instead of `npm start`. The app is built with `output: 'standalone'` for Docker compatibility.

### Database connection refused

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql
# Or for Docker:
docker compose ps db
docker compose logs db
```

### EINVAL readlink error on Windows

Delete the `.next` folder and rebuild:

```bash
# PowerShell
Remove-Item -Recurse -Force .next
npm run build
```

### CSS not loading / blank page

Make sure `.next/static` is accessible. If using standalone mode, both `server.js` AND the `static` folder must be present.

### SSO callback error

- Verify `AUTH_URL` matches your actual URL exactly (no trailing slash)
- Verify the Azure redirect URI matches: `https://compdesk.yourorg.com/api/auth/callback/microsoft-entra-id`
- Ensure admin consent is granted in Azure Portal

### Audit logs show wrong IP addresses

Make sure your reverse proxy sets these headers:
```
X-Real-IP: $remote_addr
X-Forwarded-For: $proxy_add_x_forwarded_for
```

### Port 3000 already in use

```bash
# Find what's using port 3000
sudo lsof -i :3000
# Kill it
sudo kill -9 <PID>
```

---

## Quick Reference: Deploy in 5 Minutes

```bash
# 1. Clone
git clone https://github.com/your-org/compdesk.git && cd compdesk

# 2. Configure
cp .env.example .env && nano .env

# 3. Start database + app
docker compose up --build -d

# 4. Seed initial data
docker compose exec app npx prisma db seed

# 5. Open browser
open http://localhost:3000
# Login: admin@example.invalid / Password123!
```
