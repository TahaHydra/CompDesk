import assert from 'node:assert/strict';
import test from 'node:test';
import {
    classifyChildExit,
    createTransitionGuard,
    gracefulShutdown,
    productionAccessGuidance,
    isRuntimeConfigValid,
    parseEnvFile,
    parseReceipt,
    reconcileInstallationState,
    reconstructReceiptFromRecord,
    redactSecrets,
    safeErrorMessage,
    startProduction,
    waitForTcp,
} from './orchestrator-core.mjs';

function noWait() {
    return Promise.resolve();
}

test('production startup distinguishes the browser URL from the container listener', () => {
    assert.equal(
        productionAccessGuidance('http://localhost:3100', 3000),
        'Open CompDesk in your browser at http://localhost:3100. Any later Next.js localhost:3000 message is the container-internal listener.'
    );
});

test('waitForTcp resolves as soon as connect succeeds and reports the attempt count', async () => {
    let calls = 0;
    const connect = async () => { calls += 1; if (calls < 3) throw new Error('ECONNREFUSED'); };
    const result = await waitForTcp('db', 5432, { connect, wait: noWait, attempts: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3);
});

test('waitForTcp gives up after the bounded attempt count instead of looping forever', async () => {
    let calls = 0;
    const connect = async () => { calls += 1; throw new Error('ECONNREFUSED'); };
    const result = await waitForTcp('db', 5432, { connect, wait: noWait, attempts: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 5);
    assert.equal(calls, 5);
    assert.match(result.error.message, /ECONNREFUSED/);
});

test('waitForTcp backs off with doubling delays capped at maxDelayMs (no busy-spin)', async () => {
    const delays = [];
    const wait = async (ms) => { delays.push(ms); };
    const connect = async () => { throw new Error('refused'); };
    await waitForTcp('db', 5432, { connect, wait, attempts: 5, initialDelayMs: 100, maxDelayMs: 300 });
    assert.deepEqual(delays, [100, 200, 300, 300]);
});

test('redactSecrets removes every occurrence of each configured secret value', () => {
    const text = 'connection failed: postgresql://user:hunter2pass@db:5432/app and again hunter2pass';
    const output = redactSecrets(text, ['hunter2pass']);
    assert.doesNotMatch(output, /hunter2pass/);
    assert.match(output, /\[redacted\]/);
});

test('redactSecrets ignores trivially short values to avoid over-redacting unrelated text', () => {
    const output = redactSecrets('port 80 is in use', ['80']);
    assert.equal(output, 'port 80 is in use');
});

test('safeErrorMessage redacts secrets and bounds the message length', () => {
    const error = new Error(`connection string was postgresql://u:supersecretpassword@db/app ${'x'.repeat(1000)}`);
    const message = safeErrorMessage(error, ['supersecretpassword'], 50);
    assert.doesNotMatch(message, /supersecretpassword/);
    assert.ok(message.length <= 50);
});

test('parseEnvFile reverses the quoting scheme written by setup-core.mjs renderEnvironment', () => {
    const contents = [
        '# comment',
        '',
        'DATABASE_URL="postgresql://user:pa\\"ss@db:5432/app?schema=public"',
        'AUTH_SECRET="line one\\nline two"',
        'PLAIN=unquoted',
    ].join('\n');
    const parsed = parseEnvFile(contents);
    assert.equal(parsed.DATABASE_URL, 'postgresql://user:pa"ss@db:5432/app?schema=public');
    assert.equal(parsed.AUTH_SECRET, 'line one\nline two');
    assert.equal(parsed.PLAIN, 'unquoted');
});

test('createTransitionGuard allows exactly one transition to begin', () => {
    const guard = createTransitionGuard();
    assert.equal(guard.begin(), true);
    assert.equal(guard.begin(), false);
    assert.equal(guard.begin(), false);
    assert.equal(guard.started, true);
});

test('isRuntimeConfigValid requires DATABASE_URL, AUTH_URL, and AUTH_SECRET', () => {
    assert.equal(isRuntimeConfigValid({ DATABASE_URL: 'postgresql://x', AUTH_URL: 'http://x', AUTH_SECRET: 's' }), true);
    assert.equal(isRuntimeConfigValid({ DATABASE_URL: 'postgresql://x', AUTH_URL: 'http://x' }), false);
    assert.equal(isRuntimeConfigValid({}), false);
});

test('parseReceipt accepts a well-formed receipt and rejects malformed or incomplete ones', () => {
    const good = parseReceipt(JSON.stringify({ installedAt: '2026-01-01T00:00:00.000Z', applicationUrl: 'http://localhost:3000', deploymentMode: 'docker-compose', setupVersion: 1 }));
    assert.equal(good.malformed, false);
    assert.equal(good.parsed.applicationUrl, 'http://localhost:3000');

    assert.equal(parseReceipt('{not json').malformed, true);
    assert.equal(parseReceipt('null').malformed, true);
    assert.equal(parseReceipt(JSON.stringify({ installedAt: 'x' })).malformed, true, 'missing applicationUrl/deploymentMode must be malformed');
    assert.equal(parseReceipt(JSON.stringify({ applicationUrl: 'http://x', deploymentMode: 1 })).malformed, true, 'wrong-typed deploymentMode must be malformed');
});

test('reconstructReceiptFromRecord rebuilds the same non-secret shape install() originally wrote', () => {
    const receipt = reconstructReceiptFromRecord({
        installed_at: new Date('2026-01-01T00:00:00.000Z'),
        application_url: 'http://localhost:3000',
        deployment_mode: 'docker-compose',
        setup_version: 1,
    });
    assert.deepEqual(receipt, {
        installedAt: '2026-01-01T00:00:00.000Z',
        applicationUrl: 'http://localhost:3000',
        deploymentMode: 'docker-compose',
        setupVersion: 1,
    });
});

// The seven reachable states (A-G) from the task's reconciliation matrix.
const reconcileDbRecord = { installed_at: new Date('2026-01-01T00:00:00.000Z'), application_url: 'http://localhost:3000', deployment_mode: 'docker-compose', setup_version: 1 };
const reconcileMatchingReceipt = { malformed: false, parsed: { applicationUrl: 'http://localhost:3000', deploymentMode: 'docker-compose' } };

test('reconcileInstallationState A: no config, no receipt, no db record -> normal setup', () => {
    assert.deepEqual(reconcileInstallationState({ configValid: false, receipt: null, dbRecord: null }), { state: 'UNINSTALLED' });
});

test('reconcileInstallationState B: valid config + receipt + matching db record -> production', () => {
    assert.deepEqual(reconcileInstallationState({ configValid: true, receipt: reconcileMatchingReceipt, dbRecord: reconcileDbRecord }), { state: 'INSTALLED' });
});

test('reconcileInstallationState C: valid config + db record but missing receipt -> automatic recovery', () => {
    const result = reconcileInstallationState({ configValid: true, receipt: null, dbRecord: reconcileDbRecord });
    assert.equal(result.state, 'RECOVER');
    assert.deepEqual(result.receipt, { installedAt: '2026-01-01T00:00:00.000Z', applicationUrl: 'http://localhost:3000', deploymentMode: 'docker-compose', setupVersion: 1 });
});

test('reconcileInstallationState D: receipt exists but runtime config missing/invalid -> fail closed', () => {
    const result = reconcileInstallationState({ configValid: false, receipt: reconcileMatchingReceipt, dbRecord: null });
    assert.equal(result.state, 'FAILED');
    assert.match(result.reason, /runtime configuration is missing or invalid/);
});

test('reconcileInstallationState E: receipt exists but db installation record is missing -> fail closed', () => {
    const result = reconcileInstallationState({ configValid: true, receipt: reconcileMatchingReceipt, dbRecord: null });
    assert.equal(result.state, 'FAILED');
    assert.match(result.reason, /no matching installation record/);
});

test('reconcileInstallationState F: runtime config exists but neither receipt nor db record exist -> setup may resume', () => {
    assert.deepEqual(reconcileInstallationState({ configValid: true, receipt: null, dbRecord: null }), { state: 'UNINSTALLED' });
});

test('reconcileInstallationState G: malformed receipt -> fail closed', () => {
    const result = reconcileInstallationState({ configValid: true, receipt: { malformed: true }, dbRecord: reconcileDbRecord });
    assert.equal(result.state, 'FAILED');
    assert.match(result.reason, /malformed/);
});

test('reconcileInstallationState G: receipt contradicts the db record (application URL) -> fail closed', () => {
    const contradicting = { malformed: false, parsed: { applicationUrl: 'http://evil.example', deploymentMode: 'docker-compose' } };
    const result = reconcileInstallationState({ configValid: true, receipt: contradicting, dbRecord: reconcileDbRecord });
    assert.equal(result.state, 'FAILED');
    assert.match(result.reason, /contradicts/);
});

test('reconcileInstallationState G: receipt contradicts the db record (deployment mode) -> fail closed', () => {
    const contradicting = { malformed: false, parsed: { applicationUrl: 'http://localhost:3000', deploymentMode: 'standalone' } };
    const result = reconcileInstallationState({ configValid: true, receipt: contradicting, dbRecord: reconcileDbRecord });
    assert.equal(result.state, 'FAILED');
    assert.match(result.reason, /contradicts/);
});

test('reconcileInstallationState: receipt present but the database could not be queried -> fail closed (never trust the filesystem alone)', () => {
    const result = reconcileInstallationState({ configValid: true, receipt: reconcileMatchingReceipt, dbRecord: null, dbQueryFailed: true });
    assert.equal(result.state, 'FAILED');
    assert.match(result.reason, /could not be verified/);
});

test('reconcileInstallationState: no receipt and the database could not be queried -> resume setup rather than hard-failing', () => {
    assert.deepEqual(reconcileInstallationState({ configValid: true, receipt: null, dbRecord: null, dbQueryFailed: true }), { state: 'UNINSTALLED' });
});

test('startProduction runs migrate -> attachment migration -> start server in order and reports success', async () => {
    const order = [];
    const result = await startProduction({
        runMigrations: async () => { order.push('migrate'); return { ok: true }; },
        runAttachmentMigration: async () => { order.push('attachments'); return { ok: true }; },
        startServer: async () => { order.push('server'); return { ok: true, code: 0 }; },
    });
    assert.deepEqual(order, ['migrate', 'attachments', 'server']);
    assert.equal(result.ok, true);
    assert.equal(result.stage, 'server');
});

test('startProduction reports a production server crash as a failure at the server stage', async () => {
    const result = await startProduction({
        runMigrations: async () => ({ ok: true }),
        runAttachmentMigration: async () => ({ ok: true }),
        startServer: async () => ({ ok: false, code: 1 }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'server');
    assert.equal(result.detail.code, 1);
});

test('startProduction stops at a migration failure and never starts the attachment migration or server', async () => {
    const order = [];
    const result = await startProduction({
        runMigrations: async () => { order.push('migrate'); return { ok: false, code: 1 }; },
        runAttachmentMigration: async () => { order.push('attachments'); return { ok: true }; },
        startServer: async () => { order.push('server'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'migrate');
    assert.deepEqual(order, ['migrate']);
});

test('startProduction stops at an attachment migration failure and never starts the server', async () => {
    const order = [];
    const result = await startProduction({
        runMigrations: async () => { order.push('migrate'); return { ok: true }; },
        runAttachmentMigration: async () => { order.push('attachments'); return { ok: false, code: 1 }; },
        startServer: async () => { order.push('server'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'attachment-migration');
    assert.deepEqual(order, ['migrate', 'attachments']);
});

test('gracefulShutdown runs every step and reports "graceful" when they finish before the timeout', async () => {
    const order = [];
    const result = await gracefulShutdown({
        steps: [async () => { order.push('a'); }, async () => { order.push('b'); }],
        timeoutMs: 10000,
        wait: async () => new Promise(() => {}), // never resolves: proves the graceful path wins the race
    });
    assert.equal(result.outcome, 'graceful');
    assert.equal(result.timedOut, false);
    assert.deepEqual(order, ['a', 'b']);
});

test('gracefulShutdown reports a timeout when steps hang past the bound instead of blocking forever', async () => {
    const result = await gracefulShutdown({
        steps: [() => new Promise(() => {})], // hangs forever
        timeoutMs: 5,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    assert.equal(result.outcome, 'timeout');
    assert.equal(result.timedOut, true);
});

test('classifyChildExit treats a forwarded-signal exit during shutdown as expected regardless of code', () => {
    const result = classifyChildExit({ code: null, signal: 'SIGTERM', shuttingDown: true });
    assert.equal(result.ok, true);
    assert.equal(result.gracefulStop, true);
});

test('classifyChildExit treats a nonzero exit outside of shutdown as an unprompted crash', () => {
    const result = classifyChildExit({ code: 1, signal: null, shuttingDown: false });
    assert.equal(result.ok, false);
    assert.equal(result.gracefulStop, false);
    assert.equal(result.code, 1);
});

test('classifyChildExit treats a clean zero exit outside of shutdown as success', () => {
    const result = classifyChildExit({ code: 0, signal: null, shuttingDown: false });
    assert.equal(result.ok, true);
});
