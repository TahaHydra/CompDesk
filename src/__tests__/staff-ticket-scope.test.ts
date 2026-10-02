import { buildTicketVisibilityWhere } from '@/lib/ticket-search';
test.each(['AGENT', 'ADMIN'] as const)('staff %s my-ticket scope retains department authorization', (role) => {
    expect(buildTicketVisibilityWhere('u', role, 'my', ['allowed'])).toEqual({ AND: [{ queueId: { in: ['allowed'] } }, { OR: [{ assignments: { some: { userId: 'u' } } }, { requesterId: 'u' }] }] });
});
test('revoked staff access cannot be regained by having requested a ticket', () => {
    expect(buildTicketVisibilityWhere('u', 'AGENT', 'my', [])).toHaveProperty('AND.0.queueId.in', ['__none__']);
});
test('requester and super-admin scopes retain existing behavior', () => {
    expect(buildTicketVisibilityWhere('u', 'USER', 'my', [])).toEqual({ requesterId: 'u' });
    expect(buildTicketVisibilityWhere('u', 'SUPER_ADMIN', 'my', null)).toEqual({ OR: [{ assignments: { some: { userId: 'u' } } }, { requesterId: 'u' }] });
});
