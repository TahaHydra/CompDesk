# Single sign-on test lab

A local Keycloak with two realms, plus PostgreSQL, for testing CompDesk SSO end to end in development mode. Development mode allows plain HTTP to `localhost` identity providers; production requires HTTPS.

| Realm | Issuer | Client | Users (password `LabPassword1!`) |
|---|---|---|---|
| `compdesk` | `http://localhost:18080/realms/compdesk` | `compdesk` / `lab-client-secret-1` | `alice` (admin@compdesk.test), `bob` (bob@compdesk.test), `carol` (carol@compdesk.test), `dave` (email **not** verified) |
| `compdesk-next` | `http://localhost:18080/realms/compdesk-next` | `compdesk` / `lab-client-secret-2` | `alice-next` (admin@compdesk.test), `carol-next` (carol@compdesk.test) |

Keycloak admin console: http://localhost:18080, user `admin`, password `lab-admin`.

## Start

Run these from the repository root in Git Bash. The first command starts Keycloak and PostgreSQL:

```bash
docker compose -f e2e/sso-lab/docker-compose.yml up -d
```

Create a development `.env` in the repository root. It is ignored by Git, and Settings writes your SSO configuration into it:

```bash
printf 'DATABASE_URL="postgresql://compdesk:lab-password@127.0.0.1:15433/compdesk?schema=public"\nAUTH_URL="http://localhost:3000"\nAUTH_SECRET="%s"\nAPP_SETTINGS_ENCRYPTION_KEY="%s"\n' "$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")" "$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" > .env
```

Apply the migrations:

```bash
npx prisma migrate deploy
```

Seed a password-capable Super Admin (`admin@compdesk.test`) and a local user `bob@compdesk.test`, which is used for the duplicate-email check:

```bash
SEED_ADMIN_EMAIL=admin@compdesk.test SEED_USER1_EMAIL=bob@compdesk.test SEED_DEFAULT_PASSWORD='LocalPassword1!' npm run db:seed
```

Start CompDesk:

```bash
npm run dev
```

Open http://localhost:3000 and sign in as `admin@compdesk.test` / `LocalPassword1!`.

## Scenarios

To start each Keycloak login as a different user, sign out of Keycloak in between, at `http://localhost:18080/realms/<realm>/protocol/openid-connect/logout`.

1. **Configure the provider.**
   1. Go to **Settings → Single sign-on**, choose **Keycloak**, and enter the issuer `http://localhost:18080/realms/compdesk`, client ID `compdesk`, and secret `lab-client-secret-1`.
   2. Click **Test configuration**, then **Switch to Keycloak**.
   3. Stop and restart `npm run dev`, since SSO settings load at startup.
   4. Turn on **Login button** and save.
2. **Create a new user.** Sign out of CompDesk, then click **Sign in with Keycloak** and log in as `carol`. Expected: a new USER account.
3. **Duplicate email.** Log in as `bob`. Expected: refused with `OAuthAccountNotLinked`, because email never links accounts.
4. **Unverified email.** Log in as `dave`. Expected: refused (`AccessDenied`).
5. **Explicit linking.** Sign in locally as the admin, then use **Profile → Link my Keycloak account** and log in as `alice`. Sign out, then **Sign in with Keycloak**. Expected: you are signed in as the Super Admin.
6. **Lockout protection.** In **Settings → Security**, disabling local login now works, because the admin is linked. While local login is disabled, the following are refused:
   - switching the provider directly,
   - turning off the SSO login button.

   Re-enable local login afterwards.
7. **Migration.**
   1. Under **SSO migration**, start a migration to **authentik** (any OIDC preset works). Enter the issuer `http://localhost:18080/realms/compdesk-next`, client ID `compdesk`, and secret `lab-client-secret-2`. Test, save, and restart `npm run dev`.
   2. Use **Profile → Link my authentik account** as `alice-next`.
   3. **Cut over.** The sign-in page now shows authentik, plus **Sign in with Keycloak** for users who have not linked yet.
   4. Try `carol-next` without linking. Expected: refused.
   5. Sign in with Keycloak as `carol`, then link `carol-next` from Profile.
   6. **Roll back**, cut over again, then **Finish migration**.
8. **SSO switch during migration.** While a migration is staged, turn the login button off. Anonymous sign-in through the target is then refused, while linking from Profile still works.

### Optional: `private_key_jwt`

Generate a key and certificate:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 -subj "/CN=compdesk-lab" -keyout lab-client.key -out lab-client.pem
```

Register the certificate on the `compdesk-next` client:

```bash
MSYS_NO_PATHCONV=1 docker compose -f e2e/sso-lab/docker-compose.yml exec keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password lab-admin
```

```bash
CLIENT_ID=$(MSYS_NO_PATHCONV=1 docker compose -f e2e/sso-lab/docker-compose.yml exec keycloak /opt/keycloak/bin/kcadm.sh get clients -r compdesk-next -q clientId=compdesk --fields id --format csv --noquotes | tr -d '\r')
```

```bash
MSYS_NO_PATHCONV=1 docker compose -f e2e/sso-lab/docker-compose.yml exec keycloak /opt/keycloak/bin/kcadm.sh update clients/$CLIENT_ID -r compdesk-next -s clientAuthenticatorType=client-jwt -s "attributes.\"jwt.credential.certificate\"=$(grep -v CERTIFICATE lab-client.pem | tr -d '\r\n')"
```

Then, under **Advanced** in the staged provider's settings:

1. Choose **Private key JWT**.
2. Load `lab-client.key` and `lab-client.pem`.
3. Leave **Key ID** empty, then save and restart.

Delete `lab-client.key` when you are done.

## Stop and clean up

```bash
docker compose -f e2e/sso-lab/docker-compose.yml down -v
```

Also delete the development `.env` if you do not need it any more.

On PowerShell, set the seed variables with `$env:NAME='value'` before `npm run db:seed`, and create `.env` with any editor.
