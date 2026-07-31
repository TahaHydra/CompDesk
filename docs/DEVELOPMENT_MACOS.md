# macOS development

CompDesk development is supported on current macOS releases with Node.js 22.12–24, npm 10+, Docker Desktop, and Git.

```bash
brew install node@24 git
node --version
npm --version
cp .env.example .env
npm ci
npm run db:up
npm run db:migrate:prod
npm run dev
```

The development PostgreSQL container binds only to loopback. Keep `AUTH_URL=http://localhost:3000`, never reuse production secrets, and do not copy production data to a laptop without an approved sanitized dataset.

Before opening a pull request:

```bash
npm run verify
npm run test:e2e
npm audit --omit=dev
```

Private attachments remain under `storage/attachments`; generated browser and build artifacts are ignored. Stop the development database with `npm run db:down`.