# Review branch: acceptance results and remaining coverage

**Status: the required deployment/authentication/attachment acceptance checks passed. The broader browser checklist below remains partially unexecuted; merge and release require the maintainer's decision.**

Planned acceptance review: **3 October 2026**. This is a testing target, not a scheduled automated job.

Branch: `review-pending-multiuser-tests-2026-10-03`.

Automated regression tests, lint, typecheck, production builds, isolated security regressions and local HTTP checks have already run. Those checks do **not** establish that every user journey, button, concurrent operation or enterprise configuration works. Full multi-user browser acceptance testing remains pending. A finite test plan cannot guarantee the absence of all bugs.

## Safe test installation

### Acceptance test environment used

Repository: your local CompDesk checkout. Run the commands below from its root.
Branch: `review-pending-multiuser-tests-2026-10-03`.
Starting head: `d58a28f9 Add update awareness, managed demo data and pending acceptance plan`.

This is an isolated Docker Desktop acceptance stack on Windows, with usable IPv4
Internet connectivity and no usable IPv6 route. SMTP succeeded. Microsoft's DNS
returned IPv6 addresses for the unspecified-family lookup; an explicit IPv4 HTTPS
request succeeded. The later acceptance-only override supplied Entra credentials
while investigating configuration and networking; it is private, ignored by Git
and Docker builds, and is not required by the corrected managed deployment.

```powershell
git fetch origin
git switch review-pending-multiuser-tests-2026-10-03
git pull --ff-only
git log -1 --oneline

$env:COMPOSE_PROJECT_NAME="compdesk-acceptance"
$env:POSTGRES_VOLUME_NAME="compdesk_acceptance_pgdata"
$env:UPLOADS_VOLUME_NAME="compdesk_acceptance_uploads"
$env:ATTACHMENTS_VOLUME_NAME="compdesk_acceptance_attachments"
$env:CONFIG_VOLUME_NAME="compdesk_acceptance_config"
$env:APP_PORT="3200"
$env:APP_BIND_ADDRESS="127.0.0.1"

docker compose -p compdesk-acceptance `
  -f docker-compose.yml `
  -f docker-compose.build.yml `
  up -d --build

docker compose -p compdesk-acceptance `
  -f docker-compose.yml `
  -f docker-compose.build.yml `
  ps

docker compose -p compdesk-acceptance `
  -f docker-compose.yml `
  -f docker-compose.build.yml `
  logs -f compdesk
```

Setup URL: `http://localhost:3200/setup`.
Microsoft redirect URI: `http://localhost:3200/api/auth/callback/microsoft-entra-id`.

The acceptance-only Compose override is local diagnostic tooling. Do not use it in the supported deployment or distribute it with the repository.

Entra settings saved from setup or Settings use the private config volume's
`secrets/runtime.env`. Restart **only CompDesk** after saving Entra settings:

```powershell
docker compose -p compdesk-acceptance -f docker-compose.yml -f docker-compose.build.yml restart compdesk
```

The runtime prefers IPv4 and explicitly recovers A records if the container
resolver supplies only AAAA records for an unspecified family; IPv6 fallback and
certificate verification remain enabled. Next.js uses a bounded, writable tmpfs
cache while the root filesystem remains read-only. Startup and readiness compare
the actual database columns with the generated Prisma client in addition to
checking migration history. The corrective attachment migration is additive;
never edit already applied migrations or use `db push` to bypass release history.

- Use an isolated test installation and disposable accounts/data. Do not reset a production database.
- Use separate browser profiles/sessions: two USER accounts, two AGENT accounts, one ADMIN and one SUPER_ADMIN. Include different departments, overlapping assignments and a user with no department access.
- Keep an unchanged Super Admin recovery account. Record the exact Git commit, image, browser, language and deployment configuration used.
- Use a local mail capture server/test mailbox. Enterprise Graph testing requires a configured test Microsoft tenant and approved test recipients; it has not been live-verified yet.
- Test English/French, light/dark mode, a desktop width and a narrow mobile width. Check keyboard navigation and visible focus.

