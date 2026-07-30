# Ubuntu deployment

Supported targets for this release are Ubuntu 22.04 and 24.04 with PostgreSQL
16 and a supported Node.js/npm version. Docker Compose is recommended; see
`docs/DEPLOY_DOCKER.md`.

## Standalone prerequisites

Install Node.js from an approved source and PostgreSQL client tools:

```bash
sudo apt update
sudo apt install -y ca-certificates curl postgresql-client openssl
node --version
npm --version
psql --version
```

Use a dedicated unprivileged account, for example `compdesk`, and place the
application under `/opt/compdesk`. Store runtime configuration outside the
repository with mode `0600`. Private attachments and uploads require durable
writable directories owned by the service account.

```bash
npm ci
npm run db:generate
npm run verify
npm run db:migrate:prod
npm run build
npm start
```

Run migrations once during deployment, not from every replica.

## systemd example

```ini
[Unit]
Description=CompDesk helpdesk
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=compdesk
Group=compdesk
WorkingDirectory=/opt/compdesk
EnvironmentFile=/etc/compdesk/compdesk.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/compdesk /opt/compdesk/public/uploads

[Install]
WantedBy=multi-user.target
```

Adjust Node/npm paths and writable paths for the actual installation.

## Caddy example

```caddy
helpdesk.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

The public `AUTH_URL` must match the HTTPS origin. Review trusted forwarding
headers and firewall the application so only the proxy can reach it.
