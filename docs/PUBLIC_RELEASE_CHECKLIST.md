# Public release checklist

This checklist defines the release gates for the CompDesk version in `package.json`, written `<version>` below. Historical release notes remain available separately.

## Version handling

`package.json` is the only place the version is typed. The application footer, update checks and image verification read it (`src/lib/version.ts`); `src/__tests__/release-version.test.ts` fails CI if the lockfile, release note, update manifests or README disagree with it, and the image workflow refuses a tag that differs from it.

1. **Prepare:** `npm run release:prepare -- <version>` sets `package.json` and `package-lock.json` and creates `docs/releases/v<version>.md` if missing. Its first paragraph becomes the README and in-app update summary.
2. **Publish:** merge, tag `v<version>`, and let the image workflow publish and scan the image and pinned Compose asset.
3. **Announce, only once the release is public:** `npm run release:announce -- <version>` updates `updates/manifest.json` and `updates/manifest.staging.json`, the README current-release section, the upgrade-rehearsal boundary (`LATEST_RELEASE_MIGRATION`) and the release note title. Every installation reads the manifest from `main`, so announcing early would offer an update that does not exist yet.

## Required gates

- Clean locked dependency installation, including a production-only install.
- `npm audit --omit=dev` exits successfully with zero known production findings.
- Inspect the full `npm audit` and distinguish development-tool exposure from production dependencies. The existing [dependency assessment](audits/2026-10-03-beta3-dependencies.md) records the build-tool scope; do not claim the full audit is clean.
- `npm run verify` passes ESLint, TypeScript, the complete Jest suite and the production build.
- Prisma schema validation, fresh installation and previous-release migration rehearsal pass. `npm run test:migration:upgrade` rehearses both the historical upgrade path and an upgrade from the latest published release (`release:announce` moves that boundary).
- Canonical, build, setup, legacy, external-database and version-pinned Compose files parse successfully. Parsing is not a claim that the external topology is validated.
- Disposable bundled-PostgreSQL lifecycle and backup/restore checks pass.
- Runtime image remains non-root/read-only with bounded writable cache; build-only CSS/glob dependencies are absent.
- Readiness, attachments/privacy/restart persistence, Entra diagnostics and separate sign-in/linking protections pass.
- Repository hygiene and current-tree secret checks pass; local acceptance tools, overrides, tokens and backups remain excluded.

Publication additionally requires green main-branch CI/security checks (and pull-request checks when a PR is used), the exact `v<version>` tag on the merged source, a successful scan of the exact published image digest, a `<version>`-pinned Compose asset, and final anonymous-access checks. Those hosted checks are verified against GitHub at publication time rather than recorded as static repository state. Run `release:announce` only after the release, image and Compose asset are publicly available. Preserve historical releases and tags.

## Supported beta deployment

Docker Compose with the bundled PostgreSQL service is the supported beta topology. The repository includes other Compose variants for development and migration scenarios, but an externally managed PostgreSQL Compose deployment is not part of the supported beta path.

Use HTTPS for internet-facing deployments. Plain HTTP on a trusted private LAN is supported with graceful fallbacks for browser features that require a secure context.

## Known beta limitations

- Multi-replica deployments require shared attachment storage and coordinated configuration management.
- Malware scanning is optional and depends on a reachable ClamAV service.
- SMTP acceptance confirms handoff to the configured server, not delivery to a recipient mailbox.
- Administrators remain responsible for backups, TLS termination, host patching, and access to the Docker host.

Release-specific user-facing notes, one file per release, are in [docs/releases](releases/), with the [development rehearsal](audits/2026-10-06-beta4-rehearsal.md) recorded separately. Real Graph mailbox delivery and the broader multi-user browser checklist remain unverified; see [acceptance evidence](MULTIUSER_ACCEPTANCE_TESTING.md).
