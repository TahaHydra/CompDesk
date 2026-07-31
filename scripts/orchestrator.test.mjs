import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function availablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => resolve(address.port));
        });
    });
}

// Anything accepting a raw TCP connection satisfies waitForTcp()'s
// reachability check, so a plain listener stands in for "Postgres is up"
// without needing a real database for these fast, non-Docker tests.
async function startFakeTcpListener() {
    const port = await availablePort();
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    return { server, port, close: () => new Promise((resolve) => server.close(resolve)) };
}

function spawnOrchestrator(env) {
    const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'orchestrator.mjs')], {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    return { child, output: () => output };
}

async function waitForPattern(getOutput, pattern, child, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (pattern.test(getOutput())) return;
        if (child.exitCode !== null) throw new Error(`Process exited (code ${child.exitCode}) before matching ${pattern}: ${getOutput()}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${pattern}: ${getOutput()}`);
}

async function waitForExit(child, timeoutMs = 15_000) {
    if (child.exitCode !== null) return child.exitCode;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for process exit')), timeoutMs);
        child.once('exit', (code) => { clearTimeout(timeout); resolve(code); });
    });
}

async function stopIfRunning(child) {
    if (child.exitCode === null) {
        child.kill('SIGKILL');
        await new Promise((resolve) => child.once('exit', resolve));
    }
}

test('UNINSTALLED state: starts the setup server and never starts production', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-orch-uninstalled-'));
    const fakeDb = await startFakeTcpListener();
    const port = await availablePort();
    const running = spawnOrchestrator({
        COMPDESK_CONFIG_DIR: configDir,
        COMPDESK_DB_HOST: '127.0.0.1',
        COMPDESK_DB_PORT: String(fakeDb.port),
        PORT: String(port),
    });
    try {
        await waitForPattern(running.output, /first-run setup is active/i, running.child);
        const response = await fetch(`http://127.0.0.1:${port}/api/health/live`);
        const body = await response.json();
        assert.equal(body.mode, 'setup');
        assert.doesNotMatch(running.output(), /production server/i);
    } finally {
        await stopIfRunning(running.child);
        await fakeDb.close();
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});

// Windows has no real cross-process POSIX signal delivery: child.kill('SIGTERM')
// does not invoke the target process's `process.on('SIGTERM', ...)` handler the
// way it does on Linux (verified empirically — the child never observes the
// signal and keeps running). The orchestrator's production target is always a
// Linux container, where this exact mechanism is exercised for real by
// scripts/docker-lifecycle.test.mjs (`docker compose stop` sends a genuine
// SIGTERM). Skip the process-level simulation here on Windows rather than
// assert on a platform behavior Node itself does not provide.
test('signal forwarding: SIGTERM during UNINSTALLED gracefully stops the setup server and exits zero', { skip: process.platform === 'win32' ? 'cross-process SIGTERM delivery is not simulable on Windows; covered by the real-container docker-lifecycle test' : false }, async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-orch-sigterm-'));
    const fakeDb = await startFakeTcpListener();
    const port = await availablePort();
    const running = spawnOrchestrator({
        COMPDESK_CONFIG_DIR: configDir,
        COMPDESK_DB_HOST: '127.0.0.1',
        COMPDESK_DB_PORT: String(fakeDb.port),
        PORT: String(port),
    });
    try {
        await waitForPattern(running.output, /first-run setup is active/i, running.child);
        running.child.kill('SIGTERM');
        const code = await waitForExit(running.child);
        assert.equal(code, 0);
        assert.match(running.output(), /shutting down gracefully/i);
    } finally {
        await stopIfRunning(running.child);
        await fakeDb.close();
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});

