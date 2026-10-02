# CompDesk approved fixes — 2 October 2026

Implemented on `codex/ticket-review-fixes`, based on the existing main checkout. Earlier authorized update/demo changes remain in the working tree and were not mixed into these fix commits. No push, merge or public release was performed.

## Delivered changes

| Scope | Result |
| --- | --- |
| Ticket/form layout | Opening requester, avatar and time; description and submitted answers before conversation; Details before Actions; own replies on the right and other participants on the left. Claim/Withdraw remain in the header. Shared helper text follows controls, checkbox labels are unique, and paired controls align. |
| A1 | New internal uploads persist a staff-only attachment flag, filtered from requester metadata and denied on download/deletion. Existing staff uploads remain supported. Historical files without recorded visibility cannot be reliably reclassified; the migration does not invent that classification. |
| A2 | Dashboard recent tickets use the same role-filtered historical form projection as ticket responses. |
| A3 | Staff personal ticket lists and notifications intersect current department access. |
| A4 | Creation emails/watchers exclude inactive users and people who no longer have a staff role. |
| B1–B2 | Persisted resolution deadlines drive SLA breach state; closed/resolved/withdrawn tickets do not breach. A transaction advisory lock serializes ticket-counter initialization and yearly rollover. |
| B3–B5 | Environment SMTP credentials bypass unused saved-secret decryption. Setup and partial settings updates agree on STARTTLS versus implicit TLS. |
| B6–B7 | User editing separates agent assignments from administrator memberships; archived existing memberships can be removed without allowing new inactive assignments. |
| B8–B10 | Pagination deep links and Back/Forward filters work; local URL acknowledgments preserve pending search drafts. Dashboard links match combined status counts. |
| B11–B13 | Empty descriptions save; help detail/list caches invalidate together and include language; inaccessible articles no longer display stale content. |
| B14–B16 | Impossible calendar dates are rejected; partial file uploads retain successful references; standalone attachment storage uses the application root consistently. |
| C | Read failures have status-aware error/retry states and shape validation; untouched defaults do not trigger discard prompts; changed options clear invalid selections; ticket mutations refresh list/inbox/dashboard caches. UI-owned ticket/admin/mail/reminder copy uses EN/FR. Template-authored labels and user content retain their authored language. |
| Microsoft 365 | SMTP remains available alongside app-only Graph sending with a fixed sender mailbox, encrypted application secret, cached tokens, explicit test send and Super Admin configuration boundaries. |
| Remind me | Private owner-scoped schedules, notes and optional email, persisted in PostgreSQL with leases, bounded retry, status/access checks and in-app bell delivery. |

The initial ticket/form remodel is isolated in `48d0df7`. A1–A4 each have their own small commit. Subsequent subsystem/review corrections are separate.

## Mail and reminders

[Microsoft 365 setup](../MICROSOFT_365_MAIL.md) documents Entra client credentials and Exchange Application RBAC scoped to the sender mailbox. No actual tenant permissions, credentials or email delivery were changed during implementation. Live Exchange validation requires your own configured application/mailbox. Graph 202 confirms provider acceptance, not final arrival. This first provider supports an application secret; certificate authentication is not implemented.

[Private reminder behavior](../TICKET_REMINDERS.md) documents ownership, UTC schedules, worker leases, retries, cancellation and at-least-once external email semantics. A real PostgreSQL test verified UTC behavior under Europe/Paris and America/New_York sessions, simultaneous claims, active leases and expired-lease restart recovery. Browser validation saved a reminder with email unchecked, reloaded it, and cancelled it; no reminder email was sent.

The old `origin/codex/ticket-reminders` branch adds staff-triggered requester nudges for PENDING_USER tickets. It has complementary value, but collides with the new route/model/table/library names and carries unrelated history. It is preserved. Port only that behavior into distinct requester-nudge endpoints/data when revisited; do not merge it wholesale or expose private notes through it.

## Update awareness / recovery report

The earlier update implementation is present in the deployed working tree. Settings places Updates immediately after Webhooks, followed by Demo data. About services remain administrator-only, with https://xhydra.fr/compdesk and mailto:compdesk@xhydra.fr; no pricing is embedded.

The checker performs server-side HTTPS manifest GETs, validates a bounded JSON body and explicit normal/critical severity, and compares with APP_VERSION. Administrator reads trigger automatic checks when the 24-hour shared cache expires. A global database rate gate permits one external check per minute across replicas. Manual refresh bypasses the 24-hour cache when that gate permits. Browsers call local authenticated APIs and share one update controller; they never poll GitHub directly.

