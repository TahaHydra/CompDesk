# CompDesk UX improvements: work plan (v2, for review)

Status: **proposal, nothing implemented**. Every phase is its own branch and PR, released and tested before the next one starts.

## Decisions taken

| # | Topic | Decision |
|---|---|---|
| D1 | Deleted message content | **Super Admins only** can read it. Fix the wording that overpromises. |
| D2 | Saved replies | **Staff only**: Agent, Department admin, Super Admin. Requesters never see them. **Personal** in v1. |
| D3 | Person card | **Always shows identity**, so you know who you're talking to. Sensitive fields (email, etc.) follow an **org-wide privacy setting**. The default is **"only people with a higher role than you"**; Super Admins see everything. |
| D4 | Help suggestions | **Linked per category only.** No usage tracking, no "suggest as you type". |

## v3 refinements after external review (these override anything below)

1. **Privacy is role *and* relationship, not role alone.**
   - **Relationship is always required.** Contact fields are only ever computed for people the viewer has a *working relationship* with:
     - they appear on a ticket the viewer can access (as requester, assignee or visible message author), or
     - for staff only, they are staff in a department the viewer belongs to or administers.
     - Super Admins: anyone. Yourself: always.
   - **Department admins rank as admin only where they administer.** A department admin counts as "admin" only toward people reached through a department it administers. Everywhere else it counts as an agent.
     - So an IT admin on an IT ticket sees the requester's email (your case).
     - An HR admin with no link to an IT agent sees nothing.
   - **The levels unchanged:** Higher roles only (default) · Same role and higher · All staff · Everyone. Each level applies *on top of* the relationship.
2. **The card endpoint checks both sides.** The viewer can access the ticket **and** the person actually belongs to that ticket. Otherwise it returns 404.
3. **Requesters see less about staff:** only the department of *their ticket*, never all of a staff member's departments, and no "inactive" status.
4. **Search can't leak hidden emails.** User search drops a result that matched *only* on an email the viewer isn't allowed to see. Every API that returns emails goes through the same policy helper. Cards are cached for a short time (60 s) and refetched when opened.
5. **No "Admin → Users" exception.** That page is already Super Admin only, and Super Admins see everything anyway.
6. **Attachments with no recorded uploader** (`uploaderId` null) can't be deleted by requesters.
7. **Help suggestions** require the article **and** its collection to be published. The department-admin category whitelist is extended *only* by the suggested-articles field.
8. **Legacy canned responses are kept.**
   - `/api/canned-responses` stays and is not removed in beta.9.
   - Its entries appear read-only as a "Shared" section in the Saved replies popover, so existing data is usable instead of stranded.
9. **Profile fields.** Add only an optional **job title** in beta.8, editable in Profile and by Super Admins in Admin → Users. No phone, and no SSO sync.
10. **Upgrade rehearsal.** `scripts/validate-migration-upgrade.mjs` is pinned to an old baseline (`20260727130000_add_multiple_ticket_assignees`). Move it to the latest released schema (beta.5.1) so new migrations are rehearsed against what users actually run.
11. **Not breaking today's behaviour.** Today, staff see all emails. The new default (higher roles only) is stricter, so it is called out in the release notes with the one-click way back ("All staff").

## Rules every phase follows

- **Upgrades stay "pull the image, `docker compose up -d`".**
  - Migrations are additive only (new tables or nullable columns, no drops or renames) and apply automatically on start.
  - Each is covered by `migration-contract.test.ts` and `npm run test:migration:upgrade`.
- **Security is enforced on the server; the UI only hides what the server already refuses.**
  - Strict zod input.
  - Owner or ticket-access scoping in every query; another user's object returns 404, so nothing can be enumerated.
  - Rate limits on writes.
  - `auditLog` on changes, recording metadata only and never message content.
- **No new npm dependencies.** Reuse the Radix popover, tooltip, dialog, dropdown and multi-select we already have.
- **The design matches what's already there:** same card, spacing, badges and icons. No new colours or decorative UI. Every new string gets a French entry.
- **Each PR ships with:**
  - Jest tests for permissions, contracts and layout.
  - Docs: `USER_GUIDE`, `API_REFERENCE`, release notes with an "API changes" section.
  - Updates to the demo dataset.
  - A check in the demo stack: light and dark, FR and EN, narrow screen, each role.
- **No new sidebar entries.** Settings live where people already look for them (see "Where settings live").

---

## Phase 0: Tags control spacing (XS)

**Problem.** In the ticket's Actions card, the "Tags" label is inline and the "Add tags" button isn't full width (`tickets/[id]/page.tsx:898-909`, `tag-picker.tsx:43`). With no tags, they sit glued on one line. Status, Priority, Category and Assignees use full-width block controls.

**Fix.**
- Make the label `block`.
- Let `TagPicker` accept a `className` and give it `w-full`.
- Add `gap-4` to the Details-card tag row.

**Test.** Add an assertion to `ticket-layout.test.ts` and check it in the browser.

---

