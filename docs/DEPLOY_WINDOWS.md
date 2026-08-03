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

From the exact release tag, install dependencies, build, and start the isolated
first-run wizard. It tests the target PostgreSQL schema permissions, writes the
restricted `.env` (and `database-ca.pem` when a private database CA is selected),
runs migrations, and creates the first Super Admin:

```powershell
git checkout v0.9.0-beta.1
npm ci
npm run verify
npm run setup:bootstrap
```

Open the printed loopback URL, enter the one-time console token, and complete the
wizard. After it reports completion, stop bootstrap with `Ctrl+C` and start the
configured application:

```powershell
npm start
```

Run the service under a dedicated low-privilege Windows account. Restrict the
configuration, attachment, upload, and backup directories with NTFS ACLs.
Terminate HTTPS in IIS, Caddy, Nginx, or another reviewed reverse proxy and
forward the original host and scheme. Do not expose PostgreSQL publicly.

Windows Service wrappers must preserve graceful process termination and the
configured working directory. Test service-account access to private storage
and backup destinations before enabling automatic startup.
