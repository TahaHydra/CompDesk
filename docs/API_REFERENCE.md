# CompDesk API reference

CompDesk exposes authenticated internal routes and an API-key-protected `/api/v1` integration surface. JSON request bodies are validated with Zod. Write routes enforce authorization on the server; hiding a control in the browser is never the security boundary.

## Conventions

- Internal authentication: Auth.js session cookie.
- External authentication: `X-API-Key` with the required client scope.
- IDs: UUID strings.
- Validation errors: HTTP `400` with `{ "error": "...", "details": { ... } }`.
- Authorization failures: `401` when unauthenticated, `403` when authenticated but forbidden.
- Conflicts that would damage history: `409`.
- Archived departments, categories, and templates are not offered for new tickets.

## Branding

### `GET /api/branding`

Public and read-only. Returns only the typed values needed by the login page, metadata, favicon, and application theme. It never returns SMTP credentials, Entra secrets, API keys, or the general settings map.

### `GET /api/branding/admin`

Admin or Super Admin. Returns the complete typed branding configuration.

### `PATCH /api/branding/admin`

Admin or Super Admin. Replaces the complete branding configuration. Supported values include application names, subtitle, description, asset URLs, primary/accent colors, login copy, support email, footer, demo visibility, local/Microsoft login visibility, and Microsoft button text.

Asset URLs cannot be supplied arbitrarily; they must be URLs returned by the branding asset endpoint.

### `DELETE /api/branding/admin`

Admin or Super Admin. Restores all branding defaults and safely removes branding assets that are no longer referenced.

### `POST /api/branding/assets`

Admin or Super Admin. Multipart body:

- `field`: one of `mainLogoUrl`, `compactLogoUrl`, `lightLogoUrl`, `darkLogoUrl`, `faviconUrl`, `loginBackgroundImageUrl`.
- `file`: PNG, JPEG, WebP, GIF, or ICO; maximum 5 MB. SVG is rejected.

The server validates the file signature, generates a random UUID filename, updates branding, and removes a replaced unreferenced asset.

### `DELETE /api/branding/assets?field=mainLogoUrl`

Resets one branding asset.

## Departments and categories

### `GET /api/queues`

Returns departments scoped to the requester: public departments for users, assigned departments for agents, explicitly administered departments for department admins, and all departments for Super Admins. Department admins and Super Admins can add `includeInactive=true` within their scope.

### `POST /api/queues`

Super Admin only. Creates a department.

### `PATCH /api/queues`

A Super Admin can edit the complete department configuration and its direct department-admin assignments. Important fields:

```json
{
  "id": "department-uuid",
  "name": "IT Support",
  "description": "Technical support",
  "isPublic": true,
  "isActive": true,
  "autoAssign": false,
  "defaultTemplateId": "uuid-or-null",
  "administratorIds": ["admin-user-uuid"]
}
```

A department admin can patch only `id` and `defaultTemplateId`, and only for a department assigned to that admin either directly or through a group. The selected template may be any active template in the shared library; `null` means inherit the protected system default. The server rejects attempts to change another department or any other department setting.

### `DELETE /api/queues?id=uuid`

Super Admin only. Permanent deletion is allowed only when no categories or tickets reference the department.

### `GET /api/categories?queueId=uuid`

Returns active categories belonging to exactly that department. `queueId` is mandatory for users and agents. A department admin may list only categories in administered departments and may add `includeInactive=true`; a Super Admin may list all departments.

### `POST /api/categories`

Super Admin only.

```json
{
  "queueId": "department-uuid",
  "name": "New Account",
  "description": "Optional",
  "templateId": null,
  "isActive": true
}
```

Names are unique within one department, so different departments may both use `New Account`.

### `PATCH /api/categories`

A Super Admin can rename, activate/archive, move an unused category, and set its template override. Moving is rejected when tickets already reference the category.

A department admin can patch only `id` and `templateId`, and only for a category in an administered department. The override may use any active template in the shared library; `null` inherits the department default. The server rejects category edits and assignments outside that scope.

### `DELETE /api/categories?id=uuid`

Super Admin only. Archives by default. Add `mode=hard` only for an unreferenced category. Referenced categories are never detached from historical tickets.

## Ticket Form Templates

Ticket Form Templates are not canned responses. Canned responses remain reply macros under `/api/canned-responses`.

### `GET /api/ticket-form-templates?includeArchived=true`

Admin only. Lists the protected system default first, all fields, version/status, department assignments, category overrides, historical ticket count, and update time.

### `POST /api/ticket-form-templates`

