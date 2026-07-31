# Deployment

Use the isolated first-run setup; do not seed a public installation with shared credentials.

Choose one supported path:

- [Docker Compose](DEPLOY_DOCKER.md) (recommended, bundled or external PostgreSQL);
- [Ubuntu standalone Node.js](DEPLOY_UBUNTU.md);
- [Windows standalone](DEPLOY_WINDOWS.md);
- [macOS development](DEVELOPMENT_MACOS.md).

The first-run flow is documented in [FIRST_RUN_SETUP.md](FIRST_RUN_SETUP.md). Backup, restore, upgrades, and rollback are documented in [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) and [UPGRADING.md](UPGRADING.md).

## Production invariants

- `AUTH_URL` is the exact browser-facing HTTPS origin.
- PostgreSQL and the Node.js port are not exposed publicly.
- Nginx or Caddy overwrites forwarding headers; enable `TRUST_PROXY=true` only in that topology.
- PostgreSQL migrations run once as a deployment job before application replicas start.
- `public/uploads` and the private `ATTACHMENT_STORAGE_DIR` are durable, writable, and backed up with the database.
- Configuration, `AUTH_SECRET`, and current/previous settings-encryption keys are backed up as one encrypted recovery set.
- `/api/health/live` checks the process. `/api/health/ready` checks installation, database, migrations, and private-storage writability without returning infrastructure details.

Reviewed reverse-proxy examples are in `deploy/nginx/compdesk.conf` and `deploy/caddy/Caddyfile`. The standalone service example is `deploy/systemd/compdesk.service`.

## Logs

CompDesk emits structured JSON to stdout/stderr in production. Use `docker compose logs app` for containers and `journalctl -u compdesk` for systemd. Do not depend on an undocumented application log file.