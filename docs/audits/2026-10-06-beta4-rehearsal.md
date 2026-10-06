# Beta.4 development rehearsal — 2026-10-06

Performed with images built from `main` (beta.3, `efa364d`) and this branch, using separate Compose projects and volumes.

| Check | Result |
|---|---|
| beta.3 install with demo data, Entra configured, uploaded logo | ✅ |
| beta.3 checks a **staging** manifest (`updates/manifest.staging.json`, served over HTTPS via `COMPDESK_UPDATE_MANIFEST_URL`) and detects 0.9.0-beta.4; request carries no installation data | ✅ |
| Upgrade beta.3 → beta.4 with preserved database, config volume and uploads: data, uploads, Entra config and button text unchanged; `login_sso_enabled=true` migrated | ✅ |
| Image-only rollback to beta.3 on the upgraded database | ✅ starts and signs in normally |
| Restore of the pre-upgrade `pg_dump` | ✅ identical to the original beta.3 snapshot |
| Re-upgrade after restore | ✅ identical to the first upgrade |
| Fresh beta.4 setup wizard: SSO-only refused; Keycloak over HTTPS with private CA tested and installed; provider active after install | ✅ |

Identity provider integration was tested against Keycloak 26.4: client secret, `private_key_jwt`, explicit linking, duplicate email, unverified email, relogin, migration cut-over/rollback/finish with pruning, and HTTPS with a managed CA in production mode. SMTP was tested against a mutual-TLS relay (private CA, client certificate, no password).
