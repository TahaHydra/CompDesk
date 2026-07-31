import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Real-Docker, real-Postgres end-to-end proof of the unified one-command
// deployment. This is intentionally NOT part of `npm run test:ci` (it needs
// a Docker daemon and takes minutes, not milliseconds) — run it explicitly:
//   node --test scripts/docker-lifecycle.test.mjs
//
// Every resource this file creates is scoped under a distinctive project
// name and volume-name suffix that can never collide with a real deployment
// (or with the default compdesk_pgdata/compdesk_uploads/compdesk_attachments/
// compdesk_config names), and every scenario tears its own resources down —
// even on failure, after first collecting `docker compose logs` for
// diagnostics.

const ROOT = process.cwd();
const PROJECT = 'compdesk-lifecycle-test';
const IMAGE_TAG = 'lifecycle-test';

function volumeNames(suffix) {
    return {
        pgdata: `compdesk_lifecycle_test_${suffix}_pgdata`,
        uploads: `compdesk_lifecycle_test_${suffix}_uploads`,
        attachments: `compdesk_lifecycle_test_${suffix}_attachments`,
        config: `compdesk_lifecycle_test_${suffix}_config`,
    };
}

function composeEnv(volumes, extra = {}) {
    return {
        ...process.env,
        COMPDESK_VERSION: IMAGE_TAG,
        POSTGRES_VOLUME_NAME: volumes.pgdata,
        UPLOADS_VOLUME_NAME: volumes.uploads,
        ATTACHMENTS_VOLUME_NAME: volumes.attachments,
        CONFIG_VOLUME_NAME: volumes.config,
        ...extra,
    };
}

function compose(args, env, { allowFailure = false } = {}) {
    const result = spawnSync('docker', ['compose', '-p', PROJECT, ...args], {
        cwd: ROOT, env, encoding: 'utf8', windowsHide: true,
    });
    if (!allowFailure && result.status !== 0) {
        throw new Error(`docker compose ${args.join(' ')} failed (exit ${result.status}):\n${result.stderr}\n${result.stdout}`);
    }
    return result;
}

function dockerRun(args, { allowFailure = true } = {}) {
    const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
    if (!allowFailure && result.status !== 0) {
        throw new Error(`docker ${args.join(' ')} failed (exit ${result.status}): ${result.stderr}`);
    }
    return result;
}

