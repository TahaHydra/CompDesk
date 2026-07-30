# Security policy

CompDesk is actively developed. Keep deployments private until the release
checklist for the exact version in use is complete.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security-advisory workflow for this repository and include:

- affected commit or version;
- reproduction steps;
- expected and observed impact;
- logs with credentials, tokens, personal data, and tenant identifiers removed;
- a suggested remediation, if available.

Maintainers should acknowledge a complete report within seven days. Timelines
for validation, remediation, and disclosure depend on impact and complexity.
Please allow a reasonable remediation period before public disclosure.

## Supported versions

Only the current default branch and explicitly tagged releases that state a
security-support window are supported. An untagged commit has no implied
production support.

## Deployment responsibility

Operators are responsible for TLS termination, PostgreSQL access control,
secret storage, backups, host patching, log retention, outbound network policy,
and testing upgrades against a restorable backup. See
`docs/PRODUCTION_HARDENING.md` and `docs/THREAT_MODEL.md`.
