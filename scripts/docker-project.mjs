import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { randomSecret, writeFileAtomic } from './setup-core.mjs';

export const CANONICAL_COMPOSE_PROJECT_NAME = 'compdesk';
export const LEGACY_COMPOSE_PROJECT_NAMES = ['compdesk-setup'];
export const DEFAULT_VOLUME_NAMES = {
    pgdata: 'compdesk_pgdata',
    uploads: 'compdesk_uploads',
    attachments: 'compdesk_attachments',
    config: 'compdesk_config',
};
export const RESET_CONFIRMATION_PHRASE = 'DELETE COMPDESK';
const PGDATA_PROBE_IMAGE = 'alpine:3.22';
const NOT_FOUND_PATTERNS = {
    container: /no such container/i,
    network: /no such network/i,
    volume: /no such volume/i,
};
// Docker's own exit-code convention for `docker run`: 125 means the run
// invocation itself failed (bad daemon, missing image, etc.) before the
// container's command ever executed, as opposed to the command's own exit code.
const DOCKER_RUN_INFRA_FAILURE_EXIT_CODE = 125;

export function resolveVolumeNames(env = process.env) {
    return {
        pgdata: env.POSTGRES_VOLUME_NAME || DEFAULT_VOLUME_NAMES.pgdata,
        uploads: env.UPLOADS_VOLUME_NAME || DEFAULT_VOLUME_NAMES.uploads,
        attachments: env.ATTACHMENTS_VOLUME_NAME || DEFAULT_VOLUME_NAMES.attachments,
        config: env.CONFIG_VOLUME_NAME || DEFAULT_VOLUME_NAMES.config,
    };
}

function safeStderr(result) {
    if (!result) return '';
    const raw = typeof result.stderr === 'string' ? result.stderr : Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : '';
    return raw.trim().split(/\r?\n/)[0]?.slice(0, 300) || '';
}

function spawnFailureMessage(result) {
    if (result?.error?.code === 'ENOENT') return 'The docker executable was not found on PATH.';
    return `Could not run docker: ${result?.error?.message || 'unknown spawn failure'}.`;
}

function describeFsError(error) {
    return String(error?.message || error || 'unknown filesystem error').trim().slice(0, 300);
}

// Distinguishes the states that matter for credential safety instead of
// collapsing "missing", "empty", "initialized", and every failure mode into a
// single boolean. Only "missing" and "empty" are safe to mint new credentials
// for; every error state must fail closed.
export function inspectPgdataVolume(volumeName, { run = spawnSync } = {}) {
    const inspect = run('docker', ['volume', 'inspect', volumeName], { encoding: 'utf8', windowsHide: true });
    if (!inspect || inspect.error) {
        return { state: 'inspection-error', volumeName, detail: spawnFailureMessage(inspect) };
    }
    if (inspect.status !== 0) {
        const stderr = safeStderr(inspect);
        if (NOT_FOUND_PATTERNS.volume.test(stderr)) {
            return { state: 'missing', volumeName, detail: `Docker volume "${volumeName}" does not exist.` };
        }
        return { state: 'inspection-error', volumeName, detail: `"docker volume inspect ${volumeName}" failed (exit ${inspect.status}): ${stderr || 'no diagnostic output.'}` };
    }

    const probe = run(
        'docker',
        ['run', '--rm', '-v', `${volumeName}:/pgdata:ro`, PGDATA_PROBE_IMAGE, 'test', '-f', '/pgdata/PG_VERSION'],
        { encoding: 'utf8', windowsHide: true }
    );
    if (!probe || probe.error) {
        return { state: 'probe-error', volumeName, detail: spawnFailureMessage(probe) };
    }
    if (probe.status === 0) {
        return { state: 'initialized', volumeName, detail: `Docker volume "${volumeName}" already contains an initialized PostgreSQL data directory.` };
    }
    if (probe.status === 1) {
        return { state: 'empty', volumeName, detail: `Docker volume "${volumeName}" exists but has no initialized PostgreSQL data directory yet.` };
    }
    const stderr = safeStderr(probe);
    return {
        state: 'probe-error',
        volumeName,
        detail: probe.status === DOCKER_RUN_INFRA_FAILURE_EXIT_CODE
            ? `The pgdata probe container failed to start (exit ${probe.status}): ${stderr || 'no diagnostic output.'}`
            : `The pgdata probe container exited unexpectedly (status ${probe.status}): ${stderr || 'no diagnostic output.'}`,
    };
}