## Focused acceptance findings — 3 October 2026

Verified against the rebuilt Windows Docker Desktop stack on localhost:3200:

- The new migration repaired `temporary_attachments.blob_removed_at` without
  resetting the installation. Startup verified the generated-client columns,
  and readiness returned HTTP 200.
- 46 authenticated HTTP checks passed using five disposable test accounts:
  temporary uploads, ticket creation, uploads/downloads for USER/AGENT/ADMIN/
  SUPER_ADMIN, invalid signatures, oversized files, anonymous download denial,
  unrelated-agent denial, internal attachment privacy in direct downloads and
  ticket responses, and absence of a public static attachment URL.
- Super Admin password resets worked for all four roles. Password hashes matched
  the generated passwords; session versions increased and stale cookies were
  rejected. USER, AGENT and ADMIN reset attempts were denied.
- Managed Docker Entra saves succeeded. The OIDC diagnostic and expected callback
  URI passed; Microsoft accepted the supplied application credentials in a
  client-credentials token request. After the final rebuild, the maintainer
  completed browser Microsoft sign-in and a clean sign-out/sign-in repeat,
  confirming the expected Profile identity. Server audit records confirmed the
  existing linked Super Admin account. No browser tokens were collected and no
  Graph mail delivery was exercised.
- Demo visibility saves were accepted for Super Admin and denied to other roles.
- Read-only root and bounded cache mount were retained. Actual Next.js image
  optimization returned HTTP 200 after restart. Public and authorized internal
  attachment downloads retained their bytes after restart; requester access to
  internal attachments remained denied.
- Final full Jest: 75 suites / 564 tests passed. The setup/network/schema and
  Entra-security Node suite: 64 tests passed. Typecheck, lint, local production
  build, and Docker production build passed.
- A read-only code review found no Critical or Important issue in the product
  diff it examined. This is not a claim that the application has no bugs.

The final rebuild used the supported Compose files without the private
acceptance-only override. The local finalization script passed all 10 checks,
including readiness, Entra runtime configuration, image optimization, restart
persistence/privacy, the authorization redirect, restoration of original demo
visibility, and removal of only the five disposable acceptance accounts and
their test department/ticket/files. The backup was read through a separate
temporary database; the active installation was never restored or reset.

Fresh installation/demo lifecycle integration passed all 8 tests in disposable
databases. The previous-release migration rehearsal preserved existing users,
tickets and assignments, applied all 18 migrations, and verified the actual
columns against the generated Prisma client. Real-database account-linking
integration passed, including rejection of a different local account attempting
to take ownership of an existing Microsoft identity. These tests removed their
own disposable databases/accounts.

Three additional HTTP checks passed after the final rebuild: a new temporary
upload, a new ticket attachment with authenticated byte download, and anonymous
download denial. Their disposable account/department/ticket/files were removed.
Browser inspection confirmed demo visibility controls in Demo data, only the
informational demo note in Branding, a successful Entra diagnostic, and the
separate Profile linking action.

Startup/runtime logs contained no missing-column, Microsoft network/fetch,
Next.js cache, or unhandled-rejection failures. Two callbacks were rejected for
invalid PKCE verifier state during interactive testing; successful sign-ins
followed. The precise origin of those rejected callbacks was not investigated
through browser history or tokens. PKCE and account-ownership protections remain
enabled. Normal startup completed migrations and schema verification cleanly.

### Microsoft sign-in session conflict found during acceptance

The server recorded `OAuthAccountNotLinked: The account is already associated
with another user`. Database inspection confirmed that the enterprise user
already had an active Microsoft provider binding. This specific error occurs
when a different CompDesk account is still authenticated in the browser; it is
distinct from the earlier Entra configuration and network failures.

The public login-page Microsoft button now ends the existing CompDesk session
before starting Microsoft sign-in. The authenticated **My Profile → Link my
Microsoft account** flow retains its session and ownership checks. Email-based
automatic linking remains disabled. The error message provides recovery steps
even when local login is disabled, and the configured branding support address
is labeled separately. Support contact settings are not changed automatically.

