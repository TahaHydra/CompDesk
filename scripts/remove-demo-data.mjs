import nextEnv from '@next/env';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { removeDemoData, DEMO_CONFIRMATION } from './demo-data.mjs';

nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes(`--confirm=${DEMO_CONFIRMATION}`)) {
    console.error('Refusing removal. Run locally with --confirm=REMOVE-DEMO-DATA.');
    process.exit(2);
}
const prisma = new PrismaClient();
try {
    const installation = await prisma.installationRecord.findUnique({ where: { id: 'primary' } });
    const owner = installation ? await prisma.user.findUnique({ where: { normalizedEmail: installation.installedByEmail.trim().toLowerCase() } }) : null;
    const admin = owner || await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, orderBy: { isDemo: 'asc' } });
    const { attachments, ...result } = await removeDemoData(prisma, { protectedUserId: admin?.id, confirmation: DEMO_CONFIRMATION });
    let filesRetained = 0;
    for (const attachment of attachments) {
        // Only unlink a single recognized file inside its expected ticket directory.
        const match = /^(private\/|\/uploads\/)([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(attachment.path);
        if (!match || match[2] !== attachment.ticketId) { filesRetained += 1; continue; }
        const root = match[1] === 'private/' ? path.resolve(process.env.ATTACHMENT_STORAGE_DIR || 'storage/attachments') : path.resolve('public/uploads');
        const filename = path.resolve(root, match[2], match[3]);
        if (!filename.startsWith(`${root}${path.sep}`)) { filesRetained += 1; continue; }
        try { await fs.unlink(filename); } catch (error) { if (error.code !== 'ENOENT') filesRetained += 1; }
    }
    console.log(`Demo cleanup complete: ${result.removed} records removed, ${result.retained} preserved, ${result.deactivated} referenced accounts deactivated, ${filesRetained} attachment files retained.`);
} catch (error) {
    console.error(error.statusCode ? error.message : 'Demo cleanup failed. No partial database changes were committed.');
    process.exitCode = 1;
} finally { await prisma.$disconnect(); }
