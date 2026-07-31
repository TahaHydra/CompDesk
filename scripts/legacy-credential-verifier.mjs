import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_POSTGRES_IMAGE = 'postgres:16-alpine';

function safeStderr(result) {
    if (!result) return '';
    const raw = typeof result.stderr === 'string' ? result.stderr : Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : '';
    return raw.trim().split(/\r?\n/)[0]?.slice(0, 300) || '';
}

function spawnFailureMessage(result) {
    if (result?.error?.code === 'ENOENT') return 'The docker executable was not found on PATH.';
    return `Could not run docker: ${result?.error?.message || 'unknown spawn failure'}.`;
}

// Refuses to proceed if any container currently has the legacy pgdata volume
// mounted (the legacy stack was not stopped first) — starting a second
// PostgreSQL server against the same data directory concurrently risks
// corruption, and Docker itself would likely refuse the second lock anyway,
// but this catches the unsafe attempt before ever trying.
export function detectVolumeInUse(volumeName, { run = spawnSync } = {}) {
    const result = run('docker', ['ps', '--filter', `volume=${volumeName}`, '--format', '{{.Names}}'], { encoding: 'utf8', windowsHide: true });
    if (!result || result.error) return { ok: false, reason: 'docker-unavailable', detail: spawnFailureMessage(result) };
    if (result.status !== 0) return { ok: false, reason: 'docker-unavailable', detail: safeStderr(result) || `exit ${result.status}` };
    const names = result.stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (names.length > 0) {
        return { ok: false, reason: 'volume-in-use', detail: `The following running container(s) already have this volume mounted: ${names.join(', ')}. Stop the legacy stack first (docker compose down, without -v) before importing.` };
    }
    return { ok: true };
}

export async function waitForPostgresReady(containerName, { run = spawnSync, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 30, delayMs = 1000 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const result = run('docker', ['exec', containerName, 'pg_isready'], { encoding: 'utf8', windowsHide: true });
        if (result && !result.error && result.status === 0) return { ok: true };
        if (attempt < attempts) await wait(delayMs);
    }
    return { ok: false };
}

// Runs `psql` inside a throwaway container on the verification network,
// reading the password from a mounted file rather than a command-line
// argument or a `docker run -e PGPASSWORD=...` flag — a `docker inspect` of
// this container never shows the password. Only the (non-secret) username,
// database, and host are passed as plain environment variables.
export function authenticateAndVerifyIdentity({ networkName, containerName, postgresUser, postgresDb, passwordPath, postgresImage = DEFAULT_POSTGRES_IMAGE }, { run = spawnSync } = {}) {
    const result = run('docker', [
        'run', '--rm',
        '--network', networkName,
        '-v', `${passwordPath}:/run/verify/password:ro`,
        '-e', `PGUSER=${postgresUser}`,
        '-e', `PGDATABASE=${postgresDb}`,
        '-e', `PGHOST=${containerName}`,
        '-e', 'PGCONNECT_TIMEOUT=10',
        postgresImage,
        'sh', '-c',
        'PGPASSWORD="$(cat /run/verify/password)" exec psql -tAc "select current_user, current_database()"',
    ], { encoding: 'utf8', windowsHide: true });

    if (!result || result.error) return { ok: false, reason: 'verification-failed', detail: spawnFailureMessage(result) };
    if (result.status !== 0) return { ok: false, reason: 'authentication-failed', detail: 'PostgreSQL rejected the imported username/password, or the imported database name does not exist.' };

    const [returnedUser, returnedDatabase] = result.stdout.trim().split('|').map((value) => value.trim());
    if (returnedUser !== postgresUser || returnedDatabase !== postgresDb) {
        return { ok: false, reason: 'identity-mismatch', detail: 'The authenticated session did not report the expected username and database.' };
    }
    return { ok: true };
}

// The single fail-closed gate between reading a legacy compdesk.env and ever
// writing anything into compdesk_config: proves the exact imported
// username/password/database actually authenticate against the exact
// selected pgdata volume, using a fully isolated, temporary PostgreSQL
// container and network that touch no existing resource and are always
// removed — on success or failure — before this function returns.
export async function verifyLegacyCredentials({ pgdataVolumeName, postgresUser, postgresPassword, postgresDb, postgresImage = DEFAULT_POSTGRES_IMAGE }, deps = {}) {
    const run = deps.run || spawnSync;
    const wait = deps.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const mkdtempSync = deps.mkdtempSync || fs.mkdtempSync;
    const writeFileSync = deps.writeFileSync || fs.writeFileSync;
    const rmSync = deps.rmSync || fs.rmSync;
    const randomId = deps.randomId || (() => crypto.randomBytes(6).toString('hex'));
    const readyOptions = deps.readyOptions || {};

    const inUse = detectVolumeInUse(pgdataVolumeName, { run });
    if (!inUse.ok) return inUse;

    const id = randomId();
    const networkName = `compdesk-verify-net-${id}`;
    const containerName = `compdesk-verify-db-${id}`;
    // A random, non-secret directory/file name — the password value itself
    // is the only sensitive content, never the path.
    const stagingDirectory = mkdtempSync(path.join(os.tmpdir(), 'compdesk-verify-'));
    const passwordPath = path.join(stagingDirectory, 'password');

    let networkCreated = false;
    let containerStarted = false;
    try {
        writeFileSync(passwordPath, postgresPassword, { mode: 0o600 });

        const networkResult = run('docker', ['network', 'create', networkName], { encoding: 'utf8', windowsHide: true });
        if (!networkResult || networkResult.error || networkResult.status !== 0) {
            return { ok: false, reason: 'verifier-startup-failed', detail: `Could not create the isolated verification network: ${networkResult?.error ? spawnFailureMessage(networkResult) : safeStderr(networkResult)}` };
        }
        networkCreated = true;

        const runResult = run('docker', [
            'run', '-d', '--name', containerName,
            '--network', networkName,
            '--network-alias', containerName,
            '-v', `${pgdataVolumeName}:/var/lib/postgresql/data`,
            postgresImage,
        ], { encoding: 'utf8', windowsHide: true });
        if (!runResult || runResult.error || runResult.status !== 0) {
            return { ok: false, reason: 'verifier-startup-failed', detail: `Could not start the isolated verification container: ${runResult?.error ? spawnFailureMessage(runResult) : safeStderr(runResult)}` };
        }
        containerStarted = true;

        const ready = await waitForPostgresReady(containerName, { run, wait, ...readyOptions });
        if (!ready.ok) {
            return { ok: false, reason: 'verifier-startup-failed', detail: 'The isolated verification PostgreSQL server never became ready to accept connections.' };
        }

        return authenticateAndVerifyIdentity({ networkName, containerName, postgresUser, postgresDb, passwordPath, postgresImage }, { run });
    } finally {
        // Always clean up, success or failure — never leaves a verification
        // container, network, or the on-disk password file behind, and
        // never touches the original pgdata volume's contents.
        if (containerStarted) run('docker', ['rm', '-f', containerName], { encoding: 'utf8', windowsHide: true });
        if (networkCreated) run('docker', ['network', 'rm', networkName], { encoding: 'utf8', windowsHide: true });
        rmSync(stagingDirectory, { recursive: true, force: true });
    }
}
