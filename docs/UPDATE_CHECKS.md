# Update awareness and assisted recovery

Administrators and Super Admins see updates in the existing sidebar version
footer and About dialog. Users and agents cannot access update-management UI
or update endpoints. About also contains a small administrator-only CompDesk
services section; CompDesk remains free and open source to self-host.

## Release metadata and privacy

The server fetches this XHydra-controlled public JSON manifest by default:

`https://raw.githubusercontent.com/TahaHydra/CompDesk/main/updates/manifest.json`

Publish `updates/manifest.json` on the public main branch before distributing
the checker. Release maintainers update it **after** publishing and verifying
the desired release/image and pinned Compose asset. The included manifest
describes the existing beta release; it does not announce an unpublished version.
This deliberately uses explicit release metadata instead of querying GitHub's
latest-release API (which can omit beta releases).

Required fields: strict SemVer `latest`, `severity` (`normal` or `critical`),
and an HTTPS `release_url` with no embedded credentials. Optional fields:
strict SemVer `minimum_supported`, RFC 3339 `published_at`, `summary` (up to
2,000 characters), and `upgrade_notes` (up to 6,000 characters). Unknown fields
are ignored. The whole response is limited to 16 KiB and a five-second timeout.
Invalid JSON, invalid fields, redirects, non-HTTPS sources, and HTTP failures
fail safely. Severity is never inferred from the version number or the minimum
supported version. SemVer precedence handles prereleases and ignores build metadata.

Release rehearsals use the separate test metadata in `updates/manifest.staging.json`.
Serve it over HTTPS and point a **test** installation at it with
`COMPDESK_UPDATE_MANIFEST_URL`; never change the production manifest before the
release is published and verified. See the [beta.4 development rehearsal record](audits/2026-10-06-beta4-rehearsal.md).

Operators may set `COMPDESK_UPDATE_MANIFEST_URL` to another trusted HTTPS
manifest in the server environment (or the Compose host environment). This is
host configuration, not an editable browser URL. Restart/recreate the app when
changing it; a cached result from another source is never reused.

An update check sends one HTTPS GET with `Accept: application/json` and no
request body, installed version, authentication credentials, user identifier,
tenant identifier, application URL, email, or other application data. The
source naturally sees the server's public IP address, request time, requested
manifest path, and ordinary HTTP client/TLS transport headers. There is no
telemetry. Browsers only call authenticated local CompDesk APIs; they do not
poll GitHub. Opening documentation, release notes, or service links navigates
the administrator's browser to the explicitly chosen site.

## Cache and preferences

No scheduler is installed: administrator reads of `/api/updates` trigger an
automatic check only when the shared 24-hour cache has expired. While the app
is open, the shared client query refreshes the local endpoint hourly and on
focus when stale. Idle installations do not send periodic requests.

The existing PostgreSQL `app_settings` table stores:

- `updates_cache`: source, last attempted check timestamp, success/unavailable
  status, and the last validated release manifest. Failures are cached for
  24 hours too, to avoid hammering an unavailable source. Previously valid
  metadata remains available with an explicit stale notice.
- `updates_automatic`: `true` or `false`; absent means enabled. Only Super
  Admin can change it through the existing settings API. Turning it off stops
  automatic external requests; explicit manual checks remain available.

The existing PostgreSQL rate limiter gates external requests globally to at
most one per minute, including concurrent replicas and manual refreshes.
`POST /api/updates` bypasses the 24-hour cache when that gate permits. A rapid
repeat reports that the administrator should wait one minute. No page reload
is required. When settings/cache cannot be read, the service fails closed
without an external request and reports unavailable; this feature does not
change the application's existing database requirements.

Collapse state is stored on each browser in localStorage under
`compdesk:update-dismissal:<encoded user ID>`, with the dismissed release
version as its value. It does not affect another account. It is browser-local
(not synchronized across devices); another tab updates through storage events.
When browser storage is blocked, collapse still works in memory for that
session. A newly released version expands again. Collapsed updates always
retain an accessible indicator, red for critical releases, including when the
whole desktop sidebar is collapsed.

## Permissions and assisted updates

ADMIN and SUPER_ADMIN can inspect updates, open release notes/documentation,
manually refresh the cache, collapse notices, and inspect health/recovery
information. ADMIN sees disabled privileged instructions with the explanation
"Super Admin privileges required". `GET /api/updates/instructions` independently
requires SUPER_ADMIN. Super Admin can additionally inspect/copy the assisted
host commands and configure automatic checking. There is no command execution
endpoint or one-click updater, no Docker daemon/socket access, no new container
privilege, and no automatic application update.

Follow [UPGRADING.md](UPGRADING.md) and [DEPLOY_DOCKER.md](DEPLOY_DOCKER.md):
create and verify a coordinated backup, rehearse the upgrade, obtain/review the
desired version-pinned Compose release asset (or deliberately change the exact
image version/digest), and preserve deployment-specific settings. Only then run
the displayed `docker compose pull` and `docker compose up -d` on the host.
Pulling the old pinned Compose file alone does not select a newer release.
Docker deployments apply migrations automatically before serving traffic.
Standalone or customized deployments follow their documented procedure.

## Real health and informational recovery

`GET /api/updates/health` is restricted to administrators and reuses
`readinessChecks()` for database, installation record, migrations, and private
attachment storage. Application liveness means the authenticated application
endpoint responded. Readiness failure displays "Not ready"; migration state
is "Current" only when the existing migration check succeeds, otherwise
"Unknown" (a false readiness result does not prove that migrations are pending).
These are point-in-time checks, not proof that an upgrade succeeded.

Installed version is real and comes from `APP_VERSION`. Previous installed
version and last successful deployment time are not tracked. The existing
host backup/restore scripts do not publish verified recovery records to the
application, so it always reports "No managed recovery point available".
This does not assert that the operator has no external backups.

An older image is not sufficient for rollback. Database migrations may make it
incompatible. A future managed recovery point would need coordinated database,
configuration and file backups, image/version identity, migration state, and
health/restore verification. There is no rollback button. Follow
[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) for verified restoration.