## Phase 1: Deletion and visibility tightening (M, security)

### Today (verified in code)

| Role | Delete own message | Delete others' | After a delete, sees | Audit log |
|---|---|---|---|---|
| SUPER_ADMIN | yes | yes, any ticket | **original text** with a "Deleted · history retained" badge | yes (only this role) |
| ADMIN (department) | yes | yes, any ticket it can reach | `[Deleted comment]` | no |
| AGENT | yes | no | `[Deleted comment]` | no |
| USER (requester) | public replies only | no | `[Deleted comment]`; deleted internal notes are hidden | no |

### Fixes

1. **Honest wording.** The delete dialog says "visible to Super Admins" (D1). The attachment dialog says the file is **permanently removed** and only its name and size are kept, which is what actually happens.
2. **Moderation follows the department.** Editing or deleting someone else's message requires being admin *of that ticket's department*, not just having the ADMIN role somewhere. Only a Super Admin can moderate a Super Admin's messages.
3. **Attachments.** Requesters may delete only files they uploaded themselves; today they can delete agents' files on their ticket. The trash button is shown only to people the server will actually allow.
4. **Visible moderation.** Staff see "Deleted by {name} · {time}" on the placeholder. Requesters keep the plain placeholder.
5. **Email leak.** The ticket list currently sends staff emails and roles to requester accounts. Remove them now; Phase 3 later re-exposes them only where the privacy setting allows.

**API changes (release notes).**
- `GET /api/tickets` no longer returns assignee email and role to USER accounts.
- Moderation endpoints return 403 in the newly restricted cases.

**Out of scope, noted for later:** a full edit-revision history. Today only the first 200 characters of the previous version are kept, in the audit log.

---

## Phase 2: Saved replies (M, staff only)

### Current state

- An unused `CannedResponse` table and `/api/canned-responses` exist. They are global, with no owner and no edit or delete, and any agent can create entries.

### Design

- **New `SavedReply` table:**
  - Fields: `id, ownerId → User (cascade delete), title (≤ 80), content (≤ 10,000, same as replies), useCount, lastUsedAt, createdAt, updatedAt`.
  - Titles are unique per owner.
  - Each user can have at most 200 replies.
- **API:**
  - `GET/POST /api/saved-replies` and `PATCH/DELETE /api/saved-replies/{id}`.
  - `POST /api/saved-replies/{id}/use` bumps the usage counter, so the list is ordered by most used.
  - Staff roles only; requesters get 403.
  - Every query is scoped to `ownerId = me`.
  - Audit records title and length, never content.
- **In the reply box,** a "Saved replies" button sits right-aligned in the empty space next to "Public reply / Internal note". It opens a popover with:
  - A search box (title and content) and keyboard up/down/enter.
  - The list: title, plus a one-line preview.
  - Clicking **inserts at the cursor**. It never replaces your draft and never sends.
  - Footer: **"+ Save current reply"**, which asks for a title and is disabled when the box is empty.
- **Managing them:** Profile → "My saved replies" (staff only). Create, edit, rename and delete, with a search.
- **Plain text only:** content is inserted into the textarea as text, so no new HTML rendering and no XSS risk.
- **Old canned responses:** the endpoint is marked **deprecated** in this release and removed in the next. The old table is left untouched; removing the demo data cleans it up.

**Later (not in this phase):**
- Department-shared replies managed by department admins.
- Placeholders such as `{requester.firstName}` and `{ticket.key}`.

---

## Phase 3: Person card and privacy setting (M–L)

### 3a. The person card (everywhere a name appears)

- **One shared `<PersonName>` component** replaces the roughly 10 places that render names separately: requester, assignees, message authors, watchers, presence, ticket lists, queue and dashboard.
- **How it opens:** hover on desktop (short delay) and click or tap on touch screens. It is keyboard accessible (Enter opens, Esc closes).
- **The card is fetched only when opened** and cached, so lists don't get slower.

**What the card shows:**

