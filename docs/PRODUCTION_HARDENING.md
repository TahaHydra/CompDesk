# Production hardening

CompDesk is an actively developed self-hosted helpdesk. Complete
`docs/PUBLIC_RELEASE_CHECKLIST.md` for the exact commit before deployment.

## Required controls

- Use HTTPS at the public origin and redirect HTTP to HTTPS.
- Bind the application to loopback behind a reverse proxy unless direct
  exposure is intentional and firewalled.
- Do not publish PostgreSQL. Use a dedicated database, role, and random secret.
- Set unique `AUTH_SECRET` and `APP_SETTINGS_ENCRYPTION_KEY` values generated
  from at least 32 random bytes.
- Store `.env` or equivalent secrets with owner-only access. Never commit it.
- Keep private attachments outside `public`; use durable shared storage for
  multiple replicas.
- Configure the limits in `.env.example`. If `CLAMAV_HOST` is set, scanner
  errors fail closed; monitor scanner availability and review `docs/ATTACHMENT_SECURITY.md`.
- Restrict outbound traffic. SMTP and Entra require their configured endpoints;
  webhooks require explicit destination policy.
- Run migrations as a one-shot deployment step before starting replicas.
- Configure encrypted, regularly tested backups for PostgreSQL, attachments,
  branding uploads, and secrets.
- Run as a non-root service account and apply OS/container security updates.

## Reverse proxy

Forward `Host`, `X-Forwarded-Proto`, and a controlled client-address chain.
Discard untrusted incoming forwarding headers at the public proxy. Set upload
limits consistently in the proxy and application. Review `nginx.conf` and the
Caddy example in `docs/DEPLOY_UBUNTU.md`; replace all example hostnames.

## Secrets and logs

Do not log request bodies on authentication, setup, settings, SMTP, Entra,
webhook, or API-client routes. Audit changed key names, not values. Treat
configuration backups as secrets because they contain the keys required to
decrypt settings.

## Operational checks

Monitor liveness separately from readiness. Readiness must fail when setup is
incomplete, the database is unavailable, migrations are pending, or private
storage is unwritable. Do not expose infrastructure details in health responses.
