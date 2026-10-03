import path from 'node:path';
import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat, lstat, unlink, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';
import { PrismaClient } from '@prisma/client';

async function fileInfo(file) {
    try {
        const info = await lstat(file);
        if (!info.isFile()) throw new Error(`Attachment migration requires a regular file: ${file}`);
        return info;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function digest(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

async function containsFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || await containsFiles(path.join(directory, entry.name))) return true;
    }
    return false;
}

async function normalizeHistoricalPlaceholder(file) {
    const info = await lstat(file);
    if (!info.isFile()) return false;
    if (info.size === 0) return true;
    if (info.size !== 9 && info.size !== 10) return false;
    const handle = await open(file, constants.O_RDWR | (constants.O_NOFOLLOW || 0));
    try {
        const openedInfo = await handle.stat();
        if (!openedInfo.isFile() || openedInfo.size !== info.size) return false;
        const bytes = Buffer.alloc(info.size);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead !== bytes.length || (!bytes.equals(Buffer.from('.gitkeep\n')) && !bytes.equals(Buffer.from('.gitkeep\r\n')))) return false;
        // Only these exact historical repository sentinels have no application data.
        await handle.truncate(0);
        return true;
    } finally {
        await handle.close();
    }
}

export async function migratePrivateAttachments({ root, storageRoot, prisma }) {
    root = path.resolve(root);
    storageRoot = path.resolve(storageRoot);
    const publicRoots = [path.join(root, 'public'), path.join(root, '.next', 'standalone', 'public')];
    for (const publicRoot of publicRoots) {
        if (storageRoot === publicRoot || storageRoot.startsWith(`${publicRoot}${path.sep}`)) {
            throw new Error('Private attachment storage cannot be inside a public directory');
        }
    }
    let moved = 0;
    const attachments = await prisma.attachment.findMany({
        where: { OR: [{ path: { startsWith: '/uploads/' } }, { path: { startsWith: 'private/' } }] },
        select: { id: true, ticketId: true, path: true },
    });

    for (const attachment of attachments) {
        const legacy = attachment.path.startsWith('/uploads/');
        const match = /^(?:\/uploads\/|private\/)([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(attachment.path);
        if (!match || match[1] !== attachment.ticketId) {
            if (legacy) throw new Error(`Invalid legacy attachment reference: ${attachment.id}`);
            continue;
        }
        const sources = [];
        for (const publicRoot of publicRoots) {
            const source = path.join(publicRoot, 'uploads', match[1], match[2]);
            if (await fileInfo(source)) sources.push(source);
        }
        const destinationDirectory = path.resolve(storageRoot, match[1]);
        const destination = path.resolve(destinationDirectory, match[2]);
        let destinationInfo = await fileInfo(destination);
        if (!destinationInfo && sources.length) {
            await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
            try {
                await copyFile(sources[0], destination, constants.COPYFILE_EXCL);
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
            }
            destinationInfo = await fileInfo(destination);
        }
        if (!destinationInfo) {
            if (legacy || sources.length) throw new Error(`Missing private attachment: ${attachment.id}`);
            continue;
        }
        if (sources.length) {
            const privateDigest = await digest(destination);
            for (const source of sources) {
                if (await digest(source) !== privateDigest) throw new Error(`Attachment copy conflict: ${attachment.id}`);
            }
        }
        if (legacy) {
            await prisma.attachment.update({ where: { id: attachment.id }, data: { path: `private/${match[1]}/${match[2]}` } });
        }
        // Never delete a sole copy or bytes whose verified private counterpart differs.
        for (const source of sources) {
            await unlink(source).catch((error) => { if (error.code !== 'ENOENT') throw error; });
            moved += 1;
        }
    }
    for (const publicRoot of publicRoots) {
        const uploads = path.join(publicRoot, 'uploads');
        const entries = await readdir(uploads, { withFileTypes: true }).catch((error) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        for (const entry of entries) {
            if (entry.name === '.gitkeep' && entry.isFile() && await normalizeHistoricalPlaceholder(path.join(uploads, entry.name))) continue;
            if (['branding', 'quick-links'].includes(entry.name) && entry.isDirectory()) continue;
            if (entry.name === '.gitkeep' || !entry.isDirectory() || await containsFiles(path.join(uploads, entry.name))) {
                throw new Error(`Unhandled public upload remains; preserve and reconcile it before startup: ${path.join(uploads, entry.name)}`);
            }
        }
    }
    if (moved) console.log(`Private attachment migration: ${moved} public copies removed after private verification.`);
}

async function removeExpiredTemporaryFiles(storageRoot) {
    const ttlHours = Number.parseInt(process.env.TEMP_ATTACHMENT_TTL_HOURS || '24', 10);
    const cutoff = Date.now() - (Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 24) * 60 * 60 * 1000;
    const tempRoot = path.resolve(storageRoot, 'temp');
    const userDirectories = await readdir(tempRoot, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    let expiredRemoved = 0;
    for (const userDirectory of userDirectories) {
        if (!userDirectory.isDirectory() || !/^[a-zA-Z0-9-]+$/.test(userDirectory.name)) continue;
        const directory = path.resolve(tempRoot, userDirectory.name);
        const files = await readdir(directory, { withFileTypes: true });
        for (const file of files) {
            if (!file.isFile() || !/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/.test(file.name)) continue;
            const filePath = path.resolve(directory, file.name);
            if (!filePath.startsWith(`${directory}${path.sep}`)) continue;
            const info = await stat(filePath).catch(() => null);
            if (info?.isFile() && info.mtimeMs <= cutoff) {
                await unlink(filePath).catch(() => undefined);
                expiredRemoved += 1;
            }
        }
    }
    if (expiredRemoved > 0) console.log(`Temporary attachment cleanup: ${expiredRemoved} expired files removed.`);
}

export async function runPrivateAttachmentMigration() {
    nextEnv.loadEnvConfig(process.cwd());
    const root = process.cwd();
    const storageRoot = path.resolve(root, process.env.ATTACHMENT_STORAGE_DIR?.trim() || path.join('storage', 'attachments'));
    const prisma = new PrismaClient();
    try {
        await migratePrivateAttachments({ root, storageRoot, prisma });
        await removeExpiredTemporaryFiles(storageRoot);
    } finally {
        await prisma.$disconnect();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await runPrivateAttachmentMigration();
}
