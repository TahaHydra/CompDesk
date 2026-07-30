# Windows deployment

CompDesk supports development and standalone testing on Windows 10, Windows 11,
and Windows Server with a supported Node.js/npm version and PostgreSQL.

Install prerequisites from an elevated PowerShell session where appropriate:

```powershell
winget install OpenJS.NodeJS.LTS
winget install PostgreSQL.PostgreSQL
node --version
npm --version
psql --version
```

Create `.env` from `.env.example`, configure a dedicated PostgreSQL database
and random secrets, then:

```powershell
npm ci
npm run db:generate
npm run verify
npm run db:migrate:prod
npm run build
npm start
```

Run the service under a dedicated low-privilege Windows account. Restrict the
configuration, attachment, upload, and backup directories with NTFS ACLs.
Terminate HTTPS in IIS, Caddy, Nginx, or another reviewed reverse proxy and
forward the original host and scheme. Do not expose PostgreSQL publicly.

Windows Service wrappers must preserve graceful process termination and the
configured working directory. Test service-account access to private storage
and backup destinations before enabling automatic startup.
