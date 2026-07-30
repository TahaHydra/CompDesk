import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('first-run setup primitives', () => {
    it('pass the isolated Node security test suite', () => {
        expect(() => execFileSync(
            process.execPath,
            [
                '--test',
                path.join(process.cwd(), 'scripts', 'setup-core.test.mjs'),
                path.join(process.cwd(), 'scripts', 'setup-server.test.mjs'),
                path.join(process.cwd(), 'scripts', 'launch.test.mjs'),
            ],
            { cwd: process.cwd(), stdio: 'pipe' }
        )).not.toThrow();
    });
});
