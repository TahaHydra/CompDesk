# Plan: Generic OpenID Connect SSO and certificate support

Branch: `feature/generic-oidc-and-certificates` · Target: 0.9.0-beta.4

## Goals

1. Provider-agnostic OIDC sign-in next to Microsoft Entra ID, keeping the explicit
   account-linking and ownership protections.
2. Optional certificate-based OIDC client authentication (`private_key_jwt`).
3. Optional SMTP TLS material: custom CA trust and client certificates (mutual TLS).
4. Settings UX: one **Single sign-on** tab with a provider dropdown (names and logos).
   The "Show … login" switch and button text move there from the Branding tab.
   Microsoft stays the default.

Non-goals: several SSO providers active at once, SAML, Graph-mail certificate credentials,
encrypted (passphrase-protected) private keys.

## Upstream findings (checked 2026-10-06)

- `next-auth@5.0.0-beta.32` / `@auth/core@0.41.3` are the latest published releases. A
  generic OIDC provider is `{ type: 'oidc', issuer, clientId, clientSecret, client: { token_endpoint_auth_method } }`.
  Auth.js discovers the endpoints through `oauth4webapi`, which validates the issuer exactly.
- Auth.js supports `private_key_jwt`, but it signs `aud = [issuer, token_endpoint]`.
  **draft-ietf-oauth-rfc7523bis** (the 2025 audience-injection fix) requires the issuer
  identifier as the **sole** `aud` value and forbids the token endpoint. Authorization servers
  that have adopted the fix reject Auth.js's assertion.
  → CompDesk signs its own assertion (`aud = issuer`, 60 s lifetime, random `jti`) and
  attaches it through Auth.js's supported `customFetch` hook on the token request. Auth.js is
  configured with `token_endpoint_auth_method: 'none'`, so it adds no credentials of its own.
  This also lets us send `x5t#S256`, which Entra-style certificate credentials need.
- The Auth.js discovery path requires the IdP to publish a `userinfo_endpoint`. All targeted
  presets do.
- Nodemailer (`10.x`) passes `tls` options to Node TLS: `ca`, `cert` and `key` are
  supported. `rejectUnauthorized` stays `true`. A custom CA **replaces** the system roots for
  SMTP, so a private CA can be pinned.
- To trust a private CA for the IdP (OIDC discovery and token calls go through Node fetch),
  use `NODE_EXTRA_CA_CERTS`. CompDesk adds no code for this; it is documented instead.

## Design

### Configuration model (no DB migration)

