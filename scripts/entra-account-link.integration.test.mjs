import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { handleLoginOrRegister } from '../node_modules/next-auth/node_modules/@auth/core/lib/actions/callback/handle-login.js';

const databaseUrl = process.env.ENTRA_LINK_TEST_DATABASE_URL || process.env.DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest('links an existing normalized local user to Entra and reuses it on subsequent SSO', async () => {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const adapter = PrismaAdapter(prisma);
    const suffix = crypto.randomUUID();
    const normalizedEmail = `entra-link-${suffix}@example.test`;
    const providerAccountId = `entra-object-${suffix}`;
    let localUserId;
    try {
        const localUser = await prisma.user.create({
            data: {
                email: normalizedEmail,
                normalizedEmail,
                name: 'Existing Local User',
                role: 'USER',
                isActive: true,
                passwordHash: 'local-password-hash-placeholder',
            },
        });
        localUserId = localUser.id;
        const options = {
            adapter,
            jwt: { decode: async () => null },
            events: {},
            session: { strategy: 'jwt', generateSessionToken: () => crypto.randomUUID(), maxAge: 3600 },
            cookies: { sessionToken: { name: 'authjs.session-token' } },
            provider: {
                allowDangerousEmailAccountLinking: true,
                account: (tokenSet) => tokenSet,
            },
        };
        const profile = { id: providerAccountId, name: 'Entra User', email: normalizedEmail, image: null };
        const account = { type: 'oidc', provider: 'microsoft-entra-id', providerAccountId };

        const firstLogin = await handleLoginOrRegister(null, profile, account, options);
        assert.equal(firstLogin.user.id, localUser.id);
        assert.equal(firstLogin.isNewUser, false);
        assert.equal(await prisma.user.count({ where: { normalizedEmail } }), 1);
        const linked = await prisma.account.findMany({ where: { provider: 'microsoft-entra-id', providerAccountId } });
        assert.equal(linked.length, 1);
        assert.equal(linked[0].userId, localUser.id);

        const subsequentLogin = await handleLoginOrRegister(null, profile, account, options);
        assert.equal(subsequentLogin.user.id, localUser.id);
        assert.equal(await prisma.user.count({ where: { normalizedEmail } }), 1);
        assert.equal(await prisma.account.count({ where: { provider: 'microsoft-entra-id', providerAccountId } }), 1);
    } finally {
        if (localUserId) await prisma.user.delete({ where: { id: localUserId } }).catch(() => undefined);
        await prisma.$disconnect();
    }
});