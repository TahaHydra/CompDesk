import { execFileSync } from 'node:child_process';

const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/verify-runtime-image.mjs <locally-built-image>');

// Exercise the assembled image with no host files, network, or writable
// application filesystem. Source-tree imports cannot mask missing packages.
const probe = `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
assert.equal(process.getuid(), 1001, 'runtime must use its unprivileged user');
await import('./scripts/setup-bootstrap.mjs');
await import('./scripts/config-store.mjs');
await import('./scripts/orchestrator-core.mjs');
const cli = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', '--help'], {
    encoding: 'utf8',
    env: { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
});
assert.equal(cli.status, 0, cli.stderr || cli.error?.message);
assert.match(cli.stdout, /migrate/);
console.log('Runtime setup imports and Prisma migration CLI passed in an isolated image.');
`;

execFileSync('docker', [
    'run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
    '-e', 'COMPDESK_ORCHESTRATOR_MANAGED=true',
    '--entrypoint', 'node', image, '--input-type=module', '--eval', probe,
], { stdio: 'inherit', windowsHide: true });
