import assert from 'node:assert/strict';
import test from 'node:test';
import {
    authenticateAndVerifyIdentity,
    detectVolumeInUse,
    verifyLegacyCredentials,
    waitForPostgresReady,
} from './legacy-credential-verifier.mjs';

const SECRET_PASSWORD = 'sUpEr-Secret-Legacy-Pass_9f3e21';

function noWait() {
    return Promise.resolve();
}

function baseDeps(overrides = {}) {
    const calls = [];
    const written = {};
    const removedDirs = [];
    const { run: rawRun, ...restOverrides } = overrides;
    const run = rawRun || (() => ({ status: 0, stdout: '', stderr: '' }));
    return {
        calls,
        written,
        removedDirs,
        deps: {
            wait: noWait,
            mkdtempSync: (prefix) => `${prefix}FAKE`,
            writeFileSync: (target, contents) => { written[target] = contents; },
            rmSync: (target) => removedDirs.push(target),
            randomId: () => 'testid',
            ...restOverrides,
            // Always wraps whichever run() the test supplied, so `calls` is
            // populated regardless of which override object "wins" — the
            // wrapper itself must never be overwritable by a spread.
            run: (command, args, opts) => { calls.push(args); return run(command, args, opts); },
        },
    };
}

test('detectVolumeInUse: reports docker-unavailable when the docker executable is missing', () => {
    const result = detectVolumeInUse('v', { run: () => ({ error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }) }) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'docker-unavailable');
});

