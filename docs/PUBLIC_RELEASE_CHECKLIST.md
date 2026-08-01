# Public release checklist

Status values are `PASS`, `BLOCKED`, or `NOT RUN`. This checklist separates
three different bars, because they are not the same gate:

- **Beta gates** — required before publishing `v0.9.0-beta.1` as a public
  beta (repository visibility, evaluation/testing use).
- **Stable v1.0.0 gates** — required before describing CompDesk as
  production-hardened/stable, in addition to everything in the beta section.
- **Recommended cleanup** — real findings that do not block either release,
  tracked so they aren't lost.

Re-evaluated 2026-08-01 against the `release/xhydra-branding-beta` branch,
with fresh evidence gathered for every item below (not carried over from the
prior assessment without re-checking). Superseded findings are marked as such.

## Beta gates (`v0.9.0-beta.1`)

| Gate | Status | Evidence |
|---|---|---|
| Repository visibility decision before the public beta launch | **BLOCKED** | The repository is currently **private** (`gh repo view` → `isPrivate: true`). History reachable from `origin/main` contains: (a) the original pre-rebrand client-specific product name, default credentials, and domain in early commits (`5ac75d8`, `c8aec35`, `138d3d1`, others — see `src/__tests__/repository-hygiene.test.ts` for the exact encoded, non-tracked terms it checks for), and (b) the repository author's real employer email address on commit metadata across the same history. This is not exposed today because the repo is private, but going public without a decision here would expose it. This is a decision for the repository owner (business/professional, not just technical) — see "Remaining blockers" below. |
| Full development-dependency audit | **PASS (re-evaluated; was 33 findings, now 1)** | Fresh `npm audit` (2026-08-01): 1 high-severity finding (`brace-expansion`, transitive via `@eslint/eslintrc`→`minimatch` and `eslint-config-next`→`typescript-eslint`→`minimatch`), fix available. `npm audit --omit=dev`: 0 vulnerabilities. `brace-expansion` is dev-tooling only (lint/typecheck), absent from the production image (`Dockerfile` installs `npm ci --omit=dev --ignore-scripts` for the runtime stage). Does not block beta or production. The prior "33 findings" figure is stale — dependency updates since 2026-07-30 (date-fns, react-hook-form, several `@radix-ui` packages, etc.) already resolved the rest. |
| Static/container security analysis — CodeQL review item | **PASS (documented in-source exception)** | `src/lib/api-clients.ts` lines 45-51: `js/insufficient-password-hash` on a SHA-256 lookup digest of a 192-bit CSPRNG bearer token (not a human password). An in-source suppression comment (`// codeql[js/insufficient-password-hash]`) sits immediately above the flagged line, matching the exact format `scripts/check-sarif.mjs`'s `hasExactSourceSuppression()` requires. This has not been re-confirmed against a fresh GitHub-hosted CodeQL run for this exact branch (that happens automatically once this branch is pushed and the `security.yml` workflow runs) — treat as PASS pending that automatic confirmation, not as fully closed. Does not block beta: the underlying code pattern is not a real weakness (see code comment for the entropy/threat-model rationale). |
| Full isolated PostgreSQL/files/config restore rehearsal | **PASS (newly executed 2026-08-01)** | Ran for real: isolated Postgres container + isolated Node/postgresql-client runner container (own Docker network, no shared state with any other stack) → `npm run db:migrate:prod` → seeded a marker row → `npm run backup` → `node scripts/verify-backup.mjs` → `npm run backup:rehearse` against a disposable temp database. Output: `Isolated PostgreSQL, attachment, upload, configuration, and optional CA restore rehearsal passed.` This directly closes the prior "NOT RUN" gap. |
| Standard Compose deployment (bundled PostgreSQL) | **PASS** | Built and ran the unified `docker-compose.yml` + `docker-compose.build.yml` stack in an isolated project (`compdesk-release-test`, own port/volumes) — full setup wizard, login, ticket create/assign/reply/attachment/close/reopen, container restart with data persistence, all confirmed live. Containers run Linux (Alpine) regardless of the Windows Docker Desktop host. A genuinely separate GitHub-hosted `ubuntu-latest` run happens automatically once this branch is pushed (`ci.yml`'s `docker`/`validate`/`setup-e2e`/`backup-restore` jobs); historical CI run `30562028485` already exercised this successfully on `ubuntu-latest` for the pre-beta codebase. |
| External PostgreSQL Compose topology | **BLOCKED — do not advertise as supported** | Newly discovered, reproduced live: `docker-compose.external-db.yml`'s `app` service never starts against a real external PostgreSQL host. `scripts/orchestrator.mjs` waits for TCP on `COMPDESK_DB_HOST`/`COMPDESK_DB_PORT`, defaulting to `db:5432` (the unified stack's internal service name) when unset; `docker-compose.external-db.yml` never sets either variable, so the `app` container hangs waiting for a host that doesn't exist in that topology. The `migrate` service in the same file bypasses the orchestrator (runs `prisma migrate deploy` directly), so migrations can succeed while `app` never becomes healthy — easy to miss. README and `docs/DEPLOY_DOCKER.md` updated to describe this as a known issue rather than a supported beta path. Fixing it (deriving `COMPDESK_DB_HOST`/`COMPDESK_DB_PORT` from `DATABASE_URL` when unset, or having the compose file set them explicitly) is real but out of scope for this branding/audit pass — tracked as follow-up. |
| Jest suite | **PASS** | 346/346 (was 345/346). The one failure was a test bug, not a Compose bug: the assertion used a literal `\n` while the repository's tracked files (including this test file itself) consistently use CRLF; `docker-compose.setup.yml`'s formatting was already correct and consistent with the rest of the repo. Fixed by normalizing line endings before the string match in `src/__tests__/deployment-engineering.test.ts`. |
| Lint, type checking, production build | PASS | `npm run lint` (0 warnings), `npm run typecheck`, `npm run build` (31 routes) |
| Stale `v1.0.0-rc1` tag | **Confirmed harmless, recommend deleting before tagging the beta** | `gh api repos/TahaHydra/CompDesk/releases` → `[]` (no GitHub Release ever created from it). `gh run list --workflow=publish-image.yml` → no runs ever. The only workflow that publishes to GHCR has never executed, so no image or package was ever published under this tag. Deletion command prepared, not executed (see below). |

