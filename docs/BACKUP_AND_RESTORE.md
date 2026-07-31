# Backup and restore

A valid recovery set contains PostgreSQL, private attachments, uploaded branding/quick-link assets, the runtime configuration (the `compdesk_config` Docker volume for the unified Compose deployment, or the single runtime configuration file for standalone/legacy deployments), any configured PostgreSQL custom CA, `AUTH_SECRET`, and both current/previous settings-encryption keys.

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
- `configuration/database-ca.pem` when custom PostgreSQL trust is configured;
- a non-secret `manifest.json`.

The script passes PostgreSQL credentials through `PG*` child-process environment variables rather than command-line arguments. Use `node scripts/backup.mjs --dry-run` to confirm scope without writing a backup or contacting PostgreSQL.

## Docker Compose backup (unified stack)

Quiesce application writes or take a coordinated storage snapshot:

```bash
docker compose exec -T db \
  sh -c ‘exec pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"’ \
  > database.dump

docker run --rm -v compdesk_attachments:/source:ro -v "$PWD":/backup alpine:3.22 \
  tar -C /source -czf /backup/attachments.tar.gz .
docker run --rm -v compdesk_uploads:/source:ro -v "$PWD":/backup alpine:3.22 \
  tar -C /source -czf /backup/uploads.tar.gz .
docker run --rm -v compdesk_config:/source:ro -v "$PWD":/backup alpine:3.22 \
  tar -C /source -czf /backup/config.tar.gz .
chmod 600 database.dump attachments.tar.gz uploads.tar.gz config.tar.gz
```

The `compdesk_config` archive replaces the old `compdesk.env`/`database-ca.pem` file backups for the unified stack — it contains the same secrets (database URL, `AUTH_SECRET`, `APP_SETTINGS_ENCRYPTION_KEY`, any custom PostgreSQL CA) plus the installation receipt. If volume names were customized, use the configured names.

## Docker Compose backup (deprecated two-stack deployment)

For an installation still running the legacy `docker-compose.legacy.yml`/`docker-compose.setup.yml` pair (not yet migrated — see [DEPLOY_DOCKER.md](DEPLOY_DOCKER.md)), use the exact production environment file instead:

```bash
docker compose --env-file .compdesk/compdesk.env -f docker-compose.legacy.yml exec -T db \
  sh -c ‘exec pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"’ \
  > database.dump

docker run --rm -v compdesk_attachments:/source:ro -v "$PWD":/backup alpine:3.22 \
  tar -C /source -czf /backup/attachments.tar.gz .
docker run --rm -v compdesk_uploads:/source:ro -v "$PWD":/backup alpine:3.22 \
  tar -C /source -czf /backup/uploads.tar.gz .
cp .compdesk/compdesk.env ./compdesk.env.backup
if [ -f .compdesk/database-ca.pem ]; then cp .compdesk/database-ca.pem ./database-ca.pem.backup; fi
chmod 600 database.dump attachments.tar.gz uploads.tar.gz compdesk.env.backup
if [ -f database-ca.pem.backup ]; then chmod 600 database-ca.pem.backup; fi
```

For external PostgreSQL (either topology), use the database provider’s consistent snapshot procedure or `npm run backup` from a host that can reach it.

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

`npm run backup:verify` validates structure and containment only. With PostgreSQL client tools installed, `RESTORE_TEST_DATABASE_URL` pointing to an administrative database, and an isolated backup path, `npm run backup:rehearse -- /absolute/path/to/backup` creates a random temporary database, restores the dump and file/configuration set, validates it, and drops the temporary database. A successful isolated restore is the required proof. Never rehearse over the only production database.