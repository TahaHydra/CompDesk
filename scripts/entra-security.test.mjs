import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { handleLoginOrRegister } from '../node_modules/next-auth/node_modules/@auth/core/lib/actions/callback/handle-login.js';

function fixture({ linked = false, active = true, newUser = false } = {}) {
    let config;
    const existing = { id: 'existing-local', email: 'admin@example.test', normalizedEmail: 'admin@example.test', name: 'Administrator', role: 'SUPER_ADMIN', isActive: active, entraObjectId: 'original-object-id', sessionVersion: 2, credentialsChangedAt: null };
    const updates = [];
    const links = [];
    const prisma = {
        user: { findUnique: async () => newUser ? null : existing, update: async (args) => { updates.push(args); return existing; } },
        account: { findUnique: async () => linked ? { user: existing, userId: existing.id } : null },
    };
    const nextAuth = (value) => { config = value; return { handlers: { GET() {}, POST() {} } }; };
    const dependencies = {
        'next-auth': nextAuth, '@auth/prisma-adapter': { PrismaAdapter: () => ({}) },
        'next-auth/jwt': { decode: async ({ token }) => token ? JSON.parse(token) : null },
        'next-auth/providers/microsoft-entra-id': (value) => ({ id: 'microsoft-entra-id', ...value }),
        'next-auth/providers/credentials': (value) => value,
        'bcryptjs': {}, '@/lib/prisma': { prisma }, '@/lib/audit': { auditLog: async () => {} },
        '@/lib/login-policy': { isLoginMethodEnabled: async () => true },
        '@/lib/entra-diagnostic': { scheduleEntraStartupDiagnostic() {} },
        '@/lib/email-identity': { normalizeEmail: (value) => value.trim().toLowerCase() },
        '@/lib/login-throttle': {}, '@/lib/session-security': { isSessionTokenCurrent: ({ tokenSessionVersion, databaseSessionVersion }) => tokenSessionVersion === databaseSessionVersion }, '@/lib/request-ip': {},
    };
    const source = ts.transpileModule(fs.readFileSync('src/lib/auth.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, {
        exports: {}, require: (name) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; },
        process: { env: { AZURE_AD_CLIENT_ID: 'fixture', AZURE_AD_CLIENT_SECRET: 'synthetic', AZURE_AD_TENANT_ID: 'fixture' } },
    });
    const provider = config.providers.find((value) => value.id === 'microsoft-entra-id');
    const profile = provider.profile({ sub: 'different-provider-subject', oid: 'different-object-id', email: existing.email, name: 'Different identity' });
    const account = { type: 'oidc', provider: 'microsoft-entra-id', providerAccountId: profile.id };
    const options = {
        adapter: {
            getUserByAccount: async () => linked ? existing : null,
            getUser: async () => existing,
            getUserByEmail: async () => newUser ? null : existing,
            createUser: async (value) => ({ ...value, id: 'new-user', role: 'USER', isActive: true }),
            linkAccount: async (value) => links.push(value),
        },
        jwt: config.jwt, events: {},
        session: { strategy: 'jwt', generateSessionToken: () => 'fixture', maxAge: 3600 },
        cookies: { sessionToken: { name: 'authjs.session-token' } },
        provider: { allowDangerousEmailAccountLinking: provider.allowDangerousEmailAccountLinking, account: (value) => value },
    };
    return { config, provider, profile, account, existing, updates, links, options };
}

test('an anonymous different Microsoft subject cannot inherit an existing email account', async () => {
    const f = fixture();
    await f.config.callbacks.signIn({ user: f.profile, account: f.account });
    assert.equal(f.updates.length, 0, 'email claims must not overwrite an existing identity');
    await assert.rejects(handleLoginOrRegister(null, f.profile, f.account, f.options), { name: 'OAuthAccountNotLinked' });
    assert.equal(f.links.length, 0);
});

test('existing linked Microsoft accounts continue signing into the same local account', async () => {
    const f = fixture({ linked: true });
    assert.equal(await f.config.callbacks.signIn({ user: f.existing, account: f.account }), true);
    const result = await handleLoginOrRegister(null, f.profile, f.account, f.options);
    assert.equal(result.user.id, f.existing.id);
    assert.equal(result.user.role, 'SUPER_ADMIN');
    assert.equal(f.updates.length, 0);
});

test('a Microsoft identity linked to another user cannot merge into the current session', async () => {
    const f = fixture({ linked: true });
    f.options.adapter.getUser = async () => ({ ...f.existing, id: 'different-local-user' });
    await assert.rejects(handleLoginOrRegister(
        JSON.stringify({ sub: 'different-local-user', sessionVersion: 2 }), f.profile, f.account, f.options,
    ), { name: 'OAuthAccountNotLinked', message: /^The account is already associated with another user/ });
    assert.equal(f.links.length, 0);
    assert.equal(f.updates.length, 0);
});

test('deactivated linked Microsoft accounts remain denied despite a different email claim', async () => {
    const f = fixture({ linked: true, active: false });
    f.profile.email = 'changed@example.test';
    assert.equal(await f.config.callbacks.signIn({ user: f.profile, account: f.account }), false);
    assert.equal(f.updates.length, 0);
});

test('authenticated local ownership permits explicit Microsoft linking without creating a duplicate', async () => {
    const f = fixture();
    const result = await handleLoginOrRegister(JSON.stringify({ sub: f.existing.id, sessionVersion: 2 }), f.profile, f.account, f.options);
    assert.equal(result.user.id, f.existing.id);
    assert.equal(f.links[0].userId, f.existing.id);
});

test('revoked local sessions cannot link a Microsoft identity', async () => {
    const f = fixture();
    await assert.rejects(handleLoginOrRegister(JSON.stringify({ sub: f.existing.id, sessionVersion: 1 }), f.profile, f.account, f.options), { name: 'OAuthAccountNotLinked' });
    assert.equal(f.links.length, 0);
});

test('deactivated local sessions cannot link a Microsoft identity', async () => {
    const f = fixture({ active: false });
    await assert.rejects(handleLoginOrRegister(JSON.stringify({ sub: f.existing.id, sessionVersion: 2 }), f.profile, f.account, f.options), { name: 'OAuthAccountNotLinked' });
    assert.equal(f.links.length, 0);
});

test('new non-colliding Microsoft identities retain normal user registration', async () => {
    const f = fixture({ newUser: true });
    assert.equal(await f.config.callbacks.signIn({ user: f.profile, account: f.account }), true);
    const result = await handleLoginOrRegister(null, f.profile, f.account, f.options);
    assert.equal(result.user.id, 'new-user');
    assert.equal(result.user.role, 'USER');
    assert.equal(result.isNewUser, true);
    assert.equal(f.links[0].userId, 'new-user');
});

test('post-login Microsoft metadata updates only the resolved account identity', async () => {
    const f = fixture();
    await f.config.events.signIn({ user: { ...f.existing, id: 'resolved-linked-user' }, account: f.account, profile: { oid: 'verified-object' } });
    assert.equal(f.updates.length, 1);
    assert.equal(f.updates[0].where.id, 'resolved-linked-user');
    assert.deepEqual(Object.keys(f.updates[0].data), ['entraObjectId']);
    assert.equal(f.updates[0].data.entraObjectId, 'verified-object');
});
