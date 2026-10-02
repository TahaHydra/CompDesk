import { APP_VERSION } from '@/lib/version';
import { prisma } from '@/lib/prisma';
import { consumeDatabaseRateLimit } from '@/lib/database-rate-limit';
import { updateManifestSchema, type UpdateManifest, type UpdateState } from '@/lib/updates';
import { z } from 'zod';

const CACHE_KEY = 'updates_cache';
const CACHE_PERIOD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/TahaHydra/CompDesk/main/updates/manifest.json';
const cacheSchema = z.object({
    source: z.string().max(2048),
    lastChecked: z.string().datetime(),
    checkStatus: z.enum(['ok', 'unavailable']),
    manifest: updateManifestSchema.nullable(),
});
type CachedCheck = z.infer<typeof cacheSchema>;

function stateFromCache(cache: CachedCheck | null, automatic: boolean, refreshLimited = false): UpdateState {
    return {
        installed: APP_VERSION, automatic, manifest: cache?.manifest ?? null,
        lastChecked: cache?.lastChecked ?? null, checkStatus: cache?.checkStatus ?? 'not_checked',
        stale: Boolean(cache && (cache.checkStatus !== 'ok' || Date.now() - Date.parse(cache.lastChecked) >= CACHE_PERIOD_MS)),
        refreshLimited,
    };
}

async function fetchManifest(source: string): Promise<UpdateManifest> {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid update source');
    const response = await fetch(source, {
        method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body) throw new Error('Update source unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16384) throw new Error('Update manifest too large');
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    return updateManifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

/** Demand-driven checks: administrator reads trigger refresh only when the shared cache expires. */
export async function getUpdateState(force = false): Promise<UpdateState> {
    let cache: CachedCheck | null = null;
    let automatic = true;
    try {
        const [preference, stored] = await Promise.all([
            prisma.appSetting.findUnique({ where: { key: 'updates_automatic' }, select: { value: true } }),
            prisma.appSetting.findUnique({ where: { key: CACHE_KEY }, select: { value: true } }),
        ]);
        automatic = preference?.value !== 'false';
        const source = process.env.COMPDESK_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL;
        if (stored) {
            try {
                const parsed = cacheSchema.safeParse(JSON.parse(stored.value));
                if (parsed.success && parsed.data.source === source) cache = parsed.data;
            } catch { /* Invalid persisted cache is treated as missing. */ }
        }
        const age = cache ? Date.now() - Date.parse(cache.lastChecked) : Infinity;
        if (!force && (!automatic || (age >= 0 && age < CACHE_PERIOD_MS))) return stateFromCache(cache, automatic);

        // A database-backed gate also prevents concurrent replicas and repeated manual clicks
        // from issuing excessive external requests. No user identifier reaches the source.
        const gate = await consumeDatabaseRateLimit('updates-check', 'installation', 1, 60_000);
        if (!gate.allowed) return stateFromCache(cache, automatic, force);

        let manifest = cache?.manifest ?? null;
        let checkStatus: 'ok' | 'unavailable' = 'ok';
        try { manifest = await fetchManifest(source); }
        catch { checkStatus = 'unavailable'; }
        cache = { source, manifest, checkStatus, lastChecked: new Date().toISOString() };
        await prisma.appSetting.upsert({
            where: { key: CACHE_KEY }, update: { value: JSON.stringify(cache) },
            create: { key: CACHE_KEY, value: JSON.stringify(cache) },
        });
        return stateFromCache(cache, automatic);
    } catch {
        // Fail closed on unreadable preferences: no external call when opt-out cannot be read.
        return { ...stateFromCache(cache, automatic), checkStatus: 'unavailable', stale: true };
    }
}
