# CompDesk audit and proposed fixes — 2 October 2026

Historical findings recorded before the follow-up implementation. This report preserves the original observations and proposed work; it is not the current release validation status. Use [the acceptance record](../MULTIUSER_ACCEPTANCE_TESTING.md) for current acceptance evidence.

## Scope and evidence

Reviewed ticket creation/rendering, ticket APIs and authorization, attachments, notifications, email and setup, SLA calculations, counters, admin memberships, lists/dashboard/help caching, updates/demo and runtime paths. Inspected the live Marie Curie ticket and the current meeting-room ticket through the browser without submitting anything.

Evidence includes code tracing, isolated executions of actual TypeScript handlers with mocked authentication/database/filesystem, component/query-cache probes, existing tests, and a public manifest HTTP check. These reproduce code paths; they do not replace real PostgreSQL concurrency tests, a live Microsoft tenant test, or a full browser journey for every role. This is a broad audit, not a guarantee that every defect has been discovered.

## The screenshots: template or form handling?

The observed alignment is a **shared form-renderer issue**. Each field independently renders label, optional help text, then its control. A field with no help starts its input earlier; a two-line helper pushes its input further down. Both screenshot fields use valid half-row widths. Changing those templates to compensate would hide the renderer defect.

Marie Curie's request data is present: resource, requested action, permission level, approver and business justification. The ticket page puts those answers underneath Actions, Timeline and Details in the narrow sidebar. The description has no opening-author attribution. This is predominantly a **ticket presentation and information-order issue**, not missing submitted data for this example.

## Confirmed privacy and access defects

### A1 — P1: Internal-note uploads are visible to the requester

