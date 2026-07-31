import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repositoryRoot = process.cwd();
const forbiddenCompanyTerms = [
    ['e', 'x', 'c', 'o'].join(''),
    ['e', 'x', 'c', 'o', 'd', 'e', 's', 'k'].join(''),
    ['@', 'e', 'x', 'c', 'o'].join(''),
];

function trackedFiles(): string[] {
    return execFileSync('git', ['ls-files', '-z'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    }).split('\0').filter(Boolean);
}

function readableText(relativePath: string): string | null {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) return null;
    return buffer.toString('utf8');
}

describe('public release repository hygiene', () => {
    it('contains no known customer-specific identifiers in tracked text files', () => {
        const findings: string[] = [];
        for (const file of trackedFiles()) {
            const content = readableText(file);
            if (content === null) continue;
            const normalized = content.toLowerCase();
            for (const term of forbiddenCompanyTerms) {
                if (normalized.includes(term)) findings.push(`${file}: ${term}`);
            }
        }
        expect(findings).toEqual([]);
    });

    it('keeps PostgreSQL private and requires production database credentials', () => {
        const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.yml'), 'utf8');
        const databaseService = compose.slice(compose.indexOf('  db:'), compose.indexOf('\n  compdesk:'));
        expect(databaseService).not.toMatch(/\n\s+ports:/);
        // The unified stack consumes the PostgreSQL password from a file
        // written by config-init (never a plaintext Compose environment
        // variable, never visible in `docker inspect`).
        expect(databaseService).toContain('POSTGRES_PASSWORD_FILE: /run/compdesk-config/secrets/postgres_password');
        expect(databaseService).not.toMatch(/\bPOSTGRES_PASSWORD:/);
        expect(compose).not.toContain('compdesk_dev_only');

        const developmentCompose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.dev.yml'), 'utf8');
        expect(developmentCompose).toContain("127.0.0.1:${POSTGRES_PORT:-5433}:5432");
    });
});
