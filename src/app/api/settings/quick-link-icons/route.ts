import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { parseDashboardLinks } from '@/lib/dashboard-links';
import { isAdminRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { isUploadedImageUrl, removeUploadedImage, storeUploadedImage } from '@/lib/uploaded-image';

const MAX_QUICK_LINK_ICON_SIZE = 512 * 1024;

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File)) return NextResponse.json({ error: 'No icon image provided' }, { status: 400 });
        const stored = await storeUploadedImage(file, 'quick-links', MAX_QUICK_LINK_ICON_SIZE);
        await auditLog({ userId: session.user.id, action: 'dashboard_link.icon_uploaded', entity: 'app_setting', metadata: { mimeType: stored.mimeType, size: stored.size } });
        return NextResponse.json({ url: stored.url }, { status: 201 });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to upload quick-link icon';
        logger.error('Failed to upload quick-link icon', { error });
        return NextResponse.json({ error: message }, { status: message.startsWith('Image') || message.startsWith('Only') || message.startsWith('The uploaded') ? 400 : 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const url = request.nextUrl.searchParams.get('url') || '';
        if (!isUploadedImageUrl(url, 'quick-links')) return NextResponse.json({ error: 'Invalid quick-link icon URL' }, { status: 400 });
        const storedLinks = await prisma.appSetting.findUnique({ where: { key: 'dashboard_links' }, select: { value: true } });
        if (parseDashboardLinks(storedLinks?.value).some((link) => link.iconUrl === url)) {
            return NextResponse.json({ error: 'Remove the icon from its dashboard link before deleting the file' }, { status: 409 });
        }
        await removeUploadedImage(url, 'quick-links');
        await auditLog({ userId: session.user.id, action: 'dashboard_link.icon_deleted', entity: 'app_setting' });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete quick-link icon', { error });
        return NextResponse.json({ error: 'Failed to delete quick-link icon' }, { status: 500 });
    }
}