| Setting | Where | Notes |
| --- | --- | --- |
| `sso_provider` | `app_settings` | `microsoft-entra-id` (default), `google`, `okta`, `keycloak`, `auth0`, `authentik` or `oidc`. Every value except Microsoft uses the Auth.js provider id `oidc`. |
| `login_sso_enabled` | `app_settings` | Provider-neutral "show SSO login" switch. It is migrated from the beta.3 `login_microsoft_enabled`, which is kept for rollback. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_CLIENT_AUTH_METHOD`, `OIDC_CLIENT_PRIVATE_KEY`, `OIDC_CLIENT_CERTIFICATE`, `OIDC_CLIENT_KEY_ID` | managed env file / environment | Same model as Entra: written to the private config file, active after a restart. A PEM can be set as a value (`\n` escapes accepted) or via `*_FILE` (Docker secrets). |
| `smtp_ca_certificate`, `smtp_client_certificate` | `app_settings` | Public PEM data, validated with `X509Certificate`. |
| `smtp_client_key` | `app_settings` | Encrypted with `APP_SETTINGS_ENCRYPTION_KEY` (same envelope as the SMTP password); write-only in the API. |
| `SMTP_CA_FILE`, `SMTP_CLIENT_CERT_FILE`, `SMTP_CLIENT_KEY_FILE` | environment | Fallback when the DB values are empty. |

### Security rules

- `allowDangerousEmailAccountLinking: false` for OIDC as well. Existing local accounts are linked
  only from an authenticated profile session, as today.
- The selected provider must match the provider id at `signIn`. Otherwise, a configured but
  deselected provider is refused.
- Generic OIDC refuses `email_verified === false` and missing email claims.
- Local login can be disabled only while the *selected* SSO provider is enabled and configured
  in the running process.
- The client-assertion key must be RSA ≥ 2048, EC P-256 or EC P-384. It is validated at startup.
  An invalid key disables the provider (and logs why) instead of crashing auth.
- An SMTP client certificate and key must match (`X509Certificate.checkPrivateKey`). PEM input is
  capped at 64 KB, and encrypted keys are rejected with a clear message.

### Code layout (small, reuses existing seams)

- `src/lib/sso-presets.ts` (client-safe): preset list, labels, issuer hints, mapping to Auth.js id.
- `src/lib/oidc-provider.ts` (server): reads the env, builds the Auth.js provider and signs the
  RFC 7523bis client assertion.
- `src/lib/tls-material.ts` (server): PEM parsing, validation, summaries, `*_FILE` reading.
- `src/components/sso-provider-logo.tsx`: inline logos (Microsoft, Google) and brand-colored
  monograms for the others. No icon dependency.
- `auth.ts`, `branding.ts`, `login-policy` callers, `managed-env.ts`, `email.ts` and the settings
  route are extended in place.
- UI: the `Entra ID` tab becomes `Single sign-on`, with a provider dropdown, a provider-specific
  form, a callback URL and a "Login button" card (switch and text, moved from Branding).
  The SMTP tab gets an optional "Certificates" section.

## Steps

1. Shared presets, logos and server helpers (`tls-material`, `oidc-provider`), with unit tests.
2. Auth: register the OIDC provider, generalize the `signIn` policy, events and profile linking.
3. Branding/public config: `ssoProvider` and `ssoLoginConfigured`; sign-in page renders the
   selected provider's logo.
4. Settings API: `sso_provider` and OIDC managed-env keys; SMTP certificate keys with
   validation and encryption.
5. Settings UI: SSO tab with dropdown, login-button card moved out of Branding, and SMTP
   certificates section.
6. SMTP transport: `ca`/`cert`/`key`, with certificate-only (no password) relays allowed.
7. Docs (`AUTHENTICATION_SECURITY.md`, `CONFIGURATION.md`, `MICROSOFT_365_MAIL.md` pointer),
   then `lint`, `typecheck` and `test:ci`.

## Status (2026-10-06)

Phase 1 (this branch) is implemented, and these review suggestions are folded in:

- `login_microsoft_enabled` → `login_sso_enabled`. Migration `20261006120000_login_sso_enabled`
  copies the beta.3 value and keeps the old row so a rollback still works.
  `LOGIN_MICROSOFT_ENABLED` remains a fallback for `LOGIN_SSO_ENABLED`.
- OIDC `providerAccountId` = `issuer + " " + sub`.
- `private_key_jwt` sits under an "Advanced" section. Dedicated tests cover the audience,
  expiry, `jti`, `x5t#S256`, signature verification and weak/unsupported/encrypted/mismatched keys.
- SMTP CA and client certificates are managed in Settings, with the key encrypted.

## Phase 2 (completed in this branch)

- **Review fixes.** HTTPS-only IdP traffic (including discovery downgrade rejection), one shared lockout
  policy (`scripts/auth-policy.mjs`), the safe direct-switch rule, per-card partial saves, and explicit
  `null` removal.
- **CompDesk-managed IdP CA trust** (`OIDC_CA_CERTIFICATE`), applied by a per-provider HTTPS transport.
- **Setup wizard authentication step** with the lockout guard and Test SSO (`scripts/setup-sso.mjs`).
- **SSO migration mode:** a staged `oidc-next` slot, settings-only cut-over and rollback, and finish with
  optional pruning. Migration also adds a rollback-window fallback sign-in button.
- **Active-issuer change guard and warning.**
- **Integration and rollout testing** (Keycloak, mutual-TLS SMTP, beta.3 → beta.4 rehearsal). Results are in
  `docs/audits/2026-10-06-beta4-rehearsal.md`.

## Verification

- Unit: assertion header and claims (`aud` is the issuer only, signature verifies with the
  public key), `x5t#S256` value, key-type rejection, PEM validation and mismatch detection,
  SMTP transport options, sign-in policy for a deselected provider, `email_verified=false`.
- Manual: Keycloak in Docker (`client_secret_basic` and `private_key_jwt`), SMTP with a
  private-CA test relay.
