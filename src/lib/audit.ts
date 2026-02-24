import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

export async function auditLog(params: {
    userId?: string;
    action: string;
    entity: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}) {
    try {
        await prisma.auditLog.create({
            data: {
                userId: params.userId,
                action: params.action,
                entity: params.entity,
                entityId: params.entityId,
                metadata: (params.metadata as any) ?? undefined,
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            },
        });
    } catch (error) {
        logger.error('Failed to create audit log', {
            error: error instanceof Error ? error.message : error,
            ...params,
        });
    }
}
