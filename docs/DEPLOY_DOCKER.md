# Docker Compose deployment

Docker Compose is the recommended deployment shape. PostgreSQL is private to
the Compose network; only the application bind address is published.

## Requirements

- Docker Engine with Compose v2;
- a DNS name and HTTPS reverse proxy;
- durable storage for PostgreSQL, attachments, and uploaded branding assets;
- a secure `.env` excluded from version control.

Create `.env` from `.env.example`, then set unique values for:

- `POSTGRES_DB`, `POSTGRES_USER`, and a URL-safe random `POSTGRES_PASSWORD`;
- `AUTH_URL` using the public HTTPS origin;
- `AUTH_SECRET` and `APP_SETTINGS_ENCRYPTION_KEY`;
- optional Entra and SMTP values.

The production Compose file has no database host port and refuses missing
database/application secrets.

Validate before starting:

```bash
docker compose config
docker compose build --no-cache
docker compose up -d
docker compose ps
```

The one-shot `migrate` service waits for PostgreSQL and applies migrations
before the application starts. Normal application replicas do not run Prisma
migrations.

Back up the `pgdata`, `uploads`, and `attachments` data with the corresponding
configuration and encryption keys. See `docs/BACKUP_AND_RESTORE.md`.

For local development only:

```bash
docker compose -f docker-compose.dev.yml up -d
```

The development database binds only to `127.0.0.1`.
