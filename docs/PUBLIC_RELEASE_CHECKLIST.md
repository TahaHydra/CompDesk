# Public release checklist

Status values: `PASS`, `BLOCKED`, or `NOT RUN`. A release requires every
blocking item to be `PASS` for the exact final commit.

| Gate | Status | Evidence |
|---|---|---|
| Baseline inventory | PASS | `docs/audits/PUBLIC_RELEASE_BASELINE.md` |
| Secure isolated first-run setup | PASS | Isolated bootstrap server, token/session/CSRF controls, setup runner tests |
| Setup cannot be reused | PASS | Immutable installation record, 410 behavior, recovery guard, regression tests |
| Safe API DTOs and recursive secret tests | PASS | Central selectors/serializers and recursive forbidden-key tests |
| No fixed production database credentials | PASS | Required Compose variables |
| PostgreSQL not published by production Compose | PASS | No `db.ports` entry |
| Ticket GET read-only | PASS | Separate expiring presence records and regression tests |
| Optimistic ticket concurrency | PASS | Required expected version and 409 conflict responses |
| Atomic assignment/escalation | PASS | Transactional mutations/timeline with post-commit side effects |
| Correct SLA and status timestamps | PASS | Deterministic SLA restart and lifecycle timestamp regression tests |
| Distributed login throttling | PASS | PostgreSQL-backed account/source throttling with expiry and regression tests |
| Session revocation after security changes | PASS | Session version and credentials-changed validation with regression tests |
| Case-normalized email identity | PASS | Database trigger/unique identity, guarded migration, and linkage tests |
| History-preserving user actions | PASS | Ticket withdrawal, comment/attachment tombstones, and user deactivation |
| Attachment quarantine/scanning architecture | PASS | Content verification, optional fail-closed ClamAV, quotas, and deletion audit |
| Webhook SSRF/signatures/outbox | PASS | Public-only DNS pinning, encrypted HMAC secrets, durable retries/history, and regression tests |
| External API default-deny departments | PASS | Explicit allow-all policy, PostgreSQL throttling, full request audit, and regression tests |
| SMTP relay and secret management | PASS | Accepted/rejected/message-ID evidence, AES-GCM rotation tests, atomic locked single-source config writes |
| Quick-link access and UI accessibility | PASS | Effective department filtering, real ticket links, mobile keyboard semantics, reduced-motion regression tests |
| Current-tree customer-reference scan | PASS | Automated repository regression test enabled |
| Git-history secret scan | NOT RUN | Final security scan |
| Unit/integration tests | NOT RUN | Final commit required |
| Setup E2E tests | BLOCKED | Test framework pending |
| Production build | NOT RUN | Final commit required |
| Compose config and Docker build | NOT RUN | Final commit required |
| Dependency audit | NOT RUN | Final commit required |
| Secret/static/container scans | NOT RUN | Final commit required |
| Clean Ubuntu Docker installation | NOT RUN | Final deployment test |
| Clean external-PostgreSQL installation | NOT RUN | Final deployment test |
| Previous-schema upgrade | NOT RUN | Final migration fixture |

Until every blocking gate passes, keep the repository private and do not
describe CompDesk as production-ready.
