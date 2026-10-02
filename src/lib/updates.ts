import { z } from 'zod';

export interface UpdateManifest {
    latest: string;
    severity: 'normal' | 'critical';
    minimum_supported?: string;
    release_url: string;
    published_at?: string;
    summary?: string;
    upgrade_notes?: string;
}

export interface UpdateState {
    installed: string;
    automatic: boolean;
    manifest: UpdateManifest | null;
    lastChecked: string | null;
    checkStatus: 'ok' | 'unavailable' | 'not_checked';
    stale: boolean;
    refreshLimited: boolean;
}

export interface UpdateHealth {
    application: boolean;
    database: boolean | null;
    installation: boolean | null;
    migrations: boolean | null;
    storage: boolean | null;
    previousVersion: null;
    lastSuccessfulUpdate: null;
    recoveryPoint: null;
}

export interface UpdateInstructions { command: string }

// Strict SemVer, including numeric prerelease identifiers without leading zeroes.
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const versionSchema = z.string().max(128).regex(versionPattern);
const httpsUrl = z.string().max(2048).url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
});
export const updateManifestSchema = z.object({
    latest: versionSchema,
    severity: z.enum(['normal', 'critical']),
    minimum_supported: versionSchema.optional(),
    release_url: httpsUrl,
    published_at: z.string().datetime({ offset: true }).optional(),
    summary: z.string().max(2000).optional(),
    upgrade_notes: z.string().max(6000).optional(),
});

export const UPGRADE_DOCUMENTATION = 'https://github.com/TahaHydra/CompDesk/blob/main/docs/UPGRADING.md';
export const BACKUP_DOCUMENTATION = 'https://github.com/TahaHydra/CompDesk/blob/main/docs/BACKUP_AND_RESTORE.md';
export const RELEASES_URL = 'https://github.com/TahaHydra/CompDesk/releases';

export function parseUpdateManifest(value: unknown): UpdateManifest | null {
    const result = updateManifestSchema.safeParse(value);
    return result.success ? result.data : null;
}

function compareIdentifier(a: string, b: string): number {
    if (a === b) return 0;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) return a.length !== b.length ? Math.sign(a.length - b.length) : a < b ? -1 : 1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a < b ? -1 : 1;
}

/** Returns precedence without treating build metadata as a new release. */
export function compareVersions(a: string, b: string): number {
    const left = a.match(versionPattern);
    const right = b.match(versionPattern);
    if (!left || !right) return 0;
    for (let index = 1; index <= 3; index++) {
        const result = compareIdentifier(left[index], right[index]);
        if (result) return result;
    }
    if (!left[4] || !right[4]) return left[4] === right[4] ? 0 : left[4] ? -1 : 1;
    const leftPre = left[4].split('.');
    const rightPre = right[4].split('.');
    for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index++) {
        if (leftPre[index] === undefined) return -1;
        if (rightPre[index] === undefined) return 1;
        const result = compareIdentifier(leftPre[index], rightPre[index]);
        if (result) return result;
    }
    return 0;
}

export function canInspectUpdates(role: string): boolean {
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function dismissalKey(userId: string): string {
    return `compdesk:update-dismissal:${encodeURIComponent(userId)}`;
}

export function updatePresentation(role: string, installed: string, manifest: UpdateManifest | null, dismissed: string | null) {
    const visible = canInspectUpdates(role) && Boolean(manifest && compareVersions(manifest.latest, installed) > 0);
    return {
        visible,
        expanded: visible && dismissed !== manifest?.latest,
        tone: visible ? manifest?.severity === 'critical' ? 'red' as const : 'blue' as const : null,
        privileged: role === 'SUPER_ADMIN',
    };
}
