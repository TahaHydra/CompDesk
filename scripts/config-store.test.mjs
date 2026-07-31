import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chownRecursiveSync, initializeConfig, pgdataInitialized, readPostgresIdentity, readPostgresPassword } from './config-store.mjs';

function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function realFsDeps() {
    return {};
}

test('pgdataInitialized: true only when PG_VERSION marker is present', () => {
    const directory = tempDir('compdesk-pgdata-check-');
    try {
        assert.equal(pgdataInitialized(directory), false);
        fs.writeFileSync(path.join(directory, 'PG_VERSION'), '16\n');
        assert.equal(pgdataInitialized(directory), true);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('fresh config initialization generates a password and identity pair', () => {
    const configDir = tempDir('compdesk-config-fresh-');
    const pgdataCheckDirectory = tempDir('compdesk-pgdata-empty-');
    try {
        const result = initializeConfig({ configDir, pgdataCheckDirectory, deps: realFsDeps() });
        assert.equal(result.ok, true);
        assert.equal(result.action, 'generated');
        const password = readPostgresPassword(configDir);
        assert.ok(password.length >= 30);
        const identity = readPostgresIdentity(configDir);
        assert.deepEqual(identity, { user: 'compdesk', db: 'compdesk' });
    } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.rmSync(pgdataCheckDirectory, { recursive: true, force: true });
    }
});

test('idempotent rerun preserves an existing secret pair without regenerating it', () => {
    const configDir = tempDir('compdesk-config-idempotent-');
    const pgdataCheckDirectory = tempDir('compdesk-pgdata-empty-');
    try {
        const first = initializeConfig({ configDir, pgdataCheckDirectory });
        assert.equal(first.action, 'generated');
        const passwordBefore = readPostgresPassword(configDir);

        const second = initializeConfig({ configDir, pgdataCheckDirectory });
        assert.equal(second.ok, true);
        assert.equal(second.action, 'preserved');
        assert.equal(readPostgresPassword(configDir), passwordBefore);
    } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.rmSync(pgdataCheckDirectory, { recursive: true, force: true });
    }
});

test('partial/interrupted initialization regenerates both secrets when pgdata is still empty', () => {
    const configDir = tempDir('compdesk-config-partial-');
    const pgdataCheckDirectory = tempDir('compdesk-pgdata-empty-');
    try {
        fs.mkdirSync(path.join(configDir, 'secrets'), { recursive: true });
        // Simulate a crash after the password file was written but before the
        // identity file was written.
        fs.writeFileSync(path.join(configDir, 'secrets', 'postgres_password'), 'partial-password');

        const result = initializeConfig({ configDir, pgdataCheckDirectory });
        assert.equal(result.ok, true);
        assert.equal(result.action, 'generated');
        assert.notEqual(readPostgresPassword(configDir), 'partial-password');
        assert.deepEqual(readPostgresIdentity(configDir), { user: 'compdesk', db: 'compdesk' });
    } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.rmSync(pgdataCheckDirectory, { recursive: true, force: true });
    }
});

test('missing secret with initialized pgdata fails closed instead of regenerating credentials', () => {
    const configDir = tempDir('compdesk-config-missing-secret-');
    const pgdataCheckDirectory = tempDir('compdesk-pgdata-initialized-');
    try {
        fs.writeFileSync(path.join(pgdataCheckDirectory, 'PG_VERSION'), '16\n');
        const result = initializeConfig({ configDir, pgdataCheckDirectory });
        assert.equal(result.ok, false);
        assert.equal(result.action, 'refused-initialized-pgdata');
        assert.equal(fs.existsSync(path.join(configDir, 'secrets', 'postgres_password')), false);
    } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.rmSync(pgdataCheckDirectory, { recursive: true, force: true });
    }
});

test('partial secrets alongside an initialized pgdata still fail closed (never guess which half is authoritative)', () => {
    const configDir = tempDir('compdesk-config-partial-initialized-');
    const pgdataCheckDirectory = tempDir('compdesk-pgdata-initialized-');
    try {
        fs.writeFileSync(path.join(pgdataCheckDirectory, 'PG_VERSION'), '16\n');
        fs.mkdirSync(path.join(configDir, 'secrets'), { recursive: true });
        fs.writeFileSync(path.join(configDir, 'secrets', 'postgres_password'), 'partial-password');

        const result = initializeConfig({ configDir, pgdataCheckDirectory });
        assert.equal(result.ok, false);
        assert.equal(result.action, 'refused-initialized-pgdata');
        assert.equal(fs.readFileSync(path.join(configDir, 'secrets', 'postgres_password'), 'utf8'), 'partial-password');
    } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.rmSync(pgdataCheckDirectory, { recursive: true, force: true });
    }
});

test('already installed with an intact secret pair is a no-op', () => {
    const configDir = tempDir('compdesk-config-installed-');
    const pgdataCheckDirectory = tempDir('compdesk-pgdata-initialized-');
    try {
        fs.writeFileSync(path.join(configDir, 'installation.json'), '{}', { flag: 'w', mode: 0o600 });
        fs.mkdirSync(path.join(configDir, 'secrets'), { recursive: true });
        fs.writeFileSync(path.join(configDir, 'secrets', 'postgres_password'), 'existing-password');
        fs.writeFileSync(path.join(configDir, 'secrets', 'postgres_identity.json'), '{"user":"compdesk_ab12","db":"compdesk_db"}');

        const result = initializeConfig({ configDir, pgdataCheckDirectory });
        assert.equal(result.ok, true);
        assert.equal(result.action, 'already-installed');
        assert.equal(fs.readFileSync(path.join(configDir, 'secrets', 'postgres_password'), 'utf8'), 'existing-password');
    } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.rmSync(pgdataCheckDirectory, { recursive: true, force: true });
    }
});

test('already installed but missing a secret file fails closed', () => {
    const configDir = tempDir('compdesk-config-installed-missing-');
    const pgdataCheckDirectory = tempDir('compdesk-pgdata-initialized-');
    try {
        fs.writeFileSync(path.join(configDir, 'installation.json'), '{}');
        const result = initializeConfig({ configDir, pgdataCheckDirectory });
        assert.equal(result.ok, false);
        assert.equal(result.action, 'failed-missing-secrets');
        assert.equal(result.missing.length, 2);
    } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.rmSync(pgdataCheckDirectory, { recursive: true, force: true });
    }
});

test('chownRecursiveSync walks nested directories and files exactly once each', () => {
    const calls = [];
    const fakeFs = {
        existsSync: () => true,
        chownSync: (target) => calls.push(target),
        readdirSync: (target) => {
            if (target === '/root') return [{ name: 'a.txt', isDirectory: () => false }, { name: 'sub', isDirectory: () => true }];
            if (target === path.join('/root', 'sub')) return [{ name: 'b.txt', isDirectory: () => false }];
            return [];
        },
    };
    chownRecursiveSync('/root', 1001, 1001, fakeFs);
    assert.deepEqual(calls.sort(), ['/root', path.join('/root', 'a.txt'), path.join('/root', 'sub'), path.join('/root', 'sub', 'b.txt')].sort());
});

test('chownRecursiveSync is a no-op when the target path does not exist', () => {
    const calls = [];
    chownRecursiveSync('/does-not-exist', 1001, 1001, { existsSync: () => false, chownSync: () => calls.push('called') });
    assert.equal(calls.length, 0);
});
