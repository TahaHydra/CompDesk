import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import pg from 'pg';
import {
    SESSION_COOKIE,
    SESSION_TTL_MS,
    TOKEN_TTL_MS,
    buildDatabaseUrl,
    databaseCaPath,
    deploymentNextSteps,
    encryptEnvelope,
    isSameOrigin,
    isStrongPassword,
    normalizeEmail,
    parseCookies,
    randomSecret,
    redactDatabaseInput,
    renderEnvironment,
    sanitizeSetupError,
    saveNonSecretState,
    timingSafeEqual,
    validateDatabaseInput,
    validatePublicUrl,
    writeFileAtomic,
} from './setup-core.mjs';
import { readPostgresIdentity, readPostgresPassword } from './config-store.mjs';

const { Client } = pg;
const execFileAsync = promisify(execFile);
const root = process.cwd();
const stateDirectory = path.resolve(process.env.COMPDESK_SETUP_STATE_DIR || path.join(root, '.compdesk'));
const statePath = path.join(stateDirectory, 'setup-state.json');
const receiptPath = path.join(stateDirectory, 'installation.json');
const uiPath = path.join(root, 'scripts', 'setup-ui.html');
const installedUiPath = path.join(root, 'scripts', 'setup-installed.html');
const envPath = path.resolve(process.env.COMPDESK_ENV_FILE || path.join(root, '.env'));
const host = process.env.SETUP_ALLOW_REMOTE === 'true' ? (process.env.SETUP_HOST || '0.0.0.0') : '127.0.0.1';
const port = Number.parseInt(process.env.SETUP_PORT || '3000', 10);
const trustProxy = process.env.SETUP_TRUST_PROXY === 'true';

function normalizePublicOrigin(value) {
    if (!value) return null;
    let parsed;
    try {
        parsed = new URL(String(value).trim());
    } catch {
        throw new Error('SETUP_PUBLIC_ORIGIN must be a valid absolute HTTP or HTTPS origin.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error('SETUP_PUBLIC_ORIGIN must contain only an HTTP or HTTPS origin, without credentials, path, query, or fragment.');
    }
    return parsed.origin;
}

const explicitSetupOrigin = normalizePublicOrigin(process.env.SETUP_PUBLIC_ORIGIN);

function firstForwardedValue(value) {
    return String(value || '').split(',')[0].trim();
}

function originFromRequest(request) {
    if (explicitSetupOrigin) return explicitSetupOrigin;

    const forwardedHost = trustProxy ? firstForwardedValue(request.headers['x-forwarded-host']) : '';
    const forwardedProto = trustProxy ? firstForwardedValue(request.headers['x-forwarded-proto']) : '';
    const authority = forwardedHost || String(request.headers.host || '').trim();
    const protocol = forwardedProto || (request.socket.encrypted ? 'https' : 'http');

    if (!authority || /[\r\n\s/@]/.test(authority) || !['http', 'https'].includes(protocol)) {
        return null;
    }
    try {
        const parsed = new URL(`${protocol}://${authority}`);
        if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || !parsed.hostname) return null;
        return parsed.origin;
    } catch {
        return null;
    }
}

function requestHasExpectedOrigin(request, expectedOrigin) {
    return Boolean(expectedOrigin) && isSameOrigin(request, expectedOrigin);
}
const bootstrapToken = randomSecret(32);
const bootstrapExpiresAt = Date.now() + TOKEN_TTL_MS;
const sessions = new Map();
const attempts = new Map();
let installRunning = false;
let onInstalled = null;

function json(response, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        ...headers,
    });
    response.end(body);
}

function html(response, body, status = 200, csp = "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'") {
    response.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': csp,
    });
    response.end(body);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function renderInstalledPage() {
    let receipt = null;
    try {
        receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    } catch { /* render generic guidance below when the receipt cannot be read */ }
    const template = fs.readFileSync(installedUiPath, 'utf8');
    const deployment = receipt?.applicationUrl
        ? deploymentNextSteps({ deploymentMode: receipt.deploymentMode, applicationUrl: receipt.applicationUrl, orchestratorManaged: process.env.COMPDESK_ORCHESTRATOR_MANAGED === 'true' })
        : null;
    const steps = deployment
        ? deployment.commands.map((step) => `<li>${escapeHtml(step.description)}<pre><code>${escapeHtml(step.command)}</code></pre></li>`).join('')
        : '<li>Start the application you configured during installation.</li>';
    return template
        .replace('{{SUMMARY}}', escapeHtml(deployment?.summary || 'CompDesk is installed and this setup server is permanently disabled.'))
        .replace('{{INSTALLED_AT}}', escapeHtml(receipt?.installedAt || 'an earlier session'))
        .replace('{{APPLICATION_URL}}', escapeHtml(receipt?.applicationUrl || 'the configured application URL'))
        .replace('{{STEPS}}', steps)
        .replace('{{LOGIN_URL}}', escapeHtml(deployment?.loginUrl || ''));
}