Focused coverage verifies sign-out ordering, failure handling, account-conflict
guidance, and rejection of cross-user provider linking. Interactive Microsoft
sign-in and the clean-session repeat passed after the final deployment.

## Beta.3 packaging regression — 3 October 2026

The beta.3 dependency classification fix retained all locked package versions and
Tailwind 3 configuration. Clean production installation/audit passed with zero
production findings; the unpatched development-tool advisory is described in
[the dependency assessment](audits/2026-10-03-beta3-dependencies.md).

Final local verification passed 76 Jest suites / 565 tests, lint, typecheck,
production build, 71 runtime/release Node tests, schema validation and the pinned
Compose parse. The rebuilt Docker runtime excludes the vulnerable build-only
chain and retains byte-identical compiled CSS. Sixteen live checks covered
readiness, active Entra configuration/diagnostic, image-cache writes, fresh
temporary/public/internal uploads, authorized bytes and denied downloads before
and after restart, and removal of only disposable probe records/files. Runtime
logs were free of unexpected network/schema/cache/unhandled errors.

These checks preserve the earlier real Microsoft sign-in/repeat evidence; no
additional human browser tokens were collected. Hosted CI/security, image scan
and publication are independently required by [the release checklist](PUBLIC_RELEASE_CHECKLIST.md).

## Full browser acceptance checklist — pending

For every button/link below, test the allowed role, a denied role where applicable, success, invalid input, double click, cancelled confirmation, failed request and retry. Verify saved changes after reload and from another session. Check server responses as well as UI visibility.

| Area | Scenarios to exercise with multiple users |
| --- | --- |
| Installation and demo data | Fresh setup with and without demo data; generated demo credentials; sign in as every role; restart; install/delete/reinstall demo data. Preserve the installation Super Admin, settings and personally created tickets/users. Cancel destructive confirmations and verify nothing changed. |
| Authentication and permissions | Local login/logout, invalid credentials, password changes, deactivation and role/membership removal while another session remains open. Verify old sessions lose access. Existing Microsoft binding, explicit authenticated linking, email collision rejection and revoked-session linking. Check department boundaries in pages, search, notifications, API clients and downloads. |
| Ticket creation and forms | Every field type and template source; required/optional fields, helper text wrapping, checkbox alignment, invalid dates/options and empty forms. Upload/paste/remove files, cancel and retry submission. Verify immutable historical answers, requester identity, description and submitted data remain understandable. Test role-restricted fields and files, including built-in title/description/priority aliases. |
| Ticket lifecycle | Claim, assign/unassign, add multiple assignees, edit status/priority/category/tags, escalate, withdraw, resolve, close and reopen. Two agents act on the same ticket concurrently: stale edits must be rejected without overwriting the other user's change. Verify SLA deadlines, counters, timeline and recipient lists. |
| Conversation and attachments | Requester/staff replies on their respective sides, internal notes, attachments and deleted comments. Requesters and unauthorized departments must not see internal files or restricted form files, even through direct URLs. Authorized roles can download; read-only field permissions prevent removal. Verify restricted priorities do not crash dashboard, inbox or detail. |
| Reminders and notifications | Create/edit/cancel personal reminders, reload and sign out/in, delivery after restart, email failure/retry, terminal ticket states, lost access and deactivation. Confirm another user cannot read/change a reminder. Verify bell counts and accessible ticket links without exposing hidden title/priority values. |
| Mail and enterprise sending | SMTP STARTTLS/implicit TLS, connection check, real-send test to a test mailbox, environment/database overrides and encrypted secrets. Microsoft Graph app credentials, permission guidance, test sending, invalid/expired credentials and switch back to SMTP. Verify errors are useful and never expose secrets. |
| Settings and administration | Every settings tab and its Save/Reset/Test/Copy/Open buttons, consistent action placement, loading/disabled states and unsaved inputs. Departments, categories, templates, tags, users, memberships, API clients and webhooks: create/edit/revoke/cancel and concurrent changes. Confirm ADMIN cannot use Super Admin configuration or privileged update actions. |
| Updates, recovery and About | Up-to-date, newer normal, critical, malformed and unavailable manifest; manual refresh/cache/rate limits; automatic checks on/off. Collapse per user and per release, new-release reappearance and persistent red critical indicator. Privileged instruction access; truthful recovery/health state. Verify services appear only for ADMIN/SUPER_ADMIN and links/email are correct. |
| Lists, dashboard and help | Filters, search, sorting, pagination, empty/error/loading states, restricted values and urgent counts. Check cache refresh after edits from another session. Help search/content access, branding, translation, navigation, dialogs and responsive layouts. Every visible control must either work or explain why disabled. |
| Runtime and recovery | Restart and readiness, migration status, private storage, legacy attachment migration, existing upload placeholders and preserved files. Rehearse documented backup/restore on disposable infrastructure; verify application/database/configuration compatibility. No implied rollback just because an older image exists. |

