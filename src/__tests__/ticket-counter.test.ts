import { reserveNextTicketCount } from '@/lib/ticket-counter';
test.each([null, { year: 2025, count: 999 }])('concurrent initialization/rollover allocations remain unique (%j)', async (initial) => {
    let current: { year: number; count: number } | null = initial;
    let queue = Promise.resolve();
    const allocate = async () => {
        let release = () => {};
        const tx = { $executeRaw: async () => { const previous = queue; queue = new Promise<void>((resolve) => { release = resolve; }); await previous; },
            ticketCounter: { findUnique: async () => current, create: async ({ data }: any) => (current = { ...data }), update: async ({ data }: any) => (current = { year: data.year ?? current!.year, count: typeof data.count === 'object' ? current!.count + data.count.increment : data.count }) } };
        try { return await reserveNextTicketCount(tx as any, 2026); } finally { release(); }
    };
    expect(await Promise.all([allocate(), allocate(), allocate()])).toEqual([1, 2, 3]);
});
