import nextEnv from '@next/env';
import { PrismaClient } from '@prisma/client';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.argv.includes('--confirm=REMOVE-DEMO-DATA')) {
    console.error('Refusing removal. Run locally with --confirm=REMOVE-DEMO-DATA.');
    process.exit(2);
}

const prisma = new PrismaClient();
try {
    const demoUsers = await prisma.user.findMany({ where: { isDemo: true }, select: { id: true, email: true } });
    let removed = 0;
    let deactivated = 0;
    for (const user of demoUsers) {
        const dependencies = await Promise.all([
            prisma.ticket.count({ where: { requesterId: user.id } }),
            prisma.ticket.count({ where: { OR: [{ escalatedById: user.id }, { escalatedToId: user.id }] } }),
            prisma.ticketAssignee.count({ where: { OR: [{ userId: user.id }, { assignedById: user.id }] } }),
            prisma.timelineEvent.count({ where: { userId: user.id } }),
            prisma.auditLog.count({ where: { userId: user.id } }),
        ]);
        if (dependencies.some((count) => count > 0)) {
            await prisma.user.update({
                where: { id: user.id },
                data: { isActive: false, passwordHash: null, sessions: { deleteMany: {} }, accounts: { deleteMany: {} } },
            });
            deactivated += 1;
            continue;
        }
        await prisma.$transaction([
            prisma.groupMember.deleteMany({ where: { userId: user.id } }),
            prisma.queueMember.deleteMany({ where: { userId: user.id } }),
            prisma.ticketWatcher.deleteMany({ where: { userId: user.id } }),
            prisma.session.deleteMany({ where: { userId: user.id } }),
            prisma.account.deleteMany({ where: { userId: user.id } }),
            prisma.user.delete({ where: { id: user.id } }),
        ]);
        removed += 1;
    }
    console.log(`Demo cleanup complete: ${removed} removed, ${deactivated} deactivated to preserve referenced history.`);
} finally {
    await prisma.$disconnect();
}
