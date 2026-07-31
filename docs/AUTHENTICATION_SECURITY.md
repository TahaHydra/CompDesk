# Authentication and account security

CompDesk supports local credentials and Microsoft Entra ID. At least one method must remain enabled. Login-method database read failures use the documented recovery policy in `docs/PRODUCTION_HARDENING.md`.

## Canonical email identities

Every email is trimmed and lowercased. PostgreSQL stores `normalized_email`, enforces a unique index, and uses a trigger so Auth.js adapter writes, setup SQL, seed data, APIs, and future integrations cannot bypass normalization. The upgrade migration aborts before changing data if two existing accounts normalize to the same value. Operators must choose the correct surviving identity and reconcile its related records before retrying; the migration never guesses.

## Local-login throttling

Credential failures are stored in PostgreSQL as HMAC-SHA-256 key hashes. Raw passwords are never stored or logged. Records cover the normalized account, trusted source address, and account/source pair:

- account/source pair: temporary lockout on the fifth failure;
- account: temporary lockout on the eighth failure;
- source: temporary lockout on the twentieth failure;
- failed responses receive a progressive delay, capped at two seconds;
- the initial lockout is 15 minutes and repeated threshold crossings increase it, capped at 24 hours;
- records expire after their enforcement window and successful authentication clears account and pair failures while retaining source-abuse evidence.

Source-IP enforcement uses forwarded headers only when `TRUST_PROXY=true`. Enable it only behind a controlled reverse proxy that overwrites client-supplied forwarding headers. Without that setting, account throttling remains active and the source is treated as unknown.

Credential errors remain generic to the browser. Audit records contain method, normalized account, source (when trusted), safe failure stage, and rate-limit state; they never contain passwords.

## Session revocation

JWTs contain the user session version. Password resets/changes, email changes, role changes, account activation-state changes, and deactivation increment that version and set `credentials_changed_at`. Tokens with a stale version or an issue time before the security change are rejected. Deactivated users are also rejected on every session refresh.

## User administration

User administration accepts strict Zod payloads. Account and department-membership updates share one database transaction. A PostgreSQL transaction advisory lock serializes operations that could remove the last active Super Admin. Routine removal always deactivates the user and retains their tickets, assignments, timeline entries, audit records, watchers, group memberships, queue memberships, accounts, and session evidence. Permanent retention/GDPR erasure requires separate purpose-built tooling and is not exposed as a routine UI action.