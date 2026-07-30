# CompDesk public-release baseline

Baseline branch: `release/public-hardening`  
Baseline commit: `06ccca0b08d44bc89c29c98dffb0a9016b93b69e`  
Inventory date: 2026-07-30
Supported database observed in Prisma: PostgreSQL only

This document records behavior observed in the repository and runtime-oriented
code at the start of public-release hardening. It does not treat README claims
as evidence. Findings are closed only when a later focused commit and test are
listed in the final audit.

## Repository state

- Starting branch `fix/settings-branding-email` matched its remote at `06ccca0`.
- Work moved to `release/public-hardening`; `main` was not modified.
- `entra-metadata.json` and `entra-metadata.jsoncurl.exe` were pre-existing,
  untracked diagnostic artifacts. They were not read as configuration, staged,
  modified, or deleted.
- There were no staged or tracked working-tree modifications at baseline.
- No server actions (`"use server"`) were found. Mutations use route handlers.

## Route inventory

### Pages and layouts

| Route | Source | Access observed |
|---|---|---|
| `/` | `src/app/page.tsx` | Redirect/entry behavior |
| `/auth/signin` | `src/app/auth/signin/page.tsx` | Public authentication UI |
| `/auth/error` | `src/app/auth/error/page.tsx` | Public safe error UI |
| `/dashboard` | `src/app/(dashboard)/dashboard/page.tsx` | Authenticated |
| `/tickets` | `src/app/(dashboard)/tickets/page.tsx` | Authenticated, server-scoped API |
| `/tickets/new` | `src/app/(dashboard)/tickets/new/page.tsx` | Authenticated |
| `/tickets/[id]` | `src/app/(dashboard)/tickets/[id]/page.tsx` | Authenticated, ticket-scoped API |
| `/queue` | `src/app/(dashboard)/queue/page.tsx` | AGENT, ADMIN, SUPER_ADMIN |
| `/profile` | `src/app/(dashboard)/profile/page.tsx` | Authenticated |
| `/help` | `src/app/(dashboard)/help/page.tsx` | Authenticated |
| `/help/[slug]` | `src/app/(dashboard)/help/[slug]/page.tsx` | Authenticated |
| `/admin` | `src/app/(dashboard)/admin/page.tsx` | ADMIN or SUPER_ADMIN layout |
| `/admin/departments` | `src/app/(dashboard)/admin/departments/page.tsx` | Department ADMIN or SUPER_ADMIN |
| `/admin/categories` | `src/app/(dashboard)/admin/categories/page.tsx` | Department ADMIN or SUPER_ADMIN |
| `/admin/templates` | `src/app/(dashboard)/admin/templates/page.tsx` | Department ADMIN or SUPER_ADMIN |
| `/admin/help` | `src/app/(dashboard)/admin/help/page.tsx` | ADMIN or SUPER_ADMIN |
| `/admin/tags` | `src/app/(dashboard)/admin/tags/page.tsx` | SUPER_ADMIN layout |
| `/admin/users` | `src/app/(dashboard)/admin/users/page.tsx` | SUPER_ADMIN layout |
| `/admin/logs` | `src/app/(dashboard)/admin/logs/page.tsx` | SUPER_ADMIN layout |
| `/admin/settings` | `src/app/(dashboard)/admin/settings/page.tsx` | SUPER_ADMIN layout |

There was no `/setup` route or isolated pre-database bootstrap application at
baseline. Normal application modules import the Prisma runtime.

### API routes