async function readBody(request, limit = 128 * 1024) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
        size += chunk.length;
        if (size > limit) {
            request.destroy();
            throw Object.assign(new Error('Setup request is too large.'), { statusCode: 413 });
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
        throw Object.assign(new Error('Setup request must contain valid JSON.'), { statusCode: 400 });
    }
}

function sourceIp(request) {
    return request.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
    const now = Date.now();
    const current = (attempts.get(ip) || []).filter((time) => now - time < 15 * 60 * 1000);
    if (current.length >= 5) return true;
    current.push(now);
    attempts.set(ip, current);
    return false;
}

function getSession(request) {
    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const session = id ? sessions.get(id) : null;
    if (!session || session.expiresAt < Date.now()) {
        if (id) sessions.delete(id);
        return null;
    }
    return { id, ...session };
}

function requireMutation(request, response) {
    const session = getSession(request);
    if (!session) {
        json(response, 401, { error: 'The setup session is missing or expired.' });
        return null;
    }
    const currentOrigin = originFromRequest(request);
    if (currentOrigin !== session.origin || !requestHasExpectedOrigin(request, session.origin) || !timingSafeEqual(request.headers['x-csrf-token'] || '', session.csrfToken)) {
        json(response, 403, { error: 'Setup request origin or CSRF validation failed.' });
        return null;
    }
    return session;
}