async function waitFor(fn, { timeoutMs = 60000, intervalMs = 500, label = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    for (;;) {
        try {
            const result = await fn();
            if (result) return result;
        } catch (error) {
            lastError = error;
        }
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

function collectLogsOnFailure(env, label) {
    const logs = compose(['logs', '--no-color'], env, { allowFailure: true });
    console.error(`\n--- docker compose logs (${label}) ---`);
    console.error(logs.stdout);
    console.error(logs.stderr);
    console.error(`--- end logs (${label}) ---\n`);
}

function teardown(volumes, env) {
    compose(['down', '-v', '--remove-orphans'], env, { allowFailure: true });
    for (const name of Object.values(volumes)) dockerRun(['volume', 'rm', '-f', name]);
}

async function withScenario(suffix, envExtra, fn) {
    const volumes = volumeNames(suffix);
    const env = composeEnv(volumes, envExtra);
    teardown(volumes, env); // pre-emptive: clean up any leftovers from a crashed previous run
    try {
        await fn({ volumes, env });
    } catch (error) {
        collectLogsOnFailure(env, suffix);
        throw error;
    } finally {
        teardown(volumes, env);
    }
}

const INSTALL_PAYLOAD = (adminEmail) => ({
    deploymentMode: 'docker-compose',
    // config-init's file-based bootstrap credentials override this
    // server-side (see setup-bootstrap.mjs resolveDatabase()) — these
    // placeholder values are never actually used to connect.
    database: { provider: 'postgresql', host: 'db', port: 5432, database: 'compdesk', username: 'compdesk', password: 'ignored', sslMode: 'disable', ca: '' },
    identity: { applicationUrl: 'http://localhost:3000', applicationName: 'CompDesk', supportEmail: '', primaryColor: '#4f46e5', accentColor: '#8b5cf6', reverseProxy: false },
    authentication: { localEnabled: true, microsoftEnabled: false, adminName: 'Lifecycle Admin', adminEmail, adminPassword: 'LifecycleTest1!Secure', adminPasswordConfirm: 'LifecycleTest1!Secure', tenantId: '', clientId: '', clientSecret: '' },
    smtp: { enabled: false, host: '', port: 587, username: '', password: '', from: '', recipient: '', secure: false, requireTls: true },
    storage: { privateAttachmentDir: 'storage/attachments', uploadMaxSizeMb: 10, attachmentMaxFilesPerTicket: 20, attachmentMaxMbPerTicket: 100, attachmentGlobalMaxGb: 10, tempAttachmentTtlHours: 24, tempAttachmentMaxFilesPerUser: 20, tempAttachmentMaxMbPerUser: 100, clamavEnabled: false, clamavHost: '', clamavPort: 3310 },
    installDemoData: false,
});

async function completeSetupOverHttp(appOrigin, env) {
    // The setup server derives the browser-visible origin from the request
    // Host header when SETUP_PUBLIC_ORIGIN is not configured. This proves a
    // non-default published host port remains same-origin secure.
    const setupOrigin = appOrigin;
    const bootstrapToken = await waitFor(async () => {
        const logs = compose(['logs', '--no-color', 'compdesk'], env, { allowFailure: true });
        const match = /bootstrap token[^:]*:\s*(\S+)/i.exec(logs.stdout);
        return match ? match[1] : null;
    }, { timeoutMs: 60000, label: 'bootstrap token in compdesk logs' });

    const session = await fetch(`${appOrigin}/setup/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: setupOrigin },
        body: JSON.stringify({ token: bootstrapToken }),
    });
    assert.equal(session.status, 200, 'setup session should authenticate with the printed bootstrap token');
    const { csrfToken } = await session.json();
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const headers = { 'Content-Type': 'application/json', Origin: setupOrigin, Cookie: cookie, 'X-CSRF-Token': csrfToken };

    const adminEmail = `lifecycle-admin-${Date.now()}@example.test`;
    const install = await fetch(`${appOrigin}/setup/api/install`, {
        method: 'POST',
        headers,
        body: JSON.stringify(INSTALL_PAYLOAD(adminEmail)),
    });
    const installBody = await install.json();
    assert.equal(install.status, 200, `install should succeed: ${JSON.stringify(installBody)}`);
    assert.deepEqual(installBody.deployment.commands, [], 'the unified orchestrator flow must require no manual commands');
    return { adminEmail };
}

async function waitForProductionTransition(appOrigin) {
    // No manual `docker compose` command runs here — only HTTP polling of
    // the same port the setup server was just serving.
    return waitFor(async () => {
        const response = await fetch(`${appOrigin}/api/health/live`, { cache: 'no-store' }).catch(() => null);
        if (!response || !response.ok) return false;
        const body = await response.json();
        return body.mode === 'production';
    }, { timeoutMs: 90000, intervalMs: 1000, label: 'transition from setup to production' });
}

test('isolated Docker lifecycle', { timeout: 15 * 60 * 1000 }, async (t) => {
    let imageBuilt = false;

    await t.test('1. the single image builds exactly once', () => {
        const buildEnv = composeEnv(volumeNames('build'));
        const result = compose(['-f', 'docker-compose.yml', '-f', 'docker-compose.build.yml', 'build'], buildEnv);
        assert.equal(result.status, 0);
        const images = dockerRun(['images', `ghcr.io/tahahydra/compdesk:${IMAGE_TAG}`, '--format', '{{.ID}}']);
        assert.ok(images.stdout.trim().length > 0, 'the built image must be tagged and present locally');
        imageBuilt = true;
    });

    await t.test('2-8. one canonical stack: setup reachable, HTTP install, auto-transition, persistence, idempotent up', async () => {
        assert.ok(imageBuilt, 'image must already be built (no rebuild in this scenario)');
        const suffix = 'main';
        const port = 13301;
        const appOrigin = `http://127.0.0.1:${port}`;
        await withScenario(suffix, { APP_BIND_ADDRESS: '127.0.0.1', APP_PORT: String(port) }, async ({ volumes, env }) => {
            // 2. One canonical Compose stack starts once.
            const up = compose(['up', '-d'], env);
            assert.equal(up.status, 0);

            // 3. Setup becomes reachable.
            await waitFor(async () => {
                const response = await fetch(`${appOrigin}/api/health/live`).catch(() => null);
                if (!response) return false;
                const body = await response.json();
                return body.mode === 'setup';
            }, { timeoutMs: 90000, label: 'setup to become reachable' });

            // 4. Setup completes through HTTP.
            const { adminEmail } = await completeSetupOverHttp(appOrigin, env);

            // 5 & 6. The same port transitions to production sign-in with no
            // manual Compose command run in between (none appears above).
            await waitForProductionTransition(appOrigin);
            const signIn = await fetch(`${appOrigin}/auth/signin`, { redirect: 'manual' });
            assert.ok(signIn.status < 500, `production sign-in page should render, got ${signIn.status}`);

            // 7. Persistent fixture data survives a restart.
            const psqlBefore = spawnSync('docker', ['compose', '-p', PROJECT, 'exec', '-T', 'db', 'psql', '-U', 'compdesk', '-d', 'compdesk', '-tAc', "select email from users where email = '" + adminEmail + "'"], { env, encoding: 'utf8', windowsHide: true });
            assert.match(psqlBefore.stdout, new RegExp(adminEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'admin account should exist before restart');

            compose(['restart', 'compdesk'], env);
            await waitFor(async () => {
                const response = await fetch(`${appOrigin}/api/health/live`).catch(() => null);
                return Boolean(response && response.ok && (await response.json()).mode === 'production');
            }, { timeoutMs: 90000, label: 'production to come back after restart' });
            const psqlAfter = spawnSync('docker', ['compose', '-p', PROJECT, 'exec', '-T', 'db', 'psql', '-U', 'compdesk', '-d', 'compdesk', '-tAc', "select email from users where email = '" + adminEmail + "'"], { env, encoding: 'utf8', windowsHide: true });
            assert.match(psqlAfter.stdout, new RegExp(adminEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'admin account should survive the restart');

            // 8. Repeated `docker compose up -d` is idempotent (no recreate).
            const idempotentUp = compose(['up', '-d'], env);
            assert.equal(idempotentUp.status, 0);
            assert.doesNotMatch(idempotentUp.stderr + idempotentUp.stdout, /Recreate/i, 'a second `up -d` must not recreate already-running containers');

            // 9. Crash-window recovery: simulate a crash between the database
            // COMMIT and the receipt write by deleting only installation.json
            // after a successful install, then restart. The orchestrator must
            // reconstruct the receipt from the (already-committed) database
            // record and reach production automatically — never get stuck
            // permanently re-offering setup for an already-installed database.
            const deleteReceipt = dockerRun([
                'run', '--rm', '-v', `${volumes.config}:/config`, 'alpine:3.22', 'rm', '/config/installation.json',
            ], { allowFailure: false });
            assert.equal(deleteReceipt.status, 0);
            compose(['restart', 'compdesk'], env);
            await waitFor(async () => {
                const logs = compose(['logs', '--no-color', 'compdesk'], env, { allowFailure: true });
                return /Recovering: a completed installation record was found in the database with no local receipt/.test(logs.stdout);
            }, { timeoutMs: 60000, label: 'automatic crash-window recovery to be logged' });
            await waitFor(async () => {
                const response = await fetch(`${appOrigin}/api/health/live`).catch(() => null);
                return Boolean(response && response.ok && (await response.json()).mode === 'production');
            }, { timeoutMs: 90000, label: 'production to come back after automatic recovery' });
            const reconstructed = dockerRun(['run', '--rm', '-v', `${volumes.config}:/config`, 'alpine:3.22', 'cat', '/config/installation.json']);
            const reconstructedReceipt = JSON.parse(reconstructed.stdout);
            assert.equal(reconstructedReceipt.deploymentMode, 'docker-compose');
            assert.equal(reconstructedReceipt.applicationUrl, 'http://localhost:3000');

            // 10. Inverse contradiction: the receipt exists (as normal) but the
            // database's installation record is gone (e.g. someone restored an
            // older database backup onto this compdesk_config). Production
            // must never start on the filesystem receipt's word alone.
            const deleteDbRecord = spawnSync('docker', ['compose', '-p', PROJECT, 'exec', '-T', 'db', 'psql', '-U', 'compdesk', '-d', 'compdesk', '-c', "DELETE FROM installation_records WHERE id = 'primary'"], { env, encoding: 'utf8', windowsHide: true });
            assert.equal(deleteDbRecord.status, 0, deleteDbRecord.stderr);
            compose(['restart', 'compdesk'], env);
            await waitFor(async () => {
                const logs = compose(['logs', '--no-color', 'compdesk'], env, { allowFailure: true });
                return /no matching installation record was found in the database/.test(logs.stdout);
            }, { timeoutMs: 60000, label: 'the receipt/database contradiction to be detected and logged' });
            const contradictionReadiness = await fetch(`${appOrigin}/api/health/live`, { cache: 'no-store' }).catch(() => null);
            assert.ok(!contradictionReadiness || !contradictionReadiness.ok, 'production must not start when the database record is missing, even with a valid-looking receipt');

            // 11. Migration failure blocks readiness: corrupt the generated
            // DATABASE_URL inside compdesk_config, then restart in place.
            // (The database record is already gone from step 10 above, which
            // makes no difference here — an unreachable database fails
            // reconciliation regardless of what the record would have said.)
            compose(['stop', 'compdesk'], env);
            const corrupt = dockerRun([
                'run', '--rm', '-v', `${volumes.config}:/config`, 'alpine:3.22', 'sh', '-c',
                "sed -i 's#@db:5432#@db:1#' /config/secrets/runtime.env",
            ], { allowFailure: false });
            assert.equal(corrupt.status, 0);
            compose(['start', 'compdesk'], env);
            // Docker's own bounded `restart: on-failure:5` policy (not the
            // old `unless-stopped`) relaunches the container after each
            // failed exit, with its own backoff, but only up to 5 times —
            // the orchestrator itself does not loop internally; it fails
            // once and exits every time. Prove both halves of that: the
            // failure is detected and logged on more than one attempt, AND
            // the container eventually settles into a stable, visibly
            // "exited" state instead of restarting forever.
            await waitFor(async () => {
                const logs = compose(['logs', '--no-color', 'compdesk'], env, { allowFailure: true });
                return (logs.stdout.match(/FAILED: Refusing to start: the installation receipt could not be verified against the database/g) || []).length >= 2;
            }, { timeoutMs: 60000, label: 'the unreachable-database failure to be detected and logged on repeated restart attempts' });

            const readiness = await fetch(`${appOrigin}/api/health/live`, { cache: 'no-store' }).catch(() => null);
            assert.ok(!readiness || !readiness.ok, 'a container that cannot reach its database must not answer as ready/live');

            const containerId = compose(['ps', '-q', 'compdesk'], env).stdout.trim();
            const stableExitedState = async () => {
                const inspected = dockerRun(['inspect', containerId, '--format', '{{.State.Status}} {{.State.Restarting}} {{.RestartCount}}']);
                const [status, restarting, restartCount] = inspected.stdout.trim().split(' ');
                return status === 'exited' && restarting === 'false' && Number(restartCount) >= 5 ? { status, restarting, restartCount } : false;
            };
            const stable = await waitFor(stableExitedState, { timeoutMs: 60000, intervalMs: 2000, label: 'the container to stop restarting after its bounded attempt count is exhausted' });
            // Confirm it stays that way — not merely caught between two of
            // its own restart attempts.
            await new Promise((resolve) => setTimeout(resolve, 5000));
            assert.deepEqual(await stableExitedState(), stable, 'the container must remain stably exited, not resume restarting, once the bounded policy is exhausted');
        });
    });

    await t.test('10. existing pgdata with missing configuration fails closed', async () => {
        const suffix = 'failclosed';
        await withScenario(suffix, {}, async ({ volumes, env }) => {
            // Pre-seed pgdata to look already-initialized, with an empty
            // compdesk_config — the exact "someone deleted the config
            // volume but kept the database" recovery scenario.
            dockerRun(['run', '--rm', '-v', `${volumes.pgdata}:/data`, 'alpine:3.22', 'sh', '-c', 'touch /data/PG_VERSION'], { allowFailure: false });

            const result = compose(['run', '--rm', 'config-init'], env, { allowFailure: true });
            assert.notEqual(result.status, 0, 'config-init must fail closed instead of minting new credentials');
            assert.match(result.stdout + result.stderr, /refusing/i);

            const configProbe = dockerRun(['run', '--rm', '-v', `${volumes.config}:/config`, 'alpine:3.22', 'sh', '-c', 'test -f /config/secrets/postgres_password && echo present || echo absent']);
            assert.match(configProbe.stdout, /absent/, 'no secret should have been written');
        });
    });

    await t.test('11. an existing randomized-role installation is verified against real pgdata: valid credentials import, wrong credentials are rejected', async () => {
        const suffix = 'import';
        const volumes = volumeNames(suffix);
        const env = composeEnv(volumes);
        teardown(volumes, env);
        const legacyPgdataVolume = volumes.pgdata;
        const legacyContainerName = `compdesk-lifecycle-legacy-db-${suffix}`;
        const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-lifecycle-import-'));
        const wrongDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-lifecycle-import-wrong-'));
        try {
            // Initialize a REAL PostgreSQL data directory with the exact
            // randomized-role credentials the legacy fixture claims, so
            // verification has something genuine to authenticate against —
            // proving the import tool doesn't just trust the old env file.
            dockerRun([
                'run', '-d', '--name', legacyContainerName,
                '-e', 'POSTGRES_USER=compdesk_9f3e21', '-e', 'POSTGRES_PASSWORD=import-test-password', '-e', 'POSTGRES_DB=compdesk_db',
                '-v', `${legacyPgdataVolume}:/var/lib/postgresql/data`, 'postgres:16-alpine',
            ], { allowFailure: false });
            await waitFor(async () => dockerRun(['exec', legacyContainerName, 'pg_isready']).status === 0, { timeoutMs: 60000, label: 'the legacy PostgreSQL fixture to become ready' });
            // Stop and remove it before verification mounts the same volume
            // elsewhere — the legacy stack must be stopped first.
            dockerRun(['rm', '-f', legacyContainerName], { allowFailure: false });

            const legacyEnvLines = (password) => [
                `DATABASE_URL="postgresql://compdesk_9f3e21:${password}@db:5432/compdesk_db?schema=public"`,
                'AUTH_URL="http://localhost:3000"',
                'AUTH_SECRET="lifecycle-import-auth-secret-long-enough"',
                'APP_SETTINGS_ENCRYPTION_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="',
                'POSTGRES_DB="compdesk_db"',
                'POSTGRES_USER="compdesk_9f3e21"',
                `POSTGRES_PASSWORD="${password}"`,
            ].join('\n');
            const installationJson = JSON.stringify({
                installedAt: '2026-01-01T00:00:00.000Z', applicationUrl: 'http://localhost:3000', deploymentMode: 'docker-compose', setupVersion: 1,
            });
            fs.writeFileSync(path.join(legacyDirectory, 'installation.json'), installationJson);
            fs.writeFileSync(path.join(legacyDirectory, 'compdesk.env'), legacyEnvLines('import-test-password'));
            fs.writeFileSync(path.join(wrongDirectory, 'installation.json'), installationJson);
            fs.writeFileSync(path.join(wrongDirectory, 'compdesk.env'), legacyEnvLines('totally-wrong-password'));

            // Wrong credentials must be rejected and must write nothing.
            const wrongResult = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'import-legacy-deployment.mjs'), wrongDirectory], {
                cwd: ROOT, env: { ...process.env, CONFIG_VOLUME_NAME: volumes.config, POSTGRES_VOLUME_NAME: legacyPgdataVolume }, encoding: 'utf8', windowsHide: true,
            });
            assert.notEqual(wrongResult.status, 0, 'wrong credentials must be rejected');
            assert.match(wrongResult.stdout + wrongResult.stderr, /rejected/i);
            const configProbeBeforeImport = dockerRun(['run', '--rm', '-v', `${volumes.config}:/config`, 'alpine:3.22', 'sh', '-c', 'test -f /config/secrets/postgres_password && echo present || echo absent']);
            assert.match(configProbeBeforeImport.stdout, /absent/, 'nothing should be written to compdesk_config after a rejected verification');

            // Valid randomized-role credentials succeed.
            const importResult = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'import-legacy-deployment.mjs'), legacyDirectory], {
                cwd: ROOT, env: { ...process.env, CONFIG_VOLUME_NAME: volumes.config, POSTGRES_VOLUME_NAME: legacyPgdataVolume }, encoding: 'utf8', windowsHide: true,
            });
            assert.equal(importResult.status, 0, importResult.stdout + importResult.stderr);

            const identity = dockerRun(['run', '--rm', '-v', `${volumes.config}:/config`, 'alpine:3.22', 'cat', '/config/secrets/postgres_identity.json']);
            assert.deepEqual(JSON.parse(identity.stdout), { user: 'compdesk_9f3e21', db: 'compdesk_db' });
            const password = dockerRun(['run', '--rm', '-v', `${volumes.config}:/config`, 'alpine:3.22', 'cat', '/config/secrets/postgres_password']);
            assert.equal(password.stdout, 'import-test-password');
        } finally {
            dockerRun(['rm', '-f', legacyContainerName]);
            fs.rmSync(legacyDirectory, { recursive: true, force: true });
            fs.rmSync(wrongDirectory, { recursive: true, force: true });
            teardown(volumes, env);
        }
    });
});
