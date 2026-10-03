const mockRows = new Map<string, { key: string; value: string }>();
const mockRateLimit = jest.fn();
jest.mock('@/lib/prisma', () => ({ prisma: { appSetting: {
    findUnique: async ({ where }: { where: { key: string } }) => mockRows.get(where.key) ?? null,
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
        const row = { key: where.key, value: update.value }; mockRows.set(where.key, row); return row;
    },
} } }));
jest.mock('@/lib/database-rate-limit', () => ({ consumeDatabaseRateLimit: mockRateLimit }));
import { getUpdateState } from '@/lib/update-service';
import { APP_VERSION } from '@/lib/version';

const release = { latest: '9.0.0', severity: 'normal', release_url: 'https://github.com/TahaHydra/CompDesk/releases/tag/v9.0.0', summary: 'A release' };
const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
    mockRows.clear(); mockFetch.mockReset(); mockRateLimit.mockReset();
    mockRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mockFetch.mockImplementation(async () => new Response(JSON.stringify(release), { headers: { 'Content-Type': 'application/json' } }));
    global.fetch = mockFetch;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

describe('server-side update cache', () => {
    it('checks once, shares cached results and expires after 24 hours', async () => {
        const first = await getUpdateState();
        expect(first).toMatchObject({ installed: APP_VERSION, checkStatus: 'ok', manifest: release, automatic: true });
        expect((await getUpdateState()).lastChecked).toBe(first.lastChecked);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        jest.setSystemTime(new Date('2026-10-02T12:01:00Z'));
        expect((await getUpdateState()).lastChecked).toBe('2026-10-02T12:01:00.000Z');
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    it('manual refresh replaces cached metadata without waiting for expiry', async () => {
        await getUpdateState();
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...release, latest: '9.0.1', severity: 'critical' })));
        expect((await getUpdateState(true)).manifest).toMatchObject({ latest: '9.0.1', severity: 'critical' });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    it('respects opt-out while allowing a deliberate manual check', async () => {
        mockRows.set('updates_automatic', { key: 'updates_automatic', value: 'false' });
        expect((await getUpdateState()).checkStatus).toBe('not_checked');
        expect(mockFetch).not.toHaveBeenCalled();
        expect((await getUpdateState(true)).checkStatus).toBe('ok');
    });
    it.each(['network', 'invalid', 'oversize', 'http'])('fails safely for %s and caches the failed attempt', async (failure) => {
        if (failure === 'network') mockFetch.mockRejectedValueOnce(new Error('offline'));
        if (failure === 'invalid') mockFetch.mockResolvedValueOnce(new Response('{"severity":"critical"}'));
        if (failure === 'oversize') mockFetch.mockResolvedValueOnce(new Response('x'.repeat(16385)));
        if (failure === 'http') mockFetch.mockResolvedValueOnce(new Response('{}', { status: 503 }));
        expect(await getUpdateState()).toMatchObject({ installed: APP_VERSION, checkStatus: 'unavailable', manifest: null });
        await getUpdateState();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    it('retains last known metadata on failure but marks it stale', async () => {
        await getUpdateState(); mockFetch.mockRejectedValueOnce(new Error('offline'));
        expect(await getUpdateState(true)).toMatchObject({ checkStatus: 'unavailable', manifest: release, stale: true });
    });
    it('limits repeated manual checks across replicas', async () => {
        await getUpdateState();
        mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 45 });
        expect(await getUpdateState(true)).toMatchObject({ refreshLimited: true, manifest: release });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    it('sends only an anonymous HTTPS GET with no version, user, or tenant payload', async () => {
        await getUpdateState();
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe('https://raw.githubusercontent.com/TahaHydra/CompDesk/main/updates/manifest.json');
        expect(options).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store' });
        expect(options.body).toBeUndefined();
    });
});
