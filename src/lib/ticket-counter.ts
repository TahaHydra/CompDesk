import type { Prisma } from '@prisma/client';
export async function reserveNextTicketCount(tx: Prisma.TransactionClient, year: number): Promise<number> {
    // Covers absent singleton initialization and yearly rollover, not just increments.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1449756211)`;
    const current = await tx.ticketCounter.findUnique({ where: { id: 'singleton' } });
    if (!current) return (await tx.ticketCounter.create({ data: { id: 'singleton', year, count: 1 } })).count;
    return (await tx.ticketCounter.update({ where: { id: 'singleton' }, data: current.year === year ? { count: { increment: 1 } } : { year, count: 1 } })).count;
}
