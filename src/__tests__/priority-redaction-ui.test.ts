import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/lib/i18n';

let mockPriority: string | null = null;
jest.mock('@/components/providers/language-provider', () => ({ useLanguage: () => ({ language: 'en', t: (key: string) => translate('en', key) }) }));
jest.mock('@/components/providers/branding-provider', () => ({ useBranding: () => ({ shortApplicationName: 'CompDesk' }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'owner', role: 'SUPER_ADMIN' } } }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const ticket = { id: 'ticket', key: 'T-1', title: 'Support request', status: 'NEW', priority: mockPriority, createdAt: '2026-10-02T10:00:00Z', assignments: [], assignees: [] };
    return { data: queryKey[0] === 'dashboard-stats' ? { stats: { total: 1, open: 1, pending: 0, resolved: 0, urgent: 0, escalated: 0 }, recentTickets: [ticket], customLinks: [], ticketView: 'all' }
        : ['queue-tickets', 'tickets'].includes(queryKey[0]) ? { tickets: [ticket], pagination: { page: 1, pages: 1, total: 1 } }
            : queryKey[0] === 'queues' ? [{ id: 'queue', name: 'Department' }] : [], isLoading: false, isError: false, refetch: jest.fn() };
} }));

import DashboardPage from '@/app/(dashboard)/dashboard/page';
import QueueInboxPage from '@/app/(dashboard)/queue/page';
import TicketsPage from '@/app/(dashboard)/tickets/page';

test.each([['dashboard', DashboardPage], ['department inbox', QueueInboxPage], ['tickets', TicketsPage]] as const)('%s renders redacted priority and preserves ordinary priority badges', (_name, Page) => {
    mockPriority = null;
    const hidden = renderToStaticMarkup(React.createElement(Page));
    expect(hidden).toContain('Support request');
    expect(hidden).not.toContain('priority-normal');
    expect(hidden).not.toMatch(/<td[^>]*><(?:div|span)[^>]*>NORMAL<\/(?:div|span)>/);
    mockPriority = 'NORMAL';
    const normal = renderToStaticMarkup(React.createElement(Page));
    expect(normal).toContain('Support request');
    expect(normal).toMatch(/<td[^>]*><(?:div|span)[^>]*>NORMAL<\/(?:div|span)>/);
});