// Reconciliation never trusts a filesystem receipt alone: when a receipt
// exists but the database can't confirm it (here, because the database is
// entirely unreachable), the orchestrator fails closed at reconciliation —
// before ever attempting a migration — rather than proceeding on the
// receipt's word alone. This is state D/"unverifiable receipt" from
// scripts/orchestrator-core.mjs's reconcileInstallationState.
test('receipt present but the database is unreachable fails closed at reconciliation with a redacted error', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-orch-migration-failure-'));
    fs.writeFileSync(path.join(configDir, 'installation.json'), JSON.stringify({
        installedAt: '2026-01-01T00:00:00.000Z', applicationUrl: 'http://127.0.0.1:3000', deploymentMode: 'docker-compose', setupVersion: 1,
    }));
    fs.mkdirSync(path.join(configDir, 'secrets'), { recursive: true });
    const secretPassword = 'sUpErSecretDbPassw0rd!!';
    fs.writeFileSync(
        path.join(configDir, 'secrets', 'runtime.env'),
        [
            `DATABASE_URL="postgresql://compdesk:${secretPassword}@127.0.0.1:1/compdesk?sslmode=disable&connect_timeout=2"`,
            'AUTH_URL="http://127.0.0.1:3000"',
            'AUTH_SECRET="orchestrator-test-auth-secret-that-is-long-enough"',
        ].join('\n'),
    );
    const fakeDb = await startFakeTcpListener();
    const port = await availablePort();
    const running = spawnOrchestrator({
        COMPDESK_CONFIG_DIR: configDir,
        COMPDESK_DB_HOST: '127.0.0.1',
        COMPDESK_DB_PORT: String(fakeDb.port),
        PORT: String(port),
    });
    try {
        const code = await waitForExit(running.child, 60_000);
        assert.notEqual(code, 0);
        assert.match(running.output(), /FAILED/);
        assert.match(running.output(), /could not be verified against the database/);
        assert.doesNotMatch(running.output(), new RegExp(secretPassword));
    } finally {
        await stopIfRunning(running.child);
        await fakeDb.close();
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});

// State F: a runtime config exists (setup previously wrote it) but neither a
// receipt nor a database record exist yet (the process crashed before ever
// reaching the database transaction) — resuming setup is safe since nothing
// was actually persisted.
test('runtime config with no receipt and no reachable database record resumes setup rather than failing', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-orch-resume-setup-'));
    fs.mkdirSync(path.join(configDir, 'secrets'), { recursive: true });
    fs.writeFileSync(
        path.join(configDir, 'secrets', 'runtime.env'),
        [
            'DATABASE_URL="postgresql://compdesk:x@127.0.0.1:1/compdesk?sslmode=disable&connect_timeout=2"',
            'AUTH_URL="http://127.0.0.1:3000"',
            'AUTH_SECRET="orchestrator-test-auth-secret-that-is-long-enough"',
        ].join('\n'),
    );
    const fakeDb = await startFakeTcpListener();
    const port = await availablePort();
    const running = spawnOrchestrator({
        COMPDESK_CONFIG_DIR: configDir,
        COMPDESK_DB_HOST: '127.0.0.1',
        COMPDESK_DB_PORT: String(fakeDb.port),
        PORT: String(port),
    });
    try {
        await waitForPattern(running.output, /first-run setup is active/i, running.child, 30_000);
        assert.doesNotMatch(running.output(), /FAILED/);
    } finally {
        await stopIfRunning(running.child);
        await fakeDb.close();
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});

test('PostgreSQL never reachable during INITIALIZING fails closed instead of retrying forever', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-orch-db-unreachable-'));
    const unusedPort = await availablePort();
    const port = await availablePort();
    const running = spawnOrchestrator({
        COMPDESK_CONFIG_DIR: configDir,
        COMPDESK_DB_HOST: '127.0.0.1',
        COMPDESK_DB_PORT: String(unusedPort),
        COMPDESK_DB_WAIT_ATTEMPTS: '3',
        COMPDESK_DB_WAIT_INITIAL_DELAY_MS: '50',
        COMPDESK_DB_WAIT_MAX_DELAY_MS: '100',
        PORT: String(port),
    });
    try {
        const code = await waitForExit(running.child, 15_000);
        assert.notEqual(code, 0);
        assert.match(running.output(), /FAILED/);
        assert.match(running.output(), /not reachable/i);
    } finally {
        await stopIfRunning(running.child);
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});