function safeReadState() {
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

async function commandVersion(command, args = ['--version']) {
    try {
        const { stdout, stderr } = await execFileAsync(command, args, { timeout: 4000, windowsHide: true });
        return { ok: true, value: `${stdout || stderr}`.trim().split(/\r?\n/, 1)[0] };
    } catch {
        return { ok: false, message: 'Not detected' };
    }
}

async function getSystemChecks() {
    const directoryWritable = (() => {
        try {
            fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
            fs.accessSync(stateDirectory, fs.constants.R_OK | fs.constants.W_OK);
            return true;
        } catch {
            return false;
        }
    })();
    const disk = (() => {
        try {
            const stats = fs.statfsSync(root);
            return `${Math.round((Number(stats.bavail) * Number(stats.bsize)) / 1024 / 1024 / 1024)} GB free`;
        } catch {
            return 'Unavailable';
        }
    })();
    const [npm, docker, compose, psql, openssl, clamav] = await Promise.all([
        commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm'),
        commandVersion('docker'),
        commandVersion('docker', ['compose', 'version']),
        commandVersion('psql'),
        commandVersion('openssl'),
        commandVersion('clamscan'),
    ]);
    return {
        checks: {
            operatingSystem: { ok: true, value: `${os.type()} ${os.release()}` },
            architecture: { ok: true, value: os.arch() },
            node: { ok: Number(process.versions.node.split('.')[0]) >= 22, value: process.version },
            npm,
            diskSpace: { ok: disk !== 'Unavailable', value: disk },
            applicationDirectory: { ok: directoryWritable, value: directoryWritable ? 'Writable' : 'Not writable' },
            setupListener: { ok: true, value: `${host}:${port}` },
            docker,
            dockerCompose: compose,
            postgresqlClient: psql,
            openssl,
            clamav: { ...clamav, optional: true },
            reverseProxy: { ok: true, value: process.env.HTTP_PROXY || process.env.HTTPS_PROXY ? 'Proxy environment detected; review trust settings.' : 'No proxy environment detected.' },
            installation: { ok: !fs.existsSync(receiptPath), value: fs.existsSync(receiptPath) ? 'Completed' : safeReadState() ? 'Incomplete setup can be resumed' : 'Fresh setup' },
        },
        guidance: process.platform === 'win32'
            ? ['Windows: winget install OpenJS.NodeJS.LTS', 'Windows: winget install PostgreSQL.PostgreSQL', 'Docker Desktop: winget install Docker.DockerDesktop']
            : process.platform === 'darwin'
                ? ['macOS: brew install node postgresql@16', 'Optional scanner: brew install clamav', 'Docker Desktop: brew install --cask docker']
                : ['Ubuntu/Debian: sudo apt update && sudo apt install -y postgresql-client openssl', 'Docker: follow https://docs.docker.com/engine/install/', 'Optional scanner: sudo apt install -y clamav-daemon'],
    };
}

function pgConfiguration(database) {
    const config = {
        connectionString: buildDatabaseUrl(database),
        connectionTimeoutMillis: 7000,
        query_timeout: 10000,
        statement_timeout: 10000,
        application_name: 'compdesk-setup',
    };
    if (database.sslMode === 'verify-ca' || database.sslMode === 'verify-full') {
        config.ssl = { rejectUnauthorized: true, ...(database.ca ? { ca: database.ca } : {}) };
    }
    return config;
}

async function testDatabase(database) {
    const errors = validateDatabaseInput(database);
    if (Object.keys(errors).length) {
        const error = new Error(Object.values(errors)[0]);
        error.statusCode = 400;
        throw error;
    }
    const correlationId = crypto.randomUUID();
    try {
        await dns.lookup(database.host);
        await new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: database.host, port: database.port });
            const timeout = setTimeout(() => socket.destroy(Object.assign(new Error('TCP timeout'), { code: 'ETIMEDOUT' })), 5000);
            socket.once('connect', () => { clearTimeout(timeout); socket.end(); resolve(); });
            socket.once('error', (error) => { clearTimeout(timeout); reject(error); });
        });
        const client = new Client(pgConfiguration(database));
        await client.connect();
        try {
            await client.query('SELECT current_database(), current_user, version()');
            // PostgreSQL identifiers are limited to 63 bytes. Keep the generated
            // table and index names short enough to remain distinct after parsing.
            const permissionSuffix = crypto.randomBytes(8).toString('hex');
            const permissionTable = `compdesk_setup_probe_${permissionSuffix}`;
            const permissionIndex = `compdesk_setup_probe_idx_${permissionSuffix}`;
            await client.query('BEGIN');
            try {
                await client.query(`CREATE TABLE public."${permissionTable}" (id integer PRIMARY KEY)`);
                await client.query(`CREATE INDEX "${permissionIndex}" ON public."${permissionTable}" (id)`);
                await client.query(`ALTER TABLE public."${permissionTable}" ADD COLUMN migration_probe text`);
                await client.query(`DROP TABLE public."${permissionTable}"`);
            } finally {
                await client.query('ROLLBACK');
            }
        } finally {
            await client.end();
        }
        return { success: true, correlationId, message: 'PostgreSQL DNS, TCP, authentication, database access, and target-schema migration permissions succeeded.', database: redactDatabaseInput(database) };
    } catch (error) {
        const safe = sanitizeSetupError(error);
        console.error(JSON.stringify({ level: 'error', message: 'Setup PostgreSQL diagnostic failed', correlationId, stage: safe.stage }));
        const diagnostic = new Error(`${safe.message} Correlation ID: ${correlationId}`);
        diagnostic.statusCode = 400;
        throw diagnostic;
    }
}

async function diagnoseEntra(authentication, applicationUrl) {
    if (!authentication.microsoftEnabled) return;
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!guid.test(authentication.tenantId) || !guid.test(authentication.clientId) || !authentication.clientSecret) {
        throw Object.assign(new Error('Microsoft Entra tenant ID, client ID, and client secret are required; both IDs must be GUIDs.'), { statusCode: 400 });
    }
    const metadataUrl = `https://login.microsoftonline.com/${encodeURIComponent(authentication.tenantId)}/v2.0/.well-known/openid-configuration`;
    try {
        // The tenant is a strict GUID and the Microsoft origin is fixed above.
        // codeql[js/request-forgery]
        const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(8000), redirect: 'error' });
        if (!response.ok) throw Object.assign(new Error(`Microsoft Entra metadata returned HTTP ${response.status}.`), { statusCode: 400 });
        const metadata = await response.json();
        for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
            if (!metadata[key] || new URL(metadata[key]).protocol !== 'https:') {
                throw Object.assign(new Error(`Microsoft Entra metadata is missing a valid HTTPS ${key}.`), { statusCode: 400 });
            }
        }
    } catch (error) {
        if (error.statusCode) throw error;
        const safe = sanitizeSetupError(error);
        throw Object.assign(new Error(`Microsoft Entra metadata check failed at the ${safe.stage} stage: ${safe.message}`), { statusCode: 400 });
    }
    return `${applicationUrl}/api/auth/callback/microsoft-entra-id`;
}

