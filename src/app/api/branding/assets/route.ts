import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import path from 'path';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
    BRANDING_ASSET_FIELDS,
    getBrandingConfig,
    saveBrandingConfig,
    type BrandingAssetField,
    type BrandingConfig,
} from '@/lib/branding';
import logger from '@/lib/logger';

const MAX_BRANDING_ASSET_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
};

function isBrandingAssetField(value: string): value is BrandingAssetField {
    return BRANDING_ASSET_FIELDS.includes(value as BrandingAssetField);
}

function detectImageMime(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon';
    return null;
}

function assetsDirectory(): string {
    return path.resolve(process.cwd(), 'public', 'uploads', 'branding');
}

async function removeAssetWhenUnreferenced(assetUrl: string, config: BrandingConfig): Promise<void> {
    if (!assetUrl.startsWith('/uploads/branding/')) return;
    const stillUsed = BRANDING_ASSET_FIELDS.some((field) => config[field] === assetUrl);
    if (stillUsed) return;

    const base = assetsDirectory();
    const candidate = path.resolve(process.cwd(), 'public', assetUrl.replace(/^\/+/, ''));
    if (!candidate.startsWith(`${base}${path.sep}`)) return;
    await unlink(candidate).catch(() => undefined);
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.formData();
        const fieldValue = body.get('field');
        const fileValue = body.get('file');
        if (typeof fieldValue !== 'string' || !isBrandingAssetField(fieldValue)) {
            return NextResponse.json({ error: 'Invalid branding asset field' }, { status: 400 });
        }
        if (!(fileValue instanceof File)) {
            return NextResponse.json({ error: 'No branding asset provided' }, { status: 400 });
        }
        if (fileValue.size === 0 || fileValue.size > MAX_BRANDING_ASSET_SIZE) {
            return NextResponse.json({ error: 'Branding assets must be between 1 byte and 5 MB' }, { status: 400 });
        }
        if (!MIME_EXTENSIONS[fileValue.type]) {
            return NextResponse.json({ error: 'Only PNG, JPEG, WebP, GIF, and ICO assets are allowed. SVG is not accepted.' }, { status: 400 });
        }

        const buffer = Buffer.from(await fileValue.arrayBuffer());
        const detectedMime = detectImageMime(buffer);
        const normalizedDeclaredMime = fileValue.type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : fileValue.type;
        if (!detectedMime || detectedMime !== normalizedDeclaredMime) {
            return NextResponse.json({ error: 'The uploaded file content does not match its image type' }, { status: 400 });
        }

        const extension = MIME_EXTENSIONS[fileValue.type];
        const filename = `${crypto.randomUUID()}${extension}`;
        const directory = assetsDirectory();
        await mkdir(directory, { recursive: true });
        const destination = path.join(directory, filename);
        if (!destination.startsWith(`${directory}${path.sep}`)) {
            return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 });
        }
        await writeFile(destination, buffer, { flag: 'wx' });

        const previous = await getBrandingConfig();
        const assetUrl = `/uploads/branding/${filename}`;
        const branding = await saveBrandingConfig({ ...previous, [fieldValue]: assetUrl });
        await removeAssetWhenUnreferenced(previous[fieldValue], branding);

        await auditLog({
            userId: session.user.id,
            action: 'branding.asset_updated',
            entity: 'branding',
            metadata: { field: fieldValue, mimeType: detectedMime, size: buffer.length },
        });

        return NextResponse.json({ url: assetUrl, branding }, { status: 201 });
    } catch (error) {
        logger.error('Failed to upload branding asset', { error });
        return NextResponse.json({ error: 'Failed to upload branding asset' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const fieldValue = new URL(req.url).searchParams.get('field') ?? '';
        if (!isBrandingAssetField(fieldValue)) {
            return NextResponse.json({ error: 'Invalid branding asset field' }, { status: 400 });
        }

        const previous = await getBrandingConfig();
        const oldAsset = previous[fieldValue];
        const branding = await saveBrandingConfig({ ...previous, [fieldValue]: '' });
        await removeAssetWhenUnreferenced(oldAsset, branding);
        await auditLog({
            userId: session.user.id,
            action: 'branding.asset_reset',
            entity: 'branding',
            metadata: { field: fieldValue },
        });

        return NextResponse.json({ branding });
    } catch (error) {
        logger.error('Failed to reset branding asset', { error });
        return NextResponse.json({ error: 'Failed to reset branding asset' }, { status: 500 });
    }
}