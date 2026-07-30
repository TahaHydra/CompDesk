# Backup and restore

Back up all of the following as one recovery set:

- PostgreSQL;
- private attachment storage;
- branding and quick-link uploads;
- runtime configuration;
- `AUTH_SECRET`;
- current and previous settings-encryption keys.

Encryption keys and configuration backups are secrets. Encrypt backup media,
limit access, and keep at least one offline or separately administered copy.

## PostgreSQL

Create a custom-format backup:

```bash
pg_dump --format=custom --file=compdesk.dump "$DATABASE_URL"
```

Verify that `pg_restore --list compdesk.dump` succeeds. A list operation is not
a restore test; regularly restore into an isolated PostgreSQL instance.

## Files

Stop writes or take a storage snapshot coordinated with the database backup.
Archive the configured private attachment directory and `public/uploads`
without following links outside those roots.

## Restore rehearsal

1. Provision an isolated host and supported PostgreSQL version.
2. Restore configuration and keys with restrictive permissions.
3. Restore PostgreSQL with `pg_restore`.
4. Restore attachments and uploaded assets to their configured durable paths.
5. Run `npm run db:migrate:prod` once.
6. Start one application instance and check readiness.
7. Verify authentication, one private attachment, ticket history, branding,
   and settings-secret decryption.
8. Record the recovery point and recovery time.

Never test a restore over the only production database.
