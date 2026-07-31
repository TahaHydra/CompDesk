# Ticket lifecycle and concurrency

This document is the runtime contract for ticket status, SLA timestamps, assignment, and routine deletion behavior.

## Status transitions and timestamps

Requesters may move `OPEN` or `PENDING_USER` tickets to `PENDING_AGENT`. Agents may use the transitions exposed by the server transition map. Administrators have the broader transitions defined in `src/lib/utils.ts`. `WITHDRAWN` is available only through the explicit withdrawal action.

A committed transition applies these rules:

- entering `RESOLVED` sets `resolvedAt` to the transition time and clears `closedAt`;
- entering `CLOSED` sets `closedAt` to the transition time;
- reopening into `NEW`, `OPEN`, `PENDING_USER`, or `PENDING_AGENT` clears both `resolvedAt` and `closedAt`;
- resolving again after reopening records a new `resolvedAt`;
- withdrawal clears `resolvedAt`, sets `closedAt`, and retains ticket history;
- every status change writes a timeline event in the same transaction.

## SLA policy changes

CompDesk uses a **restart-on-policy-change** rule for the resolution deadline. When the department or priority changes, the server resolves the destination department/priority SLA policy and calculates:

`dueAt = committed policy-change time + resolutionMinutes`

If no destination policy exists, `dueAt` becomes null. The audit record identifies the rule, change time, selected duration, and resulting deadline. Assignment alone does not restart the SLA and does not count as a requester-facing response.

`firstAssignedAt` records the first successful assignment. `firstPublicResponseAt` records the first public comment by an agent or administrator. Internal notes and assignment changes never set `firstPublicResponseAt`.

## Optimistic concurrency

Ticket business mutations require the version shown to the client when the ticket was loaded. The mutation increments the version in the same transaction as the change and its timeline records. A stale version returns HTTP 409 and requires the operator to refresh before retrying. This applies to ticket field/status/tag updates, assignment changes, escalation, and withdrawal.

## Presence and retained history

Viewing a ticket is read-only. Staff viewer heartbeats are stored separately in `ticket_presence`, expire from the active display after 90 seconds, and are non-exclusive. Presence never authorizes a mutation.

Routine ticket deletion is a history-preserving withdrawal. Routine comment deletion creates a tombstone; retained content is visible only to authorized Super Administrators. Permanent retention/GDPR erasure requires separate tooling and is not part of routine ticket actions.