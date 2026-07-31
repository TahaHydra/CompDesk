import fs from 'node:fs';
import path from 'node:path';
import { randomSecret, writeFileAtomic } from './setup-core.mjs';

export const POSTGRES_DEFAULT_USER = 'compdesk';
export const POSTGRES_DEFAULT_DB = 'compdesk';

export function pgdataInitialized(pgdataCheckDirectory, { existsSync = fs.existsSync } = {}) {
    return existsSync(path.join(pgdataCheckDirectory, 'PG_VERSION'));
}

function randomPassword() {
    return randomSecret(36).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

// Generates (once) or validates the persistent PostgreSQL bootstrap secret
// pair that lives in the compdesk_config volume. This is the single place
// that decides whether it is safe to mint new credentials: an installed
// receipt or an already-present secret pair always wins (idempotent rerun),
// and an initialized-but-unrecognized pgdata volume always fails closed,
// mirroring the safeguard scripts/docker-project.mjs already applies to the
// legacy host-side bootstrap flow.
export function initializeConfig({ configDir, pgdataCheckDirectory, deps = {} }) {
    const existsSync = deps.existsSync || fs.existsSync;
    const mkdirSync = deps.mkdirSync || fs.mkdirSync;
    const writeAtomic = deps.writeFileAtomic || writeFileAtomic;
    const checkPgdataInitialized = deps.pgdataInitialized || pgdataInitialized;

    const secretsDirectory = path.join(configDir, 'secrets');
    const installedPath = path.join(configDir, 'installation.json');
    const passwordPath = path.join(secretsDirectory, 'postgres_password');
    const identityPath = path.join(secretsDirectory, 'postgres_identity.json');

    mkdirSync(secretsDirectory, { recursive: true, mode: 0o700 });

    if (existsSync(installedPath)) {
        const missing = [passwordPath, identityPath].filter((target) => !existsSync(target));
        if (missing.length) {
            return { action: 'failed-missing-secrets', ok: false, missing, passwordPath, identityPath };
        }
        return { action: 'already-installed', ok: true, passwordPath, identityPath };
    }

    if (existsSync(passwordPath) && existsSync(identityPath)) {
        return { action: 'preserved', ok: true, passwordPath, identityPath };
    }

    if (checkPgdataInitialized(pgdataCheckDirectory, { existsSync })) {
        return {
            action: 'refused-initialized-pgdata',
            ok: false,
            passwordPath,
            identityPath,
            detail: 'The PostgreSQL data volume already contains an initialized database, but no matching secret pair exists in compdesk_config. Minting a new random password now would not match the role already stored in that volume.',
        };
    }

    const password = randomPassword();
    writeAtomic(passwordPath, password, { mode: 0o600, backup: false });
    writeAtomic(identityPath, `${JSON.stringify({ user: POSTGRES_DEFAULT_USER, db: POSTGRES_DEFAULT_DB }, null, 2)}\n`, { mode: 0o600, backup: false });
    return { action: 'generated', ok: true, passwordPath, identityPath };
}

// Recursive chown implemented in plain fs calls (no dependency on a `chown`
// binary) so the same function is trivially unit-testable with injected fs
// functions on any platform, including Windows CI runners.
export function chownRecursiveSync(targetPath, uid, gid, deps = {}) {
    const chownSync = deps.chownSync || fs.chownSync;
    const readdirSync = deps.readdirSync || fs.readdirSync;
    const existsSync = deps.existsSync || fs.existsSync;

    if (!existsSync(targetPath)) return;
    chownSync(targetPath, uid, gid);
    let entries;
    try {
        entries = readdirSync(targetPath, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const child = path.join(targetPath, entry.name);
        if (entry.isDirectory()) chownRecursiveSync(child, uid, gid, deps);
        else chownSync(child, uid, gid);
    }
}

export function readPostgresIdentity(configDir, { readFileSync = fs.readFileSync } = {}) {
    const identityPath = path.join(configDir, 'secrets', 'postgres_identity.json');
    const parsed = JSON.parse(readFileSync(identityPath, 'utf8'));
    return { user: String(parsed.user || ''), db: String(parsed.db || '') };
}

export function readPostgresPassword(configDir, { readFileSync = fs.readFileSync } = {}) {
    return readFileSync(path.join(configDir, 'secrets', 'postgres_password'), 'utf8').trim();
}
