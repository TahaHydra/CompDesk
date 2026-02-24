# 📖 CompDesk — User & Administrator Guide

Welcome to CompDesk, your organization's IT helpdesk and ticketing system. This guide covers everything you need to know as an **end user**, **agent**, or **administrator**.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [For End Users](#for-end-users)
3. [For Agents](#for-agents)
4. [For Administrators](#for-administrators)
5. [FAQ](#faq)

---

## Getting Started

### Signing In

1. Go to `https://compdesk.yourorg.com` (or `http://localhost:3000` for development)
2. You have two sign-in options:
   - **Microsoft SSO** — Click "Sign in with Microsoft" to use your organizational account
   - **Email & Password** — Enter your email and password (for local/demo accounts)

### Demo Accounts (Development Only)

| Email | Role | Password |
|-------|------|----------|
| `admin@example.invalid` | Super Admin | `Password123!` |
| `agent1@example.invalid` | Agent | `Password123!` |
| `agent2@example.invalid` | Agent | `Password123!` |
| `user1@example.invalid` | End User | `Password123!` |
| `user2@example.invalid` | End User | `Password123!` |

### Navigation

- **Sidebar** — Main navigation on the left side. Click the CompDesk logo to return to the Dashboard at any time.
- **Top Bar** — Contains the search bar, dark/light theme toggle, notification bell, and your profile menu.
- **Collapse Button** — The small circle on the sidebar edge collapses/expands the sidebar.

---

## For End Users

### Creating a Ticket

1. Click **New Ticket** in the sidebar (or the "+" button on the Dashboard)
2. Fill in:
   - **Title** — A brief summary of your issue (required)
   - **Department** — Select the team that should handle this (e.g., IT Support, HR)
   - **Category** — Optional classification (e.g., Hardware, Software, Network)
   - **Priority** — How urgent this is (Low, Normal, High, Urgent)
   - **Description** — Detailed explanation of your issue
   - Custom fields may appear depending on the department
3. Click **Submit**

### Viewing Your Tickets

- Go to **My Tickets** in the sidebar to see all tickets you've submitted
- Use the **filters** at the top to narrow down by status, priority, or search text
- Click any ticket to view its full details

### Ticket Detail Page

From the ticket detail page, you can:
- **Read the full conversation** — See all comments and status changes in the timeline
- **Add a comment** — Type in the comment box at the bottom and click Send
- **See the current status** — NEW → OPEN → PENDING → RESOLVED → CLOSED

### Notifications

- The **bell icon** in the top-right shows recent activity on your tickets
- A **red dot** appears when there are unread notifications
- Click a notification to jump directly to that ticket
- Click **Mark all read** to clear the indicator

### Your Profile

- Click your avatar in the top-right → **Profile**
- View your role, join date, and ticket statistics

---

## For Agents

Agents have all End User capabilities, plus:

### Department Inbox

- Go to **Department Inbox** in the sidebar
- This shows all tickets in departments you're assigned to
- Tickets are shown regardless of who submitted them

### Working on Tickets

1. **Claim a ticket** — Open an unassigned ticket and assign yourself
2. **Change status** — Use the status dropdown:
   - `NEW → OPEN` — When you start working on it
   - `OPEN → PENDING_USER` — When waiting for the requester's response
   - `PENDING_AGENT → OPEN` — When you resume work
   - `OPEN → RESOLVED` — When the issue is fixed
3. **Add internal notes** — Toggle "Internal Note" to leave comments only visible to agents and admins (not the end user)
4. **Use canned responses** — Click the quick-reply icon to insert pre-written responses
5. **Escalate** — Use the escalate button to bump a ticket to a higher-level agent

### Collision Detection

When you open a ticket, it's "locked" for 5 minutes to prevent two agents from working on it simultaneously. You'll see a warning if another agent has it open.

---

## For Administrators

Administrators (Admin and Super Admin) have full access to everything, plus the Admin panel.

### Admin Panel

Access the Admin panel via the sidebar links under the **Admin** section:

#### Departments

Manage organizational routing queues:
- **Add Department** — Create new departments (e.g., "Facilities", "Finance")
- **Edit** — Click the pencil icon to rename or update the description
- **Delete** — Click the trash icon (only works if no tickets are assigned)
- Each department shows its ticket count

#### Templates (Canned Responses)

Pre-written response templates for agents:
- **Add Template** — Create with a title, content, and optional category
- **Edit / Delete** — Manage existing templates
- Agents can insert these directly when replying to tickets

#### Categories

Ticket categorization labels:
- **Add Category** — Create categories like "Hardware", "Software", "Network"
- **Edit / Delete** — Manage existing categories
- Categories help with reporting and organization

#### Tags

Color-coded labels that can be applied to tickets:
- **Add Tag** — Create tags with custom names and colors
- **Edit / Delete** — Manage existing tags
- Multiple tags can be applied to a single ticket

#### Users

Manage user accounts:
- **Change Role** — Assign USER, AGENT, ADMIN, or SUPER_ADMIN roles
- **Assign Departments** — Select which departments an agent can access
- **View Activity** — See each user's login info and ticket statistics

#### Settings

Application-wide configuration:

| Tab | Purpose |
|-----|---------|
| **SMTP** | Configure outgoing email (host, port, credentials). Test with the "Send Test Email" button. |
| **Email Notifications** | Toggle which events trigger email notifications (ticket created, assigned, updated, new comment). |
| **Entra ID** | Configure Microsoft Entra ID SSO (client ID, secret, tenant). Requires app restart. |
| **Quick Links** | Add custom links that appear on everyone's dashboard (e.g., SharePoint, HR tools, intranet). URLs are auto-corrected to include `https://`. |

### Role Permissions Summary

| Action | User | Agent | Admin | Super Admin |
|--------|:----:|:-----:|:-----:|:-----------:|
| Create tickets | ✅ | ✅ | ✅ | ✅ |
| View own tickets | ✅ | ✅ | ✅ | ✅ |
| View department inbox | ❌ | ✅ | ✅ | ✅ |
| View all tickets | ❌ | ❌ | ✅ | ✅ |
| Add comments | ✅* | ✅ | ✅ | ✅ |
| Add internal notes | ❌ | ✅ | ✅ | ✅ |
| Assign tickets | ❌ | ✅ | ✅ | ✅ |
| Escalate tickets | ❌ | ✅ | ✅ | ✅ |
| Manage departments/categories/tags | ❌ | ❌ | ✅ | ✅ |
| Manage users/roles | ❌ | ❌ | ✅ | ✅ |
| Configure settings | ❌ | ❌ | ✅ | ✅ |

*End users can only comment on their own tickets.

---

## FAQ

### I can't sign in with my Microsoft account
- Make sure your Azure AD app registration is correctly configured (see the [README](../README.md#-azure-app-registration))
- Verify the redirect URI matches exactly: `https://yourapp.com/api/auth/callback/microsoft-entra-id`
- Ask your administrator to grant admin consent

### My ticket status won't change
- Not all status transitions are allowed. For example:
  - End users cannot set tickets to RESOLVED
  - Only admins can reopen CLOSED tickets
- See the [status transition rules](../README.md#-status-transition-rules) for details

### I'm not receiving email notifications
- Check that SMTP is configured in Admin → Settings → SMTP
- Use the "Send Test Email" button to verify connectivity
- Check that the relevant email toggle is ON in Admin → Settings → Email Notifications

### How do I add an agent to a department?
1. Go to Admin → Users
2. Find the user and change their role to AGENT
3. Select the departments they should have access to

### Can I integrate CompDesk with other tools?
Yes — use the [External API](API_REFERENCE.md#external-api-v1) with an `X-API-Key` header to:
- Create tickets programmatically (from monitoring tools, scripts, etc.)
- Append internal notes to existing tickets

### How do I add quick links to the dashboard?
1. Go to Admin → Settings → Quick Links tab
2. Click "Add Link"
3. Enter a title and URL (for example: `Leave Request Form` → `https://hr.yourorg.com/leave`)
4. Click "Save Links"
5. The links will appear as cards on everyone's dashboard
