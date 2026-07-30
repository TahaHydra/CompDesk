# Upgrading CompDesk

## Before upgrading

1. Read release notes and every new Prisma migration.
2. Create and verify a complete backup as described in
   `docs/BACKUP_AND_RESTORE.md`.
3. Rehearse the upgrade against a copy of realistic data.
4. Confirm the rollback procedure and maintenance window.

## Upgrade sequence

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
