import net from 'node:net';

// Pure/DI-able primitives for the Docker orchestrator. Nothing in this file
// touches a real socket, spawns a real process, or calls process.exit() —
// scripts/orchestrator.mjs wires these to Node's real APIs. Keeping the
// decision logic here (rather than inline in the entrypoint) is what makes
// the state machine unit-testable via dependency injection.

export function delay(ms, { setTimeoutFn = setTimeout } = {}) {
    return new Promise((resolve) => setTimeoutFn(resolve, ms));
}

function defaultConnect(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(Object.assign(new Error('TCP connection timed out'), { code: 'ETIMEDOUT' }));
        }, timeoutMs);
        socket.once('connect', () => {
            clearTimeout(timeout);
            socket.end();
            resolve();
        });
        socket.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

// Bounded exponential backoff — never a busy-spin loop, never unbounded.
export async function waitForTcp(host, port, {
    attempts = 40,
    initialDelayMs = 250,
    maxDelayMs = 5000,
    connectTimeoutMs = 3000,
    connect = defaultConnect,
    wait = delay,
} = {}) {
    let currentDelay = initialDelayMs;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await connect(host, port, connectTimeoutMs);
            return { ok: true, attempts: attempt };
        } catch (error) {
            lastError = error;
            if (attempt === attempts) break;
            await wait(currentDelay);
            currentDelay = Math.min(currentDelay * 2, maxDelayMs);
        }
    }
    return { ok: false, attempts, error: lastError };
}

const SECRET_MIN_LENGTH = 6;

export function redactSecrets(text, secretValues = []) {
    let output = String(text ?? '');
    for (const secret of secretValues) {
        const value = String(secret ?? '');
        if (value.length < SECRET_MIN_LENGTH) continue;
        output = output.split(value).join('[redacted]');
    }
    return output;
}

export function safeErrorMessage(error, secretValues = [], maxLength = 500) {
    const message = error?.message ? String(error.message) : String(error ?? 'Unknown error');
    return redactSecrets(message, secretValues).slice(0, maxLength);
}

export function parseEnvFile(contents) {
    const result = {};
    for (const rawLine of String(contents).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator === -1) continue;
        const key = line.slice(0, separator);
        const rawValue = line.slice(separator + 1);
        result[key] = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue;
    }
    return result;
}

export function productionAccessGuidance(applicationUrl, internalPort) {
    return `Open CompDesk in your browser at ${applicationUrl}. Any later Next.js localhost:${internalPort} message is the container-internal listener.`;
}

// Prevents two production-start sequences from ever running concurrently in
// the same process (e.g. a duplicate install callback racing a retry).
export function createTransitionGuard() {
    let started = false;
    return {
        begin() {
            if (started) return false;
            started = true;
            return true;
        },
        get started() {
            return started;
        },
    };
}

// Runs migrate -> attachment migration -> start-server in sequence, stopping
// (and reporting exactly which stage) at the first failure. Every step is
// injected so this is testable without spawning anything real. startServer()
// is expected to resolve only once the production server process itself has
// exited (gracefully stopped or crashed) — its {ok, code} result becomes the
// final outcome of the whole sequence.
export async function startProduction({
    runMigrations,
    runAttachmentMigration,
    startServer,
    log = () => {},
}) {
    log('Running database migrations.');
    const migration = await runMigrations();
    if (!migration.ok) return { ok: false, stage: 'migrate', detail: migration };

    log('Running private attachment storage migration.');
    const attachments = await runAttachmentMigration();
    if (!attachments.ok) return { ok: false, stage: 'attachment-migration', detail: attachments };

    log('Starting the production server.');
    const server = await startServer();
    if (!server.ok) return { ok: false, stage: 'server', detail: server };
    return { ok: true, stage: 'server', detail: server };
}

// Classifies a spawned child's exit for every step the orchestrator runs.
// When a shutdown was already in progress (SIGTERM/SIGINT forwarded to this
// exact child), the exit is always treated as expected regardless of the
// raw code/signal — that is the difference between an operator-requested
// stop and an unprompted crash.
export function classifyChildExit({ code, signal, shuttingDown }) {
    if (shuttingDown) return { ok: true, code, signal, gracefulStop: true };
    return { ok: code === 0, code, signal, gracefulStop: false };
}

