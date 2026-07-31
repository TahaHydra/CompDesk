import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
    classifyChildExit,
    createTransitionGuard,
    gracefulShutdown,
    isRuntimeConfigValid,
    parseEnvFile,
    parseReceipt,
    reconcileInstallationState,
    safeErrorMessage,
    startProduction,
    waitForTcp,
} from './orchestrator-core.mjs';
import { writeFileAtomic } from './setup-core.mjs';

const { Client } = pg;

const root = process.cwd();
const configDir = path.resolve(process.env.COMPDESK_CONFIG_DIR || '/config');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const dbHost = process.env.COMPDESK_DB_HOST || 'db';
const dbPort = Number.parseInt(process.env.COMPDESK_DB_PORT || '5432', 10);
const installedPath = path.join(configDir, 'installation.json');
const runtimeEnvPath = path.join(configDir, 'secrets', 'runtime.env');
const shutdownTimeoutMs = Number.parseInt(process.env.COMPDESK_SHUTDOWN_TIMEOUT_MS || '20000', 10);

let activeChild = null;
let activeServer = null;
let shuttingDown = false;
const transitionGuard = createTransitionGuard();

function log(message) {
    console.log(`[orchestrator] ${message}`);
}

function fail(message, exitCode = 1) {
    console.error(`[orchestrator] FAILED: ${redacted(message)}`);
    process.exitCode = exitCode;
    process.exit(exitCode);
}

let knownSecrets = [];
function redacted(message) {
    return safeErrorMessage({ message: String(message) }, knownSecrets);
}

function loadRuntimeEnv() {
    if (!fs.existsSync(runtimeEnvPath)) return {};
    const parsed = parseEnvFile(fs.readFileSync(runtimeEnvPath, 'utf8'));
    knownSecrets = Object.values(parsed).filter((value) => typeof value === 'string' && value.length >= 12);
    return parsed;
}

// Queries the one authoritative signal of a completed installation. Returns
// { ok: false } only for a genuine connection/authentication failure — a
// missing table (schema not migrated yet) is a normal, expected outcome
// during the crash window this reconciliation exists to close, not an error.
async function fetchInstallationRecord(databaseUrl) {
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    try {
        await client.connect();
        const tableCheck = await client.query("SELECT to_regclass('public.installation_records') AS table_name");
        if (!tableCheck.rows[0]?.table_name) return { ok: true, record: null };
        const result = await client.query(
            "SELECT installed_at, application_url, deployment_mode, setup_version FROM installation_records WHERE id = 'primary'"
        );
        return { ok: true, record: result.rows[0] || null };
    } catch (error) {
        return { ok: false, error };
    } finally {
        await client.end().catch(() => {});
    }
}

// Resolves boot state per scripts/orchestrator-core.mjs's reconcileInstallationState
// (states A-G): reads the runtime config and receipt from disk, queries the
// database (only ever called after waitForTcp already confirmed PostgreSQL
// is reachable), and — for the automatic-recovery case — writes the
// reconstructed receipt atomically before returning.
async function reconcile() {
    const runtimeEnv = loadRuntimeEnv();
    const configValid = isRuntimeConfigValid(runtimeEnv);

    let receipt = null;
    if (fs.existsSync(installedPath)) {
        receipt = parseReceipt(fs.readFileSync(installedPath, 'utf8'));
    }

    let dbRecord = null;
    let dbQueryFailed = false;
    if (configValid) {
        const fetched = await fetchInstallationRecord(runtimeEnv.DATABASE_URL);
        if (fetched.ok) dbRecord = fetched.record;
        else dbQueryFailed = true;
    }

    const decision = reconcileInstallationState({ configValid, receipt, dbRecord, dbQueryFailed });
    if (decision.state === 'RECOVER') {
        log('Recovering: a completed installation record was found in the database with no local receipt (a prior crash likely occurred between the database commit and writing the receipt). Reconstructing the receipt automatically.');
        writeFileAtomic(installedPath, `${JSON.stringify(decision.receipt, null, 2)}\n`, { mode: 0o600, backup: false });
    }
    return decision;
}

function spawnStep(command, args, env, { shell = false } = {}) {
    if (activeChild) {
        return Promise.resolve({ ok: false, code: null, signal: null, error: 'A child process is already running.' });
    }
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: root,
            env,
            shell,
            stdio: ['ignore', 'inherit', 'inherit'],
            windowsHide: true,
        });
        activeChild = child;
        child.once('error', (error) => {
            activeChild = null;
            resolve({ ok: false, code: null, signal: null, error: safeErrorMessage(error, knownSecrets) });
        });
        child.once('exit', (code, signal) => {
            activeChild = null;
            resolve(classifyChildExit({ code, signal, shuttingDown }));
        });
    });
}

function prismaBinary() {
    return path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
}

async function runMigrations(env) {
    return spawnStep(prismaBinary(), ['migrate', 'deploy'], env, { shell: process.platform === 'win32' });
}

async function runAttachmentMigration(env) {
    return spawnStep(process.execPath, [path.join(root, 'scripts', 'migrate-private-attachments.mjs')], env);
}

async function validateRuntimeEnvironment(env) {
    return spawnStep(process.execPath, [path.join(root, 'scripts', 'validate-runtime-env.mjs')], env);
}

