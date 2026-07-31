import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    CANONICAL_COMPOSE_PROJECT_NAME,
    DEFAULT_VOLUME_NAMES,
    LEGACY_COMPOSE_PROJECT_NAMES,
    RESET_CONFIRMATION_PHRASE,
    executeDockerReset,
    formatResetOutcome,
    inspectPgdataVolume,
    planDockerReset,
    prepareDockerBootstrap,
    resolveVolumeNames,
} from './docker-project.mjs';

function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function spawnEnoent() {
    return { error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }) };
}

const CANONICAL_LABEL = `label=com.docker.compose.project=${CANONICAL_COMPOSE_PROJECT_NAME}`;
const LEGACY_LABEL = `label=com.docker.compose.project=${LEGACY_COMPOSE_PROJECT_NAMES[0]}`;
const PS_CANONICAL = `ps -aq --filter ${CANONICAL_LABEL}`;
const PS_LEGACY = `ps -aq --filter ${LEGACY_LABEL}`;
const NET_CANONICAL = `network ls -q --filter ${CANONICAL_LABEL}`;
const NET_LEGACY = `network ls -q --filter ${LEGACY_LABEL}`;
const NOT_FOUND_VOLUME = (name) => ({ status: 1, stderr: `Error response from daemon: get ${name}: no such volume` });

// Simulates real docker CLI semantics for tests that need discovery and the
// later verification pass (identical filter args) to answer differently:
// each key's array is consumed in call order and the last entry repeats.
function sequencedRun(scriptByKey) {
    const counts = new Map();
    return (_command, args) => {
        const key = args.join(' ');
        const script = scriptByKey[key];
        if (!script) return { status: 0, stdout: '' };
        const index = counts.get(key) || 0;
        counts.set(key, index + 1);
        return script[Math.min(index, script.length - 1)];
    };
}

function cleanVolumeInspects(volumeNames = [DEFAULT_VOLUME_NAMES.pgdata, DEFAULT_VOLUME_NAMES.uploads, DEFAULT_VOLUME_NAMES.attachments, DEFAULT_VOLUME_NAMES.config]) {
    return Object.fromEntries(volumeNames.map((name) => [`volume inspect ${name}`, [NOT_FOUND_VOLUME(name)]]));
}

test('resolves default volume names and honors overrides', () => {
    assert.deepEqual(resolveVolumeNames({}), DEFAULT_VOLUME_NAMES);
    assert.deepEqual(resolveVolumeNames({ POSTGRES_VOLUME_NAME: 'custom_pgdata' }), {
        ...DEFAULT_VOLUME_NAMES,
        pgdata: 'custom_pgdata',
    });
    assert.deepEqual(resolveVolumeNames({ CONFIG_VOLUME_NAME: 'custom_config' }), {
        ...DEFAULT_VOLUME_NAMES,
        config: 'custom_config',
    });
});

test('inspectPgdataVolume: inspection-error when the docker executable is missing', () => {
    const result = inspectPgdataVolume('v', { run: spawnEnoent });
    assert.equal(result.state, 'inspection-error');
    assert.match(result.detail, /not found on PATH/i);
});

