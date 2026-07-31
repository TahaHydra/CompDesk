import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVolumeNames } from './docker-project.mjs';
import { verifyLegacyCredentials } from './legacy-credential-verifier.mjs';
import { parseEnvFile } from './orchestrator-core.mjs';

const PROBE_IMAGE = 'alpine:3.22';

function safeStderr(result) {
    if (!result) return '';
    const raw = typeof result.stderr === 'string' ? result.stderr : Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : '';
    return raw.trim().split(/\r?\n/)[0]?.slice(0, 300) || '';
}

// Reads (without modifying) a completed legacy two-stack installation's
// generated configuration. Never touches compdesk_pgdata/uploads/attachments
// or deletes anything under legacyStateDirectory.
export function readLegacyInstallation({ legacyStateDirectory, deps = {} }) {
    const existsSync = deps.existsSync || fs.existsSync;
    const readFileSync = deps.readFileSync || fs.readFileSync;

    const installationPath = path.join(legacyStateDirectory, 'installation.json');
    const envPath = path.join(legacyStateDirectory, 'compdesk.env');
    const caPath = path.join(legacyStateDirectory, 'database-ca.pem');

    if (!existsSync(installationPath)) return { ok: false, reason: 'no-installation-receipt', installationPath };
    if (!existsSync(envPath)) return { ok: false, reason: 'no-env-file', envPath };

    let installation;
    try {
        installation = JSON.parse(readFileSync(installationPath, 'utf8'));
    } catch {
        return { ok: false, reason: 'invalid-installation-receipt', installationPath };
    }
    if (installation.deploymentMode !== 'docker-compose') {
        return { ok: false, reason: 'unsupported-deployment-mode', deploymentMode: installation.deploymentMode };
    }

    const envText = readFileSync(envPath, 'utf8');
    const env = parseEnvFile(envText);
    if (!env.POSTGRES_USER || !env.POSTGRES_PASSWORD || !env.POSTGRES_DB) {
        return { ok: false, reason: 'missing-postgres-credentials' };
    }

    return {
        ok: true,
        installation,
        envText,
        postgresUser: env.POSTGRES_USER,
        postgresPassword: env.POSTGRES_PASSWORD,
        postgresDb: env.POSTGRES_DB,
        caText: existsSync(caPath) ? readFileSync(caPath, 'utf8') : null,
    };
}

// Fails closed (refuses to import) whenever the target volume already holds
// an installation receipt or a secret pair, exactly mirroring the
// "never silently overwrite" posture of scripts/config-store.mjs.
export function inspectConfigVolume(volumeName, { run = spawnSync } = {}) {
    const probe = run(
        'docker',
        ['run', '--rm', '-v', `${volumeName}:/config`, PROBE_IMAGE, 'sh', '-c', 'test -f /config/installation.json -o -f /config/secrets/postgres_password'],
        { encoding: 'utf8', windowsHide: true },
    );
    if (!probe || probe.error) return { state: 'inspection-error', detail: probe?.error?.message || 'unknown spawn failure' };
    if (probe.status === 0) return { state: 'populated' };
    if (probe.status === 1) return { state: 'empty' };
    return { state: 'inspection-error', detail: safeStderr(probe) || `probe exited ${probe.status}` };
}

function planFiles(read) {
    const files = {
        'installation.json': `${JSON.stringify(read.installation, null, 2)}\n`,
        'secrets/runtime.env': read.envText,
        'secrets/postgres_identity.json': `${JSON.stringify({ user: read.postgresUser, db: read.postgresDb }, null, 2)}\n`,
        // The legacy compdesk.env already contains the exact password that
        // initialized the existing pgdata volume; reuse it unchanged so
        // config-init's fail-closed check (matching secret <-> initialized
        // pgdata) recognizes it instead of a value that had to be re-derived.
        'secrets/postgres_password': read.postgresPassword,
    };
    if (read.caText) files['secrets/database-ca.pem'] = read.caText;
    return files;
}

