# 📘 CompDesk — API Reference

All API endpoints require authentication via session cookie (internal) or `X-API-Key` header (external v1). Responses are JSON.

---

## Authentication

All internal endpoints use Auth.js session cookies (set after sign-in). The external API (`/api/v1/*`) uses `X-API-Key` header authentication.

---

## Internal API Endpoints

### Dashboard

#### `GET /api/dashboard/stats`
Returns ticket statistics and recent activity scoped to the user's role.

| Role | Scope |
|------|-------|
| USER | Own tickets only |
| AGENT | Tickets in assigned departments |
| ADMIN / SUPER_ADMIN | All tickets |

**Response:**
```json
{
  "stats": { "total": 42, "open": 10, "pending": 5, "resolved": 20, "urgent": 2, "escalated": 1 },
  "recentTickets": [ { "id": "...", "key": "TCK-2026-000001", "title": "...", "status": "OPEN", "priority": "HIGH", ... } ],
  "customLinks": [ { "title": "SharePoint", "url": "https://..." } ]
}
```

---

### Notifications

#### `GET /api/notifications`
Returns recent timeline events for tickets relevant to the current user (excluding their own actions).

**Response:**
```json
{
  "items": [
    {
      "id": "...", "type": "COMMENT", "content": "...", "createdAt": "2026-02-24T...",
      "userName": "Agent Martin", "ticketId": "...", "ticketKey": "TCK-2026-000001", "ticketTitle": "..."
    }
  ],
  "unreadCount": 3
}
```

#### `POST /api/notifications`
Marks all notifications as read for the current user.

---

### Tickets

#### `GET /api/tickets`
List tickets with filtering, sorting, and pagination.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `view` | `my` / `queue` / `all` | Filter scope (default: `my`) |
| `status` | `NEW,OPEN,...` | Comma-separated statuses |
| `priority` | `LOW,NORMAL,...` | Comma-separated priorities |
| `queueId` | UUID | Filter by department |
| `search` | string | Search title/key/description |
| `assigneeId` | UUID | Filter by assignee |
| `sortBy` | `createdAt` / `updatedAt` / `priority` | Sort field |
| `sortOrder` | `asc` / `desc` | Sort direction |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 25, max: 100) |

**Response:**
```json
{
  "tickets": [ { "id": "...", "key": "TCK-2026-000001", "title": "...", "status": "OPEN", ... } ],
  "pagination": { "total": 42, "page": 1, "limit": 25, "totalPages": 2 }
}
```

#### `POST /api/tickets`
Create a new ticket. Validates custom form fields per queue.

**Body:**
```json
{
  "title": "VPN not working",
  "description": "Cannot connect to...",
  "queueId": "uuid",
  "categoryId": "uuid (optional)",
  "priority": "NORMAL",
  "severity": "S3 (optional)",
  "tagIds": ["uuid", "uuid"],
  "formData": { "environment": "production" }
}
```

**Auth:** Any authenticated user.

#### `GET /api/tickets/[id]`
Get full ticket detail including timeline, watchers, tags, form data, SLA info, and lock status.

#### `PATCH /api/tickets/[id]`
Update ticket fields (status, priority, assignee, tags, etc.). Enforces status transition rules per role.

**Body:** (all fields optional)
```json
{
  "title": "Updated title",
  "status": "RESOLVED",
  "priority": "HIGH",
  "assigneeId": "uuid",
  "categoryId": "uuid",
  "tagIds": ["uuid"]
}
```

#### `POST /api/tickets/[id]/comments`
Add a comment or internal note to a ticket.

**Body:**
```json
{ "content": "Looking into this now", "isInternal": false }
```

#### `POST /api/tickets/[id]/escalate`
Escalate a ticket (Agent/Admin only).

**Body:**
```json
{ "escalatedToId": "uuid", "reason": "Requires network team" }
```

---

### Departments (Queues)

#### `GET /api/queues`
List all departments with ticket counts and group assignments.

#### `POST /api/queues`
Create a new department. **Admin only.**

**Body:** `{ "name": "IT Support", "description": "...", "isPublic": false, "autoAssign": false }`

#### `PATCH /api/queues`
Update a department. **Admin only.**

**Body:** `{ "id": "uuid", "name": "New Name", "description": "..." }`

#### `DELETE /api/queues?id=uuid`
Delete a department. Fails if tickets exist. **Admin only.**

---

### Categories

#### `GET /api/categories`
List active categories.

#### `POST /api/categories`
Create a category. **Admin only.**

**Body:** `{ "name": "Hardware", "description": "..." }`

#### `PATCH /api/categories`
Update a category name. **Admin only.**

**Body:** `{ "id": "uuid", "name": "New Name" }`

#### `DELETE /api/categories?id=uuid`
Delete a category (detaches from tickets first). **Admin only.**

---

### Tags

#### `GET /api/tags`
List all tags.

#### `POST /api/tags`
Create a tag. **Admin only.**

**Body:** `{ "name": "urgent", "color": "#ef4444" }`

#### `PATCH /api/tags`
Update a tag. **Admin only.**

**Body:** `{ "id": "uuid", "name": "critical", "color": "#dc2626" }`

#### `DELETE /api/tags?id=uuid`
Delete a tag. **Admin only.**

---

### Users

#### `GET /api/users`
List all users with roles and queue memberships. **Authenticated.**

#### `PATCH /api/users`
Update user role and department assignments. **Admin only.**

**Body:**
```json
{ "userId": "uuid", "role": "AGENT", "queueIds": ["uuid1", "uuid2"] }
```

---

### Settings

#### `GET /api/settings`
Get all app settings as key-value map. **Admin only.**

#### `PATCH /api/settings`
Update settings. **Admin only.**

**Allowed keys:** `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password`, `smtp_from`, `smtp_secure`, `email_on_ticket_created`, `email_on_ticket_assigned`, `email_on_ticket_updated`, `email_on_new_comment`, `azure_ad_client_id`, `azure_ad_client_secret`, `azure_ad_tenant_id`, `dashboard_links`

#### `POST /api/settings/test-email`
Send a test email using current SMTP settings. **Admin only.**

---

### Other

#### `GET /api/canned-responses` / `POST` / `PATCH` / `DELETE`
CRUD for canned response templates. **Admin only.**

#### `GET /api/form-fields?queueId=uuid` / `POST` / `PATCH` / `DELETE`
CRUD for custom form fields per department. **Admin only.**

#### `GET /api/groups` / `POST /api/groups` (sync)
List and sync Microsoft Entra ID groups. **Admin only.**

---

## External API (v1)

Authenticated via `X-API-Key` header.

#### `POST /api/v1/tickets`
Create a ticket programmatically (e.g., from monitoring tools).

```json
{
  "title": "Server down",
  "description": "Web server is not responding",
  "queueId": "uuid",
  "userEmail": "user@yourorg.com",
  "priority": "URGENT"
}
```

#### `POST /api/v1/tickets/[id]/notes`
Append an internal note to a ticket.

```json
{
  "content": "Investigated: disk full",
  "authorEmail": "agent@yourorg.com"
}
```

---

## Error Responses

All errors follow this format:

```json
{ "error": "Human-readable error message" }
```

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Validation error or bad request |
| 401 | Not authenticated |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 429 | Rate limited |
| 500 | Internal server error |
