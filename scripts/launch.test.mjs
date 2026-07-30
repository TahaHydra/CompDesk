import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

function runLaunch(environment) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'launch.mjs')], {
            cwd: process.cwd(),
            env: environment,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { output += chunk.toString(); });
        child.once('error', reject);
        child.once('exit', (code) => resolve({ code, output }));
    });
}

test('configured installation exits when PostgreSQL is unavailable instead of opening setup', async () => {
    const environment = {
        ...process.env,
        DATABASE_URL: 'postgresql://compdesk:secret@127.0.0.1:1/compdesk?sslmode=disable',
        AUTH_URL: 'http://127.0.0.1:3000',
        AUTH_SECRET: 'launch-test-auth-secret-that-is-long-enough',
        COMPDESK_SETUP_MODE: 'false',
    };
    const result = await runLaunch(environment);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /configured but PostgreSQL is unavailable/i);
    assert.match(result.output, /Refusing to start first-run setup/i);
    assert.doesNotMatch(result.output, /first-run setup is active/i);
});