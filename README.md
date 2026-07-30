# 🎫 CompDesk — Lightweight IT Helpdesk & Ticketing System

CompDesk is an actively developed self-hosted helpdesk for small organizations. Review the production hardening guide before deployment.

## ⚡ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 15 (App Router) + TypeScript |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Auth** | Auth.js (NextAuth v5) + Microsoft Entra ID OIDC |
| **UI** | Tailwind CSS + shadcn/ui + Radix Primitives |
| **Email** | Nodemailer (SMTP) |
| **State** | React Query (TanStack Query) with 30s polling |
| **Logging** | Winston (structured JSON) |
| **Testing** | Jest + ts-jest |
| **Deployment** | Docker + Docker Compose + NGINX |

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [SETUP.md](SETUP.md) | Reliable Windows, macOS, and Linux local setup |
| [README.md](README.md) | Developer setup, architecture, and configuration |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Full deployment guide (Docker, Nginx, Apache, standalone) |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Complete API reference for all endpoints |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | End user, agent, and administrator guide |

---

## ✨ Features

- **Ticket Management** — Create, assign, prioritize, and resolve tickets with full timeline history
- **Department Routing** — Department-owned categories, department defaults, category form overrides, and agent assignments
- **Role-Based Access** — Four roles: End User, Agent, Admin, Super Admin with granular permissions
- **Microsoft SSO** — Sign in with Microsoft Entra ID (Azure AD) + local email/password fallback
- **Real-time Notifications** — Bell icon shows recent activity on your tickets, auto-refreshes every 30s
- **Profile & Language** — View account details and choose a personal English or French interface
- **Dashboard Quick Links** — Admins can add validated external links with optional compact icons
- **Searchable Help Center** — Bilingual collections and articles managed by administrators
- **SLA Policies** — Per-department, per-priority response and resolution time targets
- **Ticket Templates** — Versioned role-aware forms with built-ins, custom fields, conditions, validation, previews, and historical snapshots
- **Escalation** — Agents can escalate tickets to higher-level support
- **Canned Responses** — Pre-written reply templates for common issues
- **Email Notifications** — Configurable SMTP with per-event toggles
- **Audit Logging** — All admin and ticket changes are logged
- **External API** — REST API for programmatic ticket creation and note appending
- **Complete Branding** — Runtime names, copy, logos, favicon, colors, login methods/background, support address, metadata, and branded email
- **Dark Mode** — Full dark/light theme support
- **Webhooks** — HTTP callbacks on ticket events

---

## Branding and ticket-template architecture

Branding is read through one typed service. The public `/api/branding` response contains only safe pre-authentication values; admin changes and asset uploads use separate protected endpoints. Primary/accent colors are applied through root CSS variables, while runtime metadata controls the title, description, application name, and favicon.

Every category belongs to one department (`Category.queueId`) and is unique by `(queueId, name)`. Ticket Template resolution is centralized and always uses category override → department default → protected system default. Browser-supplied template IDs are ignored. The server resolves and validates every submitted field, then stores the template ID/version, immutable schema snapshot, and sanitized values on the ticket.

Historical tickets therefore keep their original labels and values after templates/categories are changed or archived.

The authenticated Help Center stores English and French collections/articles, follows each user's saved profile language, and supports title/summary/content search. Administrators manage drafts and published content under **Admin → Help Content**. Quick-link icon uploads use randomized local filenames and strict image-signature validation.

## Safe upgrades

For an existing installation, back up PostgreSQL, `public/uploads` (branding and quick-link assets), and `storage/attachments` (private ticket files), then run:

```bash
npm run db:generate
npm run db:migrate:prod
npm run verify
```

Do not reset the database. The migration is transactional and remaps legacy global categories according to each ticket's real department before removing old rows. See [SETUP.md](SETUP.md) for rehearsal, seed, and backup details.
## 🏗 Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│  Next.js App │────▶│  PostgreSQL  │
│  (React SPA) │◀────│  (API + SSR) │◀────│   (Prisma)   │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
            ┌──────────┐ ┌────────┐ ┌──────────┐
            │ Entra ID │ │ SMTP   │ │ Webhooks │
            │  (OIDC)  │ │ Server │ │ (HTTP)   │
            └──────────┘ └────────┘ └──────────┘