test('detectVolumeInUse: reports volume-in-use when a running container already has the volume mounted', () => {
    const result = detectVolumeInUse('compdesk_pgdata', { run: () => ({ status: 0, stdout: 'legacy-db-1\n' }) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'volume-in-use');
    assert.match(result.detail, /legacy-db-1/);
    assert.match(result.detail, /Stop the legacy stack first/);
});

test('detectVolumeInUse: ok when nothing currently uses the volume', () => {
    const result = detectVolumeInUse('compdesk_pgdata', { run: () => ({ status: 0, stdout: '' }) });
    assert.equal(result.ok, true);
});

test('waitForPostgresReady: succeeds as soon as pg_isready reports ready', async () => {
    let attempts = 0;
    const result = await waitForPostgresReady('c1', { run: () => { attempts += 1; return { status: attempts < 3 ? 1 : 0 }; }, wait: noWait, attempts: 10 });
    assert.equal(result.ok, true);
    assert.equal(attempts, 3);
});

test('waitForPostgresReady: gives up after the bounded attempt count (verifier startup failure)', async () => {
    const result = await waitForPostgresReady('c1', { run: () => ({ status: 1 }), wait: noWait, attempts: 4 });
    assert.equal(result.ok, false);
});

test('authenticateAndVerifyIdentity: valid credentials succeed and the returned identity matches', () => {
    const result = authenticateAndVerifyIdentity(
        { networkName: 'n', containerName: 'c', postgresUser: 'compdesk_ab12', postgresDb: 'compdesk_db', passwordPath: '/tmp/x/password' },
        { run: () => ({ status: 0, stdout: 'compdesk_ab12|compdesk_db\n' }) },
    );
    assert.equal(result.ok, true);
});

test('authenticateAndVerifyIdentity: wrong password is rejected', () => {
    const result = authenticateAndVerifyIdentity(
        { networkName: 'n', containerName: 'c', postgresUser: 'compdesk_ab12', postgresDb: 'compdesk_db', passwordPath: '/tmp/x/password' },
        { run: () => ({ status: 2, stderr: 'psql: error: connection to server failed: FATAL:  password authentication failed for user "compdesk_ab12"' }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'authentication-failed');
});

test('authenticateAndVerifyIdentity: wrong username is rejected', () => {
    const result = authenticateAndVerifyIdentity(
        { networkName: 'n', containerName: 'c', postgresUser: 'not-the-real-user', postgresDb: 'compdesk_db', passwordPath: '/tmp/x/password' },
        { run: () => ({ status: 2, stderr: 'FATAL:  password authentication failed for user "not-the-real-user"' }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'authentication-failed');
});

test('authenticateAndVerifyIdentity: wrong database is rejected', () => {
    const result = authenticateAndVerifyIdentity(
        { networkName: 'n', containerName: 'c', postgresUser: 'compdesk_ab12', postgresDb: 'not-the-real-db', passwordPath: '/tmp/x/password' },
        { run: () => ({ status: 2, stderr: 'FATAL:  database "not-the-real-db" does not exist' }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'authentication-failed');
});

test('authenticateAndVerifyIdentity: a connection that returns an unexpected identity is rejected (defense in depth)', () => {
    const result = authenticateAndVerifyIdentity(
        { networkName: 'n', containerName: 'c', postgresUser: 'compdesk_ab12', postgresDb: 'compdesk_db', passwordPath: '/tmp/x/password' },
        { run: () => ({ status: 0, stdout: 'someone_else|compdesk_db\n' }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'identity-mismatch');
});

test('authenticateAndVerifyIdentity: never places the password in the docker command arguments', () => {
    const calls = [];
    authenticateAndVerifyIdentity(
        { networkName: 'n', containerName: 'c', postgresUser: 'compdesk_ab12', postgresDb: 'compdesk_db', passwordPath: '/tmp/x/password' },
        { run: (command, args) => { calls.push(args); return { status: 0, stdout: 'compdesk_ab12|compdesk_db\n' }; } },
    );
    const flatArgs = calls.flat();
    assert.doesNotMatch(flatArgs.join(' '), new RegExp(SECRET_PASSWORD));
    // The dangerous pattern specifically: a `docker run -e PGPASSWORD=...`
    // flag pair, which IS docker-inspect-visible. Setting PGPASSWORD inside
    // an inline shell script (read from a mounted file at container runtime)
    // is the safe pattern this function actually uses, and legitimately
    // contains the substring "PGPASSWORD=" — so check for the flag form,
    // not a bare substring match.
    const envFlagValues = flatArgs.filter((arg, index) => flatArgs[index - 1] === '-e');
    assert.ok(!envFlagValues.some((value) => /^PGPASSWORD=/.test(value)), 'the password must never be passed via a -e PGPASSWORD flag (docker inspect-visible)');
});

test('verifyLegacyCredentials: happy path — starts an isolated container/network, verifies, and cleans up everything', async () => {
    const { deps, calls, written, removedDirs } = baseDeps({
        run: (command, args) => {
            const joined = args.join(' ');
            if (joined.startsWith('ps --filter')) return { status: 0, stdout: '' }; // not in use
            if (joined.startsWith('network create')) return { status: 0 };
            if (args[0] === 'run' && args.includes('-d')) return { status: 0, stdout: 'containerid123\n' };
            if (joined.includes('pg_isready')) return { status: 0 };
            if (joined.includes('psql')) return { status: 0, stdout: 'compdesk_ab12|compdesk_db\n' };
            if (joined.startsWith('rm -f') || joined.startsWith('network rm')) return { status: 0 };
            return { status: 0, stdout: '' };
        },
    });
    const result = await verifyLegacyCredentials({
        pgdataVolumeName: 'compdesk_pgdata', postgresUser: 'compdesk_ab12', postgresPassword: SECRET_PASSWORD, postgresDb: 'compdesk_db',
    }, deps);
    assert.equal(result.ok, true);
    // Cleanup happened.
    assert.ok(calls.some((args) => args[0] === 'rm' && args.includes('-f')), 'expected the verification container to be removed');
    assert.ok(calls.some((args) => args[0] === 'network' && args[1] === 'rm'), 'expected the verification network to be removed');
    assert.equal(removedDirs.length, 1);
    // The password was written to a file, not passed inline anywhere.
    assert.equal(Object.keys(written).length, 1);
    assert.equal(written[Object.keys(written)[0]], SECRET_PASSWORD);
});

test('verifyLegacyCredentials: docker unavailable fails fast without creating any resources', async () => {
    const { deps, calls } = baseDeps({ run: () => ({ error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }) }) });
    const result = await verifyLegacyCredentials({ pgdataVolumeName: 'v', postgresUser: 'u', postgresPassword: 'p', postgresDb: 'd' }, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'docker-unavailable');
    assert.ok(!calls.some((args) => args[0] === 'network' && args[1] === 'create'), 'must not attempt to create a network after docker is found unavailable');
});

test('verifyLegacyCredentials: refuses when the pgdata volume is already attached to a running (legacy) container', async () => {
    const { deps, calls } = baseDeps({ run: (command, args) => (args.join(' ').startsWith('ps --filter') ? { status: 0, stdout: 'compdesk-legacy-db-1\n' } : { status: 0 }) });
    const result = await verifyLegacyCredentials({ pgdataVolumeName: 'compdesk_pgdata', postgresUser: 'u', postgresPassword: 'p', postgresDb: 'd' }, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'volume-in-use');
    assert.ok(!calls.some((args) => args[0] === 'network' && args[1] === 'create'), 'must not start a verification container against a volume that is unsafely still in use');
});

test('verifyLegacyCredentials: temporary verifier startup failure is reported and still cleaned up', async () => {
    const { deps, calls, removedDirs } = baseDeps({
        run: (command, args) => {
            const joined = args.join(' ');
            if (joined.startsWith('ps --filter')) return { status: 0, stdout: '' };
            if (joined.startsWith('network create')) return { status: 0 };
            if (args[0] === 'run' && args.includes('-d')) return { status: 1, stderr: 'Error: no such image' };
            return { status: 0 };
        },
    });
    const result = await verifyLegacyCredentials({ pgdataVolumeName: 'v', postgresUser: 'u', postgresPassword: 'p', postgresDb: 'd' }, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'verifier-startup-failed');
    // The container never started, so only the network needs removing — but
    // cleanup must still run (not skipped) and never leave the temp file.
    assert.ok(calls.some((args) => args[0] === 'network' && args[1] === 'rm'), 'the network must still be cleaned up even though the container never started');
    assert.ok(!calls.some((args) => args[0] === 'rm' && args.includes('-f') && args.includes('compdesk-verify-db-testid')), 'must not attempt to remove a container that never started');
    assert.equal(removedDirs.length, 1, 'the staging directory must always be removed');
});

test('verifyLegacyCredentials: readiness that never succeeds is reported as a verifier startup failure and still cleans up', async () => {
    const { deps, calls, removedDirs } = baseDeps({
        run: (command, args) => {
            const joined = args.join(' ');
            if (joined.startsWith('ps --filter')) return { status: 0, stdout: '' };
            if (joined.startsWith('network create')) return { status: 0 };
            if (args[0] === 'run' && args.includes('-d')) return { status: 0, stdout: 'containerid\n' };
            if (joined.includes('pg_isready')) return { status: 1 }; // never ready
            return { status: 0 };
        },
        readyOptions: { attempts: 3 },
    });
    const result = await verifyLegacyCredentials({ pgdataVolumeName: 'v', postgresUser: 'u', postgresPassword: 'p', postgresDb: 'd' }, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'verifier-startup-failed');
    assert.ok(calls.some((args) => args[0] === 'rm' && args.includes('-f')), 'the started container must still be removed after a readiness timeout');
    assert.ok(calls.some((args) => args[0] === 'network' && args[1] === 'rm'));
    assert.equal(removedDirs.length, 1);
});

test('verifyLegacyCredentials: wrong credentials are rejected and cleanup still runs completely', async () => {
    const { deps, calls, removedDirs } = baseDeps({
        run: (command, args) => {
            const joined = args.join(' ');
            if (joined.startsWith('ps --filter')) return { status: 0, stdout: '' };
            if (joined.startsWith('network create')) return { status: 0 };
            if (args[0] === 'run' && args.includes('-d')) return { status: 0, stdout: 'containerid\n' };
            if (joined.includes('pg_isready')) return { status: 0 };
            if (joined.includes('psql')) return { status: 2, stderr: 'FATAL: password authentication failed' };
            return { status: 0 };
        },
    });
    const result = await verifyLegacyCredentials({ pgdataVolumeName: 'v', postgresUser: 'u', postgresPassword: 'wrong', postgresDb: 'd' }, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'authentication-failed');
    assert.ok(calls.some((args) => args[0] === 'rm' && args.includes('-f')));
    assert.ok(calls.some((args) => args[0] === 'network' && args[1] === 'rm'));
    assert.equal(removedDirs.length, 1);
});

test('verifyLegacyCredentials: the password never appears in any docker command argument across the whole flow', async () => {
    const { deps, calls } = baseDeps({
        run: (command, args) => {
            const joined = args.join(' ');
            if (joined.startsWith('ps --filter')) return { status: 0, stdout: '' };
            if (joined.startsWith('network create')) return { status: 0 };
            if (args[0] === 'run' && args.includes('-d')) return { status: 0, stdout: 'containerid\n' };
            if (joined.includes('pg_isready')) return { status: 0 };
            if (joined.includes('psql')) return { status: 0, stdout: 'u|d\n' };
            return { status: 0 };
        },
    });
    await verifyLegacyCredentials({ pgdataVolumeName: 'v', postgresUser: 'u', postgresPassword: SECRET_PASSWORD, postgresDb: 'd' }, deps);
    const flatArgs = calls.flat().join(' ');
    assert.doesNotMatch(flatArgs, new RegExp(SECRET_PASSWORD));
});
