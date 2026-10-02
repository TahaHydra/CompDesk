import { unlink } from 'node:fs/promises';
import { getDemoState as readDemoState, installDemoData as installDataset, removeDemoData as removeDataset, DEMO_CONFIRMATION } from '../../scripts/demo-data.mjs';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { resolveStoredAttachmentPath } from '@/lib/attachment-storage';
import logger from '@/lib/logger';

export const getDemoState = () => readDemoState(prisma);

export async function installDemoData(protectedUserId: string) {
    const credentials = await installDataset(prisma, { protectedUserId });
    await auditLog({ userId: protectedUserId, action: 'DEMO_DATA_INSTALLED', entity: 'DemoData' });
    return credentials;
}

export async function removeDemoData(protectedUserId: string) {
    const { attachments, ...result } = await removeDataset(prisma, { protectedUserId, confirmation: DEMO_CONFIRMATION });
    let filesRetained = 0;
    for (const attachment of attachments) {
        const location = resolveStoredAttachmentPath(attachment.path, attachment.ticketId);
        if (!location) { filesRetained += 1; continue; }
        try { await unlink(location); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                filesRetained += 1;
                logger.warn('Could not remove a demo attachment file', { ticketId: attachment.ticketId });
            }
        }
    }
    await auditLog({ userId: protectedUserId, action: 'DEMO_DATA_REMOVED', entity: 'DemoData', metadata: { ...result, filesRetained } });
    return { ...result, filesRetained };
}
