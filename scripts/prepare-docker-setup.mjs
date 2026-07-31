import path from 'node:path';
import { prepareDockerBootstrap } from './docker-project.mjs';

const root = process.cwd();
const stateDirectory = path.join(root, '.compdesk');
const rotateIncomplete = process.argv.includes('--rotate-incomplete');
const result = prepareDockerBootstrap({ stateDirectory, rotateIncomplete });

if (result.action === 'already-installed') {
    console.error('CompDesk is already installed. Docker bootstrap credentials will not be regenerated.');
    process.exit(2);
}
if (result.action === 'refused-initialized-volume') {
    console.error(`Refusing to generate new PostgreSQL bootstrap credentials: the "${result.volumeName}" Docker volume already holds an initialized PostgreSQL data directory, but ${result.bootstrapPath} is missing.`);
    console.error('Minting a new random PostgreSQL username now would not match the role already stored in that volume, and PostgreSQL would repeatedly report "role ... does not exist".');
    console.error('');
    console.error('Recovery options:');
    console.error('  1. Restore the original .compdesk/docker-bootstrap.env from a backup so the existing credentials are reused.');
    console.error('  2. If the existing database is not needed, permanently discard it first: node scripts/docker-reset.mjs');
    console.error('     Then re-run: npm run setup:docker:prepare');
    process.exit(1);
}
if (result.action === 'refused-unknown-volume-state') {
    console.error(`Refusing to generate new PostgreSQL bootstrap credentials: the state of Docker volume "${result.volumeName}" could not be determined.`);
    console.error(result.inspection?.detail || 'Docker inspection failed for an unknown reason.');
    console.error('');
    console.error('This is a fail-closed safeguard: generating credentials while Docker state is unknown could silently orphan an existing database.');
    console.error('Check that Docker is installed, the Docker daemon is running, and this user has permission to access it (for example, membership in the "docker" group), then re-run: npm run setup:docker:prepare');
    process.exit(1);
}
if (result.action === 'preserved') {
    console.log('Existing incomplete Docker bootstrap configuration preserved.');
    console.log('Run: docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml up --build');
    process.exit(0);
}
console.log('Generated private Docker bootstrap credentials without printing their values.');
console.log('Run: docker compose --env-file .compdesk/docker-bootstrap.env -f docker-compose.setup.yml up --build');
