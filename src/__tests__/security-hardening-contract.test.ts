import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApiClientSchema, updateApiClientSchema } from '@/lib/api-clients';

const read = (...segments: string[]) => readFileSync(path.join(process.cwd(), ...segments), 'utf8');

const queryProvider = read('src', 'components', 'providers', 'query-provider.tsx');
const brandingEditor = read('src', 'components', 'admin', 'branding-settings.tsx');
const ticketRoute = read('src', 'app', 'api', 'tickets', '[id]', 'route.ts');
const ticketCreation = read('src', 'lib', 'tickets', 'create-ticket.ts');
const apiClients = read('src', 'lib', 'api-clients.ts');
const compose = read('docker-compose.yml');
const copyAssets = read('scripts', 'copy-standalone-assets.js');
const migration = read('prisma', 'migrations', '20260724150000_harden_runtime_and_api_clients', 'migration.sql');

describe('production hardening contracts', () => {
    it('does not globally poll editable application queries', () => {
        expect(queryProvider).not.toContain('refetchInterval');
        expect(queryProvider).toContain('staleTime: 30 * 1000');
        expect(brandingEditor).toContain('if (query.data && !isDirty)');
    });

    it('requires deployment auth settings without predictable fallbacks', () => {
        expect(compose).toContain('${AUTH_URL:?AUTH_URL is required}');
        expect(compose).toContain('${AUTH_SECRET:?AUTH_SECRET is required}');
        expect(compose).not.toContain('change-me');
        expect(compose).not.toContain('API_KEY:');
    });

    it('replaces standalone static assets rather than merging stale files', () => {
        expect(copyAssets).toContain('fs.rmSync(to');
        expect(copyAssets).toContain('recursive: true');
    });

    it('stores API clients relationally and never accepts the legacy environment key', () => {
        expect(migration).toContain('CREATE TABLE "api_clients"');
        expect(migration).not.toContain('DELETE FROM "app_settings"');
        expect(apiClients).toContain('prisma.apiClient.findUnique');
        expect(apiClients).not.toContain('process.env.API_KEY');
    });

    it('validates API-client names, scopes, and department identifiers', () => {
        expect(createApiClientSchema.safeParse({ name: ' ', scopes: ['tickets:read'], allowedQueueIds: [] }).success).toBe(false);
        expect(createApiClientSchema.safeParse({ name: 'ERP', scopes: [], allowedQueueIds: [] }).success).toBe(false);
        expect(createApiClientSchema.safeParse({ name: 'ERP', scopes: ['tickets:read'], allowedQueueIds: ['bad-id'] }).success).toBe(false);
        expect(updateApiClientSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(false);
    });

    it('updates ticket state, tags, and audit timeline in one transaction', () => {
        expect(ticketRoute).toContain('const validTagCount = await prisma.tag.count');
        expect(ticketRoute).toContain('prisma.$transaction(async (tx)');
        expect(ticketRoute).toContain('tx.ticketTag.deleteMany');
        expect(ticketRoute).toContain('tx.ticket.update');
        expect(ticketRoute).toContain('tx.timelineEvent.createMany');
    });

    it('creates ticket records atomically and restores moved files after rollback', () => {
        expect(ticketCreation).toContain('reserveNextTicketCount(tx, year)');
        expect(ticketCreation).toContain('tx.attachment.createMany');
        expect(ticketCreation).toContain('tx.ticketWatcher.createMany');
        expect(ticketCreation).toContain('tx.timelineEvent.create');
        expect(ticketCreation).toContain('await restoreMovedFiles(movedFiles)');
    });
});