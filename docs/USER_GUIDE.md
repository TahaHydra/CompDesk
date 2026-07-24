# CompDesk user and administrator guide

CompDesk is a reusable helpdesk platform. The name, logos, colors, login copy, support address, and footer you see may be customized by your administrator.

## Signing in

Open your organization’s CompDesk URL (or <http://localhost:3000> in development). Depending on Branding settings, you may see local email/password login, Microsoft Entra ID login, both, or neither. If neither method is available, use the displayed support address.

Demo credentials are hidden by default. For a clean development database, `npm run db:seed` creates accounts under `example.com`; the administrator email and password can be set with `SEED_ADMIN_EMAIL` and `SEED_DEFAULT_PASSWORD`. Never enable demo-account information in production.

## Personal language

Open **Profile**, choose **English** or **Français**, and save. The preference belongs to your account, not the browser, so it follows you to another device. It changes the application shell, dashboard, profile, ticket-creation flow, and Help Center. User-entered department, category, template, ticket, and article names remain exactly as administrators wrote them.

## Help Center

Select **Help Center** in the sidebar. Search looks through the current language's article title, summary, and content. Open a collection to browse related articles, or open an article for a documentation layout with collection navigation and an on-page contents list. Draft collections and articles are hidden from normal users.
## End users

### Create a ticket

1. Select **New Ticket**.
2. Select a **Department** first.
3. Select one of that department’s active **Categories**, when categories exist.
4. CompDesk resolves the effective **Ticket Template**.
5. Complete the visible fields and submit.

Changing department always clears an incompatible category. If the resulting template changes after you entered data, CompDesk warns you. Values are retained only when the same stable field key and compatible type exist in the new form.

The form may contain:

- single-line or multiline text;
- dropdown and multi-select choices;
- checkboxes;
- dates;
- file attachments;
- built-in Title, Description, Priority, Severity, Attachments, and Tags fields.

Visible required fields and configured rules are shown in the browser, then independently revalidated by the server. If the form intentionally hides Title, CompDesk generates a useful internal title from the category or form name.

### Follow a ticket

**My Tickets** lists your requests. Open a ticket to see its current department/category, form version, submitted custom data, conversation, attachments, status, and SLA information. Historical form labels and values remain as submitted even if an administrator later edits or archives the current form or category.

You can add public comments and view notifications. Internal notes are never shown to end users.

## Agents

Agents see **Department Inbox** for departments assigned directly or through a group. They can claim/assign tickets, change permitted status/priority values, add internal notes, use canned response reply macros, and escalate tickets.

Categories offered during routing always belong to the selected department. Moving a ticket to another department requires a compatible category from that target department.

A five-minute lock warning helps prevent two agents editing the same ticket simultaneously.

## Administrators

Admin and Super Admin roles have server-authorized access to administration pages.

### Branding: Admin → Settings → Branding

Configure:

- application and short names;
- subtitle, description, login heading/description, support email, and footer;
- main, compact, light, and dark logos;
- favicon and optional login background;
- primary and accent colors;
- local and Microsoft login visibility and Microsoft button text;
- optional demo-account information.

Uploaded brand assets accept PNG, JPEG, WebP, GIF, or ICO up to 5 MB. SVG is rejected. Each asset has a preview and individual reset; **Reset all defaults** removes uploaded branding assets that are no longer referenced. Saving reloads the shell so metadata and CSS variables update together.

Disabling a login method is enforced by the authentication server, not only hidden on the login page. Confirm another working admin sign-in method before disabling local login.

### Departments

Each department has active/public/auto-assignment settings and an optional default Ticket Template. An empty assignment inherits the protected system default. Users see public departments; agents see their assigned departments; department administrators see departments they administer; super administrators see all.

A super administrator assigns active ADMIN users in the department editor. A department administrator can choose any active shared template as that department's default, but cannot rename, delete, deactivate, or change the membership of the department.

A department with categories or historical tickets cannot be hard-deleted. Deactivate it instead when preserving history.

### Categories

Every category belongs to exactly one department. Different departments may reuse the same name. Category administration shows the owner, ticket count, and whether its effective template is inherited or overridden.

Super administrators can rename, move, archive/restore, or delete categories where history permits. Department administrators can choose any active shared template as an override for categories in departments they administer, or restore inheritance from the department default. They cannot modify categories in another department. A category with tickets cannot be moved or hard-deleted; archive it to preserve historical ticket relationships.

### Ticket Templates

**Ticket Templates** are ticket-creation forms. They are separate from **Canned Responses**, which are reply macros.

The first list item is the protected system default. It cannot be archived or deleted, and departments without an explicit assignment inherit it.

Administrators can see and work with the shared template library regardless of department assignment. They can:

- create a form by cloning the current system default;
- duplicate another form;
- edit its name, description, and fields;
- add built-in or custom fields;
- configure required/default/options/length/regex/file rules;
- configure conditional visibility and role visibility/editability;
- reorder fields with keyboard-accessible arrow controls;
- choose 1–12 column widths;
- interactively preview as User, Agent, Admin, or Super Admin;
- inspect all department/category assignments and historical usage;
- archive/restore unused or assigned custom templates.

Every edit increments the template version. Archived templates are ignored during new-ticket resolution. A template with historical tickets cannot be hard-deleted; assigned templates require explicit reassignment.

Template precedence is always:

1. category override;
2. department default;
3. system default.

### Help content

**Admin → Help Content** manages the shared bilingual documentation library. Administrators can create, reorder, publish, draft, edit, and delete articles and collections. Each article requires meaningful English and French content so changing a profile language never produces an empty document. Article content supports headings, paragraphs, lists, links, emphasis, inline code, code blocks, and blockquotes. Preview both languages before publishing. A collection must be emptied before it can be deleted.
### Canned responses

Canned responses remain reusable comment text for agents. They do not define ticket fields and are not managed on the Ticket Templates page.

### Other settings

- **SMTP**: outgoing server credentials and test mail.
- **Email Notifications**: per-event delivery controls.
- **Entra ID**: Microsoft OIDC credentials; restart after environment changes.
- **Quick Links**: up to 16 validated HTTP/HTTPS dashboard links with optional PNG, JPEG, WebP, GIF, or ICO images. Icons render at 32 px on the dashboard and are limited to 512 KB.
- **Security**: local login control (also reflected in Branding).
- **Features**: attachments, quick links, external API, and webhooks.
- **API Clients**: scoped API keys and optional department restrictions.

### Audit logs

Branding, template lifecycle, department assignment, category lifecycle/override, ticket, user, and other administrative changes create audit events. Admin write routes reject non-admin sessions even if called directly.

## Operational notes

- Ticket, branding, and dashboard quick-link assets are stored under `public/uploads`. Back up this directory and persist it as a shared volume in production.
- The database preserves ticket template ID/version, immutable schema snapshot, sanitized values, and category relationships.
- Do not use destructive database resets for upgrades. Run `npm run db:migrate:prod`.
- Use the [setup guide](../SETUP.md), [deployment guide](DEPLOYMENT.md), and [API reference](API_REFERENCE.md) for operator details.