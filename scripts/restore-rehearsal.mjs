import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const backupDirectory = process.argv[2] ? path.resolve(process.argv[2]) : null;
const administrativeUrl = process.env.RESTORE_TEST_DATABASE_URL;
if (!backupDirectory || !administrativeUrl) {
    throw new Error('Usage: RESTORE_TEST_DATABASE_URL=postgresql://... node scripts/restore-rehearsal.mjs <backup-directory>');
}

function quoteIdentifier(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

function postgresEnvironment(databaseUrl) {
    const url = new URL(databaseUrl);
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

async function run(command, args, environment) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, env: environment });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
    });
}

const manifest = JSON.parse(await fs.readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
if (manifest.format !== 'compdesk-backup-v1') throw new Error('Unsupported backup format.');
const targetName = `compdesk_restore_${crypto.randomBytes(8).toString('hex')}`;
const targetUrl = new URL(administrativeUrl);
targetUrl.pathname = `/${targetName}`;
const admin = new Client({ connectionString: administrativeUrl, connectionTimeoutMillis: 7000 });
const recoveryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'compdesk-restore-rehearsal-'));
try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(targetName)}`);
    await run('pg_restore', [
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--dbname', targetName,
        path.resolve(backupDirectory, manifest.database),
    ], postgresEnvironment(targetUrl.toString()));

    const restored = new Client({ connectionString: targetUrl.toString(), connectionTimeoutMillis: 7000 });
    try {
        await restored.connect();
        const schema = await restored.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'");
        if (schema.rows[0].count < 1) throw new Error('The restored PostgreSQL schema contains no application tables.');
        await restored.query('SELECT COUNT(*) FROM installation_records');
    } finally {
        await restored.end().catch(() => undefined);
    }

    for (const key of ['attachments', 'uploads', 'configuration', ...(manifest.databaseCa ? ['databaseCa'] : [])]) {
        const source = path.resolve(backupDirectory, manifest[key]);
        const relative = path.relative(backupDirectory, source);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe ${key} path in backup manifest.`);
        const target = path.join(recoveryDirectory, key);
        await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
        const stat = await fs.stat(target);
        if ((key === 'configuration' || key === 'databaseCa') && (!stat.isFile() || stat.size === 0)) {
            throw new Error(`${key} did not restore as a non-empty file.`);
        }
    }
    console.log('Isolated PostgreSQL, attachment, upload, configuration, and optional CA restore rehearsal passed.');
} finally {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(targetName)} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    await fs.rm(recoveryDirectory, { recursive: true, force: true });
}