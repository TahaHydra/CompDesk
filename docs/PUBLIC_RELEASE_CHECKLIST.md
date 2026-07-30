# Public release checklist

Status values are `PASS`, `BLOCKED`, or `NOT RUN`. A release requires every blocking item to be `PASS` for the exact final commit.

| Gate | Status | Evidence |
|---|---|---|
| Baseline inventory | PASS | `docs/audits/PUBLIC_RELEASE_BASELINE.md` |
| Secure isolated first-run setup | PASS | Isolated bootstrap server, token/session/CSRF controls, setup runner tests |
| Setup cannot be reused | PASS | Immutable installation record, 410 behavior, recovery guard, regression tests |
| Safe API DTOs and recursive secret tests | PASS | Central selectors/serializers and recursive forbidden-key tests |
| No fixed production database credentials | PASS | Required Compose variables and repository contracts |
| PostgreSQL not published by production Compose | PASS | No production database `ports` entry |
| Ticket GET read-only | PASS | Separate expiring presence records and regression tests |
| Optimistic ticket concurrency | PASS | Required expected version and 409 conflict responses |
| Atomic assignment/escalation | PASS | Transactional state/timeline with post-commit side effects |
| Correct SLA and status timestamps | PASS | Deterministic SLA restart and lifecycle timestamp tests |
| Distributed login throttling | PASS | PostgreSQL-backed account/source throttles with expiry |
| Session revocation after security changes | PASS | Session version/credentials-change validation tests |
| Case-normalized email identity | PASS | Database trigger/unique identity, guarded migration, linkage tests |
| History-preserving user actions | PASS | Withdrawal, comment/attachment tombstones, deactivation |
| Attachment quarantine/scanning architecture | PASS | Type verification, optional fail-closed ClamAV, quotas, deletion audit |
| Webhook SSRF/signatures/outbox | PASS | Public-only DNS pinning, encrypted HMAC, durable retry/history tests |
| External API default-deny departments | PASS | Explicit allow-all, throttling, request audit tests |
| SMTP relay and secret management | PASS | Recipient/relay evidence, AES-GCM, locked atomic single-source config |
| Quick-link access and UI accessibility | PASS | Effective department filtering, links, mobile keyboard semantics |
| Current-tree customer/model-vendor scan | PASS | Encoded tracked-file regression gate; no current matches |
| Full Git-history secret scan | PASS | Gitleaks 8.30.1: 48 commits, zero leaks |
| Historical forbidden-reference removal | BLOCKED | Ancestor references require an approved coordinated history rewrite |
| Clean dependency install | PASS | `npm ci` completed and Prisma generated |
| Unit/integration tests | PASS | 42 suites, 346 tests |
| Setup E2E tests | PASS | Playwright Chromium 1/1 |
| Production build | PASS | Next.js 15.5.22 optimized build |
| Compose configuration | PASS | Main, external database, and setup files validate |
| Docker image build | PASS | CI run `30562028485` completed a no-cache production image build; local engine unavailable |
| Production dependency audit | PASS | `npm audit --omit=dev`: zero vulnerabilities |
| Full development dependency audit | BLOCKED | 33 development-tool findings require compatible upstream upgrades/risk decision |
| Secret scan | PASS | Current public files, staged diff, and full history: zero Gitleaks findings |
| CodeQL/container scan | BLOCKED | Run `30562028445`: Gitleaks and Trivy PASS; one reviewed API-token digest CodeQL item remains |
| Clean Ubuntu Docker installation | NOT RUN | Clean host required |
| Clean external-PostgreSQL installation | NOT RUN | Clean host and dedicated PostgreSQL 16 required |
| Previous-schema realistic upgrade | PASS | CI PostgreSQL 16 rehearsal applied previous schema/data and verified the upgrade |
| Full restore rehearsal | NOT RUN | Isolated restore target required |

**Release verdict: BLOCKED.** Keep the repository private and do not describe CompDesk as production-ready until every blocking gate passes.
