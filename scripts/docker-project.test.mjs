import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    CANONICAL_COMPOSE_PROJECT_NAME,
    DEFAULT_VOLUME_NAMES,
    LEGACY_COMPOSE_PROJECT_NAMES,
    executeDockerReset,
    isPgdataVolumeInitialized,
    planDockerReset,
    prepareDockerBootstrap,
    resolveVolumeNames,
} from './docker-project.mjs';

function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('resolves default volume names and honors overrides', () => {
    assert.deepEqual(resolveVolumeNames({}), DEFAULT_VOLUME_NAMES);
    assert.deepEqual(resolveVolumeNames({ POSTGRES_VOLUME_NAME: 'custom_pgdata' }), {
        ...DEFAULT_VOLUME_NAMES,
        pgdata: 'custom_pgdata',
    });
});

test('detects an initialized pgdata volume only when both the volume and its data marker exist', () => {
    assert.equal(isPgdataVolumeInitialized('v', { run: () => ({ status: 1 }) }), false);
    assert.equal(isPgdataVolumeInitialized('v', { run: () => ({ error: new Error('docker not found') }) }), false);

    let call = 0;
    const volumeExistsNoData = () => (call++ === 0 ? { status: 0 } : { status: 1 });
    assert.equal(isPgdataVolumeInitialized('v', { run: volumeExistsNoData }), false);

    assert.equal(isPgdataVolumeInitialized('v', { run: () => ({ status: 0 }) }), true);
});

test('prepareDockerBootstrap refuses when already installed', () => {
    const stateDirectory = tempDir('compdesk-prepare-installed-');
    try {
        fs.writeFileSync(path.join(stateDirectory, 'installation.json'), '{}');
        const result = prepareDockerBootstrap({
            stateDirectory,
            deps: { isPgdataVolumeInitialized: () => { throw new Error('must not check the volume once installed'); } },
        });
        assert.equal(result.action, 'already-installed');
        assert.equal(result.ok, false);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('prepareDockerBootstrap preserves an existing bootstrap file without checking the volume', () => {
    const stateDirectory = tempDir('compdesk-prepare-preserved-');
    try {
        const bootstrapPath = path.join(stateDirectory, 'docker-bootstrap.env');
        fs.writeFileSync(bootstrapPath, 'POSTGRES_USER=existing\n');
        const result = prepareDockerBootstrap({
            stateDirectory,
            deps: { isPgdataVolumeInitialized: () => { throw new Error('must not check the volume when preserving'); } },
        });
        assert.equal(result.action, 'preserved');
        assert.equal(fs.readFileSync(bootstrapPath, 'utf8'), 'POSTGRES_USER=existing\n');
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('prepareDockerBootstrap refuses to mint new credentials when the pgdata volume is already initialized', () => {
    const stateDirectory = tempDir('compdesk-prepare-refuse-');
    try {
        const result = prepareDockerBootstrap({ stateDirectory, deps: { isPgdataVolumeInitialized: () => true } });
        assert.equal(result.action, 'refused-initialized-volume');
        assert.equal(result.ok, false);
        assert.equal(fs.existsSync(path.join(stateDirectory, 'docker-bootstrap.env')), false);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('prepareDockerBootstrap generates fresh independent credentials when nothing exists', () => {
    const stateDirectory = tempDir('compdesk-prepare-generate-');
    try {
        const result = prepareDockerBootstrap({ stateDirectory, deps: { isPgdataVolumeInitialized: () => false } });
        assert.equal(result.action, 'generated');
        const contents = fs.readFileSync(result.bootstrapPath, 'utf8');
        assert.match(contents, /POSTGRES_USER=compdesk_[0-9a-f]{10}/);
        assert.match(contents, /POSTGRES_PASSWORD=\S{20,}/);
        if (process.platform !== 'win32') assert.equal(fs.statSync(result.bootstrapPath).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('planDockerReset covers the canonical and legacy project names and every named volume', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', '.compdesk') });
    assert.deepEqual(plan.projectNames, [CANONICAL_COMPOSE_PROJECT_NAME, ...LEGACY_COMPOSE_PROJECT_NAMES]);
    assert.deepEqual(plan.volumeNames, [DEFAULT_VOLUME_NAMES.pgdata, DEFAULT_VOLUME_NAMES.uploads, DEFAULT_VOLUME_NAMES.attachments]);
    assert.match(plan.warning, /permanently delete/i);
    assert.match(plan.warning, /compdesk_pgdata/);
    assert.match(plan.warning, /\.compdesk/);
});

test('executeDockerReset only targets compdesk-labeled resources and the named volumes', () => {
    const calls = [];
    const fakeRun = (command, args) => {
        calls.push([command, ...args]);
        if (args[0] === 'ps') return { status: 0, stdout: 'container1\ncontainer2\n' };
        if (args[0] === 'network') return { status: 0, stdout: 'net1\n' };
        return { status: 0, stdout: '' };
    };
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', 'does-not-exist', '.compdesk') });
    executeDockerReset(plan, {
        run: fakeRun,
        existsSync: () => false,
        rmSync: () => { throw new Error('must not remove a missing state directory'); },
    });

    for (const project of plan.projectNames) {
        assert.ok(calls.some((call) => call.join(' ').includes(`label=com.docker.compose.project=${project}`) && call[1] === 'ps'));
        assert.ok(calls.some((call) => call.join(' ').includes(`label=com.docker.compose.project=${project}`) && call[1] === 'network'));
    }
    assert.ok(calls.some((call) => call.join(' ') === 'docker rm -f container1 container2'));
    for (const volume of plan.volumeNames) {
        assert.ok(calls.some((call) => call.join(' ') === `docker volume rm -f ${volume}`));
    }
    assert.ok(!calls.some((call) => call.join(' ').includes('unrelated-project')));
});

test('executeDockerReset removes the generated configuration directory when present', () => {
    const stateDirectory = tempDir('compdesk-reset-config-');
    try {
        fs.writeFileSync(path.join(stateDirectory, 'docker-bootstrap.env'), 'secret');
        const plan = planDockerReset({ env: {}, stateDirectory });
        executeDockerReset(plan, { run: () => ({ status: 0, stdout: '' }) });
        assert.equal(fs.existsSync(stateDirectory), false);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});