// Writes the prepared files into the (possibly not-yet-created) named volume
// via a short-lived helper container — the same "docker run with two mounts"
// pattern already used for volume permission fixups elsewhere in this repo.
// Files are staged on a temporary host directory (never passed as command-
// line arguments, so secrets never appear in `docker inspect`/process lists).
export function writeFilesToVolume(volumeName, files, deps = {}) {
    const run = deps.run || spawnSync;
    const mkdtempSync = deps.mkdtempSync || fs.mkdtempSync;
    const mkdirSync = deps.mkdirSync || fs.mkdirSync;
    const writeFileSync = deps.writeFileSync || fs.writeFileSync;
    const rmSync = deps.rmSync || fs.rmSync;

    const stagingDirectory = mkdtempSync(path.join(os.tmpdir(), 'compdesk-import-'));
    try {
        for (const [relativePath, contents] of Object.entries(files)) {
            const target = path.join(stagingDirectory, relativePath);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, contents, { mode: 0o600 });
        }
        const result = run(
            'docker',
            [
                'run', '--rm',
                '-v', `${stagingDirectory}:/import:ro`,
                '-v', `${volumeName}:/config`,
                PROBE_IMAGE,
                'sh', '-c',
                'mkdir -p /config/secrets && cp -a /import/. /config/ && find /config -type d -exec chmod 700 {} + && find /config -type f -exec chmod 600 {} + && chown -R 1001:1001 /config',
            ],
            { encoding: 'utf8', windowsHide: true },
        );
        if (!result || result.error) return { ok: false, detail: result?.error?.message || 'unknown spawn failure' };
        if (result.status !== 0) return { ok: false, detail: safeStderr(result) || `exit ${result.status}` };
        return { ok: true };
    } finally {
        rmSync(stagingDirectory, { recursive: true, force: true });
    }
}

// Top-level, side-effecting orchestration. Every step is independently
// unit-testable above; this just sequences them and never mutates
// legacyStateDirectory or the data volumes. Nothing is ever written into
// compdesk_config until scripts/legacy-credential-verifier.mjs has proven —
// against the exact selected pgdata volume, using a fully isolated temporary
// PostgreSQL container — that the imported username/password/database
// actually authenticate. A verification failure leaves configVolumeName
// exactly as it was found.
export async function performImport({ legacyStateDirectory, configVolumeName, pgdataVolumeName, deps = {} }) {
    const read = readLegacyInstallation({ legacyStateDirectory, deps });
    if (!read.ok) return read;

    const inspection = inspectConfigVolume(configVolumeName, deps);
    if (inspection.state === 'populated') {
        return { ok: false, reason: 'config-already-populated', configVolumeName };
    }
    if (inspection.state === 'inspection-error') {
        return { ok: false, reason: 'config-inspection-failed', configVolumeName, detail: inspection.detail };
    }

    const verification = await verifyLegacyCredentials({
        pgdataVolumeName,
        postgresUser: read.postgresUser,
        postgresPassword: read.postgresPassword,
        postgresDb: read.postgresDb,
    }, deps);
    if (!verification.ok) {
        return { ok: false, reason: `credential-${verification.reason}`, configVolumeName, pgdataVolumeName, detail: verification.detail };
    }

    const files = planFiles(read);
    const write = writeFilesToVolume(configVolumeName, files, deps);
    if (!write.ok) return { ok: false, reason: 'write-failed', configVolumeName, detail: write.detail };

    return {
        ok: true,
        configVolumeName,
        postgresUser: read.postgresUser,
        postgresDb: read.postgresDb,
        applicationUrl: read.installation.applicationUrl,
    };
}

const isMain = (() => {
    try {
        return fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '');
    } catch {
        return false;
    }
})();

if (isMain) {
    const root = process.cwd();
    const legacyStateDirectory = path.resolve(process.argv[2] || path.join(root, '.compdesk'));
    const volumes = resolveVolumeNames(process.env);
    const configVolumeName = volumes.config;
    const pgdataVolumeName = volumes.pgdata;

    console.log(`Importing legacy installation from ${legacyStateDirectory} into Docker volume "${configVolumeName}"...`);
    console.log(`Verifying the imported credentials against Docker volume "${pgdataVolumeName}" using an isolated temporary PostgreSQL container...`);
    const result = await performImport({ legacyStateDirectory, configVolumeName, pgdataVolumeName });

    if (!result.ok) {
        const messages = {
            'no-installation-receipt': `No completed installation found at ${result.installationPath}. Only a finished legacy installation can be imported.`,
            'no-env-file': `Expected the legacy generated environment file at ${result.envPath}, but it is missing.`,
            'invalid-installation-receipt': 'The legacy installation.json could not be parsed.',
            'unsupported-deployment-mode': `This tool only imports the "docker-compose" deployment mode (found "${result.deploymentMode}"). Standalone and external-database installations do not use a bundled PostgreSQL volume and do not need this import.`,
            'missing-postgres-credentials': 'The legacy compdesk.env is missing POSTGRES_USER, POSTGRES_PASSWORD, or POSTGRES_DB.',
            'config-already-populated': `Refusing to overwrite: Docker volume "${result.configVolumeName}" already contains an installation receipt or secrets. Nothing was changed. If this is a fresh environment, remove that volume first (only if it holds no data you need).`,
            'config-inspection-failed': `Could not determine whether Docker volume "${result.configVolumeName}" is already populated: ${result.detail}. Check that Docker is running and reachable, then retry.`,
            'credential-docker-unavailable': `Could not verify the imported credentials because Docker is unavailable: ${result.detail}. Nothing was written to "${result.configVolumeName}".`,
            'credential-volume-in-use': `Refusing to verify: ${result.detail} Nothing was written to "${result.configVolumeName}".`,
            'credential-verifier-startup-failed': `The isolated verification PostgreSQL container could not be started: ${result.detail} Nothing was written to "${result.configVolumeName}".`,
            'credential-authentication-failed': `The imported PostgreSQL username, password, or database name were rejected by the existing "${result.pgdataVolumeName}" volume. Double-check the legacy .compdesk/compdesk.env. Nothing was written to "${result.configVolumeName}".`,
            'credential-identity-mismatch': `The imported credentials authenticated, but the server did not confirm the expected username/database. Nothing was written to "${result.configVolumeName}".`,
            'write-failed': `Failed to write imported configuration into Docker volume "${result.configVolumeName}": ${result.detail}`,
        };
        console.error(messages[result.reason] || `Import failed: ${result.reason}`);
        process.exit(1);
    }

    console.log(`Verified: the imported credentials authenticate against "${pgdataVolumeName}" as expected.`);
    console.log(`Imported existing PostgreSQL role "${result.postgresUser}" and database "${result.postgresDb}" into "${result.configVolumeName}" without printing secret values.`);
    console.log('');
    console.log(`The original ${legacyStateDirectory} directory was left untouched, as were the compdesk_pgdata, compdesk_uploads, and compdesk_attachments volumes.`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Start the unified stack:  docker compose up -d');
    console.log(`  2. Confirm it reaches production at: ${result.applicationUrl}/auth/signin`);
    console.log('  3. Once verified healthy, the old .compdesk directory and docker-compose.setup.yml/docker-compose.legacy.yml may be archived.');
    console.log('');
    console.log('Rollback (only if something is wrong with the unified stack):');
    console.log('  docker compose down                                                             # no -v — keep the data volumes');
    console.log(`  docker compose --env-file ${path.join(legacyStateDirectory, 'compdesk.env')} -f docker-compose.legacy.yml up -d`);
    process.exit(0);
}
