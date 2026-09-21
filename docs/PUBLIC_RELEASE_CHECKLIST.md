# Public release checklist

This checklist records the release gates for **CompDesk v0.9.0-beta.2**.

## Required gates

- [x] `npm ci`
- [x] `npm audit` — 0 vulnerabilities
- [x] `npm audit --omit=dev` — 0 vulnerabilities
- [x] `npm run verify` — ESLint, TypeScript, 382 Jest tests, and the production build
- [x] `npx prisma validate`
- [x] Canonical, build, setup, legacy, and external-database Compose files parse successfully
- [x] Disposable bundled-PostgreSQL lifecycle test passes, including setup, restart persistence, recovery, and fail-closed checks
- [x] Runtime image contract passes as a non-root, read-only, network-isolated container
- [x] Repository hygiene and current-tree secret checks pass

Publication additionally requires green pull-request and main-branch CI, an exact release tag, a successful image build and scan, a beta.2-pinned Compose asset, and final anonymous-access checks. Those hosted checks are verified against GitHub at publication time rather than recorded as static repository state.

## Supported beta deployment

Docker Compose with the bundled PostgreSQL service is the supported beta topology. The repository includes other Compose variants for development and migration scenarios, but an externally managed PostgreSQL Compose deployment is not part of the supported beta path.

Use HTTPS for internet-facing deployments. Plain HTTP on a trusted private LAN is supported with graceful fallbacks for browser features that require a secure context.

## Known beta limitations

- Multi-replica deployments require shared attachment storage and coordinated configuration management.
- Malware scanning is optional and depends on a reachable ClamAV service.
- SMTP acceptance confirms handoff to the configured server, not delivery to a recipient mailbox.
- Administrators remain responsible for backups, TLS termination, host patching, and access to the Docker host.

Release-specific user-facing notes are in [`docs/releases/v0.9.0-beta.2.md`](releases/v0.9.0-beta.2.md).
