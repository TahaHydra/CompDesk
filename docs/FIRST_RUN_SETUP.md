# First-run setup

CompDesk uses an isolated Node.js bootstrap server before the normal Next.js/Prisma runtime can start. PostgreSQL is the only supported production database.

## Standalone Node.js with existing PostgreSQL

1. Install Node.js 22.12 or later and run `npm ci` and `npm run build`.
2. Start `npm start`. When required runtime configuration or an installation record is absent, only the setup server and minimal health endpoints start.
3. On the same machine, open the localhost URL printed to the console and enter the separately printed one-time token. The token expires after 30 minutes.
4. Complete all ten steps. Normal application routes remain blocked until migrations, the first Super Admin, settings, and the installation record are committed.
5. Stop and restart `npm start`, then open the displayed sign-in URL.

Remote setup is disabled by default. If localhost access is impossible, expose setup only through a protected trusted network path, set `SETUP_ALLOW_REMOTE=true`, set `SETUP_PUBLIC_HOST` to the exact browser hostname, and retain token authentication. Never publish the setup listener directly to the Internet.

## Docker Compose first run

```bash
npm ci
npm run setup:docker:prepare
docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml up --build
```

The preparation command generates a random database account and password into an ignored, permission-restricted file without printing the values. The setup stack binds to `127.0.0.1` by default, keeps PostgreSQL on an internal network, and writes the completed configuration to `.compdesk/compdesk.env`.

After the wizard succeeds, stop the setup stack and start production services:

```bash
docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml down
docker compose --env-file .compdesk/compdesk.env config
docker compose --env-file .compdesk/compdesk.env up -d --build
```

Do not add `-v` when stopping setup: the PostgreSQL volume contains the installed database. Archive `.compdesk/compdesk.env` in an encrypted backup; it contains database, authentication, and encryption secrets. The temporary `docker-bootstrap.env` may be securely removed only after production Compose starts successfully and the final configuration is backed up.

The setup and production Compose files share one canonical `compdesk` project identity and the same `pgdata`, `uploads`, and `attachments` volume names, so production takes over exactly what setup created with no ownership warnings and no data loss.

If `.compdesk/docker-bootstrap.env` is missing but the `pgdata` volume already holds an initialized PostgreSQL data directory (for example, the file was deleted or setup ran on a machine with a pre-existing volume), `npm run setup:docker:prepare` refuses to mint a new random database user and exits with a recovery message instead of silently generating credentials PostgreSQL will not recognize. Restore the original `docker-bootstrap.env` from backup, or discard the existing database on purpose with `node scripts/docker-reset.mjs` before re-running the preparation command.

## Security behavior

- Setup listens on loopback unless remote mode is explicitly enabled.
- A random bootstrap token is printed once, expires, is rate-limited, and authorizes only one active session.
- Mutations require an HttpOnly SameSite setup session, exact same origin, and a separate CSRF token.
- Resumable server state contains no database, administrator, SMTP, or Entra passwords.
- Secrets use atomic file replacement, restrictive permissions, and a backup of any existing configuration.
- Database checks distinguish DNS, TCP, TLS, authentication, missing database, and permission failures without returning a password or connection string.
- At least one login method is mandatory. Local passwords require 14 characters with upper/lowercase, number, and symbol.
- SMTP is optional. Verification and real-send are separate; relay acceptance is not proof of mailbox delivery.
- Storage setup records per-file, per-ticket, per-user temporary, expiry, and global quotas. ClamAV is optional; enabling it requires a reachable `clamd` host/port and scan errors then fail closed.
- Demo data is disabled by default. When enabled, credentials are random and shown once. `npm run demo:remove -- --confirm=REMOVE-DEMO-DATA` removes unreferenced demo accounts and deactivates referenced ones to preserve history.
- Successful installation creates an immutable database installation record. Revisiting setup returns 410 and deleting a browser cookie cannot recreate the Super Admin.

## Interrupted setup and local recovery

Non-secret choices are saved in `.compdesk/setup-state.json`. Restarting the setup server issues a new one-time token and resumes those choices. Passwords must be re-entered.

To archive an incomplete state and restart locally:

```bash
npm run setup:recover -- --confirm=RESET-INCOMPLETE-SETUP
```

This command refuses to reopen a completed installation and never deletes the database. Deleting the installation record is not a supported recovery procedure.

## Generated configuration

Standalone setup writes one ignored `.env`. Docker setup writes `.compdesk/compdesk.env`. Generated values include independent `AUTH_SECRET` and `APP_SETTINGS_ENCRYPTION_KEY` values of at least 32 random bytes. Keep the current and previous settings keys during documented rotation and back up them with the database.