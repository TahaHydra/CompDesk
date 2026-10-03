import fs from 'fs';
import path from 'path';
import {
    genericOidcEmailAccepted,
    genericOidcProfile,
    genericOidcProvider,
    isGenericOidcConfigured,
    parseOidcRoleMap,
    roleFromOidcGroups,
} from '@/lib/oidc-provider';

const ENV = {
    NODE_ENV: 'test',
    OIDC_ISSUER: 'https://idp.example.com/application/o/compdesk/',
    OIDC_CLIENT_ID: 'client',
    OIDC_CLIENT_SECRET: 'secret',
} as NodeJS.ProcessEnv;

describe('generic OIDC provider', () => {
    it('is enabled only when issuer, client ID and secret are all set', () => {
        expect(isGenericOidcConfigured(ENV)).toBe(true);
        expect(isGenericOidcConfigured({ ...ENV, OIDC_CLIENT_SECRET: '' })).toBe(false);
        expect(isGenericOidcConfigured({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
    });

    it('uses discovery with PKCE, state and nonce checks', () => {
        const provider = genericOidcProvider({ ...ENV, OIDC_DISPLAY_NAME: 'Authentik' });
        expect(provider).toMatchObject({
            id: 'oidc',
            name: 'Authentik',
            type: 'oidc',
            issuer: ENV.OIDC_ISSUER,
            checks: ['pkce', 'state', 'nonce'],
            authorization: { params: { scope: 'openid email profile' } },
        });
    });

    it('maps configurable claims and normalizes the email', () => {
        expect(genericOidcProfile({ sub: 'abc', email: ' Owner@Example.COM ', name: 'Owner' }, ENV)).toEqual({ id: 'abc', name: 'Owner', email: 'owner@example.com', image: null });
        expect(genericOidcProfile({ uid: 'u1', mail: 'a@b.co', preferred_username: 'ab' }, { ...ENV, OIDC_ID_CLAIM: 'uid', OIDC_EMAIL_CLAIM: 'mail' }))
            .toEqual({ id: 'u1', name: 'ab', email: 'a@b.co', image: null });
    });

    it('maps IdP groups to the highest configured role and ignores unknown roles', () => {
        const map = parseOidcRoleMap('staff=AGENT, admins=super_admin, bogus=ROOT, =ADMIN');
        expect(map).toEqual([['staff', 'AGENT'], ['admins', 'SUPER_ADMIN']]);
        expect(roleFromOidcGroups(['staff', 'admins'], map)).toBe('SUPER_ADMIN');
        expect(roleFromOidcGroups(['staff'], map)).toBe('AGENT');
        expect(roleFromOidcGroups(['customers'], map)).toBeNull();
        expect(roleFromOidcGroups(undefined, map)).toBeNull();
        expect(genericOidcProfile({ sub: 'x', email: 'x@y.co', groups: ['staff'] }, { ...ENV, OIDC_ROLE_MAP: 'staff=AGENT' }).role).toBe('AGENT');
    });

    it('requires a verified email before linking accounts unless explicitly relaxed', () => {
        expect(genericOidcEmailAccepted({ email_verified: true }, ENV)).toBe(true);
        expect(genericOidcEmailAccepted({ email_verified: false }, ENV)).toBe(false);
        expect(genericOidcEmailAccepted({}, ENV)).toBe(false);
        expect(genericOidcEmailAccepted({}, { ...ENV, OIDC_REQUIRE_VERIFIED_EMAIL: 'false' })).toBe(true);
    });

    it('is wired into Auth.js and the sign-in page', () => {
        const auth = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'auth.ts'), 'utf8');
        expect(auth).toContain('isGenericOidcConfigured() ? [genericOidcProvider()] : []');
        expect(auth).toContain("reason: 'email_not_verified'");
        const page = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'auth', 'signin', 'page.tsx'), 'utf8');
        expect(page).toContain("signIn('oidc'");
    });
});