Admin only. Creates a form by cloning the current system default, or duplicates another template when `sourceTemplateId` is supplied.

```json
{
  "name": "Employee onboarding",
  "description": "Requests for new starters",
  "sourceTemplateId": "optional-template-uuid"
}
```

### `GET /api/ticket-form-templates/[id]`

Admin only. Returns a template and usage. `previewRole=USER|AGENT|ADMIN|SUPER_ADMIN` filters its preview fields.

### `PATCH /api/ticket-form-templates/[id]`

Admin only. Replaces the editable definition and increments `version`. Each field contains a stable key, label, type, built-in identifier when applicable, placeholder/help text, required/default/options/validation/condition rules, role visibility/editability, order, width, and active state.

Supported types: `TEXT`, `TEXTAREA`, `DROPDOWN`, `MULTISELECT`, `CHECKBOX`, `DATE`, `FILE`.

### `DELETE /api/ticket-form-templates/[id]`

- Default behavior: archive a non-system template.
- `mode=hard`: delete only when there are no historical tickets and no assignments.
- `mode=hard&reassignToId=uuid`: explicitly reassign current department/category usage before deletion; historical usage still prevents deletion.

The system default cannot be archived or deleted. Restore an archived template with `POST /api/ticket-form-templates/[id]?action=restore`.

### `GET /api/ticket-form/resolve?queueId=uuid&categoryId=uuid`

Authenticated. Resolves the effective form using one centralized precedence rule:

1. active category override;
2. active department default;
3. protected system default.

The route verifies that the category belongs to the department and returns only fields visible to the requester role. Admins may add `previewRole`.

## Tickets

### `GET /api/tickets`

Lists tickets with role scoping and filters including `view`, `status`, `priority`, `queueId`, `search`, `assigneeId`, `sortBy`, `sortOrder`, `page`, and `limit`.

### `POST /api/tickets`

Creates a ticket from the server-resolved effective form.

```json
{
  "idempotencyKey": "uuid",
  "queueId": "department-uuid",
  "categoryId": "category-uuid",
  "values": {
    "title": "VPN fails after sign-in",
    "description": "The connection times out.",
    "priority": "HIGH",
    "device_type": "Laptop"
  }
}
```

Do not send a template ID. The server independently resolves it, rejects cross-department categories, unknown/hidden/inaccessible fields, wrong types, invalid options, failed conditions, and missing required values. Compatibility fields (`title`, `description`, `priority`, `severity`, `tagIds`, `formData`, `attachments`) remain accepted for existing API clients but are mapped into the same resolved validation path.

At creation, CompDesk stores the resolved template ID/version, an immutable schema snapshot, and sanitized values. If a visible Title field is absent, the server generates a deterministic internal title from the category or template name.

### `GET /api/tickets/[id]`

Returns the accessible ticket, conversation, category history, SLA/lock data, attachments, and role-filtered `historicalForm`. Raw schema snapshots and inaccessible stored fields are not exposed.

### `PATCH /api/tickets/[id]`

Updates permitted ticket columns. Routing changes independently verify that the category belongs to the target department. End users cannot change routing, assignment, priority, severity, or tags.

### Comments and escalation

- `POST /api/tickets/[id]/comments`
- `POST /api/tickets/[id]/escalate` (agent/admin)

## Uploads

### `POST /api/upload`

Authenticated multipart upload for ticket form files. Optional `ticketId` attaches directly to an accessible ticket; without it, the file is placed in temporary storage until ticket creation. Maximum 10 MB. Stored extensions are derived from the accepted MIME type, image/PDF signatures are checked, SVG is rejected, paths are randomized, and access is verified before any ticket-directory write.

### `GET` / `DELETE /api/upload/[id]`

Download or remove an attachment subject to ticket authorization.

## Other internal routes

- `/api/dashboard/stats`
- `/api/notifications`
- `/api/tags`
- `/api/canned-responses`
- `/api/users`
- `/api/groups`
- `/api/audit-logs`
- `/api/settings` and `/api/settings/test-email`
- `/api/api-clients`

All write operations use server-side role checks. Branding is intentionally separate from `/api/settings` so the public endpoint can never leak administrative settings.

## External API v1

Enable the external API feature flag and create an API client in Admin → Settings → API Clients.

- `GET /api/v1/tickets` requires `tickets:read`.
- `POST /api/v1/tickets` requires `tickets:write`, accepts `userEmail` plus the same routing/`values` payload, and uses the same template resolver/validator.
- `POST /api/v1/tickets/[id]/notes` appends an integration note.

Allowed department IDs configured on the API client are independently enforced.