```

### Key Design Decisions

- **JWT Sessions**: Lightweight tokens containing only user ID, role, and group IDs. No raw Graph API data in sessions.
- **Dynamic SLA**: Overdue status calculated on read — no background workers needed.
- **Viewer Presence**: Expiring, non-exclusive presence records do not modify ticket business timestamps or authorize updates.
- **Distributed Throttling**: PostgreSQL-backed limits protect login, uploads, and external API authentication/requests across replicas.
- **Durable Webhooks**: Signed deliveries use an SSRF-safe database outbox, bounded retries, history, and automatic failure disablement.

---

## 🚀 Quick Start

The canonical local-development instructions are in **[SETUP.md](SETUP.md)**.
Docker is only required for PostgreSQL; Next.js runs directly in Node.js.

### Prerequisites

- **Node.js** 24 LTS (22.12+ is supported)
- **Docker** & Docker Compose (for PostgreSQL)
- **Azure AD App Registration** (for SSO — see below)

### 1. Clone & Install

```bash
cd CompDesk
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm ci
```

### 2. Start PostgreSQL

```bash
npm run db:up
```

### 3. Run Migrations & Seed

```bash
npm run setup
npm run db:seed
```

### 4. Start Dev Server

```bash
npm run dev
```

Open **http://localhost:3000**. The configured local and/or Microsoft sign-in sections are shown.

### 5. Full Docker Deployment

```bash
# Set env vars in .env, then:
docker compose up --build -d
```

---

## 🔐 Azure App Registration

### Step 1: Create App Registration

1. Go to **Azure Portal** → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Name: `CompDesk`
3. Supported account types: **Single tenant**
4. Redirect URI: `http://localhost:3000/api/auth/callback/microsoft-entra-id`
   - Production: `https://compdesk.yourorg.com/api/auth/callback/microsoft-entra-id`

### Step 2: Configure

1. **Certificates & Secrets** → New client secret → Copy the value
2. **API Permissions** (least privilege):
   - `openid` (delegated)
   - `profile` (delegated)
   - `email` (delegated)
   - `User.Read` (delegated)
   - Optional for group sync: `GroupMember.Read.All` (application)
3. **Token configuration** → Add optional claim `groups` (Security groups) if using group claims

### Step 3: Environment Variables

```env
AZURE_AD_CLIENT_ID=<Application (client) ID>
AZURE_AD_CLIENT_SECRET=<Client secret value>
AZURE_AD_TENANT_ID=<Directory (tenant) ID>
```

### Step 4: Grant Admin Consent

Go to **API Permissions** → Click **Grant admin consent for [your org]**

---

## 📧 SMTP Email Configuration

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourorg.com
SMTP_PASS=your-password
SMTP_FROM="CompDesk <noreply@yourorg.com>"
```

Emails are sent for:
- ✅ Ticket Created (to requester)
- ✅ Ticket Assigned (to agent)
- ✅ Status Changed / New Comment (to watchers)

Email sending **fails gracefully** — errors are logged but never crash the request.

---

## 🔒 Security Hardening

| Feature | Status |
|---------|--------|
| CSP Headers | ✅ Configured in `next.config.js` |
| X-Frame-Options: DENY | ✅ |
| HSTS | ✅ |
| X-Content-Type-Options | ✅ |
| Rate Limiting (auth + ticket creation) | ✅ In-memory |
| Input Validation (Zod schemas) | ✅ All API routes |
| Rich Text Sanitization | ✅ Script/handler/protocol stripping |
| Server-side RBAC | ✅ Every API route |
| JWT-only sessions (lightweight) | ✅ |
| Audit Logging | ✅ All admin/ticket changes |
| File Upload Size Limits | ✅ 10MB default |

---

## 👥 Roles & Permissions

| Action | User | Agent | Admin | SuperAdmin |
|--------|------|-------|-------|------------|
| Create ticket | ✅ | ✅ | ✅ | ✅ |
| View own tickets | ✅ | ✅ | ✅ | ✅ |
| View queue tickets | ❌ | ✅ | ✅ | ✅ |
| View all tickets | ❌ | ❌ | ✅ | ✅ |
| Add comment | ✅* | ✅ | ✅ | ✅ |
| Add internal note | ❌ | ✅ | ✅ | ✅ |
| Change status | Limited | ✅ | ✅ | ✅ |
| Assign tickets | ❌ | ✅ | ✅ | ✅ |
| Manage queues/categories | ❌ | ❌ | ✅ | ✅ |
| Manage users/roles | ❌ | ❌ | ✅ | ✅ |
| Sync Entra groups | ❌ | ❌ | ✅ | ✅ |

*Users can only comment on their own tickets.

---

## 🔄 Status Transition Rules

```
User:  OPEN → PENDING_AGENT, PENDING_USER → PENDING_AGENT
Agent: NEW → OPEN, OPEN → PENDING_USER/RESOLVED,
       PENDING_AGENT → OPEN/PENDING_USER/RESOLVED,
       RESOLVED → CLOSED/OPEN
