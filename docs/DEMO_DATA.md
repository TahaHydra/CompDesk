# Demo data

The first-run **Install optional demo data** checkbox and Super Admin **Settings → Demo data → Install demo data** use the same dataset. It contains 3 departments, 18 categories, 5 example tickets, 6 accounts covering all roles, department templates, groups, tags, SLA policies, canned responses, 4 help collections and 8 bilingual help articles.

The installer generates an unpredictable demo email domain and a strong shared demonstration password. Credentials are returned once, with copy/download controls. Only password hashes are stored; plaintext passwords are never written to the ownership record, browser storage, or audit log. Local sign-in must be enabled to sign into demo accounts. Existing authentication, branding and the installation administrator's credentials are preserved.

Setup creates the administrator, settings, dataset and installation record within one Serializable PostgreSQL transaction. If any step fails, no partial database installation is committed. Configuration file behavior remains the documented setup behavior. Manual installation is also transactional; conflicting department names or template IDs are rejected rather than overwriting personal data. Repeated installation is rejected while a managed dataset exists.

## Delete demo data

Only Super Admin can inspect or manage this section. Installation and deletion both require confirmation. Deletion removes records identified in the server-side ownership ledger (`app_settings.demo_dataset`), including the seeded tickets and their dependent history. It never resets the whole database or deletes unmarked users. The signed-in Super Admin, installation receipt, configuration and required system template remain.

On a demo-only installation, cleanup leaves the original Super Admin and required application infrastructure. Any users or tickets you create yourself remain. Demo departments, categories, templates, groups and tags needed by personal records are preserved, including department/category IDs in saved quick links, API client queue restrictions and personally created SLA policies. Demo accounts referenced by remaining history are deactivated, their password cleared, sessions/accounts removed and session version incremented. The UI reports preservation instead of claiming a complete reset. Changes, history and attachments added to seeded tickets are removed with those seeded tickets.

Attachment files belonging to deleted demo tickets are removed after database commit using the existing validated storage path resolver. File failures are reported separately; deleting database records and filesystem files cannot be one atomic transaction.

The ownership ledger is versioned and validated and contains only created record IDs and installation time. Reused system templates, tags or canned responses are not owned by the dataset. When no retained demo entries remain, the ledger is removed and demo installation can run again. Corrupt ownership data aborts cleanup. Missing ownership data permits only cleanup of marked legacy accounts; older untracked tickets or content are never guessed from names or deleted. Older setup's single demo user is included when the full dataset is installed.

For local CLI evaluation, `npm run db:seed` installs the same tracked dataset. Production CLI seeding still requires `ALLOW_PRODUCTION_DEMO_SEED=I_UNDERSTAND_THIS_CREATES_DEMO_DATA`. Optional `SEED_DEMO_DOMAIN`, `SEED_DEFAULT_PASSWORD` and existing per-account `SEED_*_EMAIL` overrides are supported. A conflicting account is rejected rather than changing its password or role. Cleanup uses `npm run demo:remove -- --confirm=REMOVE-DEMO-DATA` and protects the installation administrator (or an active Super Admin when no installation record exists).

## Regression tests

The regular Jest suite runs ownership/confirmation, endpoint authorization and UI tests. To run the real PostgreSQL lifecycle tests, set `DEMO_TEST_DATABASE_URL` to a test PostgreSQL connection with `CREATE DATABASE` privileges, then run:

```sh
node --test scripts/demo-data.integration.test.mjs
```

The test creates a randomly named `compdesk_demo_test_*` database, deploys existing migrations, tests rollback, complete installation, legacy-account cleanup, owner/configuration preservation, delete/reinstall and personal-data protection, then drops only that temporary database. It does not reset the database identified by the supplied connection.
