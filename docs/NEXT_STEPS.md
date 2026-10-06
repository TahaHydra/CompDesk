# Next steps

CompDesk is intentionally kept lightweight. The next planned additions focus on common help-desk needs without turning it into a large ITSM/project-management suite.

## Planned

### Generic OpenID Connect SSO

Add provider-agnostic OpenID Connect (OIDC) support so CompDesk is not limited to Microsoft Entra ID and can integrate with other standards-based identity providers.

The goal is to keep the current explicit account-linking and ownership protections while allowing administrators to configure a standard OIDC provider.

### Certificate support for authentication and mail

Extend authentication and mail configuration with certificate-based options where the provider/protocol supports them, including OIDC client authentication and SMTP/TLS deployments that require certificate or custom trust configuration.

This should remain optional and preserve the existing secret-based configuration paths.

### Saved replies / canned responses

Allow staff to save reusable reply templates for common answers and insert them into ticket replies.

The first version should stay simple: create, edit, delete, and insert saved replies without adding a large knowledge-management or automation system.

## Scope

These are deliberately small additions. CompDesk should continue to prioritize ticketing, self-hosting, privacy, straightforward administration, and useful integrations rather than accumulating unrelated ITSM or project-management features.

This file describes planned direction, not a release commitment or guaranteed implementation order.
