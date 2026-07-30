# CompDesk threat model

## Scope and trust boundaries

CompDesk stores helpdesk conversations, account identities, private
attachments, integration credentials, and audit data. The main trust
boundaries are:

1. browser to reverse proxy/application;
2. application to PostgreSQL;
3. application to private attachment storage;
4. application to Entra ID and SMTP;
5. external API clients to the application;
6. application to webhook destinations;
7. setup operator to the first-run bootstrap service.

PostgreSQL is the only supported database provider for this release.

## Assets

- account credentials, sessions, OAuth tokens, and role/department membership;
- ticket content, internal notes, attachment files, and history;
- `AUTH_SECRET`, settings-encryption keys, SMTP and webhook secrets;
- API-client keys and hashes;
- configuration, backups, audit events, and signing material.

## Principal threats

| Threat | Required control |
|---|---|
| Authentication brute force | Distributed throttling, generic errors, audit, expiry |
| Privilege or department escape | Central server authorization and negative tests |
| Secret disclosure in JSON/logs | Explicit DTOs, recursive forbidden-key tests, redaction |
| Stale concurrent ticket update | Version token and HTTP 409 |
| History erasure | Withdrawal/tombstones, retention-only hard deletion |
| Malicious attachment | Type verification, quarantine, optional scanner, private storage |
| Path traversal | Canonical containment checks and generated filenames |
| Webhook SSRF/replay | Address validation, DNS pinning, HMAC, replay window, outbox |
| Setup takeover | One-time expiring token, local default, CSRF, permanent completion |
| Database compromise | Least privilege, private network, encryption and restorable backups |
| Secret loss/rotation error | Atomic restricted configuration, current/previous key procedure |
| Supply-chain compromise | Lockfile install, dependency/static/container/secret scanning |

## Reviewed CodeQL exception: API-key lookup digest

CompDesk API keys are bearer credentials generated from 24 cryptographically random bytes
(192 bits) and displayed once. The database stores a deterministic SHA-256 digest solely for
indexed equality lookup; it never stores the raw key. CodeQL's
`js/insufficient-password-hash` rule is intentionally suppressed at that exact source line
because this value is not a human-chosen password and an offline attacker still faces the
full 192-bit search space. Password hashing would not materially improve that bound and
would prevent the current indexed lookup design. This exception does not apply to user
passwords, which remain protected with bcrypt, or to low-entropy integration secrets.

## Security assumptions

- Operators terminate HTTPS correctly and provide trustworthy forwarded headers.
- The host, container runtime, PostgreSQL, and backup destination are patched
  and access controlled.
- Encryption keys are stored separately from database-only backups.
- Multiple application replicas share durable attachment storage and use the
  same application secrets.
- Optional malware scanning reduces risk but does not prove that a file is safe.

## Out of scope

CompDesk does not claim endpoint protection for client devices, email final
delivery, protection after host/root compromise, or support for non-PostgreSQL
databases. A future release audit must update this model when boundaries change.
