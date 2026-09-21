import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function source(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('the Dockerfile has exactly one final stage that ships working Prisma engines (no separate ephemeral setup target)', () => {
    const dockerfile = source('Dockerfile');
    const fromStages = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gmi)].map((match) => match[1].toLowerCase());
    assert.deepEqual(fromStages, ['base', 'deps', 'prod-deps', 'builder', 'runtime-base', 'runner']);
    const runnerStage = dockerfile.slice(dockerfile.indexOf('FROM runtime-base AS runner'));
    assert.ok(runnerStage.includes('/app/node_modules/@prisma ./node_modules/@prisma'), 'the runner stage must copy the Prisma engine binaries');
    assert.ok(runnerStage.includes('/app/node_modules/.prisma ./node_modules/.prisma'), 'the runner stage must copy the generated Prisma client');
    assert.ok(runnerStage.includes('/app/node_modules/prisma ./node_modules/prisma'), 'the runner stage must copy the Prisma CLI so migrate deploy can run');
    assert.match(runnerStage, /CMD \["node", "scripts\/orchestrator\.mjs"\]/);
});

test('the merged runner stage does not drag in the full development node_modules tree', () => {
    const dockerfile = source('Dockerfile');
    const runnerStage = dockerfile.slice(dockerfile.indexOf('FROM runtime-base AS runner'));
    assert.doesNotMatch(runnerStage, /COPY --from=deps.*node_modules ./, 'must not copy the entire deps node_modules (devDependencies) into the runtime image');
});

test('every relative import of a packaged runtime script is included in the image', () => {
    const dockerfile = source('Dockerfile');
    const scripts = new Set([...dockerfile.matchAll(/^COPY[^\r\n]* \/app\/(scripts\/\S+) \.\/scripts\/\S+/gm)].map((match) => match[1]));
    assert.ok(scripts.has('scripts/setup-bootstrap.mjs'));
    for (const script of scripts) {
        for (const match of source(script).matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g)) {
            const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(script), match[2]));
            assert.ok(scripts.has(dependency), `${script} imports ${dependency}, which the runtime image does not include`);
        }
    }
});

test('the migration CLI and its dependency closure are installed as production dependencies', () => {
    const packageJson = JSON.parse(source('package.json'));
    assert.ok(packageJson.dependencies.prisma, 'prisma migrate deploy is required by the production orchestrator');
    const lock = JSON.parse(source('package-lock.json'));
    const visited = new Set();
    function visit(packagePath) {
        if (visited.has(packagePath)) return;
        visited.add(packagePath);
        const entry = lock.packages[packagePath];
        assert.ok(entry && entry.dev !== true, `${packagePath} would be pruned by npm ci --omit=dev`);
        for (const name of Object.keys(entry.dependencies || {})) {
            let base = packagePath;
            let resolved;
            while (base) {
                const candidate = `${base}/node_modules/${name}`;
                if (lock.packages[candidate]) { resolved = candidate; break; }
                const ancestor = base.lastIndexOf('/node_modules/');
                base = ancestor < 0 ? '' : base.slice(0, ancestor);
            }
            visit(resolved || `node_modules/${name}`);
        }
    }
    visit('node_modules/prisma');
});

function composeConfig(composeFile, extraEnv, isolatedEnvFile, extraFiles = []) {
    const output = execFileSync(
        'docker',
        ['compose', '--env-file', isolatedEnvFile, ...extraFiles.flatMap((file) => ['-f', file]), '-f', composeFile, 'config', '--format', 'json'],
        { cwd: process.cwd(), env: { ...process.env, ...extraEnv }, encoding: 'utf8' },
    );
    return JSON.parse(output);
}

function isolatedEmptyEnvFile() {
    // An empty --env-file keeps this deterministic: a real .compdesk/.env in
    // this checkout could otherwise override volume names via
    // POSTGRES_VOLUME_NAME, or leave COMPDESK_VERSION unset.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-compose-config-'));
    const file = path.join(directory, 'empty.env');
    fs.writeFileSync(file, '');
    return { directory, file };
}

