# Microsoft 365 mail delivery

Super Admin → Settings → SMTP contains the delivery provider selector. Existing SMTP remains supported. Select **Microsoft 365 / Graph**, enter the directory tenant ID, application client ID, sender mailbox and application secret, and save. Use a dedicated Entra application for mail, separately from CompDesk sign-in. A blank secret preserves the saved credential; entering a new one rotates it. Database credentials are encrypted with the existing `APP_SETTINGS_ENCRYPTION_KEY` facility and never returned by settings APIs.

Provision a sender mailbox and grant the application's service principal **Application Mail.Send** through Exchange Online Application RBAC, scoped to that mailbox. Use the **enterprise application's** service-principal object ID when registering it in Exchange. Verify authorization for the intended sender and an unrelated mailbox using `Test-ServicePrincipalAuthorization`. Avoid also granting organization-wide Entra `Mail.Send`: independent grants are additive and would bypass your mailbox restriction. Follow [Microsoft's Application RBAC procedure](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac) for current commands and permission propagation delays.

Click **Send test message** with an explicit recipient after saving. This sends an actual message. Graph HTTP 202 means accepted for processing, not confirmed delivery; inspect Exchange message tracing if it does not arrive. Tests are limited to five per minute per administrator. Only Super Admins may inspect/change this configuration or initiate test sends. No tenant credentials or messages are sent just by opening settings.

The server requests app-only tokens with `client_credentials` and the Graph `.default` scope. Tokens are cached in server memory until shortly before expiry; changing credentials changes the cache key. Sending uses fixed Microsoft HTTPS endpoints and the configured sender, one recipient per request. Each request has a 15-second timeout. Redirects are rejected. Credentials, tokens, message bodies and provider response bodies are excluded from Graph diagnostics. Microsoft receives the application's IDs/credential during authentication and the sender, recipient, subject and message during mail delivery. See [Graph sendMail semantics](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

Optional deployment environment overrides:

```dotenv
COMPDESK_MAIL_PROVIDER=graph
COMPDESK_GRAPH_TENANT_ID=<directory-tenant-uuid>
COMPDESK_GRAPH_CLIENT_ID=<application-client-uuid>
COMPDESK_GRAPH_SENDER=compdesk@example.com
COMPDESK_GRAPH_CLIENT_SECRET=<application-secret>
```

Inject these securely into the application container/runtime and recreate it when changing them. Compose does not automatically forward arbitrary shell variables: explicitly add them to its application `environment` or a secured `env_file`. Environment values take precedence over database settings. Prefer the settings UI for the standard managed deployment. This implementation supports application secrets; certificate authentication is not implemented. Keep expiry/rotation under your organization's credential policy. Existing SMTP Verify/Test controls test SMTP even when Graph is selected.

Mail sending requires outbound HTTPS to `login.microsoftonline.com` and `graph.microsoft.com`. Switching back to SMTP retains both saved configurations. CompDesk does not change tenant permissions, configure Exchange or request Docker host privileges.