export function prepareDockerBootstrap({ stateDirectory, rotateIncomplete = false, volumeName, env = process.env, deps = {} }) {
    const inspectVolume = deps.inspectPgdataVolume || inspectPgdataVolume;
    const bootstrapPath = path.join(stateDirectory, 'docker-bootstrap.env');
    const installedPath = path.join(stateDirectory, 'installation.json');
    const resolvedVolumeName = volumeName || resolveVolumeNames(env).pgdata;

    if (fs.existsSync(installedPath)) {
        return { action: 'already-installed', ok: false, bootstrapPath };
    }
    if (fs.existsSync(bootstrapPath) && !rotateIncomplete) {
        return { action: 'preserved', ok: true, bootstrapPath };
    }

    const inspection = inspectVolume(resolvedVolumeName, deps);
    if (inspection.state === 'initialized') {
        return { action: 'refused-initialized-volume', ok: false, bootstrapPath, volumeName: resolvedVolumeName, inspection };
    }
    if (inspection.state === 'inspection-error' || inspection.state === 'probe-error') {
        return { action: 'refused-unknown-volume-state', ok: false, bootstrapPath, volumeName: resolvedVolumeName, inspection };
    }

    const databaseUser = `compdesk_${crypto.randomBytes(5).toString('hex')}`;
    const databasePassword = randomSecret(36).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const contents = [
        '# Temporary credentials for the isolated Docker setup stack.',
        '# Do not commit this file. Remove it after the production stack is running.',
        'POSTGRES_DB=compdesk_db',
        `POSTGRES_USER=${databaseUser}`,
        `POSTGRES_PASSWORD=${databasePassword}`,
        'SETUP_BIND_ADDRESS=127.0.0.1',
        'SETUP_PORT=3000',
        `SETUP_UID=${typeof process.getuid === 'function' ? process.getuid() : 1000}`,
        `SETUP_GID=${typeof process.getgid === 'function' ? process.getgid() : 1000}`,
        '',
    ].join('\n');
    writeFileAtomic(bootstrapPath, contents, { mode: 0o600, backup: false });
    return { action: 'generated', ok: true, bootstrapPath, inspection };
}

export function planDockerReset({ env = process.env, stateDirectory }) {
    const volumes = resolveVolumeNames(env);
    const volumeNames = [volumes.pgdata, volumes.uploads, volumes.attachments, volumes.config];
    const projectNames = [CANONICAL_COMPOSE_PROJECT_NAME, ...LEGACY_COMPOSE_PROJECT_NAMES];
    const warning = [
        'This will permanently delete CompDesk Docker resources:',
        `  - PostgreSQL database volume: ${volumes.pgdata}`,
        `  - Uploads volume: ${volumes.uploads}`,
        `  - Attachments volume: ${volumes.attachments}`,
        `  - Persistent configuration/secrets volume: ${volumes.config}`,
        `  - Generated configuration directory: ${stateDirectory}`,
        `  - Containers and networks for project(s): ${projectNames.join(', ')}`,
        '',
        'All tickets, attachments, uploads, and installation state will be lost. This cannot be undone.',
        '',
        `To confirm, you will be asked to type exactly: ${RESET_CONFIRMATION_PHRASE}`,
    ].join('\n');
    return { projectNames, volumeNames, stateDirectory, warning };
}

