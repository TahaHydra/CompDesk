# Contributing to CompDesk

Thank you for improving CompDesk.

## Development workflow

1. Create a branch from the current default branch.
2. Install the supported Node.js/npm versions with `npm ci`.
3. Use PostgreSQL; other database providers are not supported.
4. Add a reviewed Prisma migration for every schema change. Never reset an
   existing installation as an upgrade strategy.
5. Add tests for behavior and authorization boundaries.
6. Run `npm run verify` before requesting review.

Keep commits focused. Do not commit `.env`, database dumps, uploads,
attachments, logs, credentials, tenant identifiers, generated demo passwords,
or customer branding.

## Security-sensitive changes

Authentication, authorization, cryptography, uploads, webhooks, external API,
setup, and deployment changes require tests for failure paths and secret
redaction. Never weaken TLS, certificate validation, CSRF, callback validation,
or role/department checks to make a test pass.

## Pull requests

Describe the root cause, user impact, migration/rollback behavior, tests run,
and any remaining risk. A passing build is necessary but not sufficient for a
security claim.
