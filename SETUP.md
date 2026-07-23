# CompDesk local setup

This is the canonical development setup for Windows, macOS, and Linux. Docker runs PostgreSQL only; Next.js runs directly with Node.js for fast reloads.

## Requirements

- Node.js 24 LTS (recommended). Node.js 22.12 or newer is also supported.
- npm 10 or newer.
- Docker Desktop on Windows/macOS, or Docker Engine with Compose on Linux.
- Git.

Check the tools:

```bash
node --version
npm --version
docker --version
docker compose version
```

The repository includes `.nvmrc` and `.node-version`, both pinned to the tested Node.js 24 LTS release.

## First-time setup

Run every command from the repository root (the directory containing `package.json`).

### 1. Create the environment file

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

The default local database URL uses `localhost:5433`. This deliberately avoids port 5432, which is commonly occupied by another PostgreSQL installation.

### 2. Install dependencies

```bash
npm ci
```

Use `npm ci` for a clean, reproducible install from `package-lock.json`. Use `npm install <package>` only when intentionally changing dependencies.

### 3. Start PostgreSQL

```bash
npm run db:up
```

This starts only the `db` service. Confirm it is healthy:

```bash
docker compose ps
```

To use another host port, set `POSTGRES_PORT` in `.env` and update the port in `DATABASE_URL` to match.

### 4. Generate Prisma Client and apply migrations

```bash
npm run setup
```

For demo data on a new database only:

```bash
npm run db:seed
```

### 5. Start CompDesk

```bash
npm run dev
```

Open <http://localhost:3000>.

## Daily workflow

```bash
npm run db:up
npm run dev
```

Stop the application with Ctrl+C. Stop PostgreSQL when desired:

```bash
npm run db:down
```

The database is stored in a named Docker volume and survives container stops. Do not run `docker compose down -v` unless you explicitly want to erase it.

## Verify a change

```bash
npm run verify
```

This runs TypeScript checking, all tests, and the production build.

## Restricted corporate network / Prisma download failures

A normal internet connection does not need a relay. If npm can only download through a local HTTP relay, Prisma may still fail because its engines come from `binaries.prisma.sh`, not the npm registry. CompDesk includes one optional, cross-platform relay that handles both sources.

Start it in terminal 1.

Windows PowerShell:

```powershell
npm run relay:dependencies:windows
```

macOS/Linux:

```bash
npm run relay:dependencies
```

Then use terminal 2.

Windows PowerShell:

```powershell
$env:npm_config_registry = 'http://127.0.0.1:8899/'
$env:PRISMA_ENGINES_MIRROR = 'http://127.0.0.1:8899/prisma'
npm ci
```

macOS/Linux:

```bash
export npm_config_registry='http://127.0.0.1:8899/'
export PRISMA_ENGINES_MIRROR='http://127.0.0.1:8899/prisma'
npm ci
```

These variables affect only that terminal session. Do not commit them to `.env`; application runtime does not need them.

## Common problems

### npm says it cannot find `package.json`

You are in the wrong directory. Change into the cloned CompDesk folder first.

### The app connects to the wrong PostgreSQL database

Confirm `.env` uses port 5433 and that `docker compose ps` shows the CompDesk database. Port 5432 may belong to another project.

### Prisma Client is missing or stale

```bash
npm run db:generate
```

### Start from a clean dependency install

PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules, .next -ErrorAction SilentlyContinue
npm ci
```

macOS/Linux:

```bash
rm -rf node_modules .next
npm ci
```

Removing `node_modules` and `.next` does not affect PostgreSQL data.
