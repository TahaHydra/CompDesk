import path from 'path';

const SAFE_SEGMENT = /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]+)?$/;

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
    if (!SAFE_SEGMENT.test(ticketId) || !SAFE_SEGMENT.test(filename)) {
        throw new Error('Invalid private attachment path');
    }
    const root = attachmentStorageRoot();
    const directory = path.resolve(root, ticketId);
    const absolutePath = path.resolve(directory, filename);
    if (!directory.startsWith(`${root}${path.sep}`) || !absolutePath.startsWith(`${directory}${path.sep}`)) {
        throw new Error('Invalid private attachment path');
    }
    return {
        root,
        directory,
        absolutePath,
        reference: `private/${ticketId}/${filename}`,
    };
}

export function temporaryAttachmentLocation(userId: string, filename: string) {
    if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(filename)) {
        throw new Error('Invalid temporary attachment path');
    }
    const root = attachmentStorageRoot();
    const directory = path.resolve(root, 'temp', userId);
    const absolutePath = path.resolve(directory, filename);
    if (!directory.startsWith(`${root}${path.sep}`) || !absolutePath.startsWith(`${directory}${path.sep}`)) {
        throw new Error('Invalid temporary attachment path');
    }
    return {
        directory,
        absolutePath,
        reference: `temporary/${userId}/${filename}`,
    };
}

export function resolveTemporaryAttachmentPath(reference: string, userId: string): string | null {
    const match = /^temporary\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(reference);
    if (!match || match[1] !== userId) return null;
    return temporaryAttachmentLocation(match[1], match[2]).absolutePath;
}

export function resolveStoredAttachmentPath(reference: string, ticketId: string): string | null {
    const privateMatch = /^private\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(reference);
    if (privateMatch && privateMatch[1] === ticketId) {
        return privateAttachmentLocation(privateMatch[1], privateMatch[2]).absolutePath;
    }

    const legacyMatch = /^\/uploads\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(reference);
    if (!legacyMatch || legacyMatch[1] !== ticketId) return null;
    const publicRoot = path.resolve(process.cwd(), 'public', 'uploads');
    const absolutePath = path.resolve(publicRoot, legacyMatch[1], legacyMatch[2]);
    return absolutePath.startsWith(`${publicRoot}${path.sep}`) ? absolutePath : null;
}

export function authenticatedAttachmentUrl(id: string): string {
    return `/api/upload/${encodeURIComponent(id)}`;
}
