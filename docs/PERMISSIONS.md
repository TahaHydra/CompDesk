# Role and permission matrix

Authorization is enforced server-side by route guards and centralized department helpers. UI visibility is not an authorization boundary.

| Capability | USER | AGENT | department ADMIN | SUPER_ADMIN |
|---|---|---|---|---|
| View tickets | Own requested tickets | Tickets in assigned departments | Tickets in administered or agent-assigned departments | All tickets |
| Create a ticket | Active public departments | Assigned departments | Administered or agent-assigned departments | Any active department |
| Public comments | Own visible tickets | Visible department tickets | Visible department tickets | All tickets |
| Internal notes | No | Visible department tickets | Visible department tickets | All tickets |
| Edit own reply or note | Own public replies, within 24 hours | Within 24 hours | Within 24 hours; any time in administered departments | Any time |
| Delete own reply or note | Own public replies | Yes | Yes | Yes |
| Edit or delete other people's replies and notes | No | No | Tickets in administered departments, except a Super Admin's entries | All tickets |
| Read a deleted reply's original text | No | No | No | Yes |
| Remove an attachment | Only files they uploaded on their own ticket | Visible department tickets | Visible department tickets | All tickets |
| Assign/claim | No | Eligible tickets in assigned departments | Eligible tickets in visible departments | All eligible tickets |
| Edit department configuration | No | No | Default form for administered departments | All department settings |
| Withdraw own unassigned ticket | Yes | Yes, when requester | Yes, when requester | Yes |
| Permanently remove ticket | No | No | No | Yes, with confirmation and audit |
| Add or remove tags on a ticket | At creation only, if the form shows Tags | Visible department tickets | Visible department tickets | All tickets |
| Manage tags | No | No | Tags limited to administered departments | All tags |
| Manage users, settings, API clients, webhooks | No | No | No | Yes |
| View audit logs | No | No | No | Yes |

Deleting a reply or note replaces it with a "Deleted" placeholder for everyone; staff also see who deleted it and when. The original text stays in the database for audit and only Super Admins can read it. Removing an attachment permanently deletes the stored file; only its name, size, hash and who removed it are kept. Attachments recorded without an uploader (older rows) cannot be removed by requesters.

## People details and privacy

Clicking or hovering any person's name opens their card. **Identity** is always shown to anyone who can see the person: name, photo, role (Requester, Agent, Department admin, Super Admin) and the relevant department. Requesters see only the department of their own ticket, never a staff member's full list. **Contact and profile details** (email address, preferred language, job title) follow the policy a Super Admin sets in **Admin → Settings → Privacy**, one level per field:

| Level | Who sees the field |
|---|---|
| Higher roles only (default) | People with a higher role than the person: Department admin > Agent > Requester |
| Same role and higher | Also colleagues with the same role |
| All staff | Every agent and administrator |
| Everyone | Also requesters, for the staff on their own tickets |

Every level applies on top of a **working relationship**: the person is on a ticket the viewer can open (requester, assignee, author of a message the viewer can see, or watcher for staff), or, for staff only, works in a department the viewer belongs to. A department admin counts as an administrator only toward people in the departments it administers; elsewhere it counts as an agent. Super Admins always see everything, and everyone sees their own details. The same rule applies to ticket pages and lists, assignee pickers, user search (a search cannot match on an email the viewer may not see) and the staff directory. The external API (`/api/v1`) is unchanged: its clients are integrations with explicit scopes, not people.

“ADMIN” never means global access. It is a department-scoped administrator. `SUPER_ADMIN` is the only global administrative role. Group membership and direct membership are combined; no accessible department means no department ticket scope.

External API clients are separate principals. Their scopes and departments are explicit and default deny; an empty department list is not global access.