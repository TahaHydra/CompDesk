import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dryRun = process.argv.includes('--dry-run');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.resolve(process.env.COMPDESK_BACKUP_DIR || path.join(root, 'backups'), `compdesk-${timestamp}`);
const attachments = path.resolve(process.env.ATTACHMENT_STORAGE_DIR || path.join(root, 'storage', 'attachments'));
const uploads = path.resolve(path.join(root, 'public', 'uploads'));

async function firstExisting(paths) {
    for (const candidate of paths) {
        try { await fs.access(candidate); return candidate; } catch { /* keep looking */ }
    }
    return null;
}

async function run(command, args, env) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, env });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
    });
}

function postgresEnvironment(databaseUrl) {
    const url = new URL(databaseUrl);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('DATABASE_URL must use PostgreSQL.');
    return {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || '5432',
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
        ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
        ...(url.searchParams.get('sslrootcert') ? { PGSSLROOTCERT: url.searchParams.get('sslrootcert') } : {}),
    };
}

const configPath = await firstExisting([
    process.env.COMPDESK_ENV_FILE ? path.resolve(process.env.COMPDESK_ENV_FILE) : '',
    path.join(root, '.compdesk', 'compdesk.env'),
    path.join(root, '.env'),
].filter(Boolean));
const databaseUrlCa = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).searchParams.get('sslrootcert')
    : null;
const configuredCaPath = process.env.DATABASE_CA_FILE || databaseUrlCa;
const databaseCa = await firstExisting([
    configuredCaPath ? path.resolve(configuredCaPath) : '',
    configPath ? path.join(path.dirname(configPath), 'database-ca.pem') : '',
].filter(Boolean));
if (configuredCaPath && !databaseCa) throw new Error('The configured PostgreSQL CA file is missing; refusing to create an incomplete recovery set.');

if (dryRun) {
    console.log(JSON.stringify({
        mode: 'dry-run',
        destination,
        includes: ['PostgreSQL custom dump', 'private attachments', 'uploaded branding/quick-link assets', 'one runtime configuration source', ...(databaseCa ? ['PostgreSQL custom CA'] : [])],
        configurationFound: Boolean(configPath),
        databaseCaFound: Boolean(databaseCa),
        warning: 'The backup contains authentication and encryption keys. Encrypt it and restrict access.',
    }, null, 2));
    process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to create a PostgreSQL backup.');
if (!configPath) throw new Error('No runtime configuration file was found. Set COMPDESK_ENV_FILE explicitly.');

await fs.mkdir(destination, { recursive: true, mode: 0o700 });
await fs.chmod(destination, 0o700).catch(() => undefined);
await run('pg_dump', ['--format=custom', '--file', path.join(destination, 'database.dump')], postgresEnvironment(process.env.DATABASE_URL));
await fs.cp(attachments, path.join(destination, 'attachments'), { recursive: true, force: false, errorOnExist: true });
await fs.cp(uploads, path.join(destination, 'uploads'), { recursive: true, force: false, errorOnExist: true });
const configurationDirectory = path.join(destination, 'configuration');
await fs.mkdir(configurationDirectory, { mode: 0o700 });
const configurationTarget = path.join(configurationDirectory, path.basename(configPath));
await fs.copyFile(configPath, configurationTarget);
await fs.chmod(configurationTarget, 0o600).catch(() => undefined);
let databaseCaTarget = null;
if (databaseCa) {
    databaseCaTarget = path.join(configurationDirectory, 'database-ca.pem');
    await fs.copyFile(databaseCa, databaseCaTarget);
    await fs.chmod(databaseCaTarget, 0o600).catch(() => undefined);
}

const manifest = {
    format: 'compdesk-backup-v1',
    createdAt: new Date().toISOString(),
    database: 'database.dump',
    attachments: 'attachments',
    uploads: 'uploads',
    configuration: path.join('configuration', path.basename(configPath)).replaceAll('\\', '/'),
    ...(databaseCaTarget ? { databaseCa: 'configuration/database-ca.pem' } : {}),
    integrityNonce: crypto.randomBytes(16).toString('hex'),
    warning: 'Secret-bearing recovery set. Encrypt at rest and limit access.',
};
await fs.writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(`Backup created at ${destination}. Encrypt and move it to restricted backup storage.`);