test('inspectPgdataVolume: inspection-error when the docker daemon is unavailable', () => {
    const run = () => ({ status: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' });
    const result = inspectPgdataVolume('v', { run });
    assert.equal(result.state, 'inspection-error');
    assert.match(result.detail, /docker volume inspect/i);
});

test('inspectPgdataVolume: inspection-error on permission denied', () => {
    const run = () => ({ status: 1, stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock' });
    const result = inspectPgdataVolume('v', { run });
    assert.equal(result.state, 'inspection-error');
});

test('inspectPgdataVolume: missing when docker clearly reports no such volume', () => {
    const run = () => NOT_FOUND_VOLUME('v');
    const result = inspectPgdataVolume('v', { run });
    assert.equal(result.state, 'missing');
});

test('inspectPgdataVolume: empty when the volume exists but has no PG_VERSION marker', () => {
    let call = 0;
    const run = () => (call++ === 0 ? { status: 0, stdout: '[]' } : { status: 1, stdout: '', stderr: '' });
    const result = inspectPgdataVolume('v', { run });
    assert.equal(result.state, 'empty');
});

test('inspectPgdataVolume: initialized when the volume exists and PG_VERSION is present', () => {
    const run = () => ({ status: 0, stdout: '[]' });
    const result = inspectPgdataVolume('v', { run });
    assert.equal(result.state, 'initialized');
});

test('inspectPgdataVolume: probe-error when the probe container itself fails to start', () => {
    let call = 0;
    const run = () => (call++ === 0 ? { status: 0, stdout: '[]' } : { status: 125, stderr: 'Cannot connect to the Docker daemon' });
    const result = inspectPgdataVolume('v', { run });
    assert.equal(result.state, 'probe-error');
});

test('inspectPgdataVolume: probe-error when the probe cannot even be spawned', () => {
    let call = 0;
    const run = () => (call++ === 0 ? { status: 0, stdout: '[]' } : spawnEnoent());
    const result = inspectPgdataVolume('v', { run });
    assert.equal(result.state, 'probe-error');
});

test('prepareDockerBootstrap refuses when already installed', () => {
    const stateDirectory = tempDir('compdesk-prepare-installed-');
    try {
        fs.writeFileSync(path.join(stateDirectory, 'installation.json'), '{}');
        const result = prepareDockerBootstrap({
            stateDirectory,
            deps: { inspectPgdataVolume: () => { throw new Error('must not check the volume once installed'); } },
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
            deps: { inspectPgdataVolume: () => { throw new Error('must not check the volume when preserving'); } },
        });
        assert.equal(result.action, 'preserved');
        assert.equal(fs.readFileSync(bootstrapPath, 'utf8'), 'POSTGRES_USER=existing\n');
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('prepareDockerBootstrap generates fresh independent credentials when the volume is confirmed missing', () => {
    const stateDirectory = tempDir('compdesk-prepare-missing-');
    try {
        const result = prepareDockerBootstrap({ stateDirectory, deps: { inspectPgdataVolume: () => ({ state: 'missing' }) } });
        assert.equal(result.action, 'generated');
        const contents = fs.readFileSync(result.bootstrapPath, 'utf8');
        assert.match(contents, /POSTGRES_USER=compdesk_[0-9a-f]{10}/);
        assert.match(contents, /POSTGRES_PASSWORD=\S{20,}/);
        if (process.platform !== 'win32') assert.equal(fs.statSync(result.bootstrapPath).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('prepareDockerBootstrap generates fresh credentials when the volume is confirmed empty', () => {
    const stateDirectory = tempDir('compdesk-prepare-empty-');
    try {
        const result = prepareDockerBootstrap({ stateDirectory, deps: { inspectPgdataVolume: () => ({ state: 'empty' }) } });
        assert.equal(result.action, 'generated');
        assert.equal(fs.existsSync(result.bootstrapPath), true);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('prepareDockerBootstrap refuses to mint new credentials when the pgdata volume is already initialized', () => {
    const stateDirectory = tempDir('compdesk-prepare-refuse-');
    try {
        const result = prepareDockerBootstrap({ stateDirectory, deps: { inspectPgdataVolume: () => ({ state: 'initialized', detail: 'already has data' }) } });
        assert.equal(result.action, 'refused-initialized-volume');
        assert.equal(result.ok, false);
        assert.equal(fs.existsSync(path.join(stateDirectory, 'docker-bootstrap.env')), false);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

for (const state of ['inspection-error', 'probe-error']) {
    test(`prepareDockerBootstrap refuses to mint new credentials when Docker state is unknown (${state})`, () => {
        const stateDirectory = tempDir('compdesk-prepare-unknown-');
        try {
            const result = prepareDockerBootstrap({ stateDirectory, deps: { inspectPgdataVolume: () => ({ state, detail: 'docker is unavailable' }) } });
            assert.equal(result.action, 'refused-unknown-volume-state');
            assert.equal(result.ok, false);
            assert.equal(fs.existsSync(path.join(stateDirectory, 'docker-bootstrap.env')), false);
        } finally {
            fs.rmSync(stateDirectory, { recursive: true, force: true });
        }
    });
}

test('planDockerReset covers the canonical and legacy project names, every named volume, and the confirmation phrase', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', '.compdesk') });
    assert.deepEqual(plan.projectNames, [CANONICAL_COMPOSE_PROJECT_NAME, ...LEGACY_COMPOSE_PROJECT_NAMES]);
    assert.deepEqual(plan.volumeNames, [DEFAULT_VOLUME_NAMES.pgdata, DEFAULT_VOLUME_NAMES.uploads, DEFAULT_VOLUME_NAMES.attachments, DEFAULT_VOLUME_NAMES.config]);
    assert.match(plan.warning, /permanently delete/i);
    assert.match(plan.warning, /compdesk_pgdata/);
    assert.match(plan.warning, /compdesk_config/);
    assert.match(plan.warning, /\.compdesk/);
    assert.ok(plan.warning.includes(RESET_CONFIRMATION_PHRASE));
});

test('planDockerReset resolves exact environment-overridden volume names, never a substring', () => {
    const plan = planDockerReset({
        env: { POSTGRES_VOLUME_NAME: 'override_pgdata_volume', CONFIG_VOLUME_NAME: 'override_config_volume' },
        stateDirectory: '.compdesk',
    });
    assert.deepEqual(plan.volumeNames, ['override_pgdata_volume', DEFAULT_VOLUME_NAMES.uploads, DEFAULT_VOLUME_NAMES.attachments, 'override_config_volume']);
    assert.match(plan.warning, /override_pgdata_volume/);
    assert.match(plan.warning, /override_config_volume/);
    assert.doesNotMatch(plan.warning, /compdesk_pgdata/);
    assert.doesNotMatch(plan.warning, /compdesk_config/);
});

test('executeDockerReset: happy path removes every discovered resource, verifies absence, and only then removes .compdesk', () => {
    const stateDirectory = tempDir('compdesk-reset-happy-');
    try {
        fs.writeFileSync(path.join(stateDirectory, 'docker-bootstrap.env'), 'secret');
        const plan = planDockerReset({ env: {}, stateDirectory });
        const script = {
            [PS_CANONICAL]: [{ status: 0, stdout: 'c1' }, { status: 0, stdout: '' }],
            [PS_LEGACY]: [{ status: 0, stdout: '' }, { status: 0, stdout: '' }],
            [NET_CANONICAL]: [{ status: 0, stdout: 'n1' }, { status: 0, stdout: '' }],
            [NET_LEGACY]: [{ status: 0, stdout: '' }, { status: 0, stdout: '' }],
            'rm -f c1': [{ status: 0, stdout: '' }],
            'network rm n1': [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.pgdata}`]: [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.uploads}`]: [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.attachments}`]: [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.config}`]: [{ status: 0, stdout: '' }],
            ...cleanVolumeInspects(),
        };
        const result = executeDockerReset(plan, { run: sequencedRun(script) });
        assert.equal(result.ok, true);
        assert.deepEqual(result.failures, []);
        assert.deepEqual(result.removed.containers, ['c1']);
        assert.deepEqual(result.removed.networks, ['n1']);
        assert.deepEqual(result.removed.volumes, plan.volumeNames);
        assert.equal(result.configurationRemoved, true);
        assert.equal(fs.existsSync(stateDirectory), false);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('executeDockerReset: a real container removal failure is reported and .compdesk is preserved', () => {
    const stateDirectory = tempDir('compdesk-reset-container-fail-');
    try {
        const plan = planDockerReset({ env: {}, stateDirectory });
        const script = {
            [PS_CANONICAL]: [{ status: 0, stdout: 'c1' }, { status: 0, stdout: 'c1' }],
            'rm -f c1': [{ status: 1, stderr: 'Error response from daemon: cannot remove container: still running' }],
            ...cleanVolumeInspects(),
        };
        const result = executeDockerReset(plan, { run: sequencedRun(script) });
        assert.equal(result.ok, false);
        assert.ok(result.failures.some((f) => f.phase === 'removal' && f.resource === 'container' && f.id === 'c1'));
        assert.equal(fs.existsSync(stateDirectory), true);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('executeDockerReset: a real network removal failure is reported and blocks success', () => {
    const stateDirectory = tempDir('compdesk-reset-network-fail-');
    try {
        const plan = planDockerReset({ env: {}, stateDirectory });
        const script = {
            [NET_CANONICAL]: [{ status: 0, stdout: 'n1' }, { status: 0, stdout: 'n1' }],
            'network rm n1': [{ status: 1, stderr: 'Error response from daemon: network n1 has active endpoints' }],
            ...cleanVolumeInspects(),
        };
        const result = executeDockerReset(plan, { run: sequencedRun(script) });
        assert.equal(result.ok, false);
        assert.ok(result.failures.some((f) => f.phase === 'removal' && f.resource === 'network' && f.id === 'n1'));
        assert.equal(fs.existsSync(stateDirectory), true);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('executeDockerReset: a real volume removal failure is reported and blocks success', () => {
    const stateDirectory = tempDir('compdesk-reset-volume-fail-');
    try {
        const plan = planDockerReset({ env: {}, stateDirectory });
        const script = {
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.pgdata}`]: [{ status: 1, stderr: 'Error response from daemon: volume is in use - [abc123]' }],
            ...cleanVolumeInspects([DEFAULT_VOLUME_NAMES.uploads, DEFAULT_VOLUME_NAMES.attachments, DEFAULT_VOLUME_NAMES.config]),
            [`volume inspect ${DEFAULT_VOLUME_NAMES.pgdata}`]: [{ status: 0, stdout: '[]' }],
        };
        const result = executeDockerReset(plan, { run: sequencedRun(script) });
        assert.equal(result.ok, false);
        assert.ok(result.failures.some((f) => f.phase === 'removal' && f.resource === 'volume' && f.id === DEFAULT_VOLUME_NAMES.pgdata));
        assert.equal(fs.existsSync(stateDirectory), true);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('executeDockerReset: treats a clear "not found" removal response as harmless', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', 'compdesk-notfound', '.compdesk') });
    const script = {
        [PS_CANONICAL]: [{ status: 0, stdout: 'ghost' }, { status: 0, stdout: '' }],
        'rm -f ghost': [{ status: 1, stderr: 'Error response from daemon: No such container: ghost' }],
        ...cleanVolumeInspects(),
    };
    const result = executeDockerReset(plan, { run: sequencedRun(script), existsSync: () => false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
});

test('executeDockerReset: fails closed and skips removal when discovery itself cannot be trusted (daemon unavailable)', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', 'compdesk-daemon-down', '.compdesk') });
    const calls = [];
    const script = {
        [PS_CANONICAL]: [{ status: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' }],
        ...cleanVolumeInspects(),
    };
    const run = (command, args) => { calls.push(args.join(' ')); return sequencedRun(script)(command, args); };
    const result = executeDockerReset(plan, { run, existsSync: () => false });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.phase === 'discovery' && f.resource === 'container' && f.project === CANONICAL_COMPOSE_PROJECT_NAME));
    assert.ok(!calls.some((call) => call.startsWith('rm -f')));
});

test('executeDockerReset: permission denied during discovery is a hard failure, never silently ignored', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', 'compdesk-perm-denied', '.compdesk') });
    const script = {
        [NET_CANONICAL]: [{ status: 1, stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock' }],
        ...cleanVolumeInspects(),
    };
    const result = executeDockerReset(plan, { run: sequencedRun(script), existsSync: () => false });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.phase === 'discovery' && f.resource === 'network'));
});

test('executeDockerReset: final verification catches a resource still present despite an apparently successful removal', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', 'compdesk-verify-leftover', '.compdesk') });
    const script = {
        [PS_CANONICAL]: [{ status: 0, stdout: 'ghost1' }, { status: 0, stdout: 'ghost1' }],
        'rm -f ghost1': [{ status: 0, stdout: '' }],
        ...cleanVolumeInspects(),
    };
    const result = executeDockerReset(plan, { run: sequencedRun(script), existsSync: () => false });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.phase === 'verification' && f.resource === 'container' && f.id === 'ghost1'));
});

test('executeDockerReset: final verification catches a volume still present despite an apparently successful removal', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', 'compdesk-verify-volume-leftover', '.compdesk') });
    const script = {
        [`volume rm -f ${DEFAULT_VOLUME_NAMES.pgdata}`]: [{ status: 0, stdout: '' }],
        [`volume inspect ${DEFAULT_VOLUME_NAMES.pgdata}`]: [{ status: 0, stdout: '[]' }],
        ...cleanVolumeInspects([DEFAULT_VOLUME_NAMES.uploads, DEFAULT_VOLUME_NAMES.attachments, DEFAULT_VOLUME_NAMES.config]),
    };
    const result = executeDockerReset(plan, { run: sequencedRun(script), existsSync: () => false });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.phase === 'verification' && f.resource === 'volume' && f.id === DEFAULT_VOLUME_NAMES.pgdata));
});

test('executeDockerReset: a configuration-removal failure after successful Docker cleanup is reported without throwing', () => {
    const stateDirectory = tempDir('compdesk-reset-config-fail-');
    try {
        fs.writeFileSync(path.join(stateDirectory, 'docker-bootstrap.env'), 'secret');
        const plan = planDockerReset({ env: {}, stateDirectory });
        const script = {
            [PS_CANONICAL]: [{ status: 0, stdout: 'c1' }, { status: 0, stdout: '' }],
            [NET_CANONICAL]: [{ status: 0, stdout: 'n1' }, { status: 0, stdout: '' }],
            'rm -f c1': [{ status: 0, stdout: '' }],
            'network rm n1': [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.pgdata}`]: [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.uploads}`]: [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.attachments}`]: [{ status: 0, stdout: '' }],
            [`volume rm -f ${DEFAULT_VOLUME_NAMES.config}`]: [{ status: 0, stdout: '' }],
            ...cleanVolumeInspects(),
        };
        const permissionError = Object.assign(new Error('EACCES: permission denied, rmdir'), { code: 'EACCES' });
        assert.doesNotThrow(() => {
            const result = executeDockerReset(plan, {
                run: sequencedRun(script),
                rmSync: () => { throw permissionError; },
            });
            assert.equal(result.ok, false);
            assert.equal(result.configurationRemoved, false);
            assert.deepEqual(result.removed.containers, ['c1']);
            assert.deepEqual(result.removed.networks, ['n1']);
            assert.deepEqual(result.removed.volumes, plan.volumeNames);
            const failure = result.failures.find((f) => f.phase === 'configuration-removal');
            assert.ok(failure, 'expected a configuration-removal failure');
            assert.equal(failure.resource, 'configuration');
            assert.equal(failure.id, stateDirectory);
            assert.equal(failure.command, `remove ${stateDirectory}`);
            assert.equal(failure.exitStatus, null);
            assert.match(failure.stderr, /EACCES/);
        });
        assert.equal(fs.existsSync(stateDirectory), true);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('executeDockerReset: successful cleanup with no existing .compdesk does not claim it was deleted', () => {
    const stateDirectory = path.join(tempDir('compdesk-reset-no-config-'), 'never-created', '.compdesk');
    const plan = planDockerReset({ env: {}, stateDirectory });
    const script = { ...cleanVolumeInspects() };
    const result = executeDockerReset(plan, { run: sequencedRun(script), existsSync: () => false, rmSync: () => { throw new Error('must not attempt removal of a directory that does not exist'); } });
    assert.equal(result.ok, true);
    assert.equal(result.configurationRemoved, false);
    assert.deepEqual(result.failures, []);
});

test('executeDockerReset: never removes .compdesk when Docker cleanup fails, even if it exists', () => {
    const stateDirectory = tempDir('compdesk-reset-preserve-on-fail-');
    try {
        const plan = planDockerReset({ env: {}, stateDirectory });
        const script = {
            [PS_CANONICAL]: [{ status: 1, stderr: 'Cannot connect to the Docker daemon' }],
            ...cleanVolumeInspects(),
        };
        const result = executeDockerReset(plan, {
            run: sequencedRun(script),
            rmSync: () => { throw new Error('must not remove .compdesk when Docker cleanup failed'); },
        });
        assert.equal(result.ok, false);
        assert.equal(result.configurationRemoved, false);
        assert.equal(fs.existsSync(stateDirectory), true);
    } finally {
        fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
});

test('executeDockerReset: targets only the exact canonical and legacy project labels', () => {
    const plan = planDockerReset({ env: {}, stateDirectory: path.join('tmp', 'compdesk-label-scope', '.compdesk') });
    const calls = [];
    const run = (_command, args) => { calls.push(args.join(' ')); return { status: 0, stdout: '' }; };
    executeDockerReset(plan, { run, existsSync: () => false });
    const filterCalls = calls.filter((call) => call.includes('--filter'));
    assert.ok(filterCalls.length > 0);
    for (const call of filterCalls) {
        assert.match(call, /label=com\.docker\.compose\.project=(compdesk|compdesk-setup)$/);
    }
    assert.ok(!calls.some((call) => call.startsWith('volume ls')), 'must never scan volumes by listing');
});

test('executeDockerReset: targets only the exact environment-resolved volume name, never a substring match', () => {
    const plan = planDockerReset({ env: { POSTGRES_VOLUME_NAME: 'override_pgdata_volume' }, stateDirectory: path.join('tmp', 'compdesk-volume-scope', '.compdesk') });
    const calls = [];
    const run = (_command, args) => { calls.push(args.join(' ')); return { status: 0, stdout: '' }; };
    executeDockerReset(plan, { run, existsSync: () => false });
    assert.ok(calls.includes('volume rm -f override_pgdata_volume'));
    assert.ok(calls.includes('volume inspect override_pgdata_volume'));
    assert.ok(!calls.some((call) => call.includes('compdesk_pgdata')));
    assert.ok(!calls.some((call) => call.startsWith('volume ls')));
});

test('executeDockerReset: targets only the exact environment-resolved compdesk_config volume name, never a substring match', () => {
    const plan = planDockerReset({ env: { CONFIG_VOLUME_NAME: 'override_config_volume' }, stateDirectory: path.join('tmp', 'compdesk-config-volume-scope', '.compdesk') });
    const calls = [];
    const run = (_command, args) => { calls.push(args.join(' ')); return { status: 0, stdout: '' }; };
    executeDockerReset(plan, { run, existsSync: () => false });
    assert.ok(calls.includes('volume rm -f override_config_volume'));
    assert.ok(calls.includes('volume inspect override_config_volume'));
    assert.ok(!calls.some((call) => call.includes('compdesk_config')));
});

test('formatResetOutcome: full success (Docker resources and configuration removed) prints Done and exits 0', () => {
    const outcome = formatResetOutcome({ ok: true, configurationRemoved: true, failures: [] }, path.join('tmp', '.compdesk'));
    assert.equal(outcome.exitCode, 0);
    assert.ok(outcome.lines.some((line) => /^Done\./.test(line)));
    assert.ok(outcome.lines.some((line) => line.includes('generated configuration have been removed')));
});

test('formatResetOutcome: success with no pre-existing configuration directory does not claim it was deleted', () => {
    const outcome = formatResetOutcome({ ok: true, configurationRemoved: false, failures: [] }, path.join('tmp', '.compdesk'));
    assert.equal(outcome.exitCode, 0);
    assert.ok(outcome.lines.some((line) => /^Done\./.test(line)));
    assert.ok(outcome.lines.some((line) => line.includes('No generated configuration directory was present')));
    assert.ok(!outcome.lines.some((line) => line.includes('generated configuration have been removed')));
});

test('formatResetOutcome never prints Done and exits nonzero on any failure', () => {
    const stateDirectory = path.join('tmp', '.compdesk');
    const outcome = formatResetOutcome({
        ok: false,
        configurationRemoved: false,
        failures: [{ phase: 'removal', resource: 'volume', id: DEFAULT_VOLUME_NAMES.pgdata, project: null, command: `docker volume rm -f ${DEFAULT_VOLUME_NAMES.pgdata}`, exitStatus: 1, stderr: 'volume is in use' }],
    }, stateDirectory);
    assert.equal(outcome.exitCode, 1);
    assert.ok(!outcome.lines.some((line) => /^Done\./.test(line)));
    assert.ok(outcome.lines.some((line) => line.includes(DEFAULT_VOLUME_NAMES.pgdata)));
    assert.ok(outcome.lines.some((line) => line.includes('was NOT removed')));
    assert.ok(outcome.lines.some((line) => line.includes(stateDirectory)));
});

test('formatResetOutcome: a configuration-removal-only failure states Docker cleanup succeeded but configuration remains', () => {
    const stateDirectory = path.join('tmp', '.compdesk');
    const outcome = formatResetOutcome({
        ok: false,
        configurationRemoved: false,
        failures: [{ phase: 'configuration-removal', resource: 'configuration', id: stateDirectory, project: null, command: `remove ${stateDirectory}`, exitStatus: null, stderr: 'EACCES: permission denied, rmdir' }],
    }, stateDirectory);
    assert.equal(outcome.exitCode, 1);
    assert.ok(!outcome.lines.some((line) => /^Done\./.test(line)));
    assert.ok(outcome.lines.some((line) => line.includes('Docker cleanup succeeded')));
    assert.ok(outcome.lines.some((line) => line.includes('EACCES')));
    assert.ok(outcome.lines.some((line) => line.includes(stateDirectory) && line.includes('remains on disk')));
});
