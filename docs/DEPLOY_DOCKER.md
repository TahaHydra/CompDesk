# Docker Compose deployment

After downloading the version-pinned `docker-compose.yml` asset from the
[GitHub Release](https://github.com/TahaHydra/CompDesk/releases) you intend to
install, start the deployment from that file's directory:

```bash
docker compose up -d
```

Then read the clearly boxed bootstrap token from `docker compose logs compdesk` and open `http://localhost:3000/setup` in a browser. Complete the wizard, and the same container automatically switches itself from first-run setup to production — no second command, no manual restart, and no Node.js, npm, Git, or local build.

## What you need

- Docker Desktop (Windows, macOS) or Docker Engine with the Compose plugin (Linux).
- A DNS name and HTTPS reverse proxy for anything beyond local/loopback use.

## Getting `docker-compose.yml`: release asset vs. source tree

There are two ways to get the Compose file, and they behave differently on purpose:

- **A release asset, downloaded from a [GitHub Release](https://github.com/TahaHydra/CompDesk/releases)** — this copy has the exact released version baked in as a literal image reference. `docker compose up -d` works immediately, with no environment variable to set.
- **The `docker-compose.yml` in a `git clone` of this repository** — this is the general-purpose source file every release is generated from. It defaults to a placeholder version (`0.0.0-local`) that is never actually published, specifically so [local development](#local-development-build) works with zero setup. Running it as-is against a real deployment without pinning a version will cleanly fail to pull an image (see [Troubleshooting](#troubleshooting)) rather than silently doing the wrong thing.

## First installation

1. Download `docker-compose.yml` from the release you intend to run (see above).
2. Start the stack:

   ```bash
   docker compose up -d
   ```
3. Read the one-time bootstrap token from the compact box printed once in the container log:

   ```bash
   docker compose logs --tail=50 compdesk
   ```
4. Open `http://localhost:3000/setup`, paste the token, and complete all ten steps. When you submit the final step you'll see **"Installation complete. CompDesk is starting."** The page polls automatically and redirects itself to the sign-in page once production is ready — usually a few seconds. Nothing further to run.

The token expires after 30 minutes and exists only in the running setup process. If it expires, restart the uninstalled application container and read the newly generated token:

```bash
docker compose restart compdesk
docker compose logs --tail=50 compdesk
```

Restarting cannot create multiple simultaneously valid tokens: stopping the setup process invalidates its in-memory token before the replacement process starts.

If instead you're working from a `git clone` (for example, to test a change before a release exists), pin a real published version the same way:

```bash
echo "COMPDESK_VERSION=1.0.0" > .env   # use a real published version, not this placeholder
docker compose up -d
```

## Local development build

Building from source needs no environment variable at all — `docker-compose.build.yml` layers `build:` on top of the source tree's placeholder version:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

This never pulls from a registry (the `build:` override always wins), and tags the local result `ghcr.io/tahahydra/compdesk:0.0.0-local`.

For this source-build form, retrieve the setup token with the matching Compose files:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml logs --tail=50 compdesk
```

## Opening setup locally or on a remote server

The canonical stack publishes `${APP_BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-3000}`. With defaults:

- **Docker on your local machine:** open `http://localhost:3000/setup`.
- **Remote Linux server reached over SSH:** keep the safe loopback default and create a tunnel:

  ```bash
  ssh -L 3000:127.0.0.1:3000 user@server
  ```

  Keep that SSH session open, then open `http://localhost:3000/setup` on your own computer. Replace both `3000` values consistently if you configured another `APP_PORT`.
- **Intentional private-LAN access:** after applying appropriate host firewall rules, you may publish on all interfaces for that LAN session:

  ```bash
  APP_BIND_ADDRESS=0.0.0.0 docker compose up -d
  ```

  This is not a recommendation for direct Internet exposure. Public deployments must stay behind an HTTPS reverse proxy using the reviewed configuration described below.

## What happens automatically (setup → production transition)

The stack has three services, all sharing one prebuilt image:

- **`config-init`** — runs once, fixes ownership on the persistent volumes, and generates the PostgreSQL bootstrap password the first time (never on a rerun, never when the database already holds data it doesn't recognize — see [Troubleshooting](#troubleshooting)).
- **`db`** — PostgreSQL, consuming its password from a file (never a plaintext environment variable) written by `config-init`.
- **`compdesk`** — the single public container. It serves the setup wizard on port 3000 until you finish it, then runs database migrations, runs the private-attachment migration, and starts the production server — in the same process, on the same port. This is why no second Compose command is ever needed.

## Normal start and stop

```bash
docker compose stop     # stop without losing anything
docker compose start    # start it again
```

or, equivalently:

```bash
docker compose down     # never add -v here — that deletes the database
docker compose up -d
```

Re-running `docker compose up -d` against an already-running, already-installed stack is a no-op: it does not recreate containers, rerun setup, or regenerate credentials.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Back up first (see below). Any pending database migrations bundled with the new image are applied automatically before the application starts serving traffic — a failed migration blocks the container from ever becoming ready (see [Troubleshooting](#troubleshooting)), instead of starting a stale or half-migrated application.

## Backup and restore

A complete recovery set now includes the `compdesk_config` volume (it holds the PostgreSQL password, the installation receipt, and — after setup completes — the runtime configuration and secrets that used to live in `.compdesk/compdesk.env`), alongside `compdesk_pgdata`, `compdesk_uploads`, and `compdesk_attachments`. See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) for exact commands.

## Reset

`node scripts/docker-reset.mjs` permanently deletes the CompDesk PostgreSQL, uploads, attachments, **and configuration/secrets** volumes, any leftover containers/networks for the current or legacy project, and the generated `.compdesk/` directory (if one still exists from a migrated legacy install). It requires typed confirmation unless `--yes` is passed, never runs automatically, and only requires Node.js and Docker — not `npm install`. It is for development/test environments, not for resetting a production installation.

## Windows (Docker Desktop)

Use the WSL2 backend. Health checks are tuned with a generous 120-second start period to accommodate slower disk and container scheduling than native Linux. Everything above applies unchanged; run the commands from PowerShell, Windows Terminal, or WSL.

## Linux

Install Docker Engine and the Compose plugin per [Docker's documentation](https://docs.docker.com/engine/install/). No additional configuration is required beyond what's described above.

## macOS

Docker Desktop for Mac. Behavior is identical to Linux; only local development (not production hosting) is expected on macOS — see [DEVELOPMENT_MACOS.md](DEVELOPMENT_MACOS.md).

## Reverse proxy and TLS

CompDesk binds to `127.0.0.1:3000` by default (`APP_BIND_ADDRESS`/`APP_PORT` override the host binding). Put Nginx or Caddy in front for HTTPS; reviewed examples are in `deploy/nginx/compdesk.conf` and `deploy/caddy/Caddyfile`. When setup itself is reached through that proxy, set `SETUP_PUBLIC_ORIGIN` to its exact HTTPS origin. Set `SETUP_TRUST_PROXY=true` only when the trusted proxy is the sole path to the loopback-bound application and overwrites forwarded host/protocol headers. Separately, select **Trust a configured reverse proxy** in the wizard for the installed runtime. Do not enable either trust setting merely because a proxy exists somewhere upstream.

## External PostgreSQL

> **Known issue — do not use yet.** A live-deployment test against a real
> external PostgreSQL server (reachable only via `DATABASE_URL`, not on the
> Docker network as a service literally named `db`) found that the `app`
> container never starts: `scripts/orchestrator.mjs` waits for TCP on
> `COMPDESK_DB_HOST`/`COMPDESK_DB_PORT`, which default to `db:5432` and are
> never set by `docker-compose.external-db.yml`. The `migrate` service in
> this file bypasses the orchestrator (it runs `prisma migrate deploy`
> directly), which is why migrations can appear to succeed while the `app`
> service never becomes healthy. Track this as a release blocker before
> advertising this topology as supported.

If you don't want CompDesk to manage PostgreSQL, use the dedicated Compose file instead of the bundled-database one:

```bash
docker compose -f docker-compose.external-db.yml up -d
```

In the setup wizard, choose "Existing PostgreSQL with the app in Docker." This topology has no `config-init`/bundled `db` service — it never starts or publishes a database, and does not need `COMPDESK_VERSION` migration guidance beyond the same version-pinning requirement as the unified file.

## Migration from the two-stack deployment

If you installed CompDesk before this unified stack existed, you have a `.compdesk/` directory with `docker-bootstrap.env`/`compdesk.env` and the same `compdesk_pgdata`/`compdesk_uploads`/`compdesk_attachments` volumes. Nothing about those volumes needs to change — only a one-time import of your existing credentials into the new `compdesk_config` volume:

```bash
node scripts/import-legacy-deployment.mjs .compdesk
```

This reads your completed `.compdesk/installation.json` and `.compdesk/compdesk.env` (preserving whatever PostgreSQL username was generated at the time — including a randomized one), writes them into `compdesk_config`, and **never touches** `.compdesk/` or the data volumes. It refuses to run if `compdesk_config` already holds a receipt or secrets, so it cannot silently overwrite an existing unified installation.

Then start the unified stack:

```bash
docker compose up -d
```

and confirm it reaches `/auth/signin`. Keep `.compdesk/`, `docker-compose.setup.yml`, and `docker-compose.legacy.yml` in place until you've verified the unified stack is healthy — they are what rollback uses:

```bash
docker compose down                                                     # no -v — keeps the data volumes
docker compose --env-file .compdesk/compdesk.env -f docker-compose.legacy.yml up -d
```

Once you're confident the unified stack is healthy, `.compdesk/`, `docker-compose.setup.yml`, and `docker-compose.legacy.yml` may be archived or removed — they are deprecated and kept only for this migration/rollback path.

## Image version pinning

A release-asset `docker-compose.yml` pins the published version. If you're using the source-tree file with `COMPDESK_VERSION` set yourself, pin an exact published version (for example `1.2.3`) for production. `latest` is only applied to stable releases. Release tags identify the image digest scanned during publication, but registry tags can be moved by a later publish; the workflow does not enforce tag immutability. For immutable deployment inputs, replace both application image references with the verified `ghcr.io/tahahydra/compdesk@sha256:...` digest from the release. Changing versions is a deliberate action: download the new release asset or update the image references, then run `docker compose pull && docker compose up -d`.

## Rollback limitations

Two different things are called "rollback" here, and they have different safety guarantees:

- **Rolling back the Compose arrangement** (unified stack → old two-stack files) during migration validation is safe and supported — see the migration section above. Neither PostgreSQL nor the file volumes are touched by that switch.
- **Rolling back to an older CompDesk *version*** after an upgrade is only safe if that older version's code understands the database schema the newer version already migrated to. CompDesk's migrations are forward-only; there is no automated down-migration. If backward compatibility isn't documented for the specific migrations involved, restore the coordinated database/files/configuration backup from before the upgrade instead of downgrading the running application in place. See [UPGRADING.md](UPGRADING.md).

## Troubleshooting

- **`docker compose up` tries to pull `ghcr.io/tahahydra/compdesk:0.0.0-local` and fails** — this is the source tree's intentional local-only placeholder (see [above](#getting-docker-composeyml-release-asset-vs-source-tree)). Either download a release asset instead, or set `COMPDESK_VERSION` in `.env` to a real published version, or add `-f docker-compose.build.yml --build` to build locally.
- **Where is my setup token?** — for a release deployment run `docker compose logs --tail=50 compdesk`. For an image built from this repository run `docker compose -f docker-compose.yml -f docker-compose.build.yml logs --tail=50 compdesk`. The token is printed once and expires after 30 minutes. If it expired, run `docker compose restart compdesk` and then the appropriate logs command again; restarting the uninstalled setup process invalidates the old token and issues one replacement.
- **`config-init` exits with "refusing to generate new PostgreSQL credentials"** — the `compdesk_pgdata` volume already holds an initialized database but `compdesk_config` has no matching secrets (for example, `compdesk_config` was deleted or is from a different environment). Restore `compdesk_config` from a backup, import an existing installation with `scripts/import-legacy-deployment.mjs`, or discard the data on purpose with `node scripts/docker-reset.mjs` if it isn't needed.
- **The container never becomes healthy after an upgrade** — check `docker compose logs compdesk` for a migration failure; a failed migration blocks the container from starting the application on purpose. Restore from backup rather than retrying repeatedly against the same broken migration.
- **`docker compose ps` shows `db` or `compdesk` as `Exited`, and it stays that way** — this is deliberate: both services use a bounded restart policy (`on-failure:5`), not an unconditional one, so a permanent problem (broken configuration, a failing migration, a corrupt database) surfaces clearly instead of restart-looping forever and hiding the real error. To recover: `docker compose logs <service>` for the concise failure reason, fix the underlying problem, then `docker compose up -d`, which resets the attempt count and tries again. A container that merely crashed once from a transient issue restarts automatically on its own within those 5 attempts — you only need to act when it settles into `Exited`.
- **Port already in use** — set `APP_PORT` (and `APP_BIND_ADDRESS` if needed) in `.env` before `docker compose up -d`.
- **Logs** — `docker compose logs -f compdesk` (or `db`, `config-init`). CompDesk emits structured JSON to stdout/stderr; no separate log file exists.
