import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { installDemoData, installDemoDataInTransaction, removeDemoData, getDemoState, DEMO_CONFIRMATION, DEMO_LEDGER_KEY } from './demo-data.mjs';

async function checkSetup(databaseUrl) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'compdesk-demo-setup-'));
    const port = await new Promise((resolve) => {
        const listener = net.createServer();
        listener.listen(0, '127.0.0.1', () => { const address = listener.address(); listener.close(() => resolve(address.port)); });
    });
    const url = new URL(databaseUrl);
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [process.env.DEMO_TEST_SETUP_ENTRY || 'scripts/setup-bootstrap.mjs'], {
        cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, COMPDESK_ORCHESTRATOR_MANAGED: 'false', COMPDESK_CONFIG_DIR: directory, COMPDESK_ENV_FILE: path.join(directory, '.env'), COMPDESK_SETUP_STATE_DIR: directory, COMPDESK_BOOTSTRAP_DB_PASSWORD_FILE: '', SETUP_PUBLIC_ORIGIN: origin, SETUP_PORT: String(port), SETUP_HOST: '127.0.0.1', SETUP_ALLOW_REMOTE: 'false' },
    });
    let output = '';
    child.stdout.on('data', (value) => { output += value.toString(); });
    child.stderr.on('data', (value) => { output += value.toString(); });
    const database = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
        const token = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('Isolated setup failed to start')); }, 10000);
            const poll = setInterval(() => {
                const match = output.match(/bootstrap token[^:]*:\s*(\S+)/i);
                if (match) { clearInterval(poll); clearTimeout(timeout); resolve(match[1]); }
                else if (child.exitCode !== null) { clearInterval(poll); clearTimeout(timeout); reject(new Error('Isolated setup exited')); }
            }, 25);
        });
        const sessionResponse = await fetch(`${origin}/setup/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        assert.equal(sessionResponse.status, 200);
        const session = await sessionResponse.json();
        const password = `${crypto.randomBytes(16).toString('hex')}aA1!`;
        const response = await fetch(`${origin}/setup/api/install`, { method: 'POST', headers: {
            Origin: origin, 'Content-Type': 'application/json', Cookie: sessionResponse.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken,
        }, body: JSON.stringify({
            deploymentMode: 'manual', installDemoData: true,
            database: { provider: 'postgresql', host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), sslMode: 'disable' },
            identity: { applicationUrl: origin, applicationName: 'Wizard demo regression', primaryColor: '#4f46e5', accentColor: '#64748b' },
            authentication: { localEnabled: true, microsoftEnabled: false, adminEmail: 'wizard-owner@real.example', adminName: 'Wizard owner', adminPassword: password, adminPasswordConfirm: password },
            storage: { privateAttachmentDir: path.join(directory, 'attachments'), uploadMaxSizeMb: 10, attachmentMaxFilesPerTicket: 20, attachmentMaxMbPerTicket: 100, attachmentGlobalMaxGb: 10, tempAttachmentTtlHours: 24, tempAttachmentMaxFilesPerUser: 20, tempAttachmentMaxMbPerUser: 100, clamavEnabled: false },
        }) });
        assert.equal(response.status, 200, 'fresh wizard accepts the complete installation');
        const result = await response.json();
        assert.equal(result.demoCredentials.accounts.length, 6);
        assert.equal(await database.ticket.count(), 5);
        assert.equal(await database.queue.count(), 3);
        const owner = await database.user.findUnique({ where: { normalizedEmail: 'wizard-owner@real.example' } });
        assert.equal(owner.isDemo, false);
        assert.equal(owner.role, 'SUPER_ADMIN');
        assert.equal((await database.installationRecord.findUnique({ where: { id: 'primary' } })).demoDataInstalled, true);
        assert.equal((await fetch(`${origin}/setup`)).status, 410);
        await removeDemoData(database, { protectedUserId: owner.id, confirmation: DEMO_CONFIRMATION });
        assert.equal(await database.user.count(), 1);
        assert.equal(await database.ticket.count(), 0);
    } finally {
        child.kill('SIGTERM');
        await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
        await database.$disconnect();
        // mkdtemp creates this directory; never use a configured installation path.
        await fs.rm(directory, { recursive: true, force: true });
    }
}

test('complete demo lifecycle on an isolated PostgreSQL database', { skip: !process.env.DEMO_TEST_DATABASE_URL }, async (t) => {
    const sourceUrl = process.env.DEMO_TEST_DATABASE_URL;
    const name = `compdesk_demo_test_${crypto.randomBytes(6).toString('hex')}`;
    const control = new pg.Client({ connectionString: sourceUrl });
    await control.connect();
    let prisma;
    try {
        await control.query(`CREATE DATABASE "${name}"`);
        const url = new URL(sourceUrl); url.pathname = `/${name}`;
        execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.href }, stdio: 'pipe' });
        prisma = new PrismaClient({ datasourceUrl: url.href });
        const admin = await prisma.user.create({ data: { email: 'owner@real.example', name: 'Owner', role: 'SUPER_ADMIN', passwordHash: 'preserve-this-hash' } });
        await prisma.appSetting.create({ data: { key: 'branding_config', value: '{"applicationName":"My real installation"}' } });
        await prisma.appSetting.create({ data: { key: 'login_local_enabled', value: 'false' } });
        await prisma.installationRecord.create({ data: { id: 'primary', installedByEmail: admin.email, deploymentMode: 'docker-compose', applicationUrl: 'http://localhost:3100' } });
        const options = { protectedUserId: admin.id };
        const removal = { ...options, confirmation: DEMO_CONFIRMATION };

        await t.test('setup seed rolls back with its installation transaction', async () => {
            await assert.rejects(prisma.$transaction(async (tx) => {
                await installDemoDataInTransaction(tx, options);
                throw new Error('simulate setup failure');
            }, { timeout: 60000 }), /simulate setup failure/);
            assert.equal(await prisma.user.count(), 1);
            assert.equal(await prisma.queue.count(), 0);
            assert.equal(await prisma.appSetting.count({ where: { key: DEMO_LEDGER_KEY } }), 0);
        });
        await t.test('full dataset includes all roles, tickets and content without changing owner or settings', async () => {
            // Older setup releases installed just this one marked account.
            await prisma.user.create({ data: { email: 'old-demo@example.com', name: 'Legacy demo', role: 'USER', isDemo: true } });
            const result = await installDemoData(prisma, options);
            assert.equal(result.accounts.length, 6);
            assert.deepEqual(new Set(result.accounts.map((account) => account.role)), new Set(['SUPER_ADMIN', 'ADMIN', 'AGENT', 'USER']));
            assert.equal(await prisma.queue.count(), 3);
            assert.equal(await prisma.category.count(), 18);
            assert.equal(await prisma.ticket.count(), 5);
            assert.equal(await prisma.helpArticle.count(), 8);
            assert.equal(await prisma.user.count({ where: { isDemo: true } }), 7);
            assert.equal((await prisma.user.findUnique({ where: { id: admin.id } })).passwordHash, 'preserve-this-hash');
            assert.equal((await prisma.appSetting.findUnique({ where: { key: 'login_local_enabled' } })).value, 'false');
            const ledger = (await prisma.appSetting.findUnique({ where: { key: DEMO_LEDGER_KEY } })).value;
            assert.equal(ledger.includes(result.password), false);
            await assert.rejects(installDemoData(prisma, options), /already installed/);
            assert.equal(await prisma.ticket.count(), 5);
        });
        await t.test('cleanup leaves only the original super admin and required infrastructure, and reinstall works', async () => {
            const result = await removeDemoData(prisma, removal);
            assert.equal(result.retained, 0);
            assert.equal(await prisma.user.count(), 1);
            assert.equal(await prisma.ticket.count(), 0);
            assert.equal(await prisma.queue.count(), 0);
            assert.equal(await prisma.category.count(), 0);
            assert.equal(await prisma.helpArticle.count(), 0);
            assert.equal((await prisma.appSetting.findUnique({ where: { key: 'branding_config' } })).value, '{"applicationName":"My real installation"}');
            assert.equal((await getDemoState(prisma)).installed, false);
            await installDemoData(prisma, options);
        });
        await t.test('personal quick links and API restrictions retain their demo departments and categories', async () => {
            const queue = await prisma.queue.findUnique({ where: { name: 'IT Support' } });
            const category = await prisma.category.findFirst({ where: { queueId: queue.id } });
            const finance = await prisma.queue.findUnique({ where: { name: 'Finance' } });
            await prisma.appSetting.create({ data: { key: 'dashboard_links', value: JSON.stringify([{ type: 'ticket_form', title: 'My quick link', queueId: queue.id, categoryId: category.id, iconUrl: '' }]) } });
            const apiClient = await prisma.apiClient.create({ data: { name: 'Personal integration', keyHash: crypto.randomBytes(32).toString('hex'), scopes: ['tickets:read'], allowedQueueIds: [finance.id] } });
            const personalSla = await prisma.slaPolicy.create({ data: { queueId: finance.id, priority: 'LOW', firstResponseMinutes: 300, resolutionMinutes: 3000 } });
            await removeDemoData(prisma, removal);
            assert.ok(await prisma.queue.findUnique({ where: { id: queue.id } }), 'quick link department retained');
            assert.ok(await prisma.category.findUnique({ where: { id: category.id } }), 'quick link category retained');
            assert.ok(await prisma.queue.findUnique({ where: { id: finance.id } }), 'API department retained');
            await prisma.appSetting.delete({ where: { key: 'dashboard_links' } });
            await prisma.apiClient.delete({ where: { id: apiClient.id } });
            await removeDemoData(prisma, removal);
            assert.ok(await prisma.slaPolicy.findUnique({ where: { id: personalSla.id } }), 'personal SLA policy retained');
            await prisma.slaPolicy.delete({ where: { id: personalSla.id } });
            await removeDemoData(prisma, removal);
            assert.equal((await getDemoState(prisma)).installed, false);
            await installDemoData(prisma, options);
        });
        await t.test('real users and tickets are kept and referenced demo accounts cannot sign in', async () => {
            const sample = await prisma.ticket.findFirst();
            const realUser = await prisma.user.create({ data: { email: 'real-user@example.com', name: 'Personal account', role: 'USER' } });
            const realTicket = await prisma.ticket.create({ data: {
                key: 'REAL-001', title: 'Personal ticket created during testing', requesterId: realUser.id,
                queueId: sample.queueId, categoryId: sample.categoryId, resolvedTemplateId: sample.resolvedTemplateId,
                resolvedTemplateVersion: sample.resolvedTemplateVersion, formSchemaSnapshot: sample.formSchemaSnapshot,
            } });
            const demoUser = await prisma.user.findFirst({ where: { role: 'AGENT', isDemo: true } });
            await prisma.ticketAssignee.create({ data: { ticketId: realTicket.id, userId: demoUser.id, assignedById: admin.id } });
            const result = await removeDemoData(prisma, removal);
            assert.ok(result.retained > 0);
            assert.equal(await prisma.ticket.count(), 1);
            assert.ok(await prisma.user.findUnique({ where: { id: realUser.id } }));
            const disabled = await prisma.user.findUnique({ where: { id: demoUser.id } });
            assert.equal(disabled.isActive, false);
            assert.equal(disabled.passwordHash, null);
            assert.equal(disabled.sessionVersion, demoUser.sessionVersion + 1);
            assert.ok(await prisma.ticket.findUnique({ where: { id: realTicket.id } }));
        });
        await t.test('corrupted ownership fails safely without deleting personal records', async () => {
            await prisma.appSetting.update({ where: { key: DEMO_LEDGER_KEY }, data: { value: 'malformed' } });
            await assert.rejects(removeDemoData(prisma, removal), /ownership information is invalid/);
            assert.equal(await prisma.ticket.count(), 1);
            assert.ok(await prisma.user.findUnique({ where: { id: admin.id } }));
        });
        await t.test('fresh setup checkbox installs the full dataset and cleanup preserves its owner', async () => {
            const setupName = `${name}_setup`;
            await control.query(`CREATE DATABASE "${setupName}"`);
            const setupUrl = new URL(sourceUrl); setupUrl.pathname = `/${setupName}`;
            try { await checkSetup(setupUrl.href); } finally { await control.query(`DROP DATABASE "${setupName}" WITH (FORCE)`); }
        });
    } finally {
        if (prisma) await prisma.$disconnect();
        await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await control.end();
    }
});