| Route | Methods | Access observed |
|---|---|---|
| `/api/auth/[...nextauth]` | Auth.js handlers | Auth.js callback/session rules |
| `/api/branding` | GET | Public safe branding |
| `/api/branding/admin` | GET, PATCH, DELETE | SUPER_ADMIN |
| `/api/branding/assets` | POST, DELETE | SUPER_ADMIN |
| `/uploads/[folder]/[filename]` | GET | Public, constrained branding/quick-link assets |
| `/api/dashboard/stats` | GET | Authenticated, role/department scoped |
| `/api/tickets` | GET, POST | Authenticated, role/department scoped |
| `/api/tickets/[id]` | GET, PATCH, DELETE | Authenticated, ticket scoped |
| `/api/tickets/[id]/comments` | POST, PATCH, DELETE | Authenticated; internal notes staff-only |
| `/api/tickets/[id]/escalate` | POST | AGENT/ADMIN/SUPER_ADMIN with ticket access |
| `/api/tickets/[id]/assignees` | GET, POST, DELETE | Visible ticket; mutations staff with queue access |
| `/api/tickets/[id]/assignees/claim` | POST, DELETE | AGENT/ADMIN/SUPER_ADMIN with queue access |
| `/api/ticket-form/resolve` | GET | Authenticated, department visibility enforced |
| `/api/ticket-form-templates` | GET, POST | ADMIN/SUPER_ADMIN with administrative scope |
| `/api/ticket-form-templates/[id]` | GET, PATCH, POST, DELETE | ADMIN/SUPER_ADMIN with administrative scope |
| `/api/queues` | GET, POST, PATCH, DELETE | Authenticated read; administrative mutation |
| `/api/categories` | GET, POST, PATCH, DELETE | Authenticated scoped read; administrative mutation |
| `/api/tags` | GET, POST, PATCH, DELETE | Authenticated read; SUPER_ADMIN mutation |
| `/api/canned-responses` | GET, POST | AGENT/ADMIN/SUPER_ADMIN |
| `/api/help/collections` | GET, POST, PATCH, DELETE | Authenticated read; ADMIN/SUPER_ADMIN mutation |
| `/api/help/articles` | GET, POST, PATCH, DELETE | Authenticated read; ADMIN/SUPER_ADMIN mutation |
| `/api/users` | GET, POST, PATCH, DELETE | Staff-scoped read; SUPER_ADMIN mutation |
| `/api/users/search` | GET | Authenticated; results role/department scoped |
| `/api/groups` | GET, POST | SUPER_ADMIN |
| `/api/profile/preferences` | GET, PATCH | Current authenticated user |
| `/api/notifications` | GET, POST | Current authenticated user, ticket visibility scoped |
| `/api/audit-logs` | GET | SUPER_ADMIN |
| `/api/settings` | GET, PATCH | SUPER_ADMIN |
| `/api/settings/entra-diagnostic` | POST | SUPER_ADMIN |
| `/api/settings/verify-smtp` | POST | SUPER_ADMIN |
| `/api/settings/test-email` | POST | SUPER_ADMIN |
| `/api/settings/migrate-smtp-secret` | POST | SUPER_ADMIN |
| `/api/settings/quick-link-icons` | POST, DELETE | SUPER_ADMIN |
| `/api/api-clients` | GET, POST, PATCH, DELETE | SUPER_ADMIN |
| `/api/upload` | POST | Authenticated, temporary or ticket-scoped |
| `/api/upload/[id]` | GET, DELETE | Authenticated, ticket scoped |
| `/api/v1/tickets` | GET, POST | Feature flag plus API-client scope |
| `/api/v1/tickets/[id]/notes` | POST | Feature flag plus API-client scope and queue boundary |

No liveness or readiness health routes existed at baseline.

## Role and permission matrix

| Capability | USER | AGENT | department ADMIN | SUPER_ADMIN |
|---|---:|---:|---:|---:|
| Create ticket | Yes | Yes | Yes | Yes |
| Read requested tickets | Yes | Yes | Yes | Yes |
| Read department tickets | No | Accessible departments | Administered and assigned departments | Global |
| Add public comment | Own visible tickets | Accessible tickets | Accessible tickets | Global |
| Add internal note | No | Accessible tickets | Accessible tickets | Global |
| Claim/manage co-assignees | No | Accessible departments | Accessible departments | Global |
| Change ticket fields/status | Limited server rules | Accessible departments | Accessible departments | Global |
| Administer departments/categories/templates | No | No | Administered departments | Global |
| Manage global tags/users/settings/API clients/audit | No | No | No | Yes |
| Read help center | Yes | Yes | Yes | Yes |
| Manage help center | No | No | Yes | Yes |

`ADMIN` is not global. Its broad ticket view remains constrained to departments
returned by centralized queue-permission helpers.

## Data model relationship map

- `User` owns requested `Ticket` records and relates to Auth.js `Account` and
  `Session`, group/queue memberships, assignments, timeline events, watchers,
  escalation history, and audit logs.
- `Queue` owns categories, SLA policies, memberships/group assignments, tickets,
  and an optional default ticket-form template.
- `Category` belongs to exactly one queue and may override the form template.
- `Ticket` belongs to a queue, optional category, requester, and immutable
  resolved template/version snapshot. It has tags, co-assignees, watchers,
  timeline events, and attachments.
- `TicketAssignee` is the only assignment source of truth and is unique by
  `(ticketId, userId)`.
- `TimelineEvent` stores ticket conversation and history with an actor.
- `Attachment` belongs to a ticket but had no uploader, scan, quarantine, or
  deletion-status fields at baseline.
- `WebhookConfig` stores a URL and plaintext optional secret. It had no delivery
  or outbox relation.
- `ApiClient` stores a SHA-256 key hash, scopes, queue IDs, and last-used time.
- `AppSetting` is a generic string key/value store. SMTP passwords may be
  AES-256-GCM envelopes, while other values are plaintext.

Important deletion behavior observed: many ticket-child relations cascade;
assignment user/actor relations restrict; Auth.js account/session relations
cascade from users; timeline actors currently cascade, which can erase history.

## Secrets inventory

| Secret | Source/storage | Baseline protection |
|---|---|---|
| `AUTH_SECRET` | Environment | Required by runtime validator; no setup generation |
| PostgreSQL password / `DATABASE_URL` | Environment/Compose | Fixed public defaults existed |
| Entra client secret | Environment or managed environment file | Hidden from GET; managed write path |
| SMTP password | Environment or `AppSetting` | DB value supports `enc:v1` AES-256-GCM |
| Settings encryption keys | Environment | Current/previous rotation supported |
| API-client raw key | Returned once; SHA-256 hash stored | Serializer excludes `keyHash` |
| Webhook secret | `WebhookConfig.secret` | Plaintext and sent as static header |
| Auth.js OAuth/session tokens | Account/Session tables | Secret-bearing Prisma fields exist |
| Bootstrap token | Not implemented | Missing |

Forbidden response keys for the remediation test include `passwordHash`,
`password_hash`, OAuth tokens, session tokens, API key hashes, SMTP/Entra
secrets, webhook secrets, and encryption keys.

## Configuration-source precedence

- Next standalone local startup now explicitly loads the root `.env`.
- Docker Compose injects its declared environment values.
- Authentication runtime uses environment provider credentials.
- Login policy uses database setting, then last-known value on read failure,
  then explicit environment recovery, then secure/break-glass defaults.
- Branding uses database `branding_config` with typed defaults.
- SMTP host/user/from/security prefer database settings over environment.
- SMTP password prefers a non-placeholder environment password over the
  encrypted database password.
- Entra settings UI writes a managed environment file, while runtime still
  requires restart to consume provider configuration.
- Feature flags use `AppSetting` with code defaults.
- Attachments use environment-configured private storage and quota values.

Baseline inconsistencies: documented rate-limit variables were not wired to the
in-memory login limiter; Docker production defaults conflicted with safe public
deployment; there was no single installation record or setup state.

## Feature inventory

Implemented: local credentials, Entra OIDC, role/department ticket visibility,
ticket templates and snapshots, multi-assignee workflow, comments/internal
notes, SLA display, escalation, notifications, SMTP diagnostics and mail,
branding/assets, quick links, help center, API clients/external API, audit logs,
private attachments, basic webhooks, and seed/demo content.

Partially implemented or advertised beyond evidence:

- webhooks lacked SSRF protection, signatures, retries, delivery history, and UI;
- ticket viewer “presence” was stored on the business ticket row;
- first-run setup did not exist;
- attachment malware scanning/quarantine did not exist;
- distributed rate limiting and session revocation did not exist;
- optimistic ticket concurrency did not exist;
- health/readiness endpoints did not exist;
- production backup/restore automation and E2E coverage did not exist.

## Migration inventory

| Migration | Purpose observed |
|---|---|
| `20260223133234_init` | Initial PostgreSQL schema |
| `20260223133728_add_password_hash` | Local credential hash |
| `20260223140919_add_escalation_and_field_visibility` | Escalation and field visibility |
| `20260410120000_add_ticket_idempotency_key` | Requester idempotency |
| `20260720152500_add_queue_members_and_audit_user_agent` | Direct queue access and audit agent |
| `20260723150000_add_branding_department_categories_and_ticket_form_templates` | Branding and department form templates |
| `20260723170000_enforce_ticket_form_history` | Immutable ticket form history |
| `20260724120000_add_user_language_and_help_center` | Localization and help center |
| `20260724150000_harden_runtime_and_api_clients` | Runtime/API-client hardening |
| `20260727130000_add_multiple_ticket_assignees` | Co-assignee join model and backfill |

No setup installation, normalized email, session revocation, ticket version,
presence, outbox, attachment scan, withdrawal, or delivery-history migration
existed at baseline.

## Deployment inventory

- `Dockerfile`: multi-stage Node 24 Alpine build, non-root runtime, standalone
  Next output, persistent attachment directory. Migrations ran in the normal app
  startup command.
- `docker-compose.yml`: combined database/application deployment, persistent
  named volumes and DB health check. It used fixed `compdesk` credentials,
  published PostgreSQL to the host, and had no application health check.
- Standalone: `npm start` validated runtime, ran migrations and attachment
  migration, then started the standalone server.
- Reverse proxy: one Nginx example with company-specific names. No Caddy example.
- CI/security scanning: no GitHub workflow, E2E runner, dependency review,
  CodeQL, Gitleaks, or Trivy configuration was present.

## Findings reproduced

1. Company-specific `legacy customer`/`compdesk` strings in Compose, Nginx, docs, and legacy
   local-storage keys.
2. Fixed PostgreSQL username/password/database in Compose and publicly bound DB
   port.
3. Ticket GET writes `lockedBy`/`lockedAt` on `Ticket`, changing `updatedAt`.
4. Assignment service sets `firstResponseAt`; assignment is incorrectly treated
   as requester-facing first response.
5. Status transitions set resolved/closed timestamps but do not consistently
   clear stale timestamps on reopening.
6. Ticket mutations have no expected version and no 409 stale-write protection.
7. Escalation calls assignment mutation before its separate escalation
   transaction; the full operation is not atomic.
8. Ticket creation, replay, PATCH, and escalation return Prisma results with
   `requester: true` or `user: true`, allowing secret-bearing User fields.
9. Empty ticket PATCH payload is accepted by its validation schema.
10. USER ticket deletion and comment deletion permanently erase history.
11. Local login uses an in-memory rate-limit map.
12. JWTs have no session-version/security-change revocation check.
13. Email uniqueness is case-sensitive at the schema level; not every creation
    path is race-safe.
14. User-administration bodies are manually parsed rather than strict Zod DTOs.
15. Attachments trust browser MIME for several formats and lack quarantine,
    scanning status, malware interface, global/ticket quotas, uploader, and
    deletion audit.
16. Webhooks accept arbitrary URLs, follow fetch network resolution, use a
    static secret header, and have no outbox/retries/history.
17. External API treats empty allowed-queue IDs as global access and updates
    `lastUsedAt` on every request.
18. SMTP real-send reports From acceptance based mainly on promise resolution
    and does not expose safe accepted/rejected/message-ID details.
19. Quick-link settings are global and are not filtered for requester queue
    visibility before display.
20. Normal clickable table rows require an accessibility review.
21. Demo seed has known universal credentials, enables demo login information,
    and does not refuse production execution.
22. No first-run isolated setup wizard, installation record, bootstrap token,
    safe resume, demo cleanup, or setup recovery command exists.
23. Public license/security/contributing/threat/deployment/backup documents and
    GitHub templates are missing.
24. No health endpoints, setup E2E, clean-install CI, Docker build gate, or
    automated secret/company-reference scan exists.

## Findings not reproduced or already mitigated

- SMTP database passwords use authenticated AES-256-GCM with random nonces and
  current/previous key rotation support.
- Documented SMTP placeholder environment values are ignored.
- Private attachment path containment rejects traversal and private storage
  cannot be placed under `public`.
- SVG upload is rejected by current upload validation.
- Ticket search uses centralized role/department visibility before search.
- Multiple assignment uniqueness is database enforced and duplicate claims are
  idempotent.
- Entra diagnostics keep certificate validation and sanitize secrets.
- Branding public/admin responses are separated and the public response is
  typed.

## History and scan status

Current-tree company-reference scan was run and produced the findings above.
Git-history secret scanning, dependency audit, container scanning, clean Ubuntu
deployment, external-PostgreSQL installation, and previous-schema upgrade tests
remain release gates. Public history will not be rewritten automatically.

## Remediation phase file map

This table is appended as focused commits land.

| Phase | Commit | Files |
|---|---|---|
| Baseline inventory | `098338e` | `docs/audits/PUBLIC_RELEASE_BASELINE.md` |
| Deployment foundation and public files | `b4fc9f4` | Compose/Docker foundations, health routes, public project files, deployment/security documentation, and repository checks |
| Secure setup bootstrap | `8349920` | Isolated setup server and wizard, installation record migration, setup/recovery/demo scripts, setup deployment configuration, tests, and setup documentation |
| Safe API DTOs | `10ed6d8` | Central safe selectors/response assertion, ticket/user/external API serialization, strict update validation, and recursive secret-response tests |
| Ticket integrity and concurrency | `2ef0d5a` | Ticket presence, lifecycle timestamps, SLA policy, optimistic concurrency, atomic assignment/escalation, withdrawal/tombstones, migrations, tests, and documentation |
| Authentication and user hardening | `afeb9a7` | Distributed credential throttling, session revocation, normalized identities, atomic strict user administration, migration, tests, and documentation |
