import { execFileSync } from 'node:child_process';
import path from 'node:path';

it('validates ownership and destructive confirmation with the shared demo service', () => {
    execFileSync(process.execPath, ['--test', path.join(process.cwd(), 'scripts/demo-data.test.mjs')], { stdio: 'pipe' });
});
