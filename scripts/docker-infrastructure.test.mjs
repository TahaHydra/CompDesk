import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function source(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('the setup Docker image ships working Prisma engines', () => {
    const dockerfile = source('Dockerfile');
    const setupStage = dockerfile.slice(dockerfile.indexOf('FROM runtime-base AS setup'));
    assert.ok(setupStage.includes('/app/node_modules/@prisma ./node_modules/@prisma'), 'setup stage must copy the Prisma client engine binaries');
    assert.ok(setupStage.includes('/app/node_modules/.prisma ./node_modules/.prisma'), 'setup stage must copy the generated Prisma client');
});

function composeConfig(composeFile, extraEnv, isolatedEnvFile) {
    const output = execFileSync(
        'docker',
        ['compose', '--env-file', isolatedEnvFile, '-f', composeFile, 'config', '--format', 'json'],
        { cwd: process.cwd(), env: { ...process.env, ...extraEnv }, encoding: 'utf8' }
    );
    return JSON.parse(output);
}

test('production and setup Compose stacks share one canonical project identity and volume names', () => {
    // An empty --env-file keeps this deterministic: a real .compdesk/.env in this
    // checkout could otherwise override volume names via POSTGRES_VOLUME_NAME.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-compose-config-'));
    const isolatedEnvFile = path.join(directory, 'empty.env');
    fs.writeFileSync(isolatedEnvFile, '');
    try {
        const production = composeConfig('docker-compose.yml', {
            POSTGRES_DB: 'compdesk_config_test',
            POSTGRES_USER: 'compdesk_config_test',
            POSTGRES_PASSWORD: 'compdesk_config_test_password',
            AUTH_URL: 'http://localhost:3000',
            AUTH_SECRET: 'docker-config-test-auth-secret-32-characters',
            APP_SETTINGS_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        }, isolatedEnvFile);
        const setup = composeConfig('docker-compose.setup.yml', {
            POSTGRES_DB: 'compdesk_config_test',
            POSTGRES_USER: 'compdesk_config_test',
            POSTGRES_PASSWORD: 'compdesk_config_test_password',
        }, isolatedEnvFile);

        assert.equal(production.name, 'compdesk');
        assert.equal(setup.name, 'compdesk');
        assert.equal(production.volumes.pgdata.name, setup.volumes.pgdata.name);
        assert.equal(production.volumes.uploads.name, setup.volumes.uploads.name);
        assert.equal(production.volumes.attachments.name, setup.volumes.attachments.name);
        assert.equal(setup.volumes.pgdata.name, 'compdesk_pgdata');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('the destructive Docker reset utility is never wired into an automatic lifecycle script', () => {
    const scripts = JSON.parse(source('package.json')).scripts;
    for (const [name, command] of Object.entries(scripts)) {
        if (name === 'docker:reset') continue;
        assert.doesNotMatch(command, /docker-reset\.mjs/, `script "${name}" must not invoke docker-reset.mjs automatically`);
    }
});
