import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'text/plain', 'text/csv',
];

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const ticketId = formData.get('ticketId') as string | null;

        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: `File type not allowed: ${file.type}` }, { status: 400 });
        }

        // Generate unique filename
        const ext = path.extname(file.name) || '';
        const uniqueName = `${crypto.randomBytes(8).toString('hex')}${ext}`;
        const subDir = ticketId || 'temp';
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', subDir);

        await mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, uniqueName);
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(filePath, buffer);

        const relativePath = `/uploads/${subDir}/${uniqueName}`;

        // Create attachment record if ticketId is provided
        let attachment = null;
        if (ticketId) {
            // Verify ticket exists
            const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
            if (!ticket) {
                return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
            }

            attachment = await prisma.attachment.create({
                data: {
                    ticketId,
                    filename: file.name,
                    mimetype: file.type,
                    size: file.size,
                    path: relativePath,
                },
            });
        }

        return NextResponse.json({
            id: attachment?.id || null,
            filename: file.name,
            mimetype: file.type,
            size: file.size,
            url: relativePath,
            path: relativePath,
        });
    } catch (error) {
        console.error('Upload failed:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
