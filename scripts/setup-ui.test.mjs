import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./setup-ui.html', import.meta.url), 'utf8');

test('installation completion remains visible and requires an explicit sign-in action', () => {
    assert.doesNotMatch(source, /location\.href\s*=/);
    assert.match(source, /Continue to sign in/);
    assert.match(source, /transitionStatus/);
    assert.match(source, /CompDesk is ready/);
});

test('one-time demo credentials can be copied and downloaded without server persistence', () => {
    assert.match(source, /Copy demo credentials/);
    assert.match(source, /Download demo credentials/);
    assert.match(source, /URL\.createObjectURL/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
});

test('the local password checklist covers every server policy requirement', () => {
    for (const requirement of ['passwordPolicy', 'confirmation']) {
        assert.match(source, new RegExp(requirement));
    }
    assert.match(source, /aria-live="polite"/);
});

test('the authentication step offers local, SSO, or both with provider fields and a lockout guard', () => {
    for (const mode of ['local', 'both', 'sso']) assert.match(source, new RegExp(`name="authMode" type="radio" value="${mode}"`));
    for (const provider of ['microsoft-entra-id', 'google', 'okta', 'keycloak', 'auth0', 'authentik', 'oidc']) assert.match(source, new RegExp(`<option value="${provider}">`));
    assert.match(source, /Test SSO configuration/);
    assert.match(source, /\/setup\/api\/sso\/test/);
    assert.match(source, /ssoOnlyNotice/);
    assert.match(source, /Advanced: certificates and client authentication/);
    assert.match(source, /api\/auth\/callback\/\$\{entra\?'microsoft-entra-id':'oidc'\}/);
});