PostgreSQL app_settings stores updates_cache (source, manifest, last attempt, status) and updates_automatic (default enabled). Failed checks preserve earlier valid metadata as stale. Per-user, per-browser localStorage key compdesk:update-dismissal:<encoded user ID> stores the collapsed release version; a newer release expands again. Critical updates retain their red indicator.

External update checks transmit an ordinary HTTPS GET with Accept: application/json, no request body and no user, tenant, installed version, email or application URL. The source sees the server IP, request path/time and normal transport headers. Container Next.js telemetry is explicitly disabled. Opening chosen release/docs/services links navigates the browser to those sites.

ADMIN can inspect availability, release notes, recovery information, refresh and collapse notifications. SUPER_ADMIN additionally configures automatic checks and accesses/copies assisted deployment instructions. Privileged update actions are disabled for ADMIN with an explicit reason. No Docker socket, daemon access, privileged container, fake one-click updater or rollback button is introduced.

The default public manifest URL returned HTTP 404 during the audit: the local manifest has not been published there. That is why the app reports update checking unavailable. Publishing the validated manifest or configuring a real trusted HTTPS manifest remains a release/operator step; the UI does not claim that a failed check means up to date.

Readiness reuses the real application/database/migration/private-storage checks. Previous known version and last successful update are not tracked; recovery correctly says no managed recovery point available. An older image does not prove compatible rollback. Backup/restore documentation is linked; no recovery state is fabricated.

## Verification and local deployment

- Focused subsystem tests passed, including authorization, partial uploads, routing, membership editing, mail configuration and reminder ownership/delivery state.
- Full Jest: **70 suites / 532 tests passed** after the final functional review fixes.
- Final French follow-up: **2 suites / 14 tests passed** (three additional translation cases); final checkbox follow-up: **3 tests passed**. Broad tests were not repeated for those copy/layout-only changes.
- Full lint passed; final touched UI files also passed scoped lint with zero warnings. Final typecheck passed.
- Final production Docker/Next build and deployment passed. The final HR checkbox and adjacent select have identical browser top coordinates (995 px).
- Fresh setup/demo lifecycle: **8 Node integration tests passed** in disposable databases, including installation transaction rollback, all demo roles/content, clean removal to the original Super Admin, reinstall, preservation of real data and the setup checkbox workflow. Current installation data was kept.
- Existing readiness returned HTTP 200 with database, installation, migrations and privateStorage all true after migration.
- Browser: Marie Curie request reading order and conversation attribution, private reminder save/reload/cancel, Graph settings fields without saving credentials, French ticket/reminder UI, and the reported HR form control alignment. English preference was restored after validation; Marie Curie’s ticket was left open for testing.

Local image: compdesk-test:local, Compose project compdesk-test, app http://localhost:3100. Rebuild from C:/Dev/CompDesk with:

