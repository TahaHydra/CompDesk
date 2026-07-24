# 🎫 CompDesk — Lightweight IT Helpdesk & Ticketing System

A **production-ready**, modern ticketing system built for small organizations (2–3 agents, ~20 end users). Simpler than GLPI, powered by Microsoft Entra ID SSO.

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
- **Collision Detection**: 5-minute lock when an agent opens a ticket.
- **Rate Limiting**: In-memory throttling for auth and ticket creation routes.
- **Non-blocking I/O**: Email sending and webhook dispatch are fire-and-forget with error logging.

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

Include `X-API-Key: <your-api-key>` header.

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
│   │   │       ├── templates/    # Canned response templates
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
│   ├── middleware.ts           # Auth protection
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
| `AZURE_AD_CLIENT_ID` | Yes | Entra app client ID |
| `AZURE_AD_CLIENT_SECRET` | Yes | Entra app client secret |
| `AZURE_AD_TENANT_ID` | Yes | Entra tenant ID |
| `SMTP_HOST` | For email | SMTP server hostname |
| `SMTP_PORT` | For email | SMTP port (587) |
| `SMTP_USER` | For email | SMTP username |
| `SMTP_PASS` | For email | SMTP password |
| `SMTP_FROM` | For email | Sender email address |
| `API_KEY` | For ext API | Static API key |
| `WEBHOOK_SECRET` | For webhooks | Webhook signing secret |

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