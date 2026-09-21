import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
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

async function startSetup(stateDirectory, envOverrides = {}) {
    const port = await availablePort();
    const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'setup-bootstrap.mjs')], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            SETUP_PORT: String(port),
            SETUP_HOST: '127.0.0.1',
            SETUP_ALLOW_REMOTE: 'false',
            COMPDESK_SETUP_STATE_DIR: stateDirectory,
            ...envOverrides,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    const token = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Setup server did not start.')), 10000);
        const interval = setInterval(() => {
            const match = output.match(/bootstrap token[^:]*:\s*(\S+)/i);
            if (match) {
                clearInterval(interval);
                clearTimeout(timeout);
                resolve(match[1]);
            }
            if (child.exitCode !== null) {
                clearInterval(interval);
                clearTimeout(timeout);
                reject(new Error('Setup server exited before listening.'));
            }
        }, 25);
    });
    return { child, port, token, output: () => output };
}

async function stop(child) {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
        const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
}

test('setup server blocks the application and protects the one active session', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-server-'));
    const running = await startSetup(stateDirectory);
    const origin = `http://127.0.0.1:${running.port}`;
    try {
        const setupPage = await fetch(`${origin}/setup`);
        const setupHtml = await setupPage.text();
        assert.match(setupHtml, /Where do I find the setup token\?/);
        assert.match(setupHtml, /docker compose logs --tail=50 compdesk/);
        assert.match(setupHtml, /docker-compose\.build\.yml/);
        assert.match(setupHtml, /Token expired\?/);
        assert.match(setupHtml, /docker compose restart compdesk/);
        assert.match(setupHtml, /no browser-accessible reset endpoint is used/);
        assert.equal(setupHtml.includes(running.token), false, 'the setup page must never receive the bootstrap token');
        assert.match(running.output(), /CompDesk first-run setup is active/);
        assert.match(running.output(), /Token expires in 30 minutes/);
        assert.equal(running.output().split(running.token).length - 1, 1, 'bootstrap output must contain the token exactly once');

        const normal = await fetch(`${origin}/dashboard`, { redirect: 'manual' });
        assert.equal(normal.status, 302);
        assert.equal(normal.headers.get('location'), '/setup');

        const wrongOrigin = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(wrongOrigin.status, 403);

        const invalidToken = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify({ token: 'not-the-generated-token' }),
        });
        assert.equal(invalidToken.status, 401);
        assert.match((await invalidToken.json()).error, /invalid or has expired.*container or setup-process logs/i);

        const authenticated = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(authenticated.status, 200);
        const session = await authenticated.json();
        assert.ok(session.csrfToken);
        assert.match(authenticated.headers.get('set-cookie'), /HttpOnly/i);
        assert.match(authenticated.headers.get('set-cookie'), /SameSite=Strict/i);

        const duplicate = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(duplicate.status, 409);
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('concurrent exchanges of the bootstrap token create only one session', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-race-'));
    const running = await startSetup(stateDirectory);
    const origin = `http://127.0.0.1:${running.port}`;
    const body = JSON.stringify({ token: running.token });
    const requests = [];
    try {
        // Send headers for both requests before either body. This makes both
        // handlers enter the asynchronous body read before one can authenticate.
        for (let index = 0; index < 2; index += 1) {
            let request;
            const completed = new Promise((resolve, reject) => {
                request = http.request(`${origin}/setup/api/session`, {
                    method: 'POST',
                    headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                }, (response) => {
                    response.resume();
                    response.on('end', () => resolve(response.statusCode));
                });
                request.on('error', reject);
                request.flushHeaders();
            });
            requests.push({ request, completed });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        for (const { request } of requests) request.end(body);
        const statuses = await Promise.all(requests.map(({ completed }) => completed));
        assert.deepEqual(statuses.sort(), [200, 409]);
    } finally {
        for (const { request } of requests) request.destroy();
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('completed setup endpoints return gone', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-complete-'));
    fs.writeFileSync(path.join(stateDirectory, 'installation.json'), '{}', { mode: 0o600 });
    const running = await startSetup(stateDirectory);
    try {
        const response = await fetch(`http://127.0.0.1:${running.port}/setup`);
        assert.equal(response.status, 410);
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('detects a config-init-generated bootstrap database from files instead of legacy env vars', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-bootstrap-file-db-'));
    fs.mkdirSync(path.join(stateDirectory, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(stateDirectory, 'secrets', 'postgres_password'), 'generated-bootstrap-password');
    fs.writeFileSync(path.join(stateDirectory, 'secrets', 'postgres_identity.json'), JSON.stringify({ user: 'compdesk', db: 'compdesk' }));
    const running = await startSetup(stateDirectory);
    try {
        const origin = `http://127.0.0.1:${running.port}`;
        const session = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify({ token: running.token }),
        });
        const { csrfToken } = await session.json();
        const cookie = session.headers.get('set-cookie').split(';')[0];
        const system = await fetch(`${origin}/setup/api/system`, {
            headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken },
        });
        const body = await system.json();
        assert.equal(body.bootstrapDatabase.username, 'compdesk');
        assert.equal(body.bootstrapDatabase.database, 'compdesk');
        assert.equal(body.bootstrapDatabase.host, 'db');
        assert.equal(body.bootstrapDatabase.hasCustomCa, false);
        // Never returns the actual password, even redacted alongside the rest.
        assert.equal(JSON.stringify(body.bootstrapDatabase).includes('generated-bootstrap-password'), false);
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('reopening installed setup shows a friendly HTML page for browsers and plain JSON for API clients', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-installed-'));
    fs.writeFileSync(path.join(stateDirectory, 'installation.json'), JSON.stringify({
        installedAt: '2026-01-01T00:00:00.000Z',
        applicationUrl: 'http://localhost:3000',
        deploymentMode: 'docker-compose',
    }), { mode: 0o600 });
    const running = await startSetup(stateDirectory);
    try {
        const origin = `http://127.0.0.1:${running.port}`;
        const browserRequest = await fetch(`${origin}/setup`, { headers: { Accept: 'text/html,application/xhtml+xml' } });
        assert.equal(browserRequest.status, 410);
        assert.match(browserRequest.headers.get('content-type') || '', /text\/html/);
        const body = await browserRequest.text();
        assert.doesNotMatch(body, /"error"/);
        assert.match(body, /docker compose/);
        assert.match(body, /docker-compose\.setup\.yml/);

        const apiRequest = await fetch(`${origin}/setup`);
        assert.equal(apiRequest.status, 410);
        assert.equal(apiRequest.headers.get('content-type'), 'application/json; charset=utf-8');
        assert.deepEqual(await apiRequest.json(), { error: 'First-run setup is no longer available.' });
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});


test('explicit SETUP_PUBLIC_ORIGIN is enforced independently of the listener port', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-explicit-origin-'));
    const publicOrigin = 'https://helpdesk.example.test';
    const running = await startSetup(stateDirectory, { SETUP_PUBLIC_ORIGIN: publicOrigin });
    const socketOrigin = `http://127.0.0.1:${running.port}`;
    try {
        const accepted = await fetch(`${socketOrigin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: publicOrigin },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(accepted.status, 200);
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('setup session rejects a missing Origin and a malformed Host header', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-invalid-origin-'));
    const running = await startSetup(stateDirectory);
    const origin = `http://127.0.0.1:${running.port}`;
    try {
        const missingOrigin = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(missingOrigin.status, 403);

        const malformedHostResponse = await new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: '127.0.0.1', port: running.port }, () => {
                socket.write(`POST /setup/api/session HTTP/1.1\r\nHost: bad/host\r\nOrigin: http://bad/host\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`);
            });
            let response = '';
            socket.on('data', (chunk) => { response += chunk.toString(); });
            socket.on('end', () => resolve(response));
            socket.on('error', reject);
        });
        assert.match(malformedHostResponse, /^HTTP\/1\.1 403/m);
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('untrusted forwarded origin is ignored', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-untrusted-proxy-'));
    const running = await startSetup(stateDirectory);
    const origin = `http://127.0.0.1:${running.port}`;
    try {
        const response = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://proxy.example.test',
                'X-Forwarded-Host': 'proxy.example.test',
                'X-Forwarded-Proto': 'https',
            },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(response.status, 403);
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('trusted forwarded origin is accepted only when explicitly enabled', async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-setup-trusted-proxy-'));
    const running = await startSetup(stateDirectory, { SETUP_TRUST_PROXY: 'true' });
    const socketOrigin = `http://127.0.0.1:${running.port}`;
    const publicOrigin = 'https://proxy.example.test';
    try {
        const response = await fetch(`${socketOrigin}/setup/api/session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: publicOrigin,
                'X-Forwarded-Host': 'proxy.example.test',
                'X-Forwarded-Proto': 'https',
            },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(response.status, 200);
    } finally {
        await stop(running.child);
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});
