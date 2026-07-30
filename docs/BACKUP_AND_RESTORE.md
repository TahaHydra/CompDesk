# Backup and restore

A valid recovery set contains PostgreSQL, private attachments, uploaded branding/quick-link assets, the single runtime configuration file, `AUTH_SECRET`, and both current/previous settings-encryption keys.

> The configuration backup can decrypt sessions and database secrets. Encrypt the entire backup, restrict access, and keep at least one separately administered copy. Never upload it to an issue or commit it to Git.

## Standalone backup script

Install PostgreSQL client tools so `pg_dump` is available, load the same runtime environment as the service, then run:

```bash
npm run backup
npm run backup:verify -- /absolute/path/to/backups/compdesk-YYYY-MM-DD...
```

`npm run backup` creates a mode-restricted directory under `backups/` (or `COMPDESK_BACKUP_DIR`) containing:

- `database.dump` in PostgreSQL custom format;
- `attachments/` from `ATTACHMENT_STORAGE_DIR`;
- `uploads/` from `public/uploads`;
- one configuration file under `configuration/`;
- a non-secret `manifest.json`.

The script passes PostgreSQL credentials through `PG*` child-process environment variables rather than command-line arguments. Use `node scripts/backup.mjs --dry-run` to confirm scope without writing a backup or contacting PostgreSQL.

## Docker Compose backup

Quiesce application writes or take a coordinated storage snapshot. Use the exact production environment file:

```bash
docker compose --env-file .compdesk/compdesk.env exec -T db \
  sh -c 'exec pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > database.dump

docker run --rm -v compdesk_attachments:/source:ro -v "$PWD":/backup alpine:3.22 \
  tar -C /source -czf /backup/attachments.tar.gz .
docker run --rm -v compdesk_uploads:/source:ro -v "$PWD":/backup alpine:3.22 \
  tar -C /source -czf /backup/uploads.tar.gz .
cp .compdesk/compdesk.env ./compdesk.env.backup
chmod 600 database.dump attachments.tar.gz uploads.tar.gz compdesk.env.backup
```

If volume names were customized, use the configured names. For external PostgreSQL, use the database provider’s consistent snapshot procedure or `npm run backup` from a host that can reach it.

## Restore rehearsal

Always restore to an isolated target first. Verify the exact target paths before destructive database operations.

1. Provision a supported empty PostgreSQL database and empty durable storage.
2. Restore the secret-bearing configuration with mode `0600`/restricted ACLs.
3. Restore PostgreSQL:

   ```bash
   pg_restore --exit-on-error --no-owner --dbname "$RESTORE_DATABASE_URL" database.dump
   ```

4. Restore `attachments/` to `ATTACHMENT_STORAGE_DIR` and `uploads/` to `public/uploads` without following links outside the backup roots.
5. Run `npm run db:generate` and `npm run db:migrate:prod` once.
6. Start one application instance and require `/api/health/ready` to return 200.
7. Verify local/Entra authentication as configured, one private attachment download, ticket history, branding, SMTP verification, and settings-secret decryption.
8. Record the recovery point, recovery time, application commit, migration list, and verification result.

`npm run backup:verify` validates structure and containment only. A successful isolated restore is the required proof. Never rehearse over the only production database.