```powershell
docker compose --env-file .env.compdesk-test -p compdesk-test -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The installation is already initialized; initialization is not rerun or reset. [First-run setup](../FIRST_RUN_SETUP.md), [demo data](../DEMO_DATA.md), [upgrade procedure](../UPGRADING.md), [update checks](../UPDATE_CHECKS.md) cover the supported operational workflows. Fresh lifecycle tests used isolated databases and never deleted the current app's volumes.

## Commits

```text
48d0df7 Improve ticket request hierarchy and shared form alignment
6e1468a Keep internal ticket attachments private to authorized staff
4ca81fb Filter restricted historical form data in dashboard responses
fa4f29e Enforce current department scope in personal staff lists and notifications
66c84f3 Exclude inactive and demoted staff from ticket creation recipients
2ef0550 Correct SLA deadlines, counter rollover, dates and attachment storage
8bfe2df Align SMTP credential overrides and setup transport security
6cf3274 Fix administrative membership editing, list navigation and help cache state
3ebc74f Fix ticket routing defaults, partial uploads and error/cache states
d8c9935 Add scoped Microsoft 365 Graph mail delivery and Super Admin configuration
e648dca Add private persisted ticket reminders with leased delivery and retry state
7f8a486 Complete French ticket, administrative, mail and reminder UI copy
f720b16 Resolve review regressions in filter drafts and UTC reminder leases
297a97e Disable Next.js telemetry in container builds and runtime
668b5f1 Localize remaining ticket composer and attachment controls
01e5a1f Align checkbox rows with adjacent form controls without duplicate labels
```

## Files changed in the approved audit-fix commits

- [Dockerfile](<C:/Dev/CompDesk/Dockerfile>)
- [docs/MICROSOFT_365_MAIL.md](<C:/Dev/CompDesk/docs/MICROSOFT_365_MAIL.md>)
- [docs/TICKET_REMINDERS.md](<C:/Dev/CompDesk/docs/TICKET_REMINDERS.md>)
- [prisma/migrations/20261002160000_internal_attachments/migration.sql](<C:/Dev/CompDesk/prisma/migrations/20261002160000_internal_attachments/migration.sql>)
- [prisma/migrations/20261002170000_ticket_reminders/migration.sql](<C:/Dev/CompDesk/prisma/migrations/20261002170000_ticket_reminders/migration.sql>)
- [prisma/schema.prisma](<C:/Dev/CompDesk/prisma/schema.prisma>)
- [scripts/setup-bootstrap.mjs](<C:/Dev/CompDesk/scripts/setup-bootstrap.mjs>)
- [scripts/setup-ui.html](<C:/Dev/CompDesk/scripts/setup-ui.html>)
- [scripts/ticket-reminders.integration.test.mjs](<C:/Dev/CompDesk/scripts/ticket-reminders.integration.test.mjs>)
- [src/__tests__/attachment-storage.test.ts](<C:/Dev/CompDesk/src/__tests__/attachment-storage.test.ts>)
- [src/__tests__/audit-admin-client-regressions.test.ts](<C:/Dev/CompDesk/src/__tests__/audit-admin-client-regressions.test.ts>)
- [src/__tests__/audit-translations.test.ts](<C:/Dev/CompDesk/src/__tests__/audit-translations.test.ts>)
- [src/__tests__/audit-user-memberships.test.ts](<C:/Dev/CompDesk/src/__tests__/audit-user-memberships.test.ts>)
- [src/__tests__/destructive-action-contract.test.ts](<C:/Dev/CompDesk/src/__tests__/destructive-action-contract.test.ts>)
- [src/__tests__/email-delivery.test.ts](<C:/Dev/CompDesk/src/__tests__/email-delivery.test.ts>)
- [src/__tests__/graph-mail-settings.test.ts](<C:/Dev/CompDesk/src/__tests__/graph-mail-settings.test.ts>)
- [src/__tests__/graph-mail.test.ts](<C:/Dev/CompDesk/src/__tests__/graph-mail.test.ts>)
- [src/__tests__/internal-attachments.test.ts](<C:/Dev/CompDesk/src/__tests__/internal-attachments.test.ts>)
- [src/__tests__/notification-authorization.test.ts](<C:/Dev/CompDesk/src/__tests__/notification-authorization.test.ts>)
- [src/__tests__/phase4-multi-assignee.test.ts](<C:/Dev/CompDesk/src/__tests__/phase4-multi-assignee.test.ts>)
- [src/__tests__/sla-deadline.test.ts](<C:/Dev/CompDesk/src/__tests__/sla-deadline.test.ts>)
- [src/__tests__/staff-ticket-scope.test.ts](<C:/Dev/CompDesk/src/__tests__/staff-ticket-scope.test.ts>)
- [src/__tests__/ticket-counter.test.ts](<C:/Dev/CompDesk/src/__tests__/ticket-counter.test.ts>)
- [src/__tests__/ticket-form-validation.test.ts](<C:/Dev/CompDesk/src/__tests__/ticket-form-validation.test.ts>)
- [src/__tests__/ticket-layout.test.ts](<C:/Dev/CompDesk/src/__tests__/ticket-layout.test.ts>)
- [src/__tests__/ticket-reminders.test.ts](<C:/Dev/CompDesk/src/__tests__/ticket-reminders.test.ts>)
- [src/__tests__/ticket-response-security.test.ts](<C:/Dev/CompDesk/src/__tests__/ticket-response-security.test.ts>)
- [src/__tests__/ticket-routing-state.test.ts](<C:/Dev/CompDesk/src/__tests__/ticket-routing-state.test.ts>)
- [src/app/(dashboard)/admin/categories/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/admin/categories/page.tsx>)
- [src/app/(dashboard)/admin/departments/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/admin/departments/page.tsx>)
- [src/app/(dashboard)/admin/settings/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/admin/settings/page.tsx>)
- [src/app/(dashboard)/admin/users/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/admin/users/page.tsx>)
- [src/app/(dashboard)/dashboard/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/dashboard/page.tsx>)
- [src/app/(dashboard)/help/[slug]/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/help/[slug]/page.tsx>)
- [src/app/(dashboard)/help/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/help/page.tsx>)
- [src/app/(dashboard)/queue/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/queue/page.tsx>)
- [src/app/(dashboard)/tickets/[id]/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/tickets/[id]/page.tsx>)
- [src/app/(dashboard)/tickets/new/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/tickets/new/page.tsx>)
- [src/app/(dashboard)/tickets/page.tsx](<C:/Dev/CompDesk/src/app/(dashboard)/tickets/page.tsx>)
- [src/app/api/dashboard/stats/route.ts](<C:/Dev/CompDesk/src/app/api/dashboard/stats/route.ts>)
- [src/app/api/notifications/route.ts](<C:/Dev/CompDesk/src/app/api/notifications/route.ts>)
- [src/app/api/settings/mail/route.ts](<C:/Dev/CompDesk/src/app/api/settings/mail/route.ts>)
- [src/app/api/settings/route.ts](<C:/Dev/CompDesk/src/app/api/settings/route.ts>)
- [src/app/api/tickets/[id]/reminders/route.ts](<C:/Dev/CompDesk/src/app/api/tickets/[id]/reminders/route.ts>)
- [src/app/api/tickets/[id]/route.ts](<C:/Dev/CompDesk/src/app/api/tickets/[id]/route.ts>)
- [src/app/api/tickets/route.ts](<C:/Dev/CompDesk/src/app/api/tickets/route.ts>)
- [src/app/api/upload/[id]/route.ts](<C:/Dev/CompDesk/src/app/api/upload/[id]/route.ts>)
- [src/app/api/upload/route.ts](<C:/Dev/CompDesk/src/app/api/upload/route.ts>)
- [src/app/api/users/route.ts](<C:/Dev/CompDesk/src/app/api/users/route.ts>)
- [src/components/admin/graph-mail-settings.tsx](<C:/Dev/CompDesk/src/components/admin/graph-mail-settings.tsx>)
- [src/components/admin/help-center-manager.tsx](<C:/Dev/CompDesk/src/components/admin/help-center-manager.tsx>)
- [src/components/layout/app-shell.tsx](<C:/Dev/CompDesk/src/components/layout/app-shell.tsx>)
- [src/components/profile-language-preference.tsx](<C:/Dev/CompDesk/src/components/profile-language-preference.tsx>)
- [src/components/ticket-form/dynamic-ticket-form.tsx](<C:/Dev/CompDesk/src/components/ticket-form/dynamic-ticket-form.tsx>)
- [src/components/tickets/ticket-reminders.tsx](<C:/Dev/CompDesk/src/components/tickets/ticket-reminders.tsx>)
- [src/instrumentation.ts](<C:/Dev/CompDesk/src/instrumentation.ts>)
- [src/lib/attachment-storage.ts](<C:/Dev/CompDesk/src/lib/attachment-storage.ts>)
- [src/lib/email.ts](<C:/Dev/CompDesk/src/lib/email.ts>)
- [src/lib/graph-mail.ts](<C:/Dev/CompDesk/src/lib/graph-mail.ts>)
- [src/lib/i18n.ts](<C:/Dev/CompDesk/src/lib/i18n.ts>)
- [src/lib/sla-deadline.ts](<C:/Dev/CompDesk/src/lib/sla-deadline.ts>)
- [src/lib/ticket-counter.ts](<C:/Dev/CompDesk/src/lib/ticket-counter.ts>)
- [src/lib/ticket-form/validation.ts](<C:/Dev/CompDesk/src/lib/ticket-form/validation.ts>)
- [src/lib/ticket-reminders.ts](<C:/Dev/CompDesk/src/lib/ticket-reminders.ts>)
- [src/lib/ticket-search.ts](<C:/Dev/CompDesk/src/lib/ticket-search.ts>)
- [src/lib/tickets/create-ticket.ts](<C:/Dev/CompDesk/src/lib/tickets/create-ticket.ts>)

- [docs/audits/2026-10-02-compdesk-fixes.md](<C:/Dev/CompDesk/docs/audits/2026-10-02-compdesk-fixes.md>)