Admin: All of the above + any status → CLOSED, CLOSED → OPEN
```

---

## 🌐 External API

### Authentication

Enable the feature explicitly, create a scoped client in **Admin → Settings → API Clients**, then include `X-API-Key: <client-secret>` (or `Authorization: Bearer <client-secret>`). The secret is shown only when it is created or rotated. Department access is default-deny: select departments or explicitly enable all-department access. See **[docs/WEBHOOKS_AND_EXTERNAL_API.md](docs/WEBHOOKS_AND_EXTERNAL_API.md)**.

### Create Ticket

```bash
POST /api/v1/tickets
{
  "title": "Server down",
  "description": "Web server is not responding",
  "queueId": "...",
  "userEmail": "user@yourorg.com",
  "priority": "URGENT"
}
```

### Append Internal Note

```bash
POST /api/v1/tickets/{id}/notes
{
  "content": "Investigated: disk full",
  "authorEmail": "agent@yourorg.com"
}
```

---

## 📁 Project Structure

```
├── docs/
│   ├── API_REFERENCE.md       # Complete API endpoint documentation
│   └── USER_GUIDE.md          # End user, agent & admin guide
├── prisma/
│   ├── schema.prisma          # Database schema (20+ models)
│   └── seed.ts                # Demo data
├── src/
│   ├── app/
│   │   ├── (dashboard)/       # Authenticated pages
│   │   │   ├── dashboard/     # Stats overview + quick links
│   │   │   ├── tickets/       # List, create, detail
│   │   │   ├── queue/         # Agent department inbox
│   │   │   ├── profile/       # User profile page
│   │   │   └── admin/         # Admin panel
│   │   │       ├── departments/  # Department management
│   │   │       ├── categories/   # Category management
│   │   │       ├── tags/         # Tag management
│   │   │       ├── templates/    # Ticket form templates
│   │   │       ├── users/        # User/role management
│   │   │       └── settings/     # SMTP, email, Entra, quick links
│   │   ├── auth/              # Sign-in, error pages
│   │   ├── api/               # API routes
│   │   │   ├── tickets/       # CRUD + comments + escalation
│   │   │   ├── queues/        # Department management
│   │   │   ├── categories/    # Category CRUD
│   │   │   ├── tags/          # Tag CRUD
│   │   │   ├── notifications/ # Bell notifications
│   │   │   ├── users/         # User/role management
│   │   │   ├── settings/      # App settings + test email
│   │   │   ├── groups/        # Entra group sync
│   │   │   ├── v1/            # External API
│   │   │   └── dashboard/     # Dashboard stats
│   │   └── layout.tsx         # Root layout
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── layout/            # App shell, sidebar, notifications
│   │   └── providers/         # Auth + Query providers
│   ├── lib/
│   │   ├── auth.ts            # Auth.js config
│   │   ├── prisma.ts          # DB client
│   │   ├── email.ts           # Nodemailer service
│   │   ├── webhooks.ts        # Webhook dispatch
│   │   ├── audit.ts           # Audit logging
│   │   ├── validations.ts     # Zod schemas
│   │   ├── utils.ts           # Helpers, transitions, rate limiting
│   │   └── logger.ts          # Winston logger
│   └── __tests__/             # Jest tests
├── docker-compose.yml          # PostgreSQL + App
├── Dockerfile                  # Multi-stage build
├── nginx.conf                  # Reverse proxy config
└── .env.example                # Environment template
```

---

## 🧪 Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

Tests cover:
- Status transition rules (15 cases)
- Ticket key generation
- Rate limiting logic
- HTML sanitization
- RBAC checks
- Zod schema validation (tickets, comments, queues, tags)

---

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | Random 32+ char secret |
| `AUTH_URL` | Yes | App URL (e.g., `https://compdesk.yourorg.com`) |
| `AZURE_AD_CLIENT_ID` | For SSO | Entra app client ID |
| `AZURE_AD_CLIENT_SECRET` | For SSO | Entra app client secret |
| `AZURE_AD_TENANT_ID` | For SSO | Entra tenant ID |
| `SMTP_HOST` | For email | SMTP server hostname |
| `SMTP_PORT` | For email | SMTP port (587) |
| `SMTP_USER` | For email | SMTP username |
| `SMTP_PASS` | For email | SMTP password |
| `SMTP_FROM` | For email | Sender email address |

