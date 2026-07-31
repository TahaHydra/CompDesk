import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    inspectConfigVolume,
    performImport,
    readLegacyInstallation,
    writeFilesToVolume,
} from './import-legacy-deployment.mjs';

function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeLegacyFixture(directory, overrides = {}) {
    const installation = {
        installedAt: '2026-01-01T00:00:00.000Z',
        applicationUrl: 'http://localhost:3000',
        deploymentMode: 'docker-compose',
        setupVersion: 1,
        ...overrides.installation,
    };
    fs.writeFileSync(path.join(directory, 'installation.json'), JSON.stringify(installation));
    const envLines = [
        'DATABASE_URL="postgresql://compdesk_ab12cd:s3cr3t-pa%22ss@db:5432/compdesk_db?schema=public"',
        'AUTH_URL="http://localhost:3000"',
        'AUTH_SECRET="legacy-auth-secret-that-is-long-enough"',
        'APP_SETTINGS_ENCRYPTION_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="',
        `POSTGRES_DB="${overrides.postgresDb ?? 'compdesk_db'}"`,
        `POSTGRES_USER="${overrides.postgresUser ?? 'compdesk_ab12cd'}"`,
        `POSTGRES_PASSWORD="${overrides.postgresPassword ?? 's3cr3t-pa\\"ss'}"`,
    ];
    fs.writeFileSync(path.join(directory, 'compdesk.env'), `${envLines.join('\n')}\n`);
}

