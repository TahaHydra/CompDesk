# Role and permission matrix

Authorization is enforced server-side by route guards and centralized department helpers. UI visibility is not an authorization boundary.

| Capability | USER | AGENT | department ADMIN | SUPER_ADMIN |
|---|---|---|---|---|
| View tickets | Own requested tickets | Tickets in assigned departments | Tickets in administered or agent-assigned departments | All tickets |
| Create a ticket | Active public departments | Assigned departments | Administered or agent-assigned departments | Any active department |
| Public comments | Own visible tickets | Visible department tickets | Visible department tickets | All tickets |
| Internal notes | No | Visible department tickets | Visible department tickets | All tickets |
| Assign/claim | No | Eligible tickets in assigned departments | Eligible tickets in visible departments | All eligible tickets |
| Edit department configuration | No | No | Default form for administered departments | All department settings |
| Withdraw own unassigned ticket | Yes | Yes, when requester | Yes, when requester | Yes |
| Permanently remove ticket | No | No | No | Yes, with confirmation and audit |
| Manage users, tags, settings, API clients, webhooks | No | No | No | Yes |
| View audit logs | No | No | No | Yes |

“ADMIN” never means global access. It is a department-scoped administrator. `SUPER_ADMIN` is the only global administrative role. Group membership and direct membership are combined; no accessible department means no department ticket scope.

External API clients are separate principals. Their scopes and departments are explicit and default deny; an empty department list is not global access.