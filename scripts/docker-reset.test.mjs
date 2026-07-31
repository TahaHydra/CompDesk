import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const scriptPath = path.join(process.cwd(), 'scripts', 'docker-reset.mjs');

function runReset(args = []) {
    try {
        const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        return { code: 0, output: stdout };
    } catch (error) {
        return { code: error.status, output: `${error.stdout || ''}${error.stderr || ''}` };
    }
}

test('refuses to reset without --yes when no interactive terminal is attached', () => {
    const result = runReset([]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /refusing to reset/i);
    assert.match(result.output, /no CompDesk resources were removed/i);
});

test('states exactly what will be deleted before requiring confirmation', () => {
    const result = runReset([]);
    assert.match(result.output, /permanently delete/i);
    assert.match(result.output, /pgdata/i);
    assert.match(result.output, /uploads/i);
    assert.match(result.output, /attachments/i);
    assert.match(result.output, /\.compdesk/);
    assert.match(result.output, /cannot be undone/i);
});