test('the canonical docker-compose.yml is image-based, pins an explicit version when given one, and has the three-service unified shape', () => {
    const { directory, file } = isolatedEmptyEnvFile();
    try {
        const config = composeConfig('docker-compose.yml', {
            POSTGRES_VOLUME_NAME: 'compdesk_config_test_pgdata',
            UPLOADS_VOLUME_NAME: 'compdesk_config_test_uploads',
            ATTACHMENTS_VOLUME_NAME: 'compdesk_config_test_attachments',
            CONFIG_VOLUME_NAME: 'compdesk_config_test_config',
            COMPDESK_VERSION: '1.0.0',
            APP_PORT: '4310',
        }, file);
        assert.equal(config.name, 'compdesk');
        assert.deepEqual(Object.keys(config.services).sort(), ['compdesk', 'config-init', 'db']);
        assert.equal(config.volumes.config.name, 'compdesk_config_test_config');
        assert.equal(config.services.compdesk.environment.COMPDESK_PUBLISHED_PORT, '4310');
        assert.equal(config.services.compdesk.ports[0].published, '4310');
        assert.equal(config.services.compdesk.ports[0].host_ip, '127.0.0.1');
        for (const service of ['config-init', 'compdesk']) {
            assert.match(config.services[service].image, /^ghcr\.io\/tahahydra\/compdesk:1\.0\.0$/);
            assert.equal(config.services[service].build, undefined, `${service} must not define build: in the public compose file`);
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('an unset COMPDESK_VERSION defaults to the obviously-fake "0.0.0-local" placeholder, never a real or "latest" tag', () => {
    const { directory, file } = isolatedEmptyEnvFile();
    try {
        const config = composeConfig('docker-compose.yml', {}, file);
        for (const service of ['config-init', 'compdesk']) {
            // "0.0.0-local" is never produced by publish-image.yml (which only
            // ever publishes a strict semantic-version git tag) or by
            // scripts/generate-release-compose.mjs (which requires a real
            // version and never accepts this placeholder) — so resolving to
            // it is never satisfied by an actual publishable image, and a
            // `docker compose up`/`pull` against it fails with a clear
            // registry "manifest unknown" error rather than silently
            // succeeding against the wrong thing.
            assert.equal(config.services[service].image, 'ghcr.io/tahahydra/compdesk:0.0.0-local');
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('docker-compose.build.yml is the only public file that layers build: on top of the canonical image, and needs no environment variable at all', () => {
    const { directory, file } = isolatedEmptyEnvFile();
    try {
        const config = composeConfig('docker-compose.yml', {}, file, ['docker-compose.build.yml']);
        for (const service of ['config-init', 'compdesk']) {
            assert.ok(config.services[service].build, `${service} must build locally under the dev override`);
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('docker-compose.external-db.yml is image-based (no local build/npm required)', () => {
    const { directory, file } = isolatedEmptyEnvFile();
    try {
        const config = composeConfig('docker-compose.external-db.yml', {
            COMPDESK_VERSION: '1.0.0',
            DATABASE_URL: 'postgresql://u:p@db.example:5432/app?schema=public',
            AUTH_URL: 'https://helpdesk.example.com',
            AUTH_SECRET: 'ci-only-stable-auth-secret-32-characters',
            APP_SETTINGS_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        }, file);
        for (const service of ['migrate', 'app']) {
            assert.match(config.services[service].image, /^ghcr\.io\/tahahydra\/compdesk:1\.0\.0$/);
            assert.equal(config.services[service].build, undefined);
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('the deprecated legacy and setup Compose files still share one canonical project identity and volume names with each other', () => {
    const { directory, file } = isolatedEmptyEnvFile();
    try {
        const legacy = composeConfig('docker-compose.legacy.yml', {
            POSTGRES_DB: 'compdesk_config_test', POSTGRES_USER: 'compdesk_config_test', POSTGRES_PASSWORD: 'compdesk_config_test_password',
            AUTH_URL: 'http://localhost:3000', AUTH_SECRET: 'docker-config-test-auth-secret-32-characters',
            APP_SETTINGS_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        }, file);
        const setup = composeConfig('docker-compose.setup.yml', {
            POSTGRES_DB: 'compdesk_config_test', POSTGRES_USER: 'compdesk_config_test', POSTGRES_PASSWORD: 'compdesk_config_test_password',
        }, file);
        assert.equal(legacy.name, 'compdesk');
        assert.equal(setup.name, 'compdesk');
        assert.equal(legacy.volumes.pgdata.name, setup.volumes.pgdata.name);
        assert.equal(legacy.volumes.uploads.name, setup.volumes.uploads.name);
        assert.equal(legacy.volumes.attachments.name, setup.volumes.attachments.name);
        assert.equal(legacy.volumes.pgdata.name, 'compdesk_pgdata');
        // The legacy rollback file must not silently inherit the new image's
        // default CMD (the orchestrator), which would re-run first-run setup.
        assert.deepEqual(legacy.services.app.command, ['sh', '-c', 'node scripts/validate-runtime-env.mjs && exec node server.js']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('db and compdesk use a bounded restart policy, never `unless-stopped` (a permanent failure must not restart-loop forever)', () => {
    const compose = source('docker-compose.yml');
    assert.doesNotMatch(compose, /restart: unless-stopped/, 'unless-stopped would hide a permanent failure behind an infinite restart loop');
    assert.equal((compose.match(/restart: on-failure:5/g) || []).length, 2, 'both db and compdesk must use the same bounded, non-infinite restart policy');
});

test('the destructive Docker reset utility is never wired into an automatic lifecycle script', () => {
    const scripts = JSON.parse(source('package.json')).scripts;
    for (const [name, command] of Object.entries(scripts)) {
        if (name === 'docker:reset') continue;
        assert.doesNotMatch(command, /docker-reset\.mjs/, `script "${name}" must not invoke docker-reset.mjs automatically`);
    }
});