## Record results before merging

Use this log for each scenario; leave unexecuted items marked **Pending**, never **Pass**.

| Scenario | Commit/image | Role/session | Expected result | Actual result/evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Full multi-user acceptance review | To record | All roles | Complete the checklist above | Not executed yet | **Pending** |
| Linked Microsoft sign-in and clean repeat | Final acceptance rebuild, 3 October 2026 | Existing linked enterprise account | Return to the correct CompDesk account | Maintainer confirmation and successful server audit records | **Pass** |
| Microsoft linking ownership | Final acceptance tree, 3 October 2026 | Two disposable local accounts | Existing provider identity cannot be taken over | Real-database Auth.js integration and security regressions passed; Profile action inspected | **Pass** |
| Graph mail delivery | To record | Test tenant/mailbox | Approved test recipients receive Graph messages | Not executed yet | **Pending** |

Record confirmed bugs with reproduction steps, affected roles, expected/actual behavior and sanitized screenshots/logs. Fix and rerun the affected scenario plus related regressions. Keep credentials, tokens, real customer data and personal contact details out of committed evidence.

Release/merge acceptance requires the checklist results, reviewed unresolved defects and the explicit decision of the maintainer. Passing automated tests alone does not complete this review.

## Beta.3 publication verification — 3 October 2026

The maintainer authorized this public beta with the pending items above disclosed. Release source: `9906f36c04f88845341e13918d59a63ca16eb232`, tag `v0.9.0-beta.3`.

- [Merged-source CI](https://github.com/TahaHydra/CompDesk/actions/runs/37131823208): 76 Jest suites / 565 tests, lint, typecheck, production build, migration upgrade, fresh setup and backup/restore passed. Production dependency audit: zero findings.
- [Merged-source security](https://github.com/TahaHydra/CompDesk/actions/runs/37131823043): secret scanning, CodeQL and container checks passed. GitHub marked all four historical Nodemailer alerts fixed; the development-only brace-parser exposure remains documented in the dependency assessment.
- [Tagged-image publication](https://github.com/TahaHydra/CompDesk/actions/runs/37132109080): the scanned and anonymously pulled image has the same digest, `sha256:3e58277b453c91d11341a3fb160f8657ac778c8713da86ffa9fa2b06e6f6d362`.
- The public image passed 11 disposable bundled-PostgreSQL installation/restart checks: protected setup, additive migrations, automatic production transition, readiness, sign-in, setup retirement and writable image cache. Build-only CSS/brace dependencies are absent and runtime logs contain no unexpected errors. Existing acceptance volumes were preserved.
- The [public release](https://github.com/TahaHydra/CompDesk/releases/tag/v0.9.0-beta.3) is the newest release. Its anonymously downloaded, version-pinned Compose asset matches the generated bytes: SHA256 `278f61112a30c40f5970e9826ee10f7c1241081d5c7f2806c9525f688b3cf173`.

This publication record does not convert the broader browser checklist or live Graph mailbox delivery from Pending to Pass.
