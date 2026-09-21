import { NextRequest, NextResponse } from 'next/server';
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
import { readUploadFormData, UploadBodyError } from '@/lib/bounded-upload';
import {
    IMAGE_MIME_EXTENSIONS,
    detectImageMime,
    removeUploadedImage,
    storeUploadedImage,
} from '@/lib/uploaded-image';

const MAX_BRANDING_ASSET_SIZE = 5 * 1024 * 1024;

function isBrandingAssetField(value: string): value is BrandingAssetField {
    return BRANDING_ASSET_FIELDS.includes(value as BrandingAssetField);
}

async function removeAssetWhenUnreferenced(assetUrl: string, config: BrandingConfig): Promise<void> {
    if (!assetUrl.startsWith('/uploads/branding/')) return;
    const stillUsed = BRANDING_ASSET_FIELDS.some((field) => config[field] === assetUrl);
    if (stillUsed) return;

    await removeUploadedImage(assetUrl, 'branding');
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await readUploadFormData(req, MAX_BRANDING_ASSET_SIZE + 64 * 1024);
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
        if (!IMAGE_MIME_EXTENSIONS[fileValue.type]) {
            return NextResponse.json({ error: 'Only PNG, JPEG, WebP, GIF, and ICO assets are allowed. SVG is not accepted.' }, { status: 400 });
        }

        const buffer = Buffer.from(await fileValue.arrayBuffer());
        const detectedMime = detectImageMime(buffer);
        const normalizedDeclaredMime = fileValue.type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : fileValue.type;
        if (!detectedMime || detectedMime !== normalizedDeclaredMime) {
            return NextResponse.json({ error: 'The uploaded file content does not match its image type' }, { status: 400 });
        }

        const stored = await storeUploadedImage(fileValue, 'branding', MAX_BRANDING_ASSET_SIZE);
        const previous = await getBrandingConfig();
        const assetUrl = stored.url;
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
        if (error instanceof UploadBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
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