| Section | Field | Who sees it |
|---|---|---|
| **Identity** (always, can't be hidden) | Photo or initials, name, "You" if it's you | everyone who can see the person |
| | Role label: *Requester*, *Agent*, *Department admin* or *Super Admin* | everyone |
| | Departments (for staff) | everyone |
| | "Inactive account" badge | everyone |
| **Contact and profile** (governed by the privacy setting) | Email, with copy and mailto | default: higher role only |
| | Preferred language (helps reply in the right language) | default: higher role only |
| | Job title, phone (3c, optional) | default: higher role only |
| **Work context** (staff only, not configurable) | "Open tickets from this person: N", linking to the filtered ticket list, counting only tickets *you* can access | staff |
| | "Manage user" link | department admins and Super Admins |

**Same names.**
- Every message author shows a small role tag ("Requester", "Agent", "Admin").
- Your own messages say "You".
- If two different people in the same view share a name, a short hint (their department, or the first part of their email if you're allowed to see it) is shown next to the name. The card always settles it.

**Who can open whose card (server-enforced).** `GET /api/users/{id}/card?ticketId=…`
- **Staff:** anyone on a ticket they can access, plus anyone in their departments.
- **Requesters:** only people who appear on their own tickets (requester, assignees, message authors).
- **Anything else returns 404,** so IDs can't be probed.

### 3b. The privacy setting (org-wide)

The setting lives in **Admin → Settings → Privacy (new tab)**, alongside Security and SSO. It is **Super Admin only**, like every Settings tab.

> **People and privacy**
> *Who can see each person's details on cards, ticket pages and pickers.*
>
> | Field | Visible to |
> |---|---|
> | Email | [ Higher roles only ▾ ] |
> | Preferred language | [ Higher roles only ▾ ] |
> | Job title | [ … ] (only if 3c is built) |
> | Phone | [ … ] (only if 3c is built) |
>
> Options: **Higher roles only** (default) · **Same role and higher** · **All staff** · **Everyone**
> *Super Admins always see everything. Everyone always sees their own details. Admin → Users always shows emails to admins.*
>
> **Preview:** [ As a requester ▾ ] looking at [ an agent ▾ ], showing the card as it would appear.

- **Ranking:** Super Admin > Department admin > Agent > Requester.
- **Example:** a 50-person company sets Email to **Everyone**, and everybody can then see emails, including requesters looking at agents.
- **Storage:** an `AppSetting` key `people.visibility` (JSON validated with zod, safe defaults if missing or invalid), cached the same way `feature-flags.ts` is. No migration needed. Changes are audit-logged.
- **One rule everywhere:** the same check drives the card, the ticket page, the assignee and watcher pickers, and the API responses. The only exception is the Admin → Users management screen. It also replaces the email that's hard-coded today in the assignee cards and pickers.
- **Per-user opt-out** ("hide my email"): not in v1. The organisation's policy decides, which keeps the behaviour predictable. It can be added later if asked for.

### 3c. Optional profile fields (decide whether you want them)

- **Fields:** nullable `jobTitle` and `phone` columns on User.
- **Who edits them:**
  - Each user, on their Profile page.
  - Admins, in Admin → Users.
  - Optionally filled from SSO claims (Entra `jobTitle` / `mobilePhone`, or the OIDC `phone_number` claim) on sign-in.
- **Visibility:** governed by the same privacy setting.

**API changes (release notes).**
- New card endpoint.
- Email and language in the ticket and user APIs now follow the privacy setting. With the default, this is the same as today or stricter.

---

## Phase 4: Help Center suggestions per category (M)

- **New `CategoryHelpArticle` link table:**
  - Columns: `(categoryId, articleId, sortOrder)`, cascade on both sides.
  - No change needed to demo-data removal.
- **Admin → Categories:** the edit dialog gets **"Suggested help articles"**, a searchable multi-select with **at most 3** articles, next to "Template assignment".
  - Department admins can set it for their own departments.
  - Only published articles can be picked; unpublished ones simply stop being suggested.
- **Ticket creation:** once a category is chosen, a panel appears between "1. Route the request" and "2. Complete the form":
  > **This might answer your question**
  > *How to delegate a mailbox to a colleague*: one-line summary
  > The article opens in a side panel, so the form you've started is kept.
  > [ This solved it ] [ Continue with my request ]
  - **"Continue"** collapses the panel. It never blocks submitting.
  - **"This solved it"** discards the draft (asking first if fields were filled) and goes back to the dashboard. Nothing is tracked (D4).
- **Endpoint:** `GET /api/help/suggestions?categoryId=` returns published, localized articles to anyone allowed to create a ticket in that department.
- **Demo data:** add 2 or 3 realistic articles (for example "Delegate a mailbox", "Expense report deadlines") linked to the demo categories.

---

## Where settings live

| What | Where | Who |
|---|---|---|
| Privacy: who sees email and other fields | **Admin → Settings → Privacy** (new tab) | Super Admin |
| Suggested help articles | **Admin → Categories**, edit dialog | Super Admin; department admin for own departments |
| Help articles themselves | Admin → Help Content (unchanged) | Admins |
| Using a saved reply / quick-saving one | **In the reply box**, "Saved replies" button | Staff |
| Managing saved replies | **Profile → My saved replies** | Staff, own replies only |
| Job title, phone (if 3c) | **Profile**, own; **Admin → Users**, any | Each user / admins |

No new sidebar items, and no per-user privacy switches in v1.

---

## Release plan

All four phases ship together as **v0.9.0-beta.6** (decided after implementation): one upgrade for self-hosters, tested end to end as one step from beta.5.1. The phases remain separate commits on the release branch for review. `/api/canned-responses` is kept, not removed.

**Per phase:**
1. Branch and implement.
2. Tests and docs.
3. Rebuild the demo stack and run a role-by-role check.
4. Open a PR.
5. You review and test.
6. Merge and release.
7. Move to the next phase.

**Still open for you:** whether you want **3c** (job title and phone), and whether the release grouping above suits you.
