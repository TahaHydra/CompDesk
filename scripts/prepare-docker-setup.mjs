import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { randomSecret, writeFileAtomic } from './setup-core.mjs';

const root = process.cwd();
const stateDirectory = path.join(root, '.compdesk');
const bootstrapPath = path.join(stateDirectory, 'docker-bootstrap.env');
const installedPath = path.join(stateDirectory, 'installation.json');

if (fs.existsSync(installedPath)) {
    console.error('CompDesk is already installed. Docker bootstrap credentials will not be regenerated.');
    process.exit(2);
}
if (fs.existsSync(bootstrapPath) && !process.argv.includes('--rotate-incomplete')) {
    console.log('Existing incomplete Docker bootstrap configuration preserved.');
    console.log('Run: docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml up --build');
    process.exit(0);
}

const databaseUser = `compdesk_${crypto.randomBytes(5).toString('hex')}`;
const databasePassword = randomSecret(36).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const contents = [
    '# Temporary credentials for the isolated Docker setup stack.',
    '# Do not commit this file. Remove it after the production stack is running.',
    'POSTGRES_DB=compdesk_db',
    `POSTGRES_USER=${databaseUser}`,
    `POSTGRES_PASSWORD=${databasePassword}`,
    'SETUP_BIND_ADDRESS=127.0.0.1',
    'SETUP_PORT=3000',
    `SETUP_UID=${typeof process.getuid === 'function' ? process.getuid() : 1000}`,
    `SETUP_GID=${typeof process.getgid === 'function' ? process.getgid() : 1000}`,
    '',
].join('\n');

writeFileAtomic(bootstrapPath, contents, { mode: 0o600, backup: false });
console.log('Generated private Docker bootstrap credentials without printing their values.');
console.log('Run: docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml up --build');
