import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { resolveUploadRoots, type UploadImageFolder } from '@/lib/uploaded-image';

const PUBLIC_UPLOAD_FOLDERS = new Set<UploadImageFolder>(['branding', 'quick-links']);
const PUBLIC_IMAGE_NAME = /^[0-9a-f-]{36}\.(?:png|jpg|webp|gif|ico)$/;
const CONTENT_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
};

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ folder: string; filename: string }> }
) {
    const { folder, filename } = await params;
    if (!PUBLIC_UPLOAD_FOLDERS.has(folder as UploadImageFolder) || !PUBLIC_IMAGE_NAME.test(filename)) {
        return new NextResponse('Not found', { status: 404 });
    }

    for (const root of resolveUploadRoots()) {
        const directory = path.resolve(root, folder);
        const candidate = path.resolve(directory, filename);
        if (!candidate.startsWith(`${directory}${path.sep}`)) continue;
        try {
            const contents = await readFile(candidate);
            return new NextResponse(contents, {
                headers: {
                    'Content-Type': CONTENT_TYPES[path.extname(filename)] ?? 'application/octet-stream',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            if (code !== 'ENOENT') throw error;
        }
    }

    return new NextResponse('Not found', { status: 404 });
}