function smtpTransport(smtp) {
    if (!smtp.host || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) {
        throw Object.assign(new Error('Enter a valid SMTP host and port.'), { statusCode: 400 });
    }
    if (smtp.port === 465 && !smtp.secure) throw Object.assign(new Error('SMTP port 465 requires implicit TLS.'), { statusCode: 400 });
    if (smtp.port === 587 && (smtp.secure || !smtp.requireTls)) throw Object.assign(new Error('SMTP port 587 requires STARTTLS with Require TLS enabled.'), { statusCode: 400 });
    return nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        requireTLS: smtp.port === 587 ? true : Boolean(smtp.requireTls),
        auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
        tls: { rejectUnauthorized: true },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000,
    });
}

// The unified single-container Docker deployment has no separate host-side
// preparation step, so its bootstrap PostgreSQL credentials cannot arrive via
// Compose environment interpolation (see scripts/config-store.mjs and
// scripts/config-init.mjs): config-init writes them as files into the
// compdesk_config volume this process shares. The legacy two-stack
// docker-compose.setup.yml flow (COMPDESK_BOOTSTRAP_DB_* env vars, set by
// prepare-docker-setup.mjs before `docker compose up`) is still honored
// unchanged for anyone running it standalone during migration rollback.
function fileBasedBootstrapDatabase() {
    try {
        const identity = readPostgresIdentity(stateDirectory);
        const password = readPostgresPassword(stateDirectory);
        if (!identity.user || !identity.db || !password) return null;
        return {
            provider: 'postgresql',
            host: process.env.COMPDESK_BOOTSTRAP_DB_HOST || 'db',
            port: Number.parseInt(process.env.COMPDESK_BOOTSTRAP_DB_PORT || '5432', 10),
            database: identity.db,
            username: identity.user,
            password,
            sslMode: 'disable',
            ca: '',
        };
    } catch {
        return null;
    }
}

function resolveDatabase(database, deploymentMode) {
    if (deploymentMode !== 'docker-compose') return database;
    if (process.env.COMPDESK_BOOTSTRAP_DB_PASSWORD) {
        return {
            provider: 'postgresql',
            host: process.env.COMPDESK_BOOTSTRAP_DB_HOST || 'db',
            port: Number.parseInt(process.env.COMPDESK_BOOTSTRAP_DB_PORT || '5432', 10),
            database: process.env.COMPDESK_BOOTSTRAP_DB_NAME || 'compdesk_db',
            username: process.env.COMPDESK_BOOTSTRAP_DB_USER || '',
            password: process.env.COMPDESK_BOOTSTRAP_DB_PASSWORD,
            sslMode: 'disable',
            ca: '',
        };
    }
    return fileBasedBootstrapDatabase() || database;
}