async function runProductionServer(env) {
    // The Dockerfile copies the Next.js standalone build output's *contents*
    // (COPY .../.next/standalone ./) directly into the image's /app root, so
    // server.js lands at /app/server.js — unlike the non-Docker
    // start-standalone.mjs path (.next/standalone/server.js under the repo
    // root), which is a different, un-flattened layout.
    const serverPath = path.join(root, 'server.js');
    if (!fs.existsSync(serverPath)) {
        return { ok: false, code: null, signal: null, error: 'Standalone server not found at /app/server.js. The image was built without the Next.js standalone output.' };
    }
    return spawnStep(process.execPath, [serverPath], env);
}

async function transitionToProduction() {
    if (!transitionGuard.begin()) {
        log('Ignoring a duplicate production-start trigger.');
        return { ok: true, stage: 'duplicate-ignored' };
    }
    const runtimeEnv = loadRuntimeEnv();
    const env = { ...process.env, ...runtimeEnv, PORT: String(port), HOSTNAME: '0.0.0.0', NODE_ENV: 'production' };
    return startProduction({
        runMigrations: () => runMigrations(env),
        runAttachmentMigration: () => runAttachmentMigration(env),
        startServer: () => runProductionServer(env),
        log,
    });
}

async function runUninstalled() {
    log('No installation receipt found. Starting first-run setup.');
    Object.assign(process.env, {
        COMPDESK_ORCHESTRATOR_MANAGED: 'true',
        COMPDESK_SETUP_STATE_DIR: configDir,
        COMPDESK_ENV_FILE: runtimeEnvPath,
        SETUP_HOST: '0.0.0.0',
        SETUP_ALLOW_REMOTE: 'true',
        SETUP_PORT: String(port),
    });
    const { startSetupServer } = await import('./setup-bootstrap.mjs');

    const installResult = await new Promise((resolve, reject) => {
        const server = startSetupServer({ onInstalled: (result) => resolve(result) });
        activeServer = server;
        server.once('error', (error) => reject(error));
    });

    log('Setup completed. Transitioning to production in place.');
    await new Promise((resolve, reject) => {
        activeServer.close((error) => (error ? reject(error) : resolve()));
    });
    activeServer = null;
    void installResult;

    return transitionToProduction();
}

async function runInstalled() {
    log('Installation receipt found. Validating runtime configuration.');
    const runtimeEnv = loadRuntimeEnv();
    const env = { ...process.env, ...runtimeEnv, PORT: String(port), HOSTNAME: '0.0.0.0', NODE_ENV: 'production' };
    const validation = await validateRuntimeEnvironment(env);
    if (!validation.ok) return { ok: false, stage: 'validate-env', detail: validation };
    return transitionToProduction();
}

async function main() {
    log('CompDesk orchestrator starting.');
    const reachable = await waitForTcp(dbHost, dbPort, {
        attempts: Number.parseInt(process.env.COMPDESK_DB_WAIT_ATTEMPTS || '60', 10),
        initialDelayMs: Number.parseInt(process.env.COMPDESK_DB_WAIT_INITIAL_DELAY_MS || '250', 10),
        maxDelayMs: Number.parseInt(process.env.COMPDESK_DB_WAIT_MAX_DELAY_MS || '5000', 10),
    });
    if (!reachable.ok) {
        return fail(`PostgreSQL at ${dbHost}:${dbPort} was not reachable after ${reachable.attempts} attempts: ${safeErrorMessage(reachable.error)}`);
    }

    const decision = await reconcile();
    if (decision.state === 'FAILED') {
        return fail(`Refusing to start: ${decision.reason}.`);
    }
    const result = decision.state === 'UNINSTALLED' ? await runUninstalled() : await runInstalled();

    if (!result.ok) {
        const detail = result.detail || {};
        const diagnostic = detail.error ? redacted(detail.error) : `exit code ${detail.code}, signal ${detail.signal}`;
        return fail(`Startup failed at stage "${result.stage}" (${diagnostic}).`, typeof detail.code === 'number' && detail.code !== 0 ? detail.code : 1);
    }
    log('Production server exited normally.');
    process.exit(0);
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}. Shutting down gracefully.`);
    const { timedOut } = await gracefulShutdown({
        timeoutMs: shutdownTimeoutMs,
        steps: [
            async () => {
                if (activeChild) {
                    activeChild.kill(signal);
                    await new Promise((resolve) => activeChild?.once('exit', resolve) ?? resolve());
                }
            },
            async () => {
                if (activeServer) {
                    await new Promise((resolve) => activeServer.close(() => resolve()));
                }
            },
        ],
    });
    if (timedOut) {
        log('Graceful shutdown timed out. Forcing exit.');
        if (activeChild) activeChild.kill('SIGKILL');
        process.exit(1);
    }
    process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { shutdown(signal); });
}

process.on('uncaughtException', (error) => fail(`Unhandled error: ${safeErrorMessage(error, knownSecrets)}`));
process.on('unhandledRejection', (reason) => fail(`Unhandled rejection: ${safeErrorMessage(reason instanceof Error ? reason : new Error(String(reason)), knownSecrets)}`));

main();