function discoverIds(run, filterArgs) {
    const result = run('docker', filterArgs, { encoding: 'utf8', windowsHide: true });
    if (!result || result.error) {
        return { ok: false, ids: [], stderr: spawnFailureMessage(result), exitStatus: null };
    }
    if (result.status !== 0) {
        return { ok: false, ids: [], stderr: safeStderr(result) || `exit ${result.status}`, exitStatus: result.status };
    }
    const ids = (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return { ok: true, ids };
}

function classifyRemoval(result, resource) {
    if (!result || result.error) {
        return { ok: false, exitStatus: null, stderr: spawnFailureMessage(result) };
    }
    if (result.status === 0) return { ok: true, exitStatus: 0, stderr: '' };
    const stderr = safeStderr(result);
    if (NOT_FOUND_PATTERNS[resource].test(stderr)) return { ok: true, exitStatus: result.status, stderr };
    return { ok: false, exitStatus: result.status, stderr: stderr || `exit ${result.status}` };
}

function volumeStillExists(run, volumeName) {
    const result = run('docker', ['volume', 'inspect', volumeName], { encoding: 'utf8', windowsHide: true });
    if (!result || result.error) {
        return { ok: false, stderr: spawnFailureMessage(result) };
    }
    if (result.status === 0) return { ok: true, exists: true };
    const stderr = safeStderr(result);
    if (NOT_FOUND_PATTERNS.volume.test(stderr)) return { ok: true, exists: false };
    return { ok: false, stderr: stderr || `exit ${result.status}` };
}

function pushFailure(failures, { phase, resource, id, project, command, exitStatus = null, stderr = '' }) {
    failures.push({ phase, resource, id, project: project ?? null, command, exitStatus, stderr });
}

// Removes only resources labeled for the canonical/legacy CompDesk Compose
// projects and the exactly resolved volume names from the plan — never a
// substring or prefix match against unrelated volumes. Every Docker command's
// exit status is checked; "already gone" is only accepted when Docker itself
// reports "not found" (or discovery found nothing to remove in the first
// place). A final verification pass re-checks every targeted resource before
// the caller is allowed to treat the reset as successful.
export function executeDockerReset(plan, { run = spawnSync, rmSync = fs.rmSync, existsSync = fs.existsSync, log = () => {} } = {}) {
    const failures = [];
    const removed = { containers: [], networks: [], volumes: [] };

    for (const project of plan.projectNames) {
        const label = `label=com.docker.compose.project=${project}`;

        const containerDiscovery = discoverIds(run, ['ps', '-aq', '--filter', label]);
        if (!containerDiscovery.ok) {
            pushFailure(failures, { phase: 'discovery', resource: 'container', id: null, project, command: `docker ps -aq --filter ${label}`, exitStatus: containerDiscovery.exitStatus, stderr: containerDiscovery.stderr });
        } else if (containerDiscovery.ids.length) {
            log(`Removing ${containerDiscovery.ids.length} container(s) for project "${project}"...`);
            for (const id of containerDiscovery.ids) {
                const result = run('docker', ['rm', '-f', id], { encoding: 'utf8', windowsHide: true });
                const verdict = classifyRemoval(result, 'container');
                if (verdict.ok) removed.containers.push(id);
                else pushFailure(failures, { phase: 'removal', resource: 'container', id, project, command: `docker rm -f ${id}`, exitStatus: verdict.exitStatus, stderr: verdict.stderr });
            }
        }

        const networkDiscovery = discoverIds(run, ['network', 'ls', '-q', '--filter', label]);
        if (!networkDiscovery.ok) {
            pushFailure(failures, { phase: 'discovery', resource: 'network', id: null, project, command: `docker network ls -q --filter ${label}`, exitStatus: networkDiscovery.exitStatus, stderr: networkDiscovery.stderr });
        } else if (networkDiscovery.ids.length) {
            log(`Removing ${networkDiscovery.ids.length} network(s) for project "${project}"...`);
            for (const id of networkDiscovery.ids) {
                const result = run('docker', ['network', 'rm', id], { encoding: 'utf8', windowsHide: true });
                const verdict = classifyRemoval(result, 'network');
                if (verdict.ok) removed.networks.push(id);
                else pushFailure(failures, { phase: 'removal', resource: 'network', id, project, command: `docker network rm ${id}`, exitStatus: verdict.exitStatus, stderr: verdict.stderr });
            }
        }
    }

    for (const volume of plan.volumeNames) {
        log(`Removing volume "${volume}" (if present)...`);
        const result = run('docker', ['volume', 'rm', '-f', volume], { encoding: 'utf8', windowsHide: true });
        const verdict = classifyRemoval(result, 'volume');
        if (verdict.ok) removed.volumes.push(volume);
        else pushFailure(failures, { phase: 'removal', resource: 'volume', id: volume, project: null, command: `docker volume rm -f ${volume}`, exitStatus: verdict.exitStatus, stderr: verdict.stderr });
    }

    for (const project of plan.projectNames) {
        const label = `label=com.docker.compose.project=${project}`;
        const containerVerify = discoverIds(run, ['ps', '-aq', '--filter', label]);
        if (!containerVerify.ok) {
            pushFailure(failures, { phase: 'verification', resource: 'container', id: null, project, command: `docker ps -aq --filter ${label}`, exitStatus: containerVerify.exitStatus, stderr: containerVerify.stderr });
        } else if (containerVerify.ids.length) {
            pushFailure(failures, { phase: 'verification', resource: 'container', id: containerVerify.ids.join(','), project, command: `docker ps -aq --filter ${label}`, stderr: 'still present after removal' });
        }

        const networkVerify = discoverIds(run, ['network', 'ls', '-q', '--filter', label]);
        if (!networkVerify.ok) {
            pushFailure(failures, { phase: 'verification', resource: 'network', id: null, project, command: `docker network ls -q --filter ${label}`, exitStatus: networkVerify.exitStatus, stderr: networkVerify.stderr });
        } else if (networkVerify.ids.length) {
            pushFailure(failures, { phase: 'verification', resource: 'network', id: networkVerify.ids.join(','), project, command: `docker network ls -q --filter ${label}`, stderr: 'still present after removal' });
        }
    }
    for (const volume of plan.volumeNames) {
        const verify = volumeStillExists(run, volume);
        if (!verify.ok) {
            pushFailure(failures, { phase: 'verification', resource: 'volume', id: volume, project: null, command: `docker volume inspect ${volume}`, stderr: verify.stderr });
        } else if (verify.exists) {
            pushFailure(failures, { phase: 'verification', resource: 'volume', id: volume, project: null, command: `docker volume inspect ${volume}`, stderr: 'still present after removal' });
        }
    }

    const dockerCleanupOk = failures.length === 0;
    let configurationRemoved = false;
    if (dockerCleanupOk && plan.stateDirectory && existsSync(plan.stateDirectory)) {
        try {
            rmSync(plan.stateDirectory, { recursive: true, force: true });
            configurationRemoved = true;
            log(`Removed ${plan.stateDirectory}.`);
        } catch (error) {
            // Docker cleanup already succeeded at this point; a filesystem error
            // here (permissions, locking, ownership) must not throw out of a
            // function whose whole contract is "report structured failures".
            pushFailure(failures, {
                phase: 'configuration-removal',
                resource: 'configuration',
                id: plan.stateDirectory,
                command: `remove ${plan.stateDirectory}`,
                stderr: describeFsError(error),
            });
        }
    }

    return { ok: failures.length === 0, failures, removed, configurationRemoved };
}

// Pure formatting so the CLI's success/failure reporting is unit-testable
// without spawning a subprocess or touching Docker: given a result from
// executeDockerReset(), decide the exit code and exactly what gets printed.
// A "Done" message must never be produced when result.ok is false.
export function formatResetOutcome(result, stateDirectory) {
    if (result.ok) {
        return result.configurationRemoved
            ? { exitCode: 0, lines: ['Done. CompDesk containers, networks, volumes, and generated configuration have been removed and verified absent.'] }
            : { exitCode: 0, lines: ['Done. CompDesk containers, networks, and volumes have been removed and verified absent. No generated configuration directory was present to remove.'] };
    }

    // Docker resources can be fully and verifiably gone even when the local
    // .compdesk directory itself failed to delete (permissions, locking,
    // ownership) — that distinction matters enough to word separately rather
    // than folding it into the generic "reset did not complete" report.
    const configurationRemovalOnly = result.failures.length > 0 && result.failures.every((failure) => failure.phase === 'configuration-removal');
    const lines = ['', configurationRemovalOnly
        ? 'Docker cleanup succeeded, but the generated configuration directory could not be deleted:'
        : 'Docker reset did NOT complete successfully. The following could not be confirmed removed:'];
    for (const failure of result.failures) {
        const scope = failure.project ? ` (project "${failure.project}")` : '';
        const exitPart = failure.exitStatus !== null && failure.exitStatus !== undefined ? ` (exit ${failure.exitStatus})` : '';
        const stderrPart = failure.stderr ? ` — ${failure.stderr}` : '';
        lines.push(`  - [${failure.phase}/${failure.resource}] ${failure.id ?? 'n/a'}${scope}: ${failure.command}${exitPart}${stderrPart}`);
    }
    lines.push('');
    if (configurationRemovalOnly) {
        lines.push(
            `Docker containers, networks, and volumes were removed and verified absent, but "${stateDirectory}" remains on disk.`,
            'Resolve the filesystem error above (permissions, locking, or ownership) and remove it manually, or re-run this reset.'
        );
    } else {
        lines.push(
            `Generated configuration in "${stateDirectory}" was NOT removed because Docker cleanup did not fully succeed.`,
            'Resolve the errors above (Docker daemon access, permissions, or leftover resources) and re-run this reset.'
        );
    }
    return { exitCode: 1, lines };
}
