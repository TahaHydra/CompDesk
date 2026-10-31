// beta.5.1: grouped department/category selection for tags, and the notification panel's content.
const mockAuth = jest.fn();
const mockPrisma = {
    ticketReminder: { findMany: jest.fn(), count: jest.fn() },
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    timelineEvent: { findMany: jest.fn(), count: jest.fn() },
};
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({ getQueueInboxQueueIds: jest.fn().mockResolvedValue(null), getAgentAccessibleQueueIds: jest.fn().mockResolvedValue([]) }));

import { readFileSync } from 'fs';
import path from 'path';
import { GET as getNotifications } from '@/app/api/notifications/route';
import { notificationText } from '@/lib/notification-text';
import { scopesFromSelection } from '@/lib/tag-scope';

const t = (key: string) => key;
const read = (...segments: string[]) => readFileSync(path.join(process.cwd(), ...segments), 'utf8');

describe('department and category selection', () => {
    const categoryQueue = new Map([['network', 'it'], ['access', 'it'], ['leave', 'hr'], ['payroll', 'hr'], ['invoices', 'finance']]);

    it('covers all categories of a department without selected categories', () => {
        expect(scopesFromSelection(['it', 'finance'], [], categoryQueue)).toEqual([{ queueId: 'it', categoryId: null }, { queueId: 'finance', categoryId: null }]);
    });

    it('limits a department to its selected categories and keeps others whole', () => {
        expect(scopesFromSelection(['it', 'hr'], ['leave', 'payroll'], categoryQueue)).toEqual([
            { queueId: 'it', categoryId: null },
            { queueId: 'hr', categoryId: 'leave' },
            { queueId: 'hr', categoryId: 'payroll' },
        ]);
    });

    it('drops categories of departments that are no longer selected', () => {
        expect(scopesFromSelection(['it'], ['network', 'invoices'], categoryQueue)).toEqual([{ queueId: 'it', categoryId: 'network' }]);
    });

    it('keeps a selected category the list no longer offers when its department is known', () => {
        const withArchived = new Map([...categoryQueue, ['archived-vpn', 'it']]);
        expect(scopesFromSelection(['it'], ['archived-vpn'], withArchived)).toEqual([{ queueId: 'it', categoryId: 'archived-vpn' }]);
    });

    it('ignores duplicate selections', () => {
        expect(scopesFromSelection(['it', 'it'], ['access', 'access'], categoryQueue)).toEqual([{ queueId: 'it', categoryId: 'access' }]);
    });
});

describe('notification wording', () => {
    it('labels a created ticket without repeating its title', () => {
        expect(notificationText({ type: 'CREATED', content: 'Ticket created: VPN drops' }, t)).toEqual({ title: 'Ticket created' });
    });

    it.each([
        ['COMMENT', 'New comment'],
        ['INTERNAL_NOTE', 'Internal note'],
        ['REMINDER', 'Ticket reminder'],
    ])('shows %s text beneath a label', (type, title) => {
        expect(notificationText({ type, content: '  Please retry after the update  ' }, t)).toEqual({ title, detail: 'Please retry after the update' });
    });

    it('uses a change sentence as the title', () => {
        expect(notificationText({ type: 'STATUS_CHANGE', content: 'Status changed from NEW to OPEN' }, t)).toEqual({ title: 'Status changed from NEW to OPEN' });
        expect(notificationText({ type: 'ESCALATED', content: null }, t)).toEqual({ title: 'escalated' });
    });
});

describe('notification read state', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth.mockResolvedValue({ user: { id: 'super', name: 'Super', role: 'SUPER_ADMIN' } });
        mockPrisma.appSetting.findUnique.mockResolvedValue({ key: 'notifications_read_super', value: '2026-10-31T10:00:00.000Z' });
        mockPrisma.timelineEvent.count.mockResolvedValue(1);
        mockPrisma.ticketReminder.count.mockResolvedValue(0);
        mockPrisma.ticketReminder.findMany.mockResolvedValue([
            { id: 'reminder', note: 'Call back', deliveredAt: new Date('2026-10-31T09:00:00Z'), ticketId: 't1', ticket: { id: 't1', key: 'TCK-1', title: 'One', formSchemaSnapshot: null } },
        ]);
        mockPrisma.timelineEvent.findMany.mockResolvedValue([
            { id: 'new', type: 'COMMENT', content: 'Hi', createdAt: new Date('2026-10-31T11:00:00Z'), user: { name: 'Agent' }, ticket: { id: 't1', key: 'TCK-1', title: 'One', formSchemaSnapshot: null } },
            { id: 'old', type: 'CREATED', content: 'Ticket created', createdAt: new Date('2026-10-31T08:00:00Z'), user: { name: 'User' }, ticket: { id: 't1', key: 'TCK-1', title: 'One', formSchemaSnapshot: null } },
        ]);
    });

    it('marks each item read or unread against the last time the user marked all as read', async () => {
        const body = await (await getNotifications()).json();
        expect(Object.fromEntries(body.items.map((item: { id: string; unread: boolean }) => [item.id, item.unread]))).toEqual({ new: true, old: false, reminder: false });
        expect(body.unreadCount).toBe(1);
    });
});

describe('UI wiring', () => {
    it('lists notifications in a plain scroller so long lines truncate inside the panel', () => {
        const shell = read('src', 'components', 'layout', 'app-shell.tsx');
        const panel = shell.slice(shell.indexOf('<PopoverContent align="end"'), shell.indexOf('</PopoverContent>'));
        expect(panel).not.toContain('<ScrollArea');
        expect(panel).toContain('collisionPadding');
        expect(panel).toContain('notificationText(n, t)');
    });

    it('edits tag availability with department and grouped category lists', () => {
        const page = read('src', 'app', '(dashboard)', 'admin', 'tags', 'page.tsx');
        expect(page).toContain('id="tag-departments"');
        expect(page).toContain('id="tag-categories"');
        expect(page).toContain('groups={categoryGroups}');
        expect(page).toContain('MULTI_SELECT_OPEN_ATTRIBUTE');
        expect(page).not.toContain('type="checkbox"');
    });
});
