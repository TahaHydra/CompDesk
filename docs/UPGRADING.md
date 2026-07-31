# Upgrading CompDesk

## Before upgrading

1. Read release notes and every new Prisma migration.
2. Create and verify a complete backup as described in
   `docs/BACKUP_AND_RESTORE.md`.
3. Rehearse the upgrade against a copy of realistic data.
4. Confirm the rollback procedure and maintenance window.

## Upgrade sequence

### Docker Compose (unified stack)

```bash
docker compose pull
docker compose up -d
```

Migrations run automatically, once, before the application starts serving
traffic — there is no separate migration step to run by hand. See
[DEPLOY_DOCKER.md](DEPLOY_DOCKER.md) for the full upgrade/troubleshooting
guidance and what happens if a migration fails.

### Standalone Node.js

```bash
npm ci
npm run db:generate
npm run verify
npm run db:migrate:prod
```

Run migrations once before starting new application replicas. Do not run
`prisma migrate reset`, `db:push`, or destructive development migrations
against an existing installation.

After migration, start one replica, check readiness, then restore normal
capacity. Validate authentication, ticket reads and writes, attachments,
SMTP diagnostics, and audit logging.

## Rollback

Application rollback is safe only when the older application understands the
new schema. Each migration must document destructive or irreversible behavior.
When backward compatibility is not available, restore the coordinated database,
files, and configuration backup rather than attempting an improvised reverse
migration.

## Automated previous-release rehearsal

CI runs `npm run test:migration:upgrade` with a dedicated PostgreSQL administrative test URL. The command creates a random disposable database, applies migrations through the previous release, inserts representative existing rows, applies current migrations, validates preserved and backfilled data, and drops the database.

To run it outside CI, set `MIGRATION_TEST_DATABASE_URL` to a PostgreSQL server where the test account may create and drop databases. Do not point it at a production server and do not pass credentials as command-line arguments. The script deliberately refuses to fall back to the application's `DATABASE_URL`.