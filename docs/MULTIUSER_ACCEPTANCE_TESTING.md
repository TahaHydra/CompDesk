# Review branch: multi-user bug testing pending

**Status: NOT acceptance-tested for bugs yet. Do not treat this branch as release-ready.**

Planned acceptance review: **3 October 2026**. This is a testing target, not a scheduled automated job.

Branch: `codex/review-pending-multiuser-tests-2026-10-03`.

Automated regression tests, lint, typecheck, production builds, isolated security regressions and local HTTP checks have already run. Those checks do **not** establish that every user journey, button, concurrent operation or enterprise configuration works. Full multi-user browser acceptance testing remains pending. A finite test plan cannot guarantee the absence of all bugs.

## Safe test installation

- Use an isolated test installation and disposable accounts/data. Do not reset a production database.
- Use separate browser profiles/sessions: two USER accounts, two AGENT accounts, one ADMIN and one SUPER_ADMIN. Include different departments, overlapping assignments and a user with no department access.
- Keep an unchanged Super Admin recovery account. Record the exact Git commit, image, browser, language and deployment configuration used.
- Use a local mail capture server/test mailbox. Enterprise Graph testing requires a configured test Microsoft tenant and approved test recipients; it has not been live-verified yet.
- Test English/French, light/dark mode, a desktop width and a narrow mobile width. Check keyboard navigation and visible focus.

## Acceptance checklist — all pending

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
| Live Microsoft tenant flow | To record | Test tenant/accounts | Linking and Graph delivery behave safely | Not executed yet | **Pending** |

Record confirmed bugs with reproduction steps, affected roles, expected/actual behavior and sanitized screenshots/logs. Fix and rerun the affected scenario plus related regressions. Keep credentials, tokens, real customer data and personal contact details out of committed evidence.

Release/merge acceptance requires the checklist results, reviewed unresolved defects and the explicit decision of the maintainer. Passing automated tests alone does not complete this review.
