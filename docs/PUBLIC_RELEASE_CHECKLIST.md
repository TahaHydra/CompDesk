# Public release checklist

Status values: `PASS`, `BLOCKED`, or `NOT RUN`. A release requires every
blocking item to be `PASS` for the exact final commit.

| Gate | Status | Evidence |
|---|---|---|
| Baseline inventory | PASS | `docs/audits/PUBLIC_RELEASE_BASELINE.md` |
| Secure isolated first-run setup | BLOCKED | Implementation pending |
| Setup cannot be reused | BLOCKED | Implementation pending |
| Safe API DTOs and recursive secret tests | BLOCKED | Remediation pending |
| No fixed production database credentials | PASS | Required Compose variables |
| PostgreSQL not published by production Compose | PASS | No `db.ports` entry |
| Ticket GET read-only | BLOCKED | Remediation pending |
| Optimistic ticket concurrency | BLOCKED | Remediation pending |
| Atomic assignment/escalation | BLOCKED | Remediation pending |
| Correct SLA and status timestamps | BLOCKED | Remediation pending |
| Distributed login throttling | BLOCKED | Remediation pending |
| Session revocation after security changes | BLOCKED | Remediation pending |
| Case-normalized email identity | BLOCKED | Remediation pending |
| History-preserving user actions | BLOCKED | Remediation pending |
| Attachment quarantine/scanning architecture | BLOCKED | Remediation pending |
| Webhook SSRF/signatures/outbox | BLOCKED | Remediation pending |
| External API default-deny departments | BLOCKED | Remediation pending |
| Current-tree customer-reference scan | PASS | Automated test pending |
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
