import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { BRANDING_ASSET_FIELDS, brandingConfigSchema, DEFAULT_BRANDING, getBrandingConfig, saveBrandingConfig } from '@/lib/branding';
import { unlink } from 'fs/promises';
import path from 'path';
import logger from '@/lib/logger';

export async function GET() {
    const session = await auth();
    if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(await getBrandingConfig());
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const parsed = brandingConfigSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Branding validation failed', details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const previous = await getBrandingConfig();
        const branding = await saveBrandingConfig(parsed.data);
        const changedKeys = Object.keys(branding).filter(
            (key) => branding[key as keyof typeof branding] !== previous[key as keyof typeof previous]
        );

        await auditLog({
            userId: session.user.id,
            action: 'branding.updated',
            entity: 'branding',
            metadata: { changedKeys },
            ipAddress: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
            userAgent: req.headers.get('user-agent') ?? undefined,
        });

        return NextResponse.json(branding);
    } catch (error) {
        logger.error('Failed to update branding', { error });
        return NextResponse.json({ error: 'Failed to update branding' }, { status: 500 });
    }
}
export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const previous = await getBrandingConfig();
        const branding = await saveBrandingConfig(DEFAULT_BRANDING);
        const base = path.resolve(process.cwd(), 'public', 'uploads', 'branding');
        const assets = new Set(BRANDING_ASSET_FIELDS.map((field) => previous[field]).filter(Boolean));
        await Promise.all([...assets].map(async (assetUrl) => {
            const candidate = path.resolve(process.cwd(), 'public', assetUrl.replace(/^\/+/, ''));
            if (candidate.startsWith(`${base}${path.sep}`)) await unlink(candidate).catch(() => undefined);
        }));
        await auditLog({
            userId: session.user.id,
            action: 'branding.reset',
            entity: 'branding',
            metadata: { resetFields: Object.keys(DEFAULT_BRANDING) },
            ipAddress: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
            userAgent: req.headers.get('user-agent') ?? undefined,
        });
        return NextResponse.json(branding);
    } catch (error) {
        logger.error('Failed to reset branding', { error });
        return NextResponse.json({ error: 'Failed to reset branding' }, { status: 500 });
    }
}