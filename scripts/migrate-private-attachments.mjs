import path from 'node:path';
import { constants } from 'node:fs';
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import nextEnv from '@next/env';
import { PrismaClient } from '@prisma/client';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const storageRoot = path.resolve(
    process.cwd(),
    process.env.ATTACHMENT_STORAGE_DIR?.trim() || path.join('storage', 'attachments')
);
const publicRoot = path.resolve(process.cwd(), 'public');
if (storageRoot === publicRoot || storageRoot.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error('Private attachment storage cannot be inside the public directory');
}

let moved = 0;
let repaired = 0;
let missing = 0;

try {
    const attachments = await prisma.attachment.findMany({
        where: { path: { startsWith: '/uploads/' } },
        select: { id: true, ticketId: true, path: true },
    });

    for (const attachment of attachments) {
        const match = /^\/uploads\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(attachment.path);
        if (!match || match[1] !== attachment.ticketId) {
            missing += 1;
            continue;
        }

        const source = path.resolve(process.cwd(), 'public', 'uploads', match[1], match[2]);
        const destinationDirectory = path.resolve(storageRoot, match[1]);
        const destination = path.resolve(destinationDirectory, match[2]);
        if (!source.startsWith(`${path.resolve(process.cwd(), 'public', 'uploads')}${path.sep}`)
            || !destination.startsWith(`${destinationDirectory}${path.sep}`)) {
            missing += 1;
            continue;
        }

        const sourceInfo = await stat(source).catch(() => null);
        const destinationInfo = await stat(destination).catch(() => null);
        if (sourceInfo?.isFile()) {
            await mkdir(destinationDirectory, { recursive: true });
            if (!destinationInfo?.isFile()) {
                await copyFile(source, destination, constants.COPYFILE_EXCL);
            } else if (destinationInfo.size !== sourceInfo.size) {
                missing += 1;
                continue;
            }
        } else if (destinationInfo?.isFile()) {
            repaired += 1;
        } else {
            missing += 1;
            continue;
        }

        await prisma.attachment.update({
            where: { id: attachment.id },
            data: { path: `private/${match[1]}/${match[2]}` },
        });
        if (sourceInfo?.isFile()) {
            await unlink(source);
            moved += 1;
        }
    }

    if (moved || repaired || missing) {
        console.log(`Private attachment migration: ${moved} moved, ${repaired} repaired, ${missing} missing.`);
    }
} finally {
    await prisma.$disconnect();
}
