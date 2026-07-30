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

async function startSetup(stateDirectory) {
    const port = await availablePort();
    const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'setup-bootstrap.mjs')], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            SETUP_PORT: String(port),
            SETUP_HOST: '127.0.0.1',
            SETUP_ALLOW_REMOTE: 'false',
            COMPDESK_SETUP_STATE_DIR: stateDirectory,
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
    return { child, port, token };
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
        const normal = await fetch(`${origin}/dashboard`, { redirect: 'manual' });
        assert.equal(normal.status, 302);
        assert.equal(normal.headers.get('location'), '/setup');

        const wrongOrigin = await fetch(`${origin}/setup/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
            body: JSON.stringify({ token: running.token }),
        });
        assert.equal(wrongOrigin.status, 403);

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