function validateInstall(input) {
    input = { ...input, database: resolveDatabase(input.database, input.deploymentMode) };
    const databaseErrors = validateDatabaseInput(input.database);
    if (Object.keys(databaseErrors).length) throw Object.assign(new Error(Object.values(databaseErrors)[0]), { statusCode: 400 });
    const url = validatePublicUrl(input.identity?.applicationUrl);
    if (!url.valid) throw Object.assign(new Error(url.error), { statusCode: 400 });
    const auth = input.authentication || {};
    if (!auth.localEnabled && !auth.microsoftEnabled) throw Object.assign(new Error('At least one authentication method must remain enabled.'), { statusCode: 400 });
    const email = normalizeEmail(auth.adminEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid administrator email address.'), { statusCode: 400 });
    if (!String(auth.adminName || '').trim()) throw Object.assign(new Error('Administrator name is required.'), { statusCode: 400 });
    if (auth.localEnabled && (!isStrongPassword(auth.adminPassword) || auth.adminPassword !== auth.adminPasswordConfirm)) {
        throw Object.assign(new Error('The local password must match and contain at least 14 characters with upper, lower, number, and symbol.'), { statusCode: 400 });
    }
    if (!/^#[0-9a-f]{6}$/i.test(input.identity.primaryColor) || !/^#[0-9a-f]{6}$/i.test(input.identity.accentColor)) {
        throw Object.assign(new Error('Brand colors must use complete #RRGGBB values.'), { statusCode: 400 });
    }
    const storage = input.storage || {};
    if (!Number.isInteger(storage.uploadMaxSizeMb) || storage.uploadMaxSizeMb < 1 || storage.uploadMaxSizeMb > 100) {
        throw Object.assign(new Error('Maximum upload size must be between 1 and 100 MB.'), { statusCode: 400 });
    }
    const quotaValues = [
        [storage.attachmentMaxFilesPerTicket, 1, 100, 'Files per ticket'],
        [storage.attachmentMaxMbPerTicket, storage.uploadMaxSizeMb, 10_000, 'Ticket attachment storage'],
        [storage.attachmentGlobalMaxGb, 1, 100_000, 'Global attachment storage'],
        [storage.tempAttachmentTtlHours, 1, 168, 'Temporary attachment lifetime'],
        [storage.tempAttachmentMaxFilesPerUser, 1, 100, 'Temporary files per user'],
        [storage.tempAttachmentMaxMbPerUser, storage.uploadMaxSizeMb, 10_000, 'Temporary storage per user'],
    ];
    if (quotaValues.some(([value, minimum, maximum]) => !Number.isInteger(value) || value < minimum || value > maximum)) {
        throw Object.assign(new Error('Attachment quota settings are outside their supported range.'), { statusCode: 400 });
    }
    if (storage.clamavEnabled) {
        const clamavHost = String(storage.clamavHost || '').trim();
        const clamavPort = Number(storage.clamavPort);
        if (!clamavHost || clamavHost.length > 253 || /[\s/@]/.test(clamavHost) || !Number.isInteger(clamavPort) || clamavPort < 1 || clamavPort > 65535) {
            throw Object.assign(new Error('Enter a valid ClamAV daemon hostname and port.'), { statusCode: 400 });
        }
    }
    return { ...input, identity: { ...input.identity, applicationUrl: url.origin }, authentication: { ...auth, adminEmail: email } };
}

async function runMigrations(environment) {
    const prismaBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
    await new Promise((resolve, reject) => {
        const child = spawn(prismaBin, ['migrate', 'deploy'], {
            cwd: root,
            env: { ...process.env, ...environment },
            shell: process.platform === 'win32',
            stdio: ['ignore', 'inherit', 'inherit'],
            windowsHide: true,
        });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Prisma migration exited with code ${code}.`)));
    });
}

async function install(input) {
    if (installRunning) throw Object.assign(new Error('An installation is already in progress.'), { statusCode: 409 });
    installRunning = true;
    const correlationId = crypto.randomUUID();
    try {
        const config = validateInstall(input);
        await testDatabase(config.database);
        await diagnoseEntra(config.authentication, config.identity.applicationUrl);
        if (config.smtp?.enabled) {
            const transporter = smtpTransport(config.smtp);
            await transporter.verify();
        }
        const authSecret = randomSecret(48);
        const settingsEncryptionKey = randomSecret(32);
        const hasCustomCa = ['verify-ca', 'verify-full'].includes(config.database.sslMode) && Boolean(config.database.ca?.trim());
        const databaseCaFile = hasCustomCa ? databaseCaPath(envPath) : null;
        if (databaseCaFile) writeFileAtomic(databaseCaFile, `${config.database.ca.trim()}\n`, { mode: 0o600, backup: true });
        const databaseUrl = buildDatabaseUrl(config.database, { sslRootCertPath: databaseCaFile });
        const privateAttachmentDir = path.resolve(root, config.storage.privateAttachmentDir || 'storage');
        fs.mkdirSync(privateAttachmentDir, { recursive: true, mode: 0o700 });
        fs.accessSync(privateAttachmentDir, fs.constants.R_OK | fs.constants.W_OK);
        const environment = {
            DATABASE_URL: databaseUrl,
            AUTH_URL: config.identity.applicationUrl,
            AUTH_SECRET: authSecret,
            APP_SETTINGS_ENCRYPTION_KEY: settingsEncryptionKey,
            ...(databaseCaFile ? { DATABASE_CA_FILE: databaseCaFile } : {}),
        };
        const envText = renderEnvironment({
            databaseUrl,
            databaseCaFile,
            applicationUrl: config.identity.applicationUrl,
            authSecret,
            settingsEncryptionKey,
            localEnabled: config.authentication.localEnabled,
            microsoftEnabled: config.authentication.microsoftEnabled,
            trustProxy: Boolean(config.identity.reverseProxy),
            privateAttachmentDir,
            uploadMaxSizeMb: config.storage.uploadMaxSizeMb,
            attachmentMaxFilesPerTicket: config.storage.attachmentMaxFilesPerTicket,
            attachmentMaxMbPerTicket: config.storage.attachmentMaxMbPerTicket,
            attachmentGlobalMaxGb: config.storage.attachmentGlobalMaxGb,
            tempAttachmentTtlHours: config.storage.tempAttachmentTtlHours,
            tempAttachmentMaxFilesPerUser: config.storage.tempAttachmentMaxFilesPerUser,
            tempAttachmentMaxMbPerUser: config.storage.tempAttachmentMaxMbPerUser,
            clamavEnabled: config.storage.clamavEnabled,
            clamavHost: config.storage.clamavHost,
            clamavPort: config.storage.clamavPort,
            dockerDatabase: config.deploymentMode === 'docker-compose' ? config.database : null,
            tenantId: config.authentication.tenantId,
            clientId: config.authentication.clientId,
            clientSecret: config.authentication.clientSecret,
        });
        writeFileAtomic(envPath, envText, { mode: 0o600, backup: true });
        await runMigrations(environment);
        const client = new Client(pgConfiguration(config.database));
        await client.connect();
        let demoCredentials = null;
        try {
            await client.query('BEGIN');
            const installed = await client.query('SELECT id FROM installation_records WHERE id = $1 FOR UPDATE', ['primary']);
            if (installed.rowCount) throw Object.assign(new Error('CompDesk is already installed. Setup cannot be run again.'), { statusCode: 410 });
            const existing = await client.query('SELECT id, role FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1', [config.authentication.adminEmail]);
            if (existing.rowCount && existing.rows[0].role !== 'SUPER_ADMIN') {
                throw Object.assign(new Error('The administrator email already belongs to a non-Super-Admin account.'), { statusCode: 409 });
            }
            const passwordHash = config.authentication.localEnabled ? await bcrypt.hash(config.authentication.adminPassword, 12) : null;
            const userId = existing.rows[0]?.id || crypto.randomUUID();
            if (existing.rowCount) {
                await client.query(
                    'UPDATE users SET name = $1, password_hash = $2, role = $3, is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
                    [config.authentication.adminName.trim(), passwordHash, 'SUPER_ADMIN', userId]
                );
            } else {
                await client.query(
                    'INSERT INTO users (id, email, name, password_hash, role, is_active, preferred_language, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,true,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
                    [userId, config.authentication.adminEmail, config.authentication.adminName.trim(), passwordHash, 'SUPER_ADMIN', 'en']
                );
            }
            const branding = {
                applicationName: config.identity.applicationName.trim(),
                shortApplicationName: config.identity.applicationName.trim().slice(0, 24),
                subtitle: 'Helpdesk',
                description: 'A secure, customizable helpdesk and ticketing platform.',
                mainLogoUrl: '', compactLogoUrl: '', lightLogoUrl: '', darkLogoUrl: '', faviconUrl: '',
                primaryColor: config.identity.primaryColor,
                accentColor: config.identity.accentColor,
                loginHeading: `Welcome to ${config.identity.applicationName.trim()}`,
                loginDescription: 'Sign in to access your helpdesk portal.',
                loginBackgroundImageUrl: '',
                supportEmail: config.identity.supportEmail?.trim() || '',
                footerText: '',
                showDemoAccounts: false,
                demoAccountInfo: '',
                microsoftButtonText: 'Sign in with Microsoft',
            };
            const settings = {
                branding_config: JSON.stringify(branding),
                login_local_enabled: String(config.authentication.localEnabled),
                login_microsoft_enabled: String(config.authentication.microsoftEnabled),
                feature_attachments_enabled: 'true',
                feature_dashboard_links_enabled: 'true',
                feature_external_api_enabled: 'false',
                feature_webhooks_enabled: 'false',
            };
            if (config.smtp?.enabled) {
                Object.assign(settings, {
                    smtp_host: config.smtp.host,
                    smtp_port: String(config.smtp.port),
                    smtp_user: config.smtp.username || '',
                    smtp_password: encryptEnvelope(config.smtp.password || '', settingsEncryptionKey),
                    smtp_from: config.smtp.from || '',
                    smtp_secure: String(config.smtp.port === 465),
                    smtp_require_tls: String(config.smtp.port === 587 ? true : config.smtp.requireTls),
                });
            }
            for (const [key, value] of Object.entries(settings)) {
                await client.query(
                    'INSERT INTO app_settings (id, key, value, updated_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP',
                    [crypto.randomUUID(), key, value]
                );
            }
            if (config.installDemoData) {
                const demoPassword = `${crypto.randomBytes(9).toString('base64url')}aA1!`;
                demoCredentials = { email: `demo-user-${crypto.randomBytes(4).toString('hex')}@example.com`, password: demoPassword };
                await client.query(
                    'INSERT INTO users (id, email, name, password_hash, role, is_active, is_demo, preferred_language, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,true,true,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
                    [crypto.randomUUID(), demoCredentials.email, 'Demo User', await bcrypt.hash(demoPassword, 12), 'USER', 'en']
                );
            }
            await client.query(
                'INSERT INTO installation_records (id, installed_at, installed_by_email, deployment_mode, application_url, demo_data_installed, setup_version) VALUES ($1,CURRENT_TIMESTAMP,$2,$3,$4,$5,$6)',
                ['primary', config.authentication.adminEmail, config.deploymentMode, config.identity.applicationUrl, Boolean(config.installDemoData), 1]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            await client.end();
        }
        writeFileAtomic(receiptPath, `${JSON.stringify({
            installedAt: new Date().toISOString(),
            applicationUrl: config.identity.applicationUrl,
            deploymentMode: config.deploymentMode,
            setupVersion: 1,
        }, null, 2)}\n`, { mode: 0o600, backup: false });
        try { fs.unlinkSync(statePath); } catch { /* no resumable state is also valid */ }
        sessions.clear();
        return {
            success: true,
            message: 'CompDesk installation completed. Bootstrap access is now permanently retired.',
            deployment: deploymentNextSteps({ deploymentMode: config.deploymentMode, applicationUrl: config.identity.applicationUrl, orchestratorManaged: process.env.COMPDESK_ORCHESTRATOR_MANAGED === 'true' }),
            ...(demoCredentials ? { demoCredentials } : {}),
        };
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', message: 'CompDesk installation failed', correlationId, stage: sanitizeSetupError(error).stage }));
        if (!error.statusCode) {
            const wrapped = new Error(`Installation failed. Review server logs using correlation ID ${correlationId}.`);
            wrapped.statusCode = 500;
            throw wrapped;
        }
        throw error;
    } finally {
        installRunning = false;
    }
}

async function handle(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (fs.existsSync(receiptPath)) {
        const status = requestUrl.pathname.startsWith('/setup') ? 410 : 404;
        const isBrowserNavigation = request.method === 'GET'
            && !requestUrl.pathname.startsWith('/setup/api/')
            && String(request.headers.accept || '').includes('text/html');
        if (isBrowserNavigation) {
            html(response, renderInstalledPage(), status, "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
            return;
        }
        json(response, status, { error: 'First-run setup is no longer available.' });
        return;
    }
    if (requestUrl.pathname === '/api/health/live' && request.method === 'GET') {
        json(response, 200, { status: 'live', mode: 'setup' });
        return;
    }
    if (requestUrl.pathname === '/api/health/ready' && request.method === 'GET') {
        json(response, 503, { status: 'not_ready', reason: 'installation_incomplete' });
        return;
    }
    if (requestUrl.pathname === '/setup' && request.method === 'GET') {
        html(response, fs.readFileSync(uiPath, 'utf8'));
        return;
    }
    if (!requestUrl.pathname.startsWith('/setup/api/')) {
        response.writeHead(302, { Location: '/setup', 'Cache-Control': 'no-store' });
        response.end();
        return;
    }
    if (requestUrl.pathname === '/setup/api/session' && request.method === 'POST') {
        const requestOrigin = originFromRequest(request);
        if (!requestHasExpectedOrigin(request, requestOrigin)) return json(response, 403, { error: 'Setup authentication requires the setup origin.' });
        if (isRateLimited(sourceIp(request))) return json(response, 429, { error: 'Too many setup authentication attempts. Try again later.' });
        if (Date.now() > bootstrapExpiresAt) return json(response, 410, { error: 'The bootstrap token expired. Restart setup locally to issue a new token.' });
        for (const [id, session] of sessions) if (session.expiresAt < Date.now()) sessions.delete(id);
        if (sessions.size > 0) return json(response, 409, { error: 'Another setup session is already active.' });
        const body = await readBody(request);
        if (!timingSafeEqual(body.token || '', bootstrapToken)) return json(response, 401, { error: 'Invalid bootstrap token.' });
        const sessionId = randomSecret(32);
        const csrfToken = randomSecret(24);
        sessions.set(sessionId, { csrfToken, origin: requestOrigin, expiresAt: Date.now() + SESSION_TTL_MS });
        return json(response, 200, { csrfToken, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }, {
            'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/setup; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
        });
    }
    const session = request.method === 'GET' ? getSession(request) : requireMutation(request, response);
    if (!session) {
        if (request.method === 'GET') json(response, 401, { error: 'The setup session is missing or expired.' });
        return;
    }
    if (requestUrl.pathname === '/setup/api/system' && request.method === 'GET') {
        const system = await getSystemChecks();
        const bootstrapDatabase = process.env.COMPDESK_BOOTSTRAP_DB_PASSWORD || fileBasedBootstrapDatabase()
            ? redactDatabaseInput(resolveDatabase({}, 'docker-compose'))
            : null;
        return json(response, 200, { ...system, bootstrapDatabase });
    }
    if (requestUrl.pathname === '/setup/api/state' && request.method === 'GET') return json(response, 200, { state: safeReadState() });
    if (requestUrl.pathname === '/setup/api/state' && request.method === 'PUT') {
        const body = await readBody(request);
        return json(response, 200, { state: saveNonSecretState(statePath, body) });
    }
    if (requestUrl.pathname === '/setup/api/database/test' && request.method === 'POST') {
        const body = await readBody(request);
        return json(response, 200, await testDatabase(resolveDatabase(body.database, body.deploymentMode)));
    }
    if (requestUrl.pathname === '/setup/api/smtp/test' && request.method === 'POST') {
        const body = await readBody(request);
        const transporter = smtpTransport(body.smtp);
        if (body.mode !== 'send') {
            await transporter.verify();
            return json(response, 200, { success: true, stage: 'authentication', message: 'SMTP connection and authentication succeeded. This does not prove From-address acceptance or final mailbox delivery.' });
        }
        if (!body.smtp.from || !body.smtp.recipient) {
            return json(response, 400, { error: 'A valid From address and test recipient are required for a real-send test.' });
        }
        const result = await transporter.sendMail({
            from: body.smtp.from,
            to: body.smtp.recipient,
            subject: 'CompDesk setup SMTP test',
            text: 'This message confirms that the SMTP server accepted a CompDesk setup test for relay.',
        });
        const accepted = Array.isArray(result.accepted) ? result.accepted.map(String) : [];
        const rejected = Array.isArray(result.rejected) ? result.rejected.map(String) : [];
        if (!accepted.length || rejected.length) {
            return json(response, 502, { error: 'The SMTP server did not accept every test recipient for relay.', accepted, rejected });
        }
        return json(response, 200, {
            success: true,
            stage: 'relay',
            accepted,
            rejected,
            messageId: result.messageId || null,
            message: 'The SMTP server accepted the message for relay. This does not prove final mailbox delivery.',
        });
    }
    if (requestUrl.pathname === '/setup/api/install' && request.method === 'POST') {
        const body = await readBody(request);
        const result = await install(body);
        json(response, 200, result);
        if (typeof onInstalled === 'function') onInstalled(result);
        return;
    }
    json(response, 404, { error: 'Setup endpoint not found.' });
}

const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
        const correlationId = crypto.randomUUID();
        console.error(JSON.stringify({ level: 'error', message: 'Setup request failed', correlationId, status: error.statusCode || 500 }));
        if (!response.headersSent) json(response, error.statusCode || 500, { error: error.statusCode && error.statusCode < 500 ? error.message : `Setup request failed. Correlation ID: ${correlationId}` });
        else response.destroy();
    });
});

// Starts the setup HTTP listener. Exported so an orchestrator (see
// scripts/orchestrator.mjs) can import this module without it auto-starting
// (see the COMPDESK_ORCHESTRATOR_MANAGED guard below), then start it itself
// with an onInstalled hook that lets the same process transition to
// production in place instead of requiring a second Compose invocation.
export function startSetupServer({ onInstalled: onInstalledHook } = {}) {
    onInstalled = onInstalledHook || null;
    server.listen(port, host, () => {
        console.log('');
        console.log('CompDesk first-run setup is active.');
        if (explicitSetupOrigin) console.log(`Open: ${explicitSetupOrigin}/setup`);
        else console.log('Open the published CompDesk address and append /setup (for example http://127.0.0.1:3000/setup).');
        console.log(`One-time bootstrap token (expires in ${Math.floor(TOKEN_TTL_MS / 60000)} minutes): ${bootstrapToken}`);
        if (host === '127.0.0.1') console.log('Remote setup is blocked. Set SETUP_ALLOW_REMOTE=true only when protected by a trusted network path.');
        console.log('');
    });
    return server;
}

// Standalone (non-Docker) use imports this module expecting it to start
// itself immediately (scripts/launch.mjs, `npm run setup:bootstrap`). The
// orchestrator sets COMPDESK_ORCHESTRATOR_MANAGED=true before importing this
// module so it can call startSetupServer() explicitly instead.
if (process.env.COMPDESK_ORCHESTRATOR_MANAGED !== 'true') {
    startSetupServer();
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => server.close(() => process.exit(0)));
    }
}
