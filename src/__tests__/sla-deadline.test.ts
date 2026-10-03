import { resolutionSlaBreached } from '@/lib/sla-deadline';
test('a restarted future deadline overrides ticket age', () => {
    expect(resolutionSlaBreached({ status: 'OPEN', createdAt: new Date(0), dueAt: new Date(20000) }, 1, 10000)).toBe(false);
    expect(resolutionSlaBreached({ status: 'OPEN', createdAt: new Date(0), dueAt: new Date(20000) }, 1, 20001)).toBe(true);
});
test.each(['RESOLVED', 'CLOSED', 'WITHDRAWN'])('terminal %s has no active breach', (status) => {
    expect(resolutionSlaBreached({ status, createdAt: new Date(0), dueAt: new Date(1) }, 1, 100000)).toBe(false);
});
test('legacy tickets without dueAt use the policy fallback', () => {
    expect(resolutionSlaBreached({ status: 'OPEN', createdAt: new Date(0), dueAt: null }, 1, 60001)).toBe(true);
});
