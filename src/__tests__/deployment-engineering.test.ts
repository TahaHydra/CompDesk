import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function source(relativePath: string) { return fs.readFileSync(path.join(process.cwd(), ...relativePath.split('/')), 'utf8'); }

describe('deployment engineering contracts', () => {
    it('keeps the first-run browser script syntactically executable', () => {
        const html = source('scripts/setup-ui.html');
        const scriptStart = html.indexOf('<script>');
        const scriptEnd = html.indexOf('</script>', scriptStart + 8);
        expect(scriptStart).toBeGreaterThanOrEqual(0);
        expect(scriptEnd).toBeGreaterThan(scriptStart);
        const script = html.slice(scriptStart + 8, scriptEnd);
        expect(() => new Function(script)).not.toThrow();
        expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    });

    it('keeps the dependency relay on its fixed upstream origins', () => {
        const relay = source('scripts/dependency-relay.mjs');
        expect(relay).toContain("incoming.origin !== RELAY_ORIGIN");
        expect(relay).toContain("new URL(prismaRequest ? 'https://binaries.prisma.sh' : 'https://registry.npmjs.org')");
        expect(relay).not.toContain("new URL(rawUrl, 'https://registry.npmjs.org')");
    });

    it('documents only runtime-backed configuration variables', () => {
        const example = source('.env.example');
        const configuration = source('docs/CONFIGURATION.md');
        expect(example).not.toContain('RATE_LIMIT_WINDOW_MS');
        expect(example).not.toContain('RATE_LIMIT_MAX_REQUESTS');
        for (const variable of ['UPLOAD_MAX_SIZE_MB', 'ATTACHMENT_STORAGE_DIR', 'TEMP_ATTACHMENT_TTL_HOURS', 'AUTH_URL', 'TRUST_PROXY', 'SMTP_REQUIRE_TLS', 'APP_SETTINGS_ENCRYPTION_KEY']) {
            expect(configuration).toContain('' + variable + '');
        }
    });

    it('keeps migrations separate from normal multi-replica startup', () => {
        for (const file of ['docker-compose.yml', 'docker-compose.external-db.yml']) {
            const compose = source(file);
            expect(compose).toContain('migrate:');
            expect(compose).toContain('condition: service_completed_successfully');
        }
        const dockerfile = source('Dockerfile');
        expect(dockerfile.match(/^CMD .*$/m)?.[0]).not.toContain('prisma migrate');
        expect(dockerfile).toContain('npm ci --omit=dev --ignore-scripts');
        expect(dockerfile).toContain('FROM runtime-base AS setup');
        expect(dockerfile).toContain('FROM runtime-base AS runner');
        expect(dockerfile).toContain('rm -rf /usr/local/lib/node_modules/npm');
        expect(dockerfile).toContain('rm -f /usr/local/bin/npm /usr/local/bin/npx');
        for (const file of ['docker-compose.yml', 'docker-compose.external-db.yml', 'docker-compose.setup.yml']) {
            expect(source(file)).toContain('target: setup');
        }
    });

    it('dry-runs the complete backup scope without exposing a database URL', () => {
        const output = execFileSync(process.execPath, ['scripts/backup.mjs', '--dry-run'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, DATABASE_URL: 'postgresql://secret-user:secret-password@db.example/private' },
        });
        expect(output).toContain('PostgreSQL custom dump');
        expect(output).toContain('private attachments');
        expect(output).toContain('uploaded branding/quick-link assets');
        expect(output).not.toContain('secret-user');
        expect(output).not.toContain('secret-password');
    });

    it('fails closed when static-analysis SARIF contains warning or error findings', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-sarif-test-'));
        const target = path.join(directory, 'result.sarif');
        try {
            fs.writeFileSync(target, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'test' } }, results: [] }] }));
            expect(execFileSync(process.execPath, ['scripts/check-sarif.mjs', directory], { encoding: 'utf8' })).toContain('no unsuppressed warning/error findings');
            fs.writeFileSync(target, JSON.stringify({
                version: '2.1.0',
                runs: [{ tool: { driver: { name: 'test' } }, results: [{ ruleId: 'security-test', level: 'warning', message: { text: 'Unsafe test result' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/example.ts' }, region: { startLine: 17 } } }] }] }],
            }));
            expect(() => execFileSync(process.execPath, ['scripts/check-sarif.mjs', directory], { stdio: 'pipe' })).toThrow();
            fs.writeFileSync(target, JSON.stringify({
                version: '2.1.0',
                runs: [{ tool: { driver: { name: 'test' } }, results: [{
                    ruleId: 'documented-exception', level: 'warning', message: { text: 'Reviewed exception' },
                    suppressions: [{ kind: 'inSource', status: 'accepted' }],
                }] }],
            }));
            expect(execFileSync(process.execPath, ['scripts/check-sarif.mjs', directory], { encoding: 'utf8' })).toContain('1 documented in-source suppression');
            fs.writeFileSync(target, JSON.stringify({
                version: '2.1.0',
                runs: [{ tool: { driver: { name: 'test' } }, results: [{
                    ruleId: 'external-suppression', level: 'warning', message: { text: 'Not suppressed in source' },
                    suppressions: [{ kind: 'external', status: 'accepted' }],
                }] }],
            }));
            expect(() => execFileSync(process.execPath, ['scripts/check-sarif.mjs', directory], { stdio: 'pipe' })).toThrow();
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
    it('verifies a complete backup and rejects manifest traversal', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-backup-test-'));
        try {
            fs.mkdirSync(path.join(directory, 'attachments'));
            fs.mkdirSync(path.join(directory, 'uploads'));
            fs.mkdirSync(path.join(directory, 'configuration'));
            fs.writeFileSync(path.join(directory, 'database.dump'), 'database');
            fs.writeFileSync(path.join(directory, 'configuration', 'compdesk.env'), 'AUTH_SECRET=test-only');
            const manifest = {
                format: 'compdesk-backup-v1', database: 'database.dump', attachments: 'attachments',
                uploads: 'uploads', configuration: 'configuration/compdesk.env',
            };
            fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
            expect(execFileSync(process.execPath, ['scripts/verify-backup.mjs', directory], { encoding: 'utf8' })).toContain('structure is complete');
            fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, configuration: '../outside.env' }));
            expect(() => execFileSync(process.execPath, ['scripts/verify-backup.mjs', directory], { stdio: 'pipe' })).toThrow();
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});