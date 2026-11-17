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

“ADMIN” never means global access. It is a department-scoped administrator. `SUPER_ADMIN` is the only global administrative role. Group membership and direct membership are combined; no accessible department means no department ticket scope.

External API clients are separate principals. Their scopes and departments are explicit and default deny; an empty department list is not global access.