# Webhooks and external API

Both integrations are disabled by default on a clean installation and require an explicit Super Admin feature setting.

## Signed webhooks

Webhook administration is available under **Settings → Webhooks** only to Super Admins. A destination must use HTTPS, contain no URL credentials or fragment, and resolve exclusively to public Internet addresses. CompDesk resolves every delivery, rejects any private/link-local/loopback/metadata result, and pins the selected public address into the TLS connection. Redirect responses are recorded as failures and are never followed.

A random signing secret is generated on creation or rotation, encrypted with the application settings AES-256-GCM key, and displayed once. A legacy plaintext secret can be encrypted in place without rotation through **Encrypt Existing Secret**. Neither plaintext nor ciphertext is returned by list APIs.

Every request contains:

- `X-CompDesk-Webhook-Id`: unique delivery UUID;
- `X-CompDesk-Webhook-Event`: event name;
- `X-CompDesk-Webhook-Timestamp`: ISO timestamp of this delivery attempt; the body's timestamp remains the original event time;
- `X-CompDesk-Webhook-Signature`: `v1=` followed by hex HMAC-SHA256;
- `X-CompDesk-Webhook-Replay-Window`: sender-declared 300-second acceptance window.

The signed bytes are exactly:

```text
<timestamp>.<raw request body>
```

Receivers must compare the HMAC in constant time, reject timestamps outside five minutes, and reject a delivery ID already processed. Never parse and reserialize the body before verifying it.

Retries keep the same delivery ID and exact body, but sign a fresh header timestamp so a delayed retry can pass the five-minute check. Use the header timestamp for replay protection and the body timestamp for event ordering.

Deliveries are persisted before dispatch. Workers claim a delivery with a database lease, use an absolute 10-second timeout, retain HTTP/error-stage history, and retry with bounded exponential backoff for at most eight attempts. Ten consecutive endpoint failures disable the webhook. Super Admins can inspect the latest 50 deliveries, send a safe test event, and retry failed deliveries. Multiple replicas can safely compete for work because the lease update is atomic.

## External API clients

API keys are generated with the `cdk_` prefix, stored only as SHA-256 hashes, and shown once. Requests may use `Authorization: Bearer` or `X-API-Key`. Authentication failures and successful request limits use PostgreSQL-backed throttling. `lastUsedAt` is written no more than once per five minutes per client.

Department access is default-deny:

- an empty department list grants no department access;
- selected department IDs grant only those departments;
- global access requires the separate **Explicitly allow all departments** policy.

The upgrade migration intentionally converts legacy empty lists to no access. Review each existing client after upgrading and grant only the required departments. API request audit events include client ID, client name, required scope, target department, target object, result, source IP (when the trusted-proxy policy permits it), and user agent. Integration-created ticket timelines and notes also retain the client ID and name in metadata.

Available scopes are `tickets:read` and `tickets:write`. List requests remain paginated with a maximum page size of 50. API-client department checks are independent of requester identity and cannot be bypassed by supplying a different requester or note author.
