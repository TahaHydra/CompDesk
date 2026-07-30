# Attachment security

Ticket files are stored outside `public` and are served only by the authenticated attachment route after the normal ticket-access check. Stored paths use generated identifiers; original names are sanitized display metadata only.

## Validation and quarantine

The server verifies content signatures instead of trusting the browser MIME declaration. Images, PDF, ZIP, RAR, 7-Zip, legacy compound Office files, OOXML Word/Excel/PowerPoint packages, UTF-8 text, and CSV have format-specific checks. SVG remains unsupported. A mismatched declaration is rejected before a file is written.

Set `CLAMAV_HOST` (and optionally `CLAMAV_PORT` and `CLAMAV_TIMEOUT_MS`) to scan through a ClamAV `clamd` INSTREAM connection. Infected files are rejected and never written. Once ClamAV is configured, connection, timeout, and scanner errors fail closed. When ClamAV is deliberately not configured, records are marked `NOT_CONFIGURED`; the UI does not claim that a malware scan passed. Existing pre-migration files remain explicitly unscanned rather than being mislabeled as clean.

Files are not assigned a download URL until validation and scanning complete. Downloads use `Content-Disposition: attachment`, `nosniff`, a restrictive CSP, private no-store caching, and the server-detected MIME type.

## Quotas and cleanup

The following settings are enforced server-side:

- `UPLOAD_MAX_SIZE_MB`: maximum bytes for one file;
- `ATTACHMENT_MAX_FILES_PER_TICKET`: active files per ticket;
- `ATTACHMENT_MAX_BYTES_PER_TICKET`: active bytes per ticket;
- `ATTACHMENT_GLOBAL_MAX_BYTES`: active bytes across ticket attachments;
- `TEMP_ATTACHMENT_TTL_HOURS`: lifetime of a pre-ticket upload;
- `TEMP_ATTACHMENT_MAX_FILES_PER_USER`: active temporary files for one user;
- `TEMP_ATTACHMENT_MAX_BYTES_PER_USER`: temporary bytes for one user.

PostgreSQL advisory locks and temporary reservation rows serialize quota decisions so concurrent uploads cannot independently pass the same remaining capacity check. Expired temporary records and files are removed during subsequent uploads by that user. Production operators should also schedule routine orphan/expiry reconciliation when operating at high volume.

## Removal and audit

The routine UI action removes the stored bytes but tombstones the database record with actor, time, and reason. It also writes an `attachment.removed` audit event. This preserves ticket history. Physical deletion needed for a retention or privacy request belongs in separately authorized retention tooling, not the normal ticket action.

Directories and new files request owner-only `0700`/`0600` permissions on POSIX systems. Use a dedicated service account, durable shared private storage for multiple replicas, and include the attachment root in encrypted backups.
