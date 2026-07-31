import fs from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';
import pg from 'pg';
import { sanitizeSetupError } from './setup-core.mjs';

const { loadEnvConfig } = nextEnv;
const { Client } = pg;
const root = process.cwd();
loadEnvConfig(root);

function databaseClientConfiguration() {
    const connectionString = process.env.DATABASE_URL;
    const configuration = { connectionString, connectionTimeoutMillis: 4000 };
    if (!connectionString) return configuration;
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('sslmode');
    const caPath = url.searchParams.get('sslrootcert') || process.env.DATABASE_CA_FILE;
    if (caPath && ['verify-ca', 'verify-full'].includes(sslMode || '')) {
        configuration.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(path.resolve(caPath), 'utf8') };
    }
    return configuration;
}

async function installationExists() {
    if (!process.env.DATABASE_URL) return false;
    let client;
    try {
        client = new Client(databaseClientConfiguration());
        await client.connect();
        const result = await client.query("SELECT to_regclass('public.installation_records') AS table_name");
        if (!result.rows[0]?.table_name) return false;
        const installed = await client.query('SELECT id FROM installation_records WHERE id = $1', ['primary']);
        return installed.rowCount > 0;
    } catch (error) {
        const diagnostic = sanitizeSetupError(error);
        throw new Error(
            `CompDesk is configured but PostgreSQL is unavailable (${diagnostic.stage}). Refusing to start first-run setup. ${diagnostic.message}`,
            { cause: error }
        );
    } finally {
        await client?.end().catch(() => undefined);
    }
}

const forcedSetup = process.argv.includes('--setup') || process.env.COMPDESK_SETUP_MODE === 'true';
const requiredRuntimeConfiguration = Boolean(process.env.DATABASE_URL && process.env.AUTH_URL && process.env.AUTH_SECRET);
if (forcedSetup || !requiredRuntimeConfiguration || !(await installationExists())) {
    await import('./setup-bootstrap.mjs');
} else {
    const serverPath = path.join(root, '.next', 'standalone', 'server.js');
    if (!fs.existsSync(serverPath)) throw new Error('Standalone server not found. Run npm run build first.');
    await import('./start-standalone.mjs');
}