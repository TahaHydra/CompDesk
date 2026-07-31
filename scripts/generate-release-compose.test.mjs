import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pinReleaseCompose } from './generate-release-compose.mjs';

const ROOT = process.cwd();
const SOURCE = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');

test('pinReleaseCompose replaces every placeholder image reference with the exact pinned version', () => {
    const pinned = pinReleaseCompose(SOURCE, '1.2.3');
    // The header comment legitimately mentions these names in prose — only
    // the interpolation syntax itself must be gone from the pinned output.
    assert.doesNotMatch(pinned, /\$\{COMPDESK_VERSION/, 'no COMPDESK_VERSION interpolation should remain');
    assert.doesNotMatch(pinned, /\$\{COMPDESK_IMAGE/, 'no COMPDESK_IMAGE interpolation should remain');
    assert.match(pinned, /image: ghcr\.io\/tahahydra\/compdesk:1\.2\.3/);
    const occurrences = (pinned.match(/image: ghcr\.io\/tahahydra\/compdesk:1\.2\.3/g) || []).length;
    assert.equal(occurrences, 2, 'both config-init and compdesk services must be pinned');
});

test('pinReleaseCompose accepts a prerelease version', () => {
    const pinned = pinReleaseCompose(SOURCE, '2.0.0-rc1');
    assert.match(pinned, /image: ghcr\.io\/tahahydra\/compdesk:2\.0\.0-rc1/);
});

test('pinReleaseCompose rejects a version with a leading "v" or an incomplete/invalid version', () => {
    for (const bad of ['v1.2.3', '1.2', 'latest', '1.2.3.4', '']) {
        assert.throws(() => pinReleaseCompose(SOURCE, bad), /not a valid semantic version/);
    }
});

test('pinReleaseCompose never mutates the source string', () => {
    const before = SOURCE;
    pinReleaseCompose(SOURCE, '1.0.0');
    assert.equal(SOURCE, before);
});

test('the generated release-asset Compose file validates with docker compose config using zero environment variables', () => {
    const pinned = pinReleaseCompose(SOURCE, '1.2.3');
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-release-compose-'));
    const composePath = path.join(tempDirectory, 'docker-compose.yml');
    const emptyEnvPath = path.join(tempDirectory, 'empty.env');
    try {
        fs.writeFileSync(composePath, pinned);
        fs.writeFileSync(emptyEnvPath, '');
        const output = execFileSync('docker', ['compose', '--env-file', emptyEnvPath, '-f', composePath, 'config'], {
            cwd: tempDirectory, encoding: 'utf8',
        });
        assert.match(output, /image: ghcr\.io\/tahahydra\/compdesk:1\.2\.3/);
        assert.doesNotMatch(output, /0\.0\.0-local/, 'a real release asset must never resolve to the local-dev placeholder tag');
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
});

test('the CLI writes the pinned file to the requested output path', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-release-compose-cli-'));
    const outputPath = path.join(tempDirectory, 'nested', 'docker-compose.yml');
    try {
        const result = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-release-compose.mjs'), '1.2.3', outputPath], {
            cwd: ROOT, encoding: 'utf8',
        });
        assert.match(result, /Wrote a version-pinned release Compose file/);
        assert.equal(fs.existsSync(outputPath), true);
        assert.match(fs.readFileSync(outputPath, 'utf8'), /image: ghcr\.io\/tahahydra\/compdesk:1\.2\.3/);
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
});

test('the CLI refuses an invalid version with a clear, non-zero exit', () => {
    assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-release-compose.mjs'), 'not-a-version'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }), /Command failed/);
});