## Stable v1.0.0 gates (beyond beta)

| Gate | Status | Evidence |
|---|---|---|
| Coordinated git-history rewrite to remove the client-specific/model-vendor references and author-email exposure | NOT RUN | Requires collaborator notification, branch/tag replacement, and fresh-clone verification before any public visibility change is treated as permanent. Not attempted here — no automatic rewrite or force-push was performed, per standing instruction. |
| Clean Ubuntu bundled-PostgreSQL installation on a genuinely fresh host | NOT RUN | No fresh (non-Docker-Desktop-on-Windows) Ubuntu host was available in this session. GitHub-hosted `ubuntu-latest` CI runners cover the Docker path (see beta gates); the non-Docker standalone-on-Ubuntu path (`docs/DEPLOY_UBUNTU.md`) has not been independently rehearsed end-to-end. |
| External PostgreSQL topology fix + validation | BLOCKED | See beta gates — this needs an actual code fix (not just documentation) before it can be promoted from "known issue" to "supported." |
| Full development-dependency upgrade (`brace-expansion` and transitive chain) | Recommended, not blocking | Real fix exists (`npm audit fix`) but its dry-run pulls in unrelated version bumps (`react-hook-form`, `date-fns`, several `@radix-ui` packages) beyond the one advisory; deferred to a dedicated dependency-upgrade pass rather than bundling into this branch. |

## Recommended cleanup (neither beta nor stable-v1 blocking)

- Reconcile `SETUP_PUBLIC_HOST` (used in `docs/FIRST_RUN_SETUP.md`) vs `SETUP_PUBLIC_ORIGIN` (used in `scripts/setup-bootstrap.mjs`) naming.
- Add real screenshots to the README (placeholder section added in this branch).
- Add a GHCR/Docker badge to the README once a tag actually publishes an image.

## Remaining blockers and risks (carried forward, re-evaluated)

1. **Repository visibility / history exposure (beta-relevant business decision).** The private repository's history — already reachable from `origin/main` — contains the pre-rebrand client name/credentials and the author's real employer email address on commit metadata. This is a decision for the repository owner: whether to (a) do a coordinated history rewrite before any visibility change, (b) accept the exposure, or (c) keep the repository private for this beta and revisit before a public stable release. This is not purely a technical risk — it may have professional/employer implications for the author — so no rewrite was performed automatically.
2. **External PostgreSQL topology is broken as shipped**, not merely unvalidated (see beta gates table). Do not advertise it as a supported beta deployment path.
3. Development-only dependency advisories (now just one: `brace-expansion`) remain in lint/typecheck tooling; production dependencies and the production image scan are clean.
4. Clean Ubuntu end-to-end installation (both DB topologies) has not completed on a genuinely fresh host in this session; CI already covers the Docker path on GitHub-hosted `ubuntu-latest` runners.
5. ClamAV, SMTP delivery, Entra tenant behavior, reverse-proxy headers, and durable storage still depend on operator infrastructure and must be verified in the target environment.

## Unsupported or deliberately limited

- Databases other than PostgreSQL are unsupported. PostgreSQL 16.x is the tested release target.
- A configured ClamAV service is optional; deployments must adopt an explicit policy for files whose scanner status is not clean.
- SMTP relay acceptance is not delivery confirmation.
- Multi-replica deployments require shared durable uploads/private attachment storage and a single migration job.
- External PostgreSQL is documented but not currently functional — see beta gates.
- No automatic customer-history rewrite, database reset, TLS bypass, or destructive rollback is provided.

## Verdict

**READY FOR PUBLIC BETA WITH DOCUMENTED LIMITATIONS** for `v0.9.0-beta.1`, using the recommended bundled-PostgreSQL Docker Compose path, **conditional on** the repository owner making an explicit, informed decision about the git-history exposure described above before changing repository visibility to public. External PostgreSQL is a known-broken, documented limitation, not a beta blocker for the bundled-PostgreSQL path.

**NOT READY FOR v1.0.0 stable** — see the stable-v1 gates table.
