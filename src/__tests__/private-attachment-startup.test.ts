import { execFileSync } from 'node:child_process';
import path from 'node:path';

it('keeps legacy attachments private across build, migration and startup', () => {
    execFileSync(process.execPath, ['--test', path.join(process.cwd(), 'scripts/private-attachments.test.mjs')], {
        cwd: process.cwd(), stdio: 'pipe', timeout: 20_000,
    });
});