- Evidence: [composer upload](../../src/app/(dashboard)/tickets/[id]/page.tsx#L287), internal-mode controls around lines 625/635, [upload persistence](../../src/app/api/upload/route.ts#L114), [ticket attachment projection](../../src/app/api/tickets/[id]/route.ts#L157), [download authorization](../../src/app/api/upload/[id]/route.ts#L37).
- Trigger: staff selects Internal Note and attaches a file or pastes a screenshot. Upload saves a ticket-wide attachment immediately, without an internal visibility flag or conversation-entry relationship.
- Result: requester cannot see the note but can see/download the file, including before the note is submitted. Isolated detail/download handlers reproduced this: download returned 200 for the requester.
- Fix: first disable/reject attachments and pasted uploads in internal mode. Supporting private note files properly needs persisted visibility and authorization in metadata/download/delete paths, plus linking the file to its conversation entry. Do not label existing ticket-wide files private.
- Regression: internal upload, canceled/failed note, direct download attempt, and public attachment all have explicit expected boundaries.

### A2 — P1: Dashboard returns restricted historical form data

- Evidence: [dashboard query/response](../../src/app/api/dashboard/stats/route.ts#L39), response at line 80.
- Trigger: USER loads a dashboard recent ticket with staff-only snapshot definitions/defaults or staff-only submitted values.
- Result: raw Ticket scalar fields include full `formSchemaSnapshot` and `submittedFormValues`; other ticket endpoints already filter these. Isolated USER handler returned a private default and private submitted value.
- Fix: select only dashboard display fields, or apply the existing role-aware ticket projection to every recent ticket.
- Regression: USER and demoted staff responses omit hidden definitions, defaults and values; allowed data remains.

### A3 — P1: Staff My Tickets / notifications bypass department access

- Evidence: [my-ticket scope](../../src/lib/ticket-search.ts#L29), [notification scope](../../src/app/api/notifications/route.ts#L23), internal-note filter at line 39, reference [detail authorization](../../src/lib/permissions.ts#L107).
- Trigger: a requester is promoted to AGENT for another department, or a staff member loses an earlier department membership/assignment scope.
- Result: detail returns 403 while My Tickets returns staff-visible fields and the bell can return internal-note content from the same ticket. Actual mocked handlers reproduced this disagreement.
- Fix: intersect staff My Tickets with currently authorized departments and use the same scope for notifications. If requester access is intentionally retained, return requester-level data and suppress internal notes; this must be an explicit policy choice.
- Regression: promotion, demotion, membership removal and stale assignments across list/detail/notification endpoints.

### A4 — P1: Deactivated or demoted agents still receive creation emails

- Evidence: [creation recipients](../../src/lib/tickets/create-ticket.ts#L238), send at line 354; normal [deactivation](../../src/app/api/users/route.ts#L276) preserves membership records.
- Trigger: deactivate a direct department agent or demote a member of an agent group, then create a ticket there.
- Result: membership queries lack active-user/global-role checks. Isolated creation service sent title/key/department to disabled and demoted recipients; it also subscribes their watcher IDs.
- Fix: reuse an active, currently authorized recipient resolver for both direct/group creation recipients and watcher subscriptions.
- Regression: inactive direct membership, demoted group membership, revoked queue access, valid active agents.

## Confirmed functional defects

### B1 — P2: Restarted SLA deadlines still appear breached

- Evidence: [list calculation](../../src/app/api/tickets/route.ts#L143), [detail calculation](../../src/app/api/tickets/[id]/route.ts#L116), new persisted deadline at line 263.
- Trigger: change priority/department or escalate an older ticket, restarting its deadline.
- Result: read paths still compare age since creation against the new policy. Both handlers reported a breach with a deadline one hour in the future.
- Fix: use persisted `dueAt` for resolution breach, consistent terminal-status rules, and an explicit fallback for historical missing deadlines. Preserve separate first-response semantics.
- Regression: future/expired restarted deadline, completed/withdrawn tickets, list/detail agreement.

### B2 — P2: Concurrent yearly ticket-counter rollover can allocate duplicate keys

- Evidence: [counter allocator](../../src/lib/tickets/create-ticket.ts#L54).
- Trigger: two creation transactions read the old year and both reset count to one; initial absent-counter creation has a related race.
- Result: isolated concurrent allocator calls returned `[1,1]`; unique ticket keys can make one creation fail. The current replay catch does not recover an unrelated colliding submission.
- Fix: serialize allocation using a transaction advisory lock or atomic year-aware SQL increment/upsert.
- Regression: real PostgreSQL concurrent first allocations, rollover, normal increments and idempotent retries.

### B3 — P2: Environment SMTP override still tries decrypting unused database credentials

- Evidence: [SMTP resolution](../../src/lib/email.ts#L50).
- Trigger: saved encrypted password has an unavailable/rotated key, but valid environment credentials override it.
- Result: decryption fails before selecting the override. Actual isolated resolver reproduced the error with synthetic credentials.
- Fix: resolve the effective password source first; decrypt only if database credentials are selected.
- Regression: environment override without an old encryption key, database-only credentials, normal key rotation.

### B4 — P2: Setup accepts a TLS combination runtime rejects

- Evidence: [setup controls](../../scripts/setup-ui.html#L75), [bootstrap transport](../../scripts/setup-bootstrap.mjs#L384), persisted flags at lines 618–619; [runtime validator](../../src/lib/settings-validation.ts#L73).
- Trigger: select port 465/implicit TLS while default Require STARTTLS remains enabled.
- Result: bootstrap can preserve both flags; runtime rejects them. Synthetic runtime configuration reproduced the rejection.
- Fix: share normalized TLS rules between setup/settings/runtime; implicit TLS clears/disables Require STARTTLS.
- Regression: supported 465/587 flows from initial setup through runtime and settings edits.

### B5 — P2: Partial SMTP PATCH has inconsistent TLS defaults

- Evidence: [settings PATCH](../../src/app/api/settings/route.ts#L137), [runtime defaults](../../src/lib/email.ts#L49).
- Trigger: older implicit-TLS settings lack `smtp_require_tls`; a client changes only password/From.
- Result: PATCH defaults Require STARTTLS to true, runtime defaults it to false for implicit TLS, so valid effective settings can be rejected.
- Fix: use one shared effective SMTP configuration resolver for GET/PATCH/runtime/setup.
- Regression: partial updates with legacy flags missing; environment and database combinations.

### B6 — P2: User department editor mixes agent/admin memberships

- Evidence: [membership projection](../../src/app/api/users/route.ts#L48), [editable IDs](../../src/app/(dashboard)/admin/users/page.tsx#L209), agent-only replacement at API line 199.
- Trigger: user has administrator membership A and agent membership B; remove B through the combined dropdown.
- Result: UI sends A and backend creates an extra agent membership A. Later removing administrator access can leave inbox access; dual-role membership can also submit duplicate IDs.
- Fix: include membership role; edit deduplicated agent memberships only and display administrator access separately.
- Regression: mixed/dual memberships, role removal and resulting effective access.

### B7 — P2: Archived memberships cannot be removed through user editor

- Evidence: [active-only queue list](../../src/app/(dashboard)/admin/users/page.tsx#L72), submitted membership IDs around line 266; [active queue validation](../../src/app/api/users/route.ts#L175).
- Trigger: assigned department is archived, then administrator edits another assignment.
- Result: hidden archived ID remains in payload and fails `INVALID_QUEUE`; no checkbox can remove it.
- Fix: show existing inactive memberships as removable; prevent adding new inactive memberships.
- Regression: archive assigned department, remove old membership and add active department.

### B8 — P2: Ticket/inbox page links reset to page one

- Evidence: [ticket search effect](../../src/app/(dashboard)/tickets/page.tsx#L57), [inbox effect](../../src/app/(dashboard)/queue/page.tsx#L38).
- Trigger: load/reload `?page=3`.
- Result: initial effects reset page to one and rewrite URL; component probes reproduced both. Next works after initialization.
- Fix: reset pagination only for actual filter changes, preserving initial URL pagination.
- Regression: deep links, reload and normal filter changes.

### B9 — P2: Same-page URL navigation leaves stale filters

- Evidence: [ticket filter initialization](../../src/app/(dashboard)/tickets/page.tsx#L43), [inbox initialization](../../src/app/(dashboard)/queue/page.tsx#L24).
- Trigger: navigate/back/forward between different query strings without unmounting.
- Result: local states initialize from URL once and keep querying old filters. Probes changed OPEN to CLOSED while query remained OPEN.
- Fix: derive committed filters from URL or reconcile incoming parameters without router loops; keep search drafts separate.
- Regression: Back/Forward and same-page filter-link navigation.

### B10 — P2: Dashboard links disagree with their counts

- Evidence: [Open/Urgent links](../../src/app/(dashboard)/dashboard/page.tsx#L66), [count predicates](../../src/app/api/dashboard/stats/route.ts#L35).
- Result: Open count includes NEW+OPEN but link selects OPEN; Urgent count excludes resolved/closed but link includes them.
- Fix: share equivalent count/drilldown predicates and support the combined active-status filters.
- Regression: NEW tickets and closed urgent tickets; card count equals linked list total.

### B11 — P2: Cleared department/category descriptions do not save

- Evidence: [department payload](../../src/app/(dashboard)/admin/departments/page.tsx#L109), [category payload](../../src/app/(dashboard)/admin/categories/page.tsx#L107).
- Result: empty input serializes as undefined, omits the property, preserves old description while reporting success.
- Fix: submit the supported empty value explicitly.
- Regression: clear a nonempty description, save and reload.

### B12 — P2: Help detail cache survives edits/deletion

- Evidence: [manager invalidation](../../src/components/admin/help-center-manager.tsx#L114), [detail query](../../src/app/(dashboard)/help/[slug]/page.tsx#L38).
- Result: plural list queries invalidate but singular detail query does not. Cached old/deleted content can remain fresh for 30 seconds; actual QueryClient probe confirmed detail was not invalidated.
- Fix: invalidate affected detail queries too, including relevant collection changes.
- Regression: view, edit/delete, revisit immediately.

### B13 — P2: Help cache does not distinguish language

- Evidence: [help keys](../../src/app/(dashboard)/help/page.tsx#L47), [detail key](../../src/app/(dashboard)/help/[slug]/page.tsx#L38), [preference save](../../src/components/profile-language-preference.tsx#L30).
- Result: saved preference affects API results but neither keys nor invalidation distinguish language, allowing old-language content with newly translated interface.
- Fix: include effective language in localized query keys or invalidate all affected help queries when preference changes.
- Regression: English cached help → save French → immediate revisit.

### B14 — P2: Impossible calendar dates pass server form validation

- Evidence: [date validation](../../src/lib/ticket-form/validation.ts#L120).
- Result: `Date.parse` normalizes impossible dates. Actual validator accepted `2026-02-31` and rejected `2026-13-01` in an isolated execution.
- Fix: strict calendar validation/round-trip year-month-day comparison.
- Regression: invalid day/month, leap/non-leap February, valid ISO date.

### B15 — P2: Partial multi-file upload loses successful file references

- Evidence: [upload loop](../../src/components/ticket-form/dynamic-ticket-form.tsx#L63).
- Trigger: first temporary upload succeeds, second fails.
- Result: `onChange` runs only after the entire loop; the successful file is absent from form state while its temporary record consumes quota until expiration. This is confirmed by control flow, not a live upload test.
- Fix: retain successful references as each upload completes, report failed files individually, and avoid overwriting changes made during the batch.
- Regression: partial failure, retry, removing a file during upload, and quota behavior.

### B16 — P2: Relative attachment paths differ in local standalone runtime

- Evidence: [storage root](../../src/lib/attachment-storage.ts#L20), [migration root](../../scripts/migrate-private-attachments.mjs#L10), [standalone launcher](../../scripts/start-standalone.mjs#L9), generated `.next/standalone/server.js` calls `process.chdir(__dirname)`.
- Result: default/relative paths resolve to repository `storage/attachments` for migration/backup, but `.next/standalone/storage/attachments` for the server. Path probe confirmed different absolute paths.
- Scope: manually configured local/default-relative deployments. Setup writes absolute storage paths and Docker uses an absolute configured path, so the current Docker test is not affected.
- Fix: normalize one absolute application-root storage path before importing standalone server; reuse it across runtime/migration/backup/restore.
- Regression: local standalone default/relative/absolute paths and Docker path; migrated file can still be downloaded and included in backup.

## Presentation, accessibility and error-handling fixes

- **C1: Form controls misalign:** renderer lines 102–106 put variable-height help before controls. Put help below controls, maintain consistent label/control structure, and test wrapping labels/helpers at mobile and desktop sizes. Fix the shared renderer rather than patching HR alone.
- **C2: Duplicate checkbox labels / incomplete accessible associations:** renderer lines 103/139 repeat labels; several controls do not associate helper/error text and multi-select labels target a div. Use a single label, fieldset/legend where appropriate, and stable help/error IDs.
- **C3: Unclear ticket hierarchy:** description around ticket page line 545 has no author/time; custom submission fields at line 897 are buried after actions/timeline/details. Proposed layout below.
- **C4: Error responses look like empty/missing data:** ticket detail line 363 shows “Ticket not found” for failed reads; users query line 111 accepts an error object later used as an array. New-ticket department/category errors have no visible retry state; other dashboard/admin reads can show empty counts/lists. Add status-aware errors/retry, validate response shapes, and preserve usable cached content.
- **C5: Routing prompts on untouched defaults:** new-ticket lines 34/126 treat default NORMAL priority as entered data. Isolated probe confirmed the discard prompt occurs without editing. Track user edits relative to defaults.
- **C6: Invalid option retained after template change:** new-ticket line 42 checks only field key/type, preserving a dropdown value absent from new options; isolated probe retained Old when only New was allowed. Preserve values only when compatible with the new definition; tell the user which values were cleared.
- **C7: Ticket updates leave other caches stale:** ticket PATCH success around line 150 invalidates detail only; lists/inbox/dashboard can retain old status/priority. Share affected query invalidation with assignments/create/withdraw actions.
- **C8: Incomplete French UI:** detail page and shared form renderer contain untranslated chrome, Yes/No, file controls and errors; several list/admin pages similarly bypass the translator. Translate UI-owned strings. Template-authored labels/content need an explicit content language strategy rather than pretending a string lookup translates arbitrary text.

## Update checker explanation and proposed correction

The configured default source is `https://raw.githubusercontent.com/TahaHydra/CompDesk/main/updates/manifest.json` ([service](../../src/lib/update-service.ts#L9)). A fresh public HTTP check during this audit returned **404**. The manifest exists in this local uncommitted work, but is not available at that public URL. GitHub Releases existing does not make this separate manifest exist.

Publish the validated manifest through the intended XHydra-controlled release process, or configure `COMPDESK_UPDATE_MANIFEST_URL` to an existing public HTTPS manifest. Then Check now refreshes the shared cache. Do not invent a newer release or silently call the installation up to date when the source fails. The Updates settings tab already sits after Webhooks. Recovery history remains unknown/no managed recovery point; this is accurately informational, not a rollback capability.

## Proposed ticket layout — first separate commit

Keep the title/key/status and Claim Ticket/Withdraw header positions. Below it:

| Main column: read the request | Side column: context then action |
| --- | --- |
| Request card: colored requester avatar/name, “Requested by”, created time | Details first: requester, department/category, assignees, dates/SLA |
| Clearly titled description | Actions below Details |
| Submitted answers directly under description, preserving historical labels and role filtering | Reminders below Actions when implemented |
| Attachments with author/context | Collapsible technical timeline, watchers |
| Conversation: own entries right, other entries left, names/times always visible | |
| Public reply/internal-note composer | |

Use subtle tint and explicit labels, not color alone. Internal notes keep a clearly distinct badge/background. Show the opening request as authored content; avoid duplicating description/title as custom fields. Render dates, booleans, arrays and files by stored field type. Preserve text wrapping and a single readable flow on mobile. This remains a helpdesk ticket page.

Include alignment/accessibility improvements in this ticket UI commit, with EN/FR and focused rendering regression tests. Keep privacy fixes, data changes and mail/reminder features in later separate commits as requested.

## Microsoft 365 / Exchange Online with an Entra enterprise app

Recommended new sending mode: **Microsoft 365 (Entra application)** alongside existing SMTP. Reuse the existing `sendEmail` interface and email templates. Settings remain SUPER_ADMIN-only.

- Dedicated mail application, tenant/client IDs, sender mailbox and encrypted application credential (support a documented certificate option where deployment permits secure private-key provisioning).
- App-only client credentials with server-side cached access tokens; never reuse signed-in users' SSO tokens.
- Microsoft Graph `POST /users/{fixed-sender}/sendMail` with Exchange Application RBAC `Application Mail.Send` scoped to that mailbox. Avoid an additional organization-wide Entra Mail.Send grant: grants are additive. [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), [Exchange Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).
- Explicit test-send action and useful configuration/throttling diagnostics. Graph 202 means accepted, not delivered; UI must reflect that distinction. Keep message/credential contents out of logs.
- If SMTP protocol is specifically required, an alternative is app-only SMTP OAuth (`SMTP.SendAsApp`, Exchange service-principal registration/mailbox rights, XOAUTH2). That still depends on SMTP AUTH tenant policy. [Microsoft SMTP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), [Nodemailer OAuth2](https://nodemailer.com/smtp/oauth2).

This is a new feature. No tenant configuration/permissions, credentials or real email sends were changed by the audit. Live tenant testing needs the user's configured application/mailbox.

## Ticket reminders — proposed first scope

Add a compact **Remind me** control in the ticket sidebar, with date/time, optional private note, and in-app/email delivery choice. Show upcoming reminders with edit/cancel, localized times and an explicit timezone. Each reminder belongs to its creator and requires current ticket access; it must not create a public conversation entry containing the private note.

Persist reminder schedules and recipient deliveries in PostgreSQL. A server worker uses the existing startup/lease/retry patterns from webhooks, with unique occurrence keys, attempts, next-attempt time and dispatch status. Recheck active user, ticket access and ticket status immediately before delivery; cancel on withdrawn/closed/resolved tickets or revoked access. Handle restarts, reschedules, competing workers, provider throttling and ambiguous send failures. Do not promise exactly-once delivery through external mail APIs.

The bell currently derives events from ticket timelines, so private reminder notifications need persisted per-user records. Reuse presentation/permissions, not the shared timeline as a private inbox. Existing email sends discard fire-and-forget delivery outcomes; a durable delivery queue is necessary for dependable reminders. Automatic due-soon/overdue SLA reminders can be a later optional policy rather than expanding the first manual-reminder feature.

## Proposed execution and validation order

1. Ticket readability/alignment/localization commit, independently reviewable.
2. Privacy/access fixes A1–A4 with real boundary regression tests (small commits per problem).
3. Functional fixes B1–B16 and remaining C error/cache/routing defects, grouped by subsystem.
4. Microsoft 365 mail provider and configuration/documentation/tests.
5. Persisted ticket reminders and delivery/restart tests.
6. Focused suites, full Jest, lint, typecheck, production build; isolated fresh-install/demo install/remove tests; browser verification in EN/FR and mobile/desktop. Keep current app data intact and perform destructive lifecycle tests only in an isolated disposable database.

Existing update/demo changes must not be accidentally included in the separate ticket-layout commit. Manifest publishing is a separately reviewable release artifact step.

## Checks run in this audit

- Full Jest: **58 suites, 458 tests passed**.
- ESLint: passed with zero warnings.
- Typecheck: passed.
- Additional existing focused checks: auth/data 10 suites/90 tests; admin/runtime 8 suites/88 tests and 35 Node tests (overlap with full suite).
- Isolated reproductions: privacy projections, unauthorized notifications/list, attachment download, creation recipients, SLA restart, counter rollover, SMTP override/TLS, pagination/filter transitions, help cache, empty-description serialization, invalid calendar date, untouched-default prompt, changed dropdown options and storage-root mismatch.
- Browser: read-only inspection of Marie Curie's full submitted request and current meeting-room ticket.
- Manifest: public HTTP **404** confirmed.
- Initial sandboxed Jest had temporary-fixture cleanup permission failures; rerun with the required filesystem access passed completely. Those cleanup failures were environmental, not new product defects.
- No new production build was needed/run for this report-only change. Previous feature build evidence is separate; all approved implementation must be rebuilt and reverified.

The green existing suite does not cover the reproduced defects. Add behavioral regressions for these cases before claiming the fixes complete.