---

## 📝 Seed Data

The idempotent development seed creates:

- **6 users**: 1 Super Admin, 1 Department Admin, 2 Agents, and 2 End Users;
- **3 departments**, each with **6 department-specific categories**;
- **5 useful Ticket Templates**: Standard, IT Support, Access & Permission, HR, and Finance;
- **4 bilingual Help Center collections** with **8 searchable articles**;
- realistic tags, SLA policies, canned responses, and sample tickets.

The default domain is `example.com` and the default password is `Password123!`. Set `SEED_DEMO_DOMAIN`, the six `SEED_*_EMAIL` variables, and `SEED_DEFAULT_PASSWORD` before seeding an existing private test database. The seed preserves ticket history, renames known legacy category aliases in place, and only removes known misplaced demo categories when they have no tickets. It never deletes referenced historical categories.

See [SETUP.md](SETUP.md#seed-accounts-and-demo-data) for exact Windows and Unix commands.

---

## License

MIT
### SMTP secret encryption and key rotation

Database-backed SMTP passwords are stored as versioned AES-256-GCM envelopes (`enc:v1`). Configure `APP_SETTINGS_ENCRYPTION_KEY` as 32 random bytes encoded in base64 or as 64 hexadecimal characters. Run `npm run generate:settings-key` once to create and persist a missing local `.env` key without printing it. `npm start` loads the persisted key into the standalone server process, while Docker Compose passes it into the app container. Existing plaintext values are reported in Super Admin Settings and can be migrated once with **Encrypt existing password**. Environment-provided `SMTP_PASS`/`SMTP_PASSWORD` values are never copied to the database.

Rotate the encryption key without downtime:

1. Move the current key to `APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS` and install the new key as `APP_SETTINGS_ENCRYPTION_KEY`.
2. Restart the application; reads accept either key while every new save uses the new key.
3. In SMTP Settings, enter and save the SMTP password once to re-encrypt it with the new key.
4. Verify SMTP, then remove `APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS` and restart.

Never derive this key from `AUTH_SECRET`. If the settings database is unavailable, login policy uses the last validated in-process value, then `LOGIN_LOCAL_ENABLED` / `LOGIN_MICROSOFT_ENABLED`. With neither available, Microsoft login is disabled and local credentials are retained as the documented break-glass path. Deployments that deliberately disable local login must set `LOGIN_LOCAL_ENABLED=false`.
## Multiple ticket assignees

Tickets use `ticket_assignees` as the only assignment source of truth. Assignees are equal co-assignees; claiming adds the current agent without replacing anyone, duplicate claims are idempotent, and watchers remain separate. `POST /api/tickets/:id/assignees` adds an eligible user, `DELETE /api/tickets/:id/assignees?userId=...` removes one, and the `/assignees/claim` endpoint claims or unclaims the current actor. Every mutation revalidates the actor and candidate against the ticket department on the server.

The `20260727130000_add_multiple_ticket_assignees` migration must be applied during a maintenance window. It creates and indexes the join table, backfills every legacy `tickets.assignee_id`, aborts if verification fails, and only then drops the legacy column. Take a database backup first. A rollback requires recreating `assignee_id`, selecting one deterministic assignment per ticket (for example the earliest `assigned_at`), verifying the copy, and then removing the join model; this necessarily discards additional co-assignees, so restore the backup when those assignments must be preserved. Never use a production reset for rollback.