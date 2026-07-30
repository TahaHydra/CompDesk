# First-run setup

The secure setup wizard is the intended installation path once its release gate
is marked complete. Until then, keep deployments private and use the reviewed
manual deployment instructions.

The setup design separates pre-database bootstrap from the normal Next.js
application. It must:

- listen on localhost by default;
- issue one expiring bootstrap token to the server console;
- require explicit remote opt-in, token authentication, CSRF, and same-origin
  checks;
- persist only non-secret resumable state before final application;
- write secrets atomically with restrictive permissions;
- test PostgreSQL before importing the normal Prisma application;
- create exactly one first Super Admin;
- preserve at least one authentication method;
- create an installation record and permanently retire setup endpoints.

Supported deployment choices are Docker Compose, standalone Node.js with an
existing PostgreSQL server, and a Docker application using an existing
PostgreSQL server. Other database engines are unsupported.

SMTP and demo data are optional. Demo mode is disabled by default and must use
generated one-time credentials when explicitly selected.

The implementation and E2E evidence are tracked in
`docs/PUBLIC_RELEASE_CHECKLIST.md`.
