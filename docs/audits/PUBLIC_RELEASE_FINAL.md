# CompDesk public-release final assessment

Assessment date: 2026-07-30
Branch: `release/public-hardening`
Starting implementation: `06ccca0b08d44bc89c29c98dffb0a9016b93b69e`
Implementation under assessment: `2da454ff8202df1ef631262ffab88ecccd0ea6c4`

This document compares the repository with the findings captured in `PUBLIC_RELEASE_BASELINE.md`. It records observed evidence rather than making a production-readiness claim.

## Finding disposition

| # | Original finding | Result and exact remediation | Principal files | Proof |
|---:|---|---|---|---|
| 1 | Customer-specific branding, domains, database names, and defaults | Reproduced. Current tracked files use generic CompDesk/example values. A tracked-file regression test rejects the requested customer and model-vendor terms. Historical ancestors still contain deleted references; see blockers. | Compose files, deployment docs, seed, `src/__tests__/repository-hygiene.test.ts` | Repository hygiene tests; current-tree reference scan |
| 2 | Fixed production PostgreSQL credentials and public database port | Reproduced. Production Compose requires credentials, does not publish PostgreSQL, persists data, waits for health, and runs migrations once. Development exposure is loopback-only. | `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.external-db.yml` | Compose config validation; repository contract tests |
| 3 | Ticket GET changed `updatedAt` through a viewer lock | Reproduced. Viewer state moved to expiring multi-user `TicketPresence`; reads no longer alter business timestamps or authorize writes. | `prisma/schema.prisma`, `20260730170000_ticket_integrity_and_presence`, ticket presence route/service | `ticket-integrity.test.ts` |
| 4 | Assignment counted as a public first response | Reproduced. `firstAssignedAt` and `firstPublicResponseAt` are distinct; only a public staff response satisfies first-response SLA. | ticket service, ticket-integrity migration | Ticket integrity and comment authorization tests |
| 5 | Reopened tickets retained stale resolved/closed timestamps | Reproduced. Status lifecycle clears and re-establishes timestamps deterministically and records transitions. | ticket service and validation | Ticket integrity/status tests |
| 6 | Ticket mutations accepted stale state | Reproduced. Versioned optimistic writes require the expected version and return 409 with a safe refresh payload. | ticket mutation routes/services, ticket schema | Simultaneous mutation/conflict tests |
| 7 | Assignment/escalation could partially commit | Reproduced. Assignment, priority/escalation state, and timeline rows share a transaction; notification/webhook side effects occur post-commit. | assignment/escalation services and routes | Transaction rollback and concurrency tests |
| 8 | Raw Prisma relations could leak secret-bearing fields | Reproduced. Central safe selectors/DTOs replaced raw User and secret-bearing record responses; recursive response guards reject forbidden keys. | `src/lib/api-dto.ts`, ticket/user/API routes | `api-dto-security.test.ts` and route tests |
| 9 | Empty ticket PATCH was accepted | Reproduced. Strict validation rejects empty mutations. | ticket validation and PATCH route | API DTO/security tests |
| 10 | Routine ticket/comment deletion erased history | Reproduced. Requesters withdraw; conversations and attachments use audited tombstones; user removal defaults to deactivation. | ticket/comment/upload/user routes, ticket migration | Destructive-action and history tests |
| 11 | Local login limiter was process-local | Reproduced. PostgreSQL-backed hashed throttles cover account/source combinations, uploads, setup, and external API authentication with expiry. | `database-rate-limit.ts`, credential/auth routes, auth migration | Auth/user, upload, and external API hardening tests |
| 12 | Security changes did not revoke JWT sessions | Reproduced. Session version and credential-change time are embedded and revalidated; resets, deactivation, and security operations revoke old sessions. | Auth callbacks, user administration, auth migration | Session revocation tests |
| 13 | Email identity was case-sensitive and linking could duplicate users | Reproduced. Normalized identity is database-enforced with guarded duplicate detection; all creation/linking paths normalize. | Prisma schema, auth identity migration, Auth.js/user/setup/seed paths | Auth linking and duplicate-identity migration tests |
| 14 | User administration used loose bodies and non-atomic memberships | Reproduced. Strict Zod actions and transactions cover create/update/reset/role/activation/memberships; the last active Super Admin is protected. | user validation/routes/services | User hardening and authorization tests |
| 15 | Attachments trusted MIME and lacked quarantine/scanning/quotas | Reproduced. Signature/type verification, private quarantine, optional fail-closed ClamAV, scan status, race-safe quotas, restrictive files, safe download headers, and audited tombstones were added. SVG remains rejected. | attachment service/routes, attachment migration, setup/config | Attachment security/storage tests |
| 16 | Webhooks allowed SSRF and static unaudited delivery | Reproduced. Public-only DNS resolution and pinning, redirect refusal, timestamped HMAC signatures, unique delivery IDs, durable outbox/retry/history, timeout, manual retry, failure disablement, and encrypted secrets were added. | webhook service/routes, webhook migration | Webhook/API hardening tests |
| 17 | External API empty department scope meant global and wrote every use | Reproduced. Empty is default-deny, allow-all is explicit, user races are transactional, last-use writes are throttled, and every request is attributed/audited. | API-client service/routes, migration | Webhook/API hardening and authorization tests |
| 18 | SMTP real-send overstated sender/delivery success | Reproduced. The response reports safe accepted/rejected recipients, relay response and message ID, rejects a fully rejected send, and states that relay acceptance is not final delivery. | SMTP settings/test routes and UI | Email delivery and Phase 3 SMTP tests |
| 19 | Ticket-form quick links ignored effective access | Reproduced. Server-derived visible departments filter links for each role; invalid routing remains server-rejected. | branding/quick-link services and dashboard | Settings wiring/search/dashboard tests |
| 20 | Clickable rows and settings/mobile states needed accessibility review | Reproduced. Ticket rows use links; controls have labels and actionable errors; mobile navigation exposes state, supports Escape, and respects reduced motion. | ticket lists, settings components, mobile navigation | Browser interaction and release UI accessibility tests |
| 21 | Seed used universal credentials and could run in production | Reproduced. Production seeding refuses without explicit override, passwords are random unless deliberately supplied, demo records are marked/removable, and setup demo mode defaults off. | `prisma/seed.ts`, setup/demo removal scripts, docs | Seed and setup runner contract tests |
| 22 | No secure pre-database first-run system | Reproduced. An isolated bootstrap server implements loopback-first one-time token/session/CSRF/rate limits, ten validated steps, safe resumability, atomic restricted secrets, migrations, first Super Admin, immutable completion record, and guarded local recovery. | setup scripts/UI/Compose, installation migration | Setup core/runner tests and Playwright setup E2E |
| 23 | Public licensing, security, contribution, threat, deployment, and backup files were absent | Reproduced. Required project, platform, hardening, threat, backup, upgrade, permission, and repository-template files were added and the README was rewritten against runtime behavior. | `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/`, `.github/` | Public repository and deployment contract tests |
| 24 | No health, E2E, clean-install CI, Docker, or security scan gates | Reproduced. Safe liveness/readiness, Playwright bootstrap E2E, clean npm/migration/build jobs, Compose/image jobs, dependency review, Gitleaks, CodeQL, and Trivy workflows were added. | health routes, `playwright.config.ts`, `e2e/`, CI/security workflows | Local verify/E2E/Compose scans; remote jobs listed below |