test('readLegacyInstallation: reads a completed docker-compose installation including a randomized username', () => {
    const directory = tempDir('compdesk-import-read-ok-');
    try {
        writeLegacyFixture(directory);
        const result = readLegacyInstallation({ legacyStateDirectory: directory });
        assert.equal(result.ok, true);
        assert.equal(result.postgresUser, 'compdesk_ab12cd');
        assert.equal(result.postgresDb, 'compdesk_db');
        assert.equal(result.postgresPassword, 's3cr3t-pa"ss');
        assert.equal(result.installation.applicationUrl, 'http://localhost:3000');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('readLegacyInstallation: refuses when there is no completed installation receipt', () => {
    const directory = tempDir('compdesk-import-no-receipt-');
    try {
        const result = readLegacyInstallation({ legacyStateDirectory: directory });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no-installation-receipt');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('readLegacyInstallation: refuses when the generated environment file is missing', () => {
    const directory = tempDir('compdesk-import-no-env-');
    try {
        fs.writeFileSync(path.join(directory, 'installation.json'), JSON.stringify({ deploymentMode: 'docker-compose' }));
        const result = readLegacyInstallation({ legacyStateDirectory: directory });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no-env-file');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('readLegacyInstallation: refuses standalone/external-db installations (no bundled pgdata to import)', () => {
    const directory = tempDir('compdesk-import-wrong-mode-');
    try {
        writeLegacyFixture(directory, { installation: { deploymentMode: 'standalone' } });
        const result = readLegacyInstallation({ legacyStateDirectory: directory });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'unsupported-deployment-mode');
        assert.equal(result.deploymentMode, 'standalone');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('readLegacyInstallation: refuses when POSTGRES_* credentials are missing from the env file', () => {
    const directory = tempDir('compdesk-import-missing-creds-');
    try {
        fs.writeFileSync(path.join(directory, 'installation.json'), JSON.stringify({ deploymentMode: 'docker-compose' }));
        fs.writeFileSync(path.join(directory, 'compdesk.env'), 'AUTH_URL="http://localhost:3000"\n');
        const result = readLegacyInstallation({ legacyStateDirectory: directory });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'missing-postgres-credentials');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('inspectConfigVolume: reports populated, empty, and inspection-error states from injected docker output', () => {
    assert.equal(inspectConfigVolume('v', { run: () => ({ status: 0, stdout: '' }) }).state, 'populated');
    assert.equal(inspectConfigVolume('v', { run: () => ({ status: 1, stdout: '' }) }).state, 'empty');
    assert.equal(inspectConfigVolume('v', { run: () => ({ status: 125, stderr: 'daemon unavailable' }) }).state, 'inspection-error');
    assert.equal(inspectConfigVolume('v', { run: () => ({ error: new Error('spawn docker ENOENT') }) }).state, 'inspection-error');
});

test('writeFilesToVolume: stages files to a temp directory, invokes docker, and always cleans up the staging directory', () => {
    const calls = [];
    const removedDirs = [];
    const written = {};
    const result = writeFilesToVolume('compdesk_config', { 'secrets/postgres_password': 'abc', 'installation.json': '{}' }, {
        run: (command, args) => { calls.push(args.join(' ')); return { status: 0, stdout: '' }; },
        mkdtempSync: (prefix) => `${prefix}FAKE`,
        mkdirSync: () => {},
        writeFileSync: (target, contents) => { written[target] = contents; },
        rmSync: (target) => removedDirs.push(target),
    });
    assert.equal(result.ok, true);
    assert.ok(calls.some((call) => call.includes('compdesk_config')));
    assert.equal(Object.keys(written).length, 2);
    assert.deepEqual(removedDirs, [`${path.join(os.tmpdir(), 'compdesk-import-')}FAKE`]);
});

test('writeFilesToVolume: reports a failure and still cleans up when the docker command fails', () => {
    const removedDirs = [];
    const result = writeFilesToVolume('compdesk_config', { 'installation.json': '{}' }, {
        run: () => ({ status: 1, stderr: 'permission denied' }),
        mkdtempSync: (prefix) => `${prefix}FAKE`,
        mkdirSync: () => {},
        writeFileSync: () => {},
        rmSync: (target) => removedDirs.push(target),
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /permission denied/);
    assert.equal(removedDirs.length, 1);
});

// A mock `run` that satisfies scripts/legacy-credential-verifier.mjs's whole
// flow (volume-in-use check, network create, verifier container start,
// pg_isready, psql authentication) in addition to the config-volume probe
// this file's own functions use — so tests can exercise performImport()
// end-to-end without a real Docker daemon.
function mockVerifiedRun({ configProbeStatus = 1, authStatus = 0, authStdout = '' } = {}) {
    return (command, args) => {
        const joined = args.join(' ');
        if (joined.includes('test -f')) return { status: configProbeStatus, stdout: '' };
        if (joined.startsWith('ps --filter')) return { status: 0, stdout: '' };
        if (joined.startsWith('network create') || joined.startsWith('network rm')) return { status: 0 };
        if (args[0] === 'run' && args.includes('-d')) return { status: 0, stdout: 'containerid\n' };
        if (joined.includes('pg_isready')) return { status: 0 };
        if (joined.includes('psql')) return { status: authStatus, stdout: authStdout, stderr: authStatus === 0 ? '' : 'FATAL: password authentication failed' };
        if (joined.startsWith('rm -f')) return { status: 0 };
        return { status: 0, stdout: '' };
    };
}

test('performImport: full happy path verifies credentials against pgdata, then imports without touching uploads/attachments', async () => {
    const directory = tempDir('compdesk-import-happy-');
    try {
        writeLegacyFixture(directory, { postgresUser: 'compdesk_9f3e21', postgresDb: 'compdesk_db' });
        const dockerCalls = [];
        const run = mockVerifiedRun({ authStdout: 'compdesk_9f3e21|compdesk_db\n' });
        const result = await performImport({
            legacyStateDirectory: directory,
            configVolumeName: 'compdesk_config',
            pgdataVolumeName: 'compdesk_pgdata',
            deps: { run: (command, args) => { dockerCalls.push(args.join(' ')); return run(command, args); } },
        });
        assert.equal(result.ok, true);
        assert.equal(result.postgresUser, 'compdesk_9f3e21');
        assert.equal(result.postgresDb, 'compdesk_db');
        assert.equal(result.applicationUrl, 'http://localhost:3000');
        // The isolated verification container legitimately mounts pgdata
        // (that is the whole point of this credential check) — but nothing
        // ever references the unrelated uploads/attachments volumes, and the
        // legacy directory is left alone.
        assert.ok(!dockerCalls.some((call) => /compdesk_(uploads|attachments)/.test(call)));
        assert.ok(dockerCalls.some((call) => call.includes('compdesk_pgdata')), 'expected the verification step to reference the selected pgdata volume');
        assert.equal(fs.existsSync(path.join(directory, 'installation.json')), true);
        assert.equal(fs.existsSync(path.join(directory, 'compdesk.env')), true);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('performImport: refuses to overwrite an already-populated compdesk_config volume (never reaches credential verification)', async () => {
    const directory = tempDir('compdesk-import-populated-');
    try {
        writeLegacyFixture(directory);
        const calls = [];
        const result = await performImport({
            legacyStateDirectory: directory,
            configVolumeName: 'compdesk_config',
            pgdataVolumeName: 'compdesk_pgdata',
            deps: { run: (command, args) => { calls.push(args.join(' ')); return { status: 0, stdout: '' }; } }, // "populated" probe result
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'config-already-populated');
        assert.ok(!calls.some((call) => call.startsWith('network create')), 'must never start credential verification once the destination is already populated');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('performImport: fails closed when the target volume state cannot be determined', async () => {
    const directory = tempDir('compdesk-import-inspect-fail-');
    try {
        writeLegacyFixture(directory);
        const result = await performImport({
            legacyStateDirectory: directory,
            configVolumeName: 'compdesk_config',
            pgdataVolumeName: 'compdesk_pgdata',
            deps: { run: () => ({ error: new Error('spawn docker ENOENT') }) },
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'config-inspection-failed');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('performImport: propagates a read failure before ever probing or writing to the volume', async () => {
    const directory = tempDir('compdesk-import-read-fail-');
    try {
        const result = await performImport({ legacyStateDirectory: directory, configVolumeName: 'compdesk_config', pgdataVolumeName: 'compdesk_pgdata', deps: {} });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no-installation-receipt');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('performImport: fails closed when the imported credentials do not authenticate, and compdesk_config remains completely untouched', async () => {
    const directory = tempDir('compdesk-import-wrong-creds-');
    try {
        writeLegacyFixture(directory, { postgresUser: 'compdesk_9f3e21', postgresDb: 'compdesk_db' });
        const importStagingCalls = [];
        const run = mockVerifiedRun({ authStatus: 2 }); // wrong password/username/database
        const result = await performImport({
            legacyStateDirectory: directory,
            configVolumeName: 'compdesk_config',
            pgdataVolumeName: 'compdesk_pgdata',
            deps: {
                run,
                // scripts/legacy-credential-verifier.mjs legitimately stages
                // its own password file under a "compdesk-verify-" temp
                // directory as part of verification itself — only a
                // "compdesk-import-" prefixed call (writeFilesToVolume,
                // which must never run after a failed verification) is the
                // one this test asserts against.
                mkdtempSync: (prefix) => {
                    if (prefix.includes('compdesk-import-')) importStagingCalls.push(prefix);
                    return `${prefix}FAKE`;
                },
                writeFileSync: () => {}, // the verifier's own password-staging write; never a real file in this test
                rmSync: () => {},
            },
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'credential-authentication-failed');
        assert.equal(importStagingCalls.length, 0, 'destination must remain untouched: writeFilesToVolume must never be reached after a verification failure');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('performImport: fails closed when the legacy pgdata volume is still attached to a running (unstopped) legacy stack', async () => {
    const directory = tempDir('compdesk-import-volume-in-use-');
    try {
        writeLegacyFixture(directory);
        const result = await performImport({
            legacyStateDirectory: directory,
            configVolumeName: 'compdesk_config',
            pgdataVolumeName: 'compdesk_pgdata',
            deps: {
                run: (command, args) => {
                    const joined = args.join(' ');
                    if (joined.includes('test -f')) return { status: 1, stdout: '' };
                    if (joined.startsWith('ps --filter')) return { status: 0, stdout: 'legacy-db-1\n' };
                    return { status: 0 };
                },
            },
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'credential-volume-in-use');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
