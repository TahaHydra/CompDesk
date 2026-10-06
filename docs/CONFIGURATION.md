# Runtime configuration reference

The first-run setup writes one runtime environment file. Managed Docker Compose deployments use `/config/secrets/runtime.env` in the persistent configuration volume; standalone deployments load one restricted `.env` at the application root or one systemd/Windows service environment file. Legacy two-stack Docker deployments used `.compdesk/compdesk.env`. Do not maintain conflicting copies.

Super Admins can save single sign-on credentials (Microsoft Entra ID or OpenID Connect) from Settings in managed Docker or local standalone deployments. Credentials remain server-side in the restricted runtime file. Restart the CompDesk application/container after saving; the status distinguishes saved settings from the running configuration. Containers without a managed config volume require deployment-managed environment variables. The server never receives Docker daemon access to restart itself.

| Variable | Runtime behavior |
|---|---|
| `DATABASE_URL` | PostgreSQL connection used by Prisma, setup, migrations, health, and backup tooling. For a custom CA it includes `sslmode=verify-ca`/`verify-full` and an `sslrootcert` path. |
| `DATABASE_CA_FILE` | Restricted custom PostgreSQL CA file persisted by setup and included in recovery sets; migration and application containers mount its configuration directory read-only. |
| `AUTH_URL` | Exact public origin used for cookies, Entra callbacks, and absolute email asset URLs; HTTPS is required off localhost. |
| `AUTH_SECRET` | Stable Auth.js signing/encryption secret. |
| `TRUST_PROXY` | Enables trusted forwarded client IPs only when exactly `true`; the proxy must overwrite client headers. |
| `LOGIN_LOCAL_ENABLED`, `LOGIN_SSO_ENABLED` | Break-glass login-policy defaults when the database cannot be read. At least one method remains available. The beta.3 name `LOGIN_MICROSOFT_ENABLED` is still honoured when `LOGIN_SSO_ENABLED` is unset. |
| `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` | Microsoft Entra provider and diagnostics. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Generic OpenID Connect provider (Google, Okta, Keycloak, Auth0, authentik, or any standards-based IdP). The issuer must match the IdP discovery document exactly. Redirect URI: `AUTH_URL/api/auth/callback/oidc`. |
| `OIDC_CLIENT_AUTH_METHOD` | `client_secret_basic` (default), `client_secret_post`, or `private_key_jwt`. |
| `OIDC_CA_CERTIFICATE` / `OIDC_CA_FILE` | Optional PEM CA bundle trusted, in addition to the system roots, for this identity provider only (discovery and token calls). Normally saved from Settings → Single sign-on; no `NODE_EXTRA_CA_CERTS` needed. |
| `OIDC_NEXT_*` | The same variables for the staged provider used by SSO migration mode (for example `OIDC_NEXT_ISSUER`). Written by Settings; see [Single sign-on](SINGLE_SIGN_ON.md). |
| `OIDC_CLIENT_PRIVATE_KEY` / `OIDC_CLIENT_PRIVATE_KEY_FILE`, `OIDC_CLIENT_CERTIFICATE` / `OIDC_CLIENT_CERTIFICATE_FILE`, `OIDC_CLIENT_KEY_ID` | `private_key_jwt` only: unencrypted RSA-2048+/P-256/P-384 PEM key, optional certificate (adds `x5t#S256`), optional `kid`. Inline values may use `\n` escapes. Invalid key material disables the provider at startup and is logged. |
| `APP_SETTINGS_ENCRYPTION_KEY` | Required 32-byte base64/hex key for database SMTP/webhook secrets. |
| `APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS` | Previous key accepted only during controlled rotation. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Environment SMTP source; environment password overrides the encrypted database password. Port 465 is implicit TLS; port 587 requires STARTTLS. |
| `SMTP_CA_FILE`, `SMTP_CLIENT_CERT_FILE`, `SMTP_CLIENT_KEY_FILE` | Optional SMTP TLS material used when the matching Settings values are empty. A CA bundle replaces the system roots for SMTP only; a client certificate pair enables mutual TLS and makes username/password optional. Verification always stays enabled. |
| `ATTACHMENT_STORAGE_DIR` | Private, durable, non-public ticket attachment root. |
| `UPLOAD_MAX_SIZE_MB` | Per-file upload limit. |
| `ATTACHMENT_MAX_FILES_PER_TICKET`, `ATTACHMENT_MAX_BYTES_PER_TICKET`, `ATTACHMENT_GLOBAL_MAX_BYTES` | Race-safe permanent attachment quotas. |
| `TEMP_ATTACHMENT_TTL_HOURS`, `TEMP_ATTACHMENT_MAX_FILES_PER_USER`, `TEMP_ATTACHMENT_MAX_BYTES_PER_USER` | Temporary upload lifetime and per-user quotas. |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | Optional ClamAV INSTREAM scanner; configured scan errors fail closed. |
| `LOG_LEVEL` | Winston stdout/stderr level. |
| `NODE_ENV` | Next.js/runtime mode; must be `production` in deployment. |

Compose-only values (`POSTGRES_*`, `APP_BIND_ADDRESS`, `APP_PORT`, and volume names) configure the container topology rather than application behavior. Feature flags are validated database settings managed by a Super Admin; there are no undocumented environment feature-flag fallbacks.

Variables not consumed by runtime or deployment tooling are intentionally absent from `.env.example`.