// Bounded graceful shutdown: races the graceful path against a timeout so a
// hung child/server can never block process exit indefinitely.
export async function gracefulShutdown({ steps = [], timeoutMs = 10000, wait = delay }) {
    const timeout = wait(timeoutMs).then(() => 'timeout');
    const graceful = (async () => {
        for (const step of steps) {
            await step();
        }
        return 'graceful';
    })();
    const outcome = await Promise.race([graceful, timeout]);
    return { outcome, timedOut: outcome === 'timeout' };
}

// A committed database installation_records row is the only authoritative
// signal that setup actually finished — the filesystem receipt is a cache of
// that fact, written last, purely for fast boot without a DB round trip. If
// the process crashes between the DB COMMIT and the receipt write, the
// receipt is missing even though installation genuinely completed. Treating
// "no receipt" as "not installed" in that window would strand the deployment:
// the database refuses to let setup run again (already installed), but the
// container keeps offering setup because the file is gone. reconcile()
// resolves every combination of {config, receipt, database record} into
// exactly one safe next action instead of trusting the filesystem alone.
export const REQUIRED_RUNTIME_CONFIG_KEYS = ['DATABASE_URL', 'AUTH_URL', 'AUTH_SECRET'];

export function isRuntimeConfigValid(env) {
    return REQUIRED_RUNTIME_CONFIG_KEYS.every((key) => Boolean(env?.[key]));
}

export function parseReceipt(text) {
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.applicationUrl !== 'string' || typeof parsed.deploymentMode !== 'string') {
            return { malformed: true };
        }
        return { malformed: false, parsed };
    } catch {
        return { malformed: true };
    }
}

// The installation_records row (snake_case, as returned by `pg`) is the
// authoritative source; this rebuilds the exact same shape setup-core.mjs's
// install() originally wrote to installation.json. No secrets are involved —
// this table has never stored anything but non-secret installation metadata.
export function reconstructReceiptFromRecord(dbRecord) {
    const installedAt = dbRecord.installed_at instanceof Date ? dbRecord.installed_at.toISOString() : String(dbRecord.installed_at);
    return {
        installedAt,
        applicationUrl: dbRecord.application_url,
        deploymentMode: dbRecord.deployment_mode,
        setupVersion: dbRecord.setup_version,
    };
}

// Resolves the seven reachable combinations of {runtime config, filesystem
// receipt, database installation record} into exactly one safe next state.
// Pure decision logic — scripts/orchestrator.mjs does the actual file reads
// and database query, then calls this.
export function reconcileInstallationState({ configValid, receipt, dbRecord, dbQueryFailed = false }) {
    if (!configValid) {
        // D: a receipt with no usable runtime configuration is unrecoverable
        // by the orchestrator itself (it has nothing to connect with).
        if (receipt) return { state: 'FAILED', reason: 'an installation receipt exists but the runtime configuration is missing or invalid' };
        return { state: 'UNINSTALLED' }; // A
    }
    if (receipt && receipt.malformed) {
        return { state: 'FAILED', reason: 'the installation receipt is malformed' }; // G
    }
    if (receipt && dbQueryFailed) {
        // Never trust the filesystem receipt alone: if the database can't
        // confirm it, refuse rather than assume it is still correct.
        return { state: 'FAILED', reason: 'the installation receipt could not be verified against the database' };
    }
    if (receipt && !dbRecord) {
        return { state: 'FAILED', reason: 'the installation receipt exists but no matching installation record was found in the database' }; // E
    }
    if (receipt && dbRecord) {
        if (receipt.parsed.applicationUrl !== dbRecord.application_url || receipt.parsed.deploymentMode !== dbRecord.deployment_mode) {
            return { state: 'FAILED', reason: 'the installation receipt contradicts the database installation record' }; // G
        }
        return { state: 'INSTALLED' }; // B
    }
    if (!receipt && dbRecord) {
        return { state: 'RECOVER', receipt: reconstructReceiptFromRecord(dbRecord) }; // C
    }
    return { state: 'UNINSTALLED' }; // F: config exists, but setup never reached the database commit
}
