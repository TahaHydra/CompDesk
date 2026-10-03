import { execFileSync } from 'node:child_process';

test('Microsoft account linking requires stable provider identity or authenticated account ownership', () => {
    execFileSync(process.execPath, ['--test', 'scripts/entra-security.test.mjs'], { cwd: process.cwd(), stdio: 'pipe', timeout: 20_000 });
});
