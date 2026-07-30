# Docker Compose deployment

Docker Compose is the recommended deployment shape. Use the isolated first-run procedure in [FIRST_RUN_SETUP.md](FIRST_RUN_SETUP.md); it generates credentials before the production Compose file is evaluated.

## Requirements

- Docker Engine with Compose v2;
- a DNS name and HTTPS reverse proxy for non-local use;
- durable storage for PostgreSQL, attachments, and uploaded branding assets;
- encrypted backup storage for `.compdesk/compdesk.env`.

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