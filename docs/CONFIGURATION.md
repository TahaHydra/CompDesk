# Runtime configuration reference

The first-run setup writes one runtime environment file. Container deployments use `.compdesk/compdesk.env`; standalone deployments load one restricted `.env` at the application root or one systemd/Windows service environment file. `COMPDESK_ENV_FILE` selects the setup/backup file but is not a second runtime source. Do not maintain conflicting copies.

| Variable | Runtime behavior |
|---|---|
| `DATABASE_URL` | PostgreSQL connection used by Prisma, setup, migrations, health, and backup tooling. For a custom CA it includes `sslmode=verify-ca`/`verify-full` and an `sslrootcert` path. |
| `DATABASE_CA_FILE` | Restricted custom PostgreSQL CA file persisted by setup and included in recovery sets; migration and application containers mount its configuration directory read-only. |
| `AUTH_URL` | Exact public origin used for cookies, Entra callbacks, and absolute email asset URLs; HTTPS is required off localhost. |
| `AUTH_SECRET` | Stable Auth.js signing/encryption secret. |
| `TRUST_PROXY` | Enables trusted forwarded client IPs only when exactly `true`; the proxy must overwrite client headers. |
| `LOGIN_LOCAL_ENABLED`, `LOGIN_MICROSOFT_ENABLED` | Break-glass login-policy defaults when the database cannot be read. At least one method remains available. |
| `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` | Microsoft Entra provider and diagnostics. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Generic OpenID Connect provider (any standards-compliant IdP), enabled when all three are set. Endpoints come from the issuer's discovery document; PKCE, state and nonce are enforced. Callback: `<AUTH_URL>/api/auth/callback/oidc`. |
| `OIDC_DISPLAY_NAME`, `OIDC_SCOPES` | Sign-in button label ("Sign in with <name>") and requested scopes (default `openid email profile`). |
| `OIDC_ID_CLAIM`, `OIDC_EMAIL_CLAIM`, `OIDC_NAME_CLAIM`, `OIDC_GROUPS_CLAIM` | Optional claim names (defaults `sub`, `email`, `name`, `groups`). |
| `OIDC_ROLE_MAP` | Optional `group=ROLE` pairs (`USER`, `AGENT`, `ADMIN`, `SUPER_ADMIN`); the highest matching role is applied at each OIDC sign-in, no match leaves the role unchanged. |
| `OIDC_REQUIRE_VERIFIED_EMAIL` | Default `true`: OIDC sign-in (and linking to an existing account by email) requires `email_verified=true`. |
| `APP_SETTINGS_ENCRYPTION_KEY` | Required 32-byte base64/hex key for database SMTP/webhook secrets. |
| `APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS` | Previous key accepted only during controlled rotation. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Environment SMTP source; environment password overrides the encrypted database password. Port 465 is implicit TLS; port 587 requires STARTTLS. |
| `ATTACHMENT_STORAGE_DIR` | Private, durable, non-public ticket attachment root. |
| `UPLOAD_MAX_SIZE_MB` | Per-file upload limit. |
| `ATTACHMENT_MAX_FILES_PER_TICKET`, `ATTACHMENT_MAX_BYTES_PER_TICKET`, `ATTACHMENT_GLOBAL_MAX_BYTES` | Race-safe permanent attachment quotas. |
| `TEMP_ATTACHMENT_TTL_HOURS`, `TEMP_ATTACHMENT_MAX_FILES_PER_USER`, `TEMP_ATTACHMENT_MAX_BYTES_PER_USER` | Temporary upload lifetime and per-user quotas. |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | Optional ClamAV INSTREAM scanner; configured scan errors fail closed. |
| `LOG_LEVEL` | Winston stdout/stderr level. |
| `NODE_ENV` | Next.js/runtime mode; must be `production` in deployment. |

Compose-only values (`POSTGRES_*`, `APP_BIND_ADDRESS`, `APP_PORT`, and volume names) configure the container topology rather than application behavior. Feature flags are validated database settings managed by a Super Admin; there are no undocumented environment feature-flag fallbacks.

Variables not consumed by runtime or deployment tooling are intentionally absent from `.env.example`.