import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as core from './setup-core.mjs';

test('generates independent high-entropy secrets', () => {
    const first = core.randomSecret(32);
    const second = core.randomSecret(32);
    assert.equal(Buffer.from(first, 'base64').length, 32);
    assert.notEqual(first, second);
});

test('requires PostgreSQL and validates connection fields', () => {
    assert.equal(core.validateDatabaseInput({
        provider: 'mysql', host: 'localhost', port: 3306, database: 'compdesk',
        username: 'compdesk', password: 'secret', sslMode: 'prefer',
    }).provider, 'CompDesk currently supports PostgreSQL only.');
    assert.deepEqual(core.validateDatabaseInput({
        provider: 'postgresql', host: 'db.example.com', port: 5432, database: 'compdesk_db',
        username: 'compdesk', password: 'secret', sslMode: 'verify-full',
    }), {});
});

test('requires HTTPS away from loopback', () => {
    assert.equal(core.validatePublicUrl('http://helpdesk.example.com').valid, false);
    assert.deepEqual(core.validatePublicUrl('https://helpdesk.example.com'), {
        valid: true, origin: 'https://helpdesk.example.com',
    });
    assert.equal(core.validatePublicUrl('http://localhost:3000').valid, true);
});

test('does not persist setup passwords in resumable state', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-'));
    try {
        const target = path.join(directory, 'state.json');
        core.saveNonSecretState(target, {
            database: { host: 'db', port: 5432, database: 'app', username: 'app', password: 'db-secret' },
            authentication: { adminEmail: ' Admin@Example.COM ', adminPassword: 'user-secret', clientSecret: 'entra-secret' },
            smtp: { password: 'smtp-secret' },
        });
        const stored = fs.readFileSync(target, 'utf8');
        for (const secret of ['db-secret', 'user-secret', 'entra-secret', 'smtp-secret']) assert.equal(stored.includes(secret), false);
        assert.equal(JSON.parse(stored).authentication.adminEmail, 'admin@example.com');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('writes configuration atomically with restrictive permissions and backup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-env-'));
    try {
        const target = path.join(directory, '.env');
        core.writeFileAtomic(target, 'FIRST=true\n');
        const result = core.writeFileAtomic(target, 'SECOND=true\n');
        assert.equal(fs.readFileSync(target, 'utf8'), 'SECOND=true\n');
        assert.ok(result.backupPath);
        assert.equal(fs.readFileSync(result.backupPath, 'utf8'), 'FIRST=true\n');
        if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('encrypts SMTP passwords with authenticated random envelopes', () => {
    const key = core.randomSecret(32);
    const first = core.encryptEnvelope('smtp password', key);
    const second = core.encryptEnvelope('smtp password', key);
    assert.match(first, /^enc:v1:/);
    assert.notEqual(first, second);
    assert.equal(first.includes('smtp password'), false);
});

test('renders one deterministic environment file with the runtime storage key', () => {
    const rendered = core.renderEnvironment({
        databaseUrl: 'postgresql://user:pass@db/app',
        applicationUrl: 'https://helpdesk.example.com',
        authSecret: 'auth-secret',
        settingsEncryptionKey: 'encryption-key',
        localEnabled: true,
        microsoftEnabled: false,
        trustProxy: true,
        privateAttachmentDir: '/srv/compdesk/attachments',
        uploadMaxSizeMb: 25,
        attachmentMaxFilesPerTicket: 20,
        attachmentMaxMbPerTicket: 100,
        attachmentGlobalMaxGb: 10,
        tempAttachmentTtlHours: 24,
        tempAttachmentMaxFilesPerUser: 20,
        tempAttachmentMaxMbPerUser: 100,
    });
    assert.match(rendered, /ATTACHMENT_STORAGE_DIR=/);
    assert.match(rendered, /ATTACHMENT_MAX_FILES_PER_TICKET=20/);
    assert.match(rendered, /ATTACHMENT_MAX_BYTES_PER_TICKET=104857600/);
    assert.match(rendered, /ATTACHMENT_GLOBAL_MAX_BYTES=10737418240/);
    assert.match(rendered, /TEMP_ATTACHMENT_TTL_HOURS=24/);
    assert.doesNotMatch(rendered, /PRIVATE_ATTACHMENT_DIR=/);
    assert.doesNotMatch(rendered, /AZURE_AD_CLIENT_SECRET=/);
    assert.doesNotMatch(rendered, /CLAMAV_HOST=/);

    const withScanner = core.renderEnvironment({
        databaseUrl: 'postgresql://user:pass@db/app',
        applicationUrl: 'https://helpdesk.example.com',
        authSecret: 'auth-secret',
        settingsEncryptionKey: 'encryption-key',
        localEnabled: true,
        microsoftEnabled: false,
        trustProxy: true,
        privateAttachmentDir: '/srv/compdesk/attachments',
        uploadMaxSizeMb: 25,
        attachmentMaxFilesPerTicket: 20,
        attachmentMaxMbPerTicket: 100,
        attachmentGlobalMaxGb: 10,
        tempAttachmentTtlHours: 24,
        tempAttachmentMaxFilesPerUser: 20,
        tempAttachmentMaxMbPerUser: 100,
        clamavEnabled: true,
        clamavHost: 'clamav.internal',
        clamavPort: 3310,
    });
    assert.match(withScanner, /CLAMAV_HOST="clamav\.internal"/);
    assert.match(withScanner, /CLAMAV_PORT=3310/);
});

test('uses same-origin comparison and constant-time token comparison', () => {
    const request = new Request('http://localhost:3000/setup', { headers: { Origin: 'http://localhost:3000' } });
    assert.equal(core.isSameOrigin(request, 'http://localhost:3000'), true);
    assert.equal(core.isSameOrigin(request, 'https://example.com'), false);
    assert.equal(core.timingSafeEqual('token', 'token'), true);
    assert.equal(core.timingSafeEqual('token', 'other'), false);
});
