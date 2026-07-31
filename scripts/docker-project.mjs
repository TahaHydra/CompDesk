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
};
const PGDATA_PROBE_IMAGE = 'alpine:3.22';

export function resolveVolumeNames(env = process.env) {
    return {
        pgdata: env.POSTGRES_VOLUME_NAME || DEFAULT_VOLUME_NAMES.pgdata,
        uploads: env.UPLOADS_VOLUME_NAME || DEFAULT_VOLUME_NAMES.uploads,
        attachments: env.ATTACHMENTS_VOLUME_NAME || DEFAULT_VOLUME_NAMES.attachments,
    };
}

// A Docker volume can only be labeled with the project that first created it.
// If a prior run initialized PostgreSQL under this volume, minting a new random
// role here would leave PostgreSQL holding a role that no longer matches.
export function isPgdataVolumeInitialized(volumeName, { run = spawnSync } = {}) {
    const inspect = run('docker', ['volume', 'inspect', volumeName], { stdio: 'ignore', windowsHide: true });
    if (!inspect || inspect.error || inspect.status !== 0) return false;
    const probe = run(
        'docker',
        ['run', '--rm', '-v', `${volumeName}:/pgdata:ro`, PGDATA_PROBE_IMAGE, 'test', '-f', '/pgdata/PG_VERSION'],
        { stdio: 'ignore', windowsHide: true }
    );
    return Boolean(probe && !probe.error && probe.status === 0);
}

export function prepareDockerBootstrap({ stateDirectory, rotateIncomplete = false, volumeName, env = process.env, deps = {} }) {
    const checkInitialized = deps.isPgdataVolumeInitialized || isPgdataVolumeInitialized;
    const bootstrapPath = path.join(stateDirectory, 'docker-bootstrap.env');
    const installedPath = path.join(stateDirectory, 'installation.json');
    const resolvedVolumeName = volumeName || resolveVolumeNames(env).pgdata;

    if (fs.existsSync(installedPath)) {
        return { action: 'already-installed', ok: false, bootstrapPath };
    }
    if (fs.existsSync(bootstrapPath) && !rotateIncomplete) {
        return { action: 'preserved', ok: true, bootstrapPath };
    }
    if (checkInitialized(resolvedVolumeName, deps)) {
        return { action: 'refused-initialized-volume', ok: false, bootstrapPath, volumeName: resolvedVolumeName };
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
    return { action: 'generated', ok: true, bootstrapPath };
}

export function planDockerReset({ env = process.env, stateDirectory }) {
    const volumes = resolveVolumeNames(env);
    const volumeNames = [volumes.pgdata, volumes.uploads, volumes.attachments];
    const projectNames = [CANONICAL_COMPOSE_PROJECT_NAME, ...LEGACY_COMPOSE_PROJECT_NAMES];
    const warning = [
        'This will permanently delete CompDesk Docker resources:',
        `  - PostgreSQL database volume: ${volumes.pgdata}`,
        `  - Uploads volume: ${volumes.uploads}`,
        `  - Attachments volume: ${volumes.attachments}`,
        `  - Generated configuration directory: ${stateDirectory}`,
        `  - Containers and networks for project(s): ${projectNames.join(', ')}`,
        '',
        'All tickets, attachments, uploads, and installation state will be lost. This cannot be undone.',
    ].join('\n');
    return { projectNames, volumeNames, stateDirectory, warning };
}

function listIds(run, filterArgs) {
    const result = run('docker', filterArgs, { encoding: 'utf8', windowsHide: true });
    if (!result || result.error || result.status !== 0 || !result.stdout) return [];
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function executeDockerReset(plan, { run = spawnSync, rmSync = fs.rmSync, existsSync = fs.existsSync, log = () => {} } = {}) {
    for (const project of plan.projectNames) {
        const label = `label=com.docker.compose.project=${project}`;
        const containers = listIds(run, ['ps', '-aq', '--filter', label]);
        if (containers.length) {
            log(`Removing ${containers.length} container(s) for project "${project}"...`);
            run('docker', ['rm', '-f', ...containers], { stdio: 'ignore', windowsHide: true });
        }
        const networks = listIds(run, ['network', 'ls', '-q', '--filter', label]);
        if (networks.length) {
            log(`Removing ${networks.length} network(s) for project "${project}"...`);
            run('docker', ['network', 'rm', ...networks], { stdio: 'ignore', windowsHide: true });
        }
    }
    for (const volume of plan.volumeNames) {
        log(`Removing volume "${volume}" (if present)...`);
        run('docker', ['volume', 'rm', '-f', volume], { stdio: 'ignore', windowsHide: true });
    }
    if (plan.stateDirectory && existsSync(plan.stateDirectory)) {
        rmSync(plan.stateDirectory, { recursive: true, force: true });
        log(`Removed ${plan.stateDirectory}.`);
    }
}
