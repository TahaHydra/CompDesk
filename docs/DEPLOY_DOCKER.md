# Docker Compose deployment

Docker Compose is the recommended deployment shape. Use the isolated first-run procedure in [FIRST_RUN_SETUP.md](FIRST_RUN_SETUP.md); it generates credentials before the production Compose file is evaluated.

## Requirements

- Docker Engine with Compose v2;
- a DNS name and HTTPS reverse proxy for non-local use;
- durable storage for PostgreSQL, attachments, and uploaded branding assets;
- encrypted backup storage for `.compdesk/compdesk.env` and, when generated, `.compdesk/database-ca.pem`.

Fresh installation:

```bash
npm ci
npm run setup:docker:prepare
docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml up --build
```

Open the loopback setup URL and use the console bootstrap token. After completion:

```bash
docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml down
docker compose --env-file .compdesk/compdesk.env config
docker compose --env-file .compdesk/compdesk.env build --no-cache
docker compose --env-file .compdesk/compdesk.env up -d
docker compose --env-file .compdesk/compdesk.env ps
```

Never use `down -v` during upgrade or setup-to-production handoff. PostgreSQL has no host port in production. The application defaults to `127.0.0.1:3000`; place Nginx or Caddy in front and terminate HTTPS there.

The one-shot `migrate` service waits for PostgreSQL and applies reviewed migrations before the application starts. Normal application replicas do not run Prisma migrations. The runtime image uses a non-root user.

Back up the PostgreSQL volume, `uploads`, `attachments`, and the exact configuration/encryption keys together. See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

For local development only:

```bash
docker compose -f docker-compose.dev.yml up -d
```

The development database binds only to `127.0.0.1`.

### Resetting a development or test deployment

`node scripts/docker-reset.mjs` permanently deletes the CompDesk PostgreSQL, uploads, and attachments volumes, any leftover containers/networks from either the current `compdesk` project or the legacy `compdesk-setup` project, and the generated `.compdesk/` configuration directory. It requires typed confirmation unless `--yes` is passed, never runs automatically, and is intended for development or test environments, not for resetting a production installation. A `docker:reset` npm script is available for convenience; the script itself only requires Node.js and Docker, not `npm install`.
## External PostgreSQL

Run the setup wizard locally, select “Existing PostgreSQL with the app in Docker,” and write the restricted configuration to `.compdesk/compdesk.env`. The database must require authenticated encrypted transport appropriate to its network. When `verify-ca` or `verify-full` uses a private CA, setup writes `.compdesk/database-ca.pem` with restrictive permissions and places its `/app/config/database-ca.pem` path in `DATABASE_URL`; the external-database Compose file mounts that directory read-only into both the migration and application containers.

```bash
docker compose --env-file .compdesk/compdesk.env -f docker-compose.external-db.yml config
docker compose --env-file .compdesk/compdesk.env -f docker-compose.external-db.yml build --no-cache
docker compose --env-file .compdesk/compdesk.env -f docker-compose.external-db.yml up -d
docker compose --env-file .compdesk/compdesk.env -f docker-compose.external-db.yml ps
```

This topology contains only the one-shot migration job and application; it never starts or publishes a bundled database.

## Operations

- Logs: `docker compose --env-file .compdesk/compdesk.env logs -f app`.
- Liveness: `curl -fsS http://127.0.0.1:3000/api/health/live`.
- Readiness: `curl -fsS http://127.0.0.1:3000/api/health/ready`.
- Upgrade: back up, build the new image, run the one-shot migration service, then let the application start.
- Rollback: stop the new application and restore the coordinated database/files/configuration recovery set if the older application is not schema-compatible.

Use the reviewed proxy files under `deploy/`. Set `TRUST_PROXY=true` only when that proxy is the sole path to the loopback-bound application and overwrites forwarding headers.