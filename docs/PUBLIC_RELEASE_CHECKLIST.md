# Public release checklist

This checklist defines the release gates for **CompDesk v0.9.0-beta.4**. Historical release notes remain available separately.

## Required gates

- Clean locked dependency installation, including a production-only install.
- `npm audit --omit=dev` exits successfully with zero known production findings.
- Inspect the full `npm audit` and distinguish development-tool exposure from production dependencies. The existing [dependency assessment](audits/2026-10-03-beta3-dependencies.md) records the build-tool scope; do not claim the full audit is clean.
- `npm run verify` passes ESLint, TypeScript, the complete Jest suite and the production build.
- Prisma schema validation, fresh installation and previous-release migration rehearsal pass.
- Canonical, build, setup, legacy, external-database and beta.4-pinned Compose files parse successfully. Parsing is not a claim that the external topology is validated.
- Disposable bundled-PostgreSQL lifecycle and backup/restore checks pass.
- Runtime image remains non-root/read-only with bounded writable cache; build-only CSS/glob dependencies are absent.
- Readiness, attachments/privacy/restart persistence, Entra diagnostics and separate sign-in/linking protections pass.
- Repository hygiene and current-tree secret checks pass; local acceptance tools, overrides, tokens and backups remain excluded.

Publication additionally requires green main-branch CI/security checks (and pull-request checks when a PR is used), the exact `v0.9.0-beta.4` tag on the merged source, a successful scan of the exact published image digest, a beta.4-pinned Compose asset, and final anonymous-access checks. Those hosted checks are verified against GitHub at publication time rather than recorded as static repository state. Announce beta.4 in the update manifest only after the release, image and Compose asset are publicly available. Preserve historical beta.1/beta.2/beta.3 releases and tags.

## Supported beta deployment

Docker Compose with the bundled PostgreSQL service is the supported beta topology. The repository includes other Compose variants for development and migration scenarios, but an externally managed PostgreSQL Compose deployment is not part of the supported beta path.

Use HTTPS for internet-facing deployments. Plain HTTP on a trusted private LAN is supported with graceful fallbacks for browser features that require a secure context.

## Known beta limitations

- Multi-replica deployments require shared attachment storage and coordinated configuration management.
- Malware scanning is optional and depends on a reachable ClamAV service.
- SMTP acceptance confirms handoff to the configured server, not delivery to a recipient mailbox.
- Administrators remain responsible for backups, TLS termination, host patching, and access to the Docker host.

Release-specific user-facing notes are in [beta.4 changes and upgrade notes](releases/v0.9.0-beta.4.md), with the [development rehearsal](audits/2026-10-06-beta4-rehearsal.md) recorded separately. Real Graph mailbox delivery and the broader multi-user browser checklist remain unverified; see [acceptance evidence](MULTIUSER_ACCEPTANCE_TESTING.md).
