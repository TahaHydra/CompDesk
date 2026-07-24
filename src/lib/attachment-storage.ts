import path from 'path';
import { readdir, stat, unlink } from 'fs/promises';

const SAFE_SEGMENT = /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]+)?$/;

function positiveIntegerEnv(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function temporaryAttachmentLimits() {
    return {
        ttlMs: positiveIntegerEnv('TEMP_ATTACHMENT_TTL_HOURS', 24) * 60 * 60 * 1000,
        maxFilesPerUser: positiveIntegerEnv('TEMP_ATTACHMENT_MAX_FILES_PER_USER', 20),
        maxBytesPerUser: positiveIntegerEnv('TEMP_ATTACHMENT_MAX_BYTES_PER_USER', 100 * 1024 * 1024),
    };
}

export function attachmentStorageRoot(): string {
    const configured = process.env.ATTACHMENT_STORAGE_DIR?.trim();
    const root = configured
        ? path.resolve(process.cwd(), configured)
        : path.resolve(process.cwd(), 'storage', 'attachments');
    const publicRoot = path.resolve(process.cwd(), 'public');
    if (root === publicRoot || root.startsWith(`${publicRoot}${path.sep}`)) {
        throw new Error('Private attachment storage cannot be inside the public directory');
    }
    return root;
}

export function privateAttachmentLocation(ticketId: string, filename: string) {
    if (!SAFE_SEGMENT.test(ticketId) || !SAFE_SEGMENT.test(filename)) throw new Error('Invalid private attachment path');
    const root = attachmentStorageRoot();
    const directory = path.resolve(root, ticketId);
    const absolutePath = path.resolve(directory, filename);
    if (!directory.startsWith(`${root}${path.sep}`) || !absolutePath.startsWith(`${directory}${path.sep}`)) {
        throw new Error('Invalid private attachment path');
    }
    return { root, directory, absolutePath, reference: `private/${ticketId}/${filename}` };
}

export function temporaryAttachmentLocation(userId: string, filename: string) {
    if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(filename)) throw new Error('Invalid temporary attachment path');
    const root = attachmentStorageRoot();
    const directory = path.resolve(root, 'temp', userId);
    const absolutePath = path.resolve(directory, filename);
    if (!directory.startsWith(`${root}${path.sep}`) || !absolutePath.startsWith(`${directory}${path.sep}`)) {
        throw new Error('Invalid temporary attachment path');
    }
    return { directory, absolutePath, reference: `temporary/${userId}/${filename}` };
}

export async function temporaryAttachmentUsage(userId: string, now = Date.now()) {
    const probe = temporaryAttachmentLocation(userId, 'usage.tmp');
    const entries = await readdir(probe.directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    const limits = temporaryAttachmentLimits();
    let files = 0;
    let bytes = 0;
    let removedExpired = 0;

    for (const entry of entries) {
        if (!entry.isFile() || !SAFE_SEGMENT.test(entry.name)) continue;
        const filePath = path.resolve(probe.directory, entry.name);
        if (!filePath.startsWith(`${probe.directory}${path.sep}`)) continue;
        const info = await stat(filePath).catch(() => null);
        if (!info?.isFile()) continue;
        if (now - info.mtimeMs >= limits.ttlMs) {
            await unlink(filePath).catch(() => undefined);
            removedExpired += 1;
            continue;
        }
        files += 1;
        bytes += info.size;
    }
    return { files, bytes, removedExpired, limits };
}

export function resolveTemporaryAttachmentPath(reference: string, userId: string): string | null {
    const match = /^temporary\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(reference);
    if (!match || match[1] !== userId) return null;
    return temporaryAttachmentLocation(match[1], match[2]).absolutePath;
}

export function resolveStoredAttachmentPath(reference: string, ticketId: string): string | null {
    const privateMatch = /^private\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(reference);
    if (privateMatch && privateMatch[1] === ticketId) return privateAttachmentLocation(privateMatch[1], privateMatch[2]).absolutePath;

    const legacyMatch = /^\/uploads\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(reference);
    if (!legacyMatch || legacyMatch[1] !== ticketId) return null;
    const publicRoot = path.resolve(process.cwd(), 'public', 'uploads');
    const absolutePath = path.resolve(publicRoot, legacyMatch[1], legacyMatch[2]);
    return absolutePath.startsWith(`${publicRoot}${path.sep}`) ? absolutePath : null;
}

export function authenticatedAttachmentUrl(id: string): string {
    return `/api/upload/${encodeURIComponent(id)}`;
}
