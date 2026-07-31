import { chownRecursiveSync, initializeConfig } from './config-store.mjs';

const configDir = process.env.COMPDESK_CONFIG_DIR || '/config';
const pgdataCheckDirectory = process.env.COMPDESK_PGDATA_CHECK_DIR || '/pgdata-check';
const runtimeUid = Number.parseInt(process.env.COMPDESK_RUNTIME_UID || '1001', 10);
const runtimeGid = Number.parseInt(process.env.COMPDESK_RUNTIME_GID || '1001', 10);
const ownedPaths = (process.env.COMPDESK_CHOWN_PATHS || '')
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean);

// initializeConfig() runs first because it creates /config/secrets (and its
// files) on a fresh volume — chowning beforehand would only fix ownership of
// paths that already existed at that moment, leaving the newly created
// secrets directory root-owned (config-init runs as root) and unreadable by
// the compdesk container, which runs as the unprivileged runtime user.
const result = initializeConfig({ configDir, pgdataCheckDirectory });

for (const target of ownedPaths) {
    chownRecursiveSync(target, runtimeUid, runtimeGid);
}

if (!result.ok) {
    if (result.action === 'failed-missing-secrets') {
        console.error('config-init: CompDesk is installed, but one or more required secret files are missing from compdesk_config.');
        console.error(`config-init: expected ${result.missing.length} file(s) to exist: ${result.missing.map((target) => target.split('/').pop()).join(', ')}.`);
        console.error('config-init: this is a fail-closed safeguard. Restore compdesk_config from a backup, or import the original installation with scripts/import-legacy-deployment.mjs.');
    } else if (result.action === 'refused-initialized-pgdata') {
        console.error(`config-init: refusing to generate new PostgreSQL credentials. ${result.detail}`);
        console.error('config-init: recovery options: 1) restore the original compdesk_config volume from backup; 2) import an existing installation with scripts/import-legacy-deployment.mjs; 3) if this data is not needed, discard it with node scripts/docker-reset.mjs and re-run docker compose up -d.');
    } else {
        console.error(`config-init: unrecognized failure action "${result.action}".`);
    }
    process.exit(1);
}

console.log(`config-init: ${result.action === 'generated' ? 'generated new PostgreSQL bootstrap credentials without printing their values' : result.action}.`);
process.exit(0);