## Migrations added

| Migration | Purpose | Upgrade behavior |
|---|---|---|
| `20260730123000_add_installation_record` | Immutable setup completion and demo marker | Existing active Super Admin installations receive one legacy completion row |
| `20260730170000_ticket_integrity_and_presence` | Version, first assignment, viewer presence, deletion evidence, withdrawn state | Backfills first assignment and preserves legacy lock columns |
| `20260730200000_auth_identity_hardening` | Normalized identity, session revocation, distributed throttles | Aborts with a named normalized identity if ambiguous case variants exist |
| `20260730213000_attachment_security` | Uploader, detected type, hash, scan/quarantine and deletion state | Preserves existing attachment rows and adds explicit status |
| `20260730230000_webhook_api_hardening` | Delivery outbox/history and explicit external API allow-all | Existing empty API-client department lists remain denied |

`npm run test:migration:upgrade` creates a random disposable PostgreSQL database, applies migrations only through the previous release, inserts realistic users/department/template/category/ticket/assignment rows, applies the remaining migrations, verifies preserved/normalized/backfilled data, and drops the database. It refuses to substitute the normal application URL when `MIGRATION_TEST_DATABASE_URL` is absent.

## Verification results

| Gate | Result | Evidence |
|---|---|---|
| Clean dependency install | PASS | `npm ci`; 823 packages installed; Prisma Client generated |
| Lint, type checking, Jest, production build | PASS | `npm run verify`; 42 suites and 342 tests; Next.js 15.5.22 build completed |
| Setup browser E2E | PASS | `npm run test:e2e`; Chromium, 1/1 passed |
| Production dependency audit | PASS | `npm audit --omit=dev`; zero vulnerabilities |
| Full development dependency audit | RISK ACCEPTANCE REQUIRED | 33 high findings are confined to Jest/ESLint transitive glob matchers; production dependencies are clean and the final runtime image omits development dependencies. No incompatible override was forced. |
| Compose validation | PASS | Main, external-PostgreSQL, and setup topologies passed `docker compose ... config --quiet` |
| Docker image build | BLOCKED LOCALLY | Docker 29.2.1 client exists, but the Desktop Linux engine pipe is absent. CI is configured to build without cache. |
| Empty-database migration | PASS IN LOCAL DEVELOPMENT / CI GATE ADDED | Existing Prisma migration contract tests pass; CI applies all migrations to an empty PostgreSQL 16 service. |
| Previous-release realistic upgrade | BLOCKED LOCALLY / CI GATE ADDED | Rehearsal script is implemented; local PostgreSQL at port 5433 refused connection. CI runs the disposable database rehearsal. |
| Current public-tree secret scan | PASS | Gitleaks 8.30.1 scanned 1.52 MB with zero leaks; staged scan also found zero leaks |
| Full Git-history secret scan | PASS | Gitleaks 8.30.1 scanned 48 commits / 2.97 MB with zero leaks |
| Current-tree customer/model-vendor reference scan | PASS | No matches outside the encoded regression test; 342-test run includes the tracked-file gate |
| Static/container security analysis | PENDING REMOTE EVIDENCE | CodeQL and Trivy jobs are configured; results must pass on the final commit |
| Clean Ubuntu bundled-PostgreSQL installation | NOT RUN | Requires a clean Ubuntu 22.04/24.04 host or completed CI installation workflow |
| Clean Ubuntu external-PostgreSQL installation | NOT RUN | Requires a clean Ubuntu host and dedicated PostgreSQL 16 test service |
| Restore rehearsal | NOT RUN | Backup structure tests pass, but no isolated full PostgreSQL/files/config restore was performed here |

## Sanitized integration observations

- The SMTP diagnostic correctly categorized the configured provider response as authentication rejection and returned a correlation ID without returning the password. This is evidence that the diagnostic path works, not evidence that the mailbox credentials are correct.
- SMTP connection verification explicitly cannot prove From acceptance; real-send reports only whether the relay accepted or rejected recipients and does not claim mailbox delivery.
- Entra diagnostics build the tenant-specific metadata URL and expected callback from the running configuration, categorize nested DNS/TCP/TLS/timeout/HTTP/metadata failures, and redact provider secrets. Automated reachable/unreachable/malformed cases pass; no claim is made here about a production tenant.

## Remaining blockers and risks

1. Older ancestor commits contain deleted customer-specific references, and two ancestors contain the prohibited model-vendor reference. The current branch tree is clean, but a truly clean public history requires a coordinated repository-history rewrite, collaborator notification, branch/tag replacement, and fresh-clone verification. This was not performed because the task explicitly forbids automatic public-history rewriting and force-pushes.
2. The exact production image has not been built or scanned locally because no Docker engine is running. Remote Docker/Trivy results must pass.
3. No clean Ubuntu end-to-end installation has completed for either database topology.
4. The realistic previous-release upgrade job must pass against PostgreSQL 16 in CI; the local host had no reachable disposable PostgreSQL service.
5. A full isolated restore rehearsal has not been completed.
6. Development-only dependency advisories remain in tooling. They are excluded from the production image, but maintainers should upgrade the Jest/ESLint ecosystem when compatible releases are available.
7. ClamAV, SMTP delivery, Entra tenant behavior, reverse-proxy headers, and durable storage still depend on operator infrastructure and must be verified in the target environment.

## Unsupported or deliberately limited

- Databases other than PostgreSQL are unsupported. PostgreSQL 16.x is the tested release target.
- A configured ClamAV service is optional; deployments must adopt an explicit policy for files whose scanner status is not clean.
- SMTP relay acceptance is not delivery confirmation.
- Multi-replica deployments require shared durable uploads/private attachment storage and a single migration job.
- No automatic customer-history rewrite, database reset, TLS bypass, or destructive rollback is provided.

## Final verdict

**BLOCKED**

The implementation and local application gates are substantially hardened and green, but the public-release acceptance criteria are not all satisfied. Keep the repository private and do not describe this commit as production-ready until the history decision, remote Docker/CodeQL/Trivy jobs, clean Ubuntu installations, realistic upgrade, and restore rehearsal have documented passing evidence.