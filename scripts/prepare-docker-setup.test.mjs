import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scriptPath = path.join(process.cwd(), 'scripts', 'prepare-docker-setup.mjs');

function runPrepare(projectRoot, args = []) {
    try {
        const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        return { code: 0, output: stdout };
    } catch (error) {
        return { code: error.status, output: `${error.stdout || ''}${error.stderr || ''}` };
    }
}

test('refuses to run when CompDesk is already installed', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-prepare-cli-installed-'));
    try {
        fs.mkdirSync(path.join(projectRoot, '.compdesk'));
        fs.writeFileSync(path.join(projectRoot, '.compdesk', 'installation.json'), '{}');
        const result = runPrepare(projectRoot);
        assert.equal(result.code, 2);
        assert.match(result.output, /already installed/i);
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('preserves an existing incomplete bootstrap file instead of regenerating it', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-prepare-cli-preserved-'));
    try {
        fs.mkdirSync(path.join(projectRoot, '.compdesk'));
        const bootstrapPath = path.join(projectRoot, '.compdesk', 'docker-bootstrap.env');
        fs.writeFileSync(bootstrapPath, 'POSTGRES_USER=existing_user\n');
        const result = runPrepare(projectRoot);
        assert.equal(result.code, 0);
        assert.match(result.output, /preserved/i);
        assert.equal(fs.readFileSync(bootstrapPath, 'utf8'), 'POSTGRES_USER=existing_user\n');
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});
