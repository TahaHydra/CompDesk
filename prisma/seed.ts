import { PrismaClient, Priority, TicketStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // Default password for all demo accounts
    const defaultPassword = 'Password123!';
    const passwordHash = await bcrypt.hash(defaultPassword, 12);

    // ── Users ──────────────────────────────────────────────────
    await prisma.user.upsert({
        where: { email: 'admin@exco.fr' },
        update: { passwordHash },
        create: {
            email: 'admin@exco.fr',
            name: 'Admin User',
            role: 'SUPER_ADMIN',
            passwordHash,
        },
    });

    const agent1 = await prisma.user.upsert({
        where: { email: 'agent1@exco.fr' },
        update: { passwordHash },
        create: {
            email: 'agent1@exco.fr',
            name: 'Agent Martin',
            role: 'AGENT',
            passwordHash,
        },
    });

    const agent2 = await prisma.user.upsert({
        where: { email: 'agent2@exco.fr' },
        update: { passwordHash },
        create: {
            email: 'agent2@exco.fr',
            name: 'Agent Sophie',
            role: 'AGENT',
            passwordHash,
        },
    });

    const user1 = await prisma.user.upsert({
        where: { email: 'user1@exco.fr' },
        update: { passwordHash },
        create: {
            email: 'user1@exco.fr',
            name: 'Jean Dupont',
            role: 'USER',
            passwordHash,
        },
    });

    const user2 = await prisma.user.upsert({
        where: { email: 'user2@exco.fr' },
        update: { passwordHash },
        create: {
            email: 'user2@exco.fr',
            name: 'Marie Curie',
            role: 'USER',
            passwordHash,
        },
    });

    // Plain ADMIN (distinct from SUPER_ADMIN) so both admin tiers can be tested
    await prisma.user.upsert({
        where: { email: 'admin2@exco.fr' },
        update: { passwordHash },
        create: {
            email: 'admin2@exco.fr',
            name: 'Nadia Admin',
            role: 'ADMIN',
            passwordHash,
        },
    });

    console.log('✅ Users created');

    // ── Groups ─────────────────────────────────────────────────
    const itGroup = await prisma.group.upsert({
        where: { entraObjectId: 'it-support-group-id' },
        update: {},
        create: {
            name: 'IT Support',
            entraObjectId: 'it-support-group-id',
            description: 'IT support team members',
        },
    });

    const hrGroup = await prisma.group.upsert({
        where: { entraObjectId: 'hr-group-id' },
        update: {},
        create: {
            name: 'HR Team',
            entraObjectId: 'hr-group-id',
            description: 'Human Resources team',
        },
    });

    // Add agents to groups
    await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: agent1.id, groupId: itGroup.id } },
        update: {},
        create: { userId: agent1.id, groupId: itGroup.id },
    });
    await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: agent2.id, groupId: itGroup.id } },
        update: {},
        create: { userId: agent2.id, groupId: itGroup.id },
    });
    await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: agent2.id, groupId: hrGroup.id } },
        update: {},
        create: { userId: agent2.id, groupId: hrGroup.id },
    });

    console.log('✅ Groups created');

    // ── Queues ─────────────────────────────────────────────────
    const itQueue = await prisma.queue.upsert({
        where: { name: 'IT Support' },
        update: {},
        create: {
            name: 'IT Support',
            description: 'General IT support requests',
            isPublic: true,
            autoAssign: true,
        },
    });

    const hrQueue = await prisma.queue.upsert({
        where: { name: 'HR' },
        update: {},
        create: {
            name: 'HR',
            description: 'Human Resources requests',
            isPublic: true,
            autoAssign: false,
        },
    });

    const financeQueue = await prisma.queue.upsert({
        where: { name: 'Finance' },
        update: {},
        create: {
            name: 'Finance',
            description: 'Finance and billing inquiries',
            isPublic: false,
            autoAssign: false,
        },
    });

    // Map groups to queues
    await prisma.queueGroup.upsert({
        where: { queueId_groupId_role: { queueId: itQueue.id, groupId: itGroup.id, role: 'agent' } },
        update: {},
        create: { queueId: itQueue.id, groupId: itGroup.id, role: 'agent' },
    });
    await prisma.queueGroup.upsert({
        where: { queueId_groupId_role: { queueId: hrQueue.id, groupId: hrGroup.id, role: 'agent' } },
        update: {},
        create: { queueId: hrQueue.id, groupId: hrGroup.id, role: 'agent' },
    });

    // Give agent2 direct membership on Finance (no dedicated group needed for a demo queue)
    await prisma.queueMember.upsert({
        where: { queueId_userId_role: { queueId: financeQueue.id, userId: agent2.id, role: 'agent' } },
        update: {},
        create: { queueId: financeQueue.id, userId: agent2.id, role: 'agent' },
    });

    console.log('✅ Queues created');

    // ── Categories ─────────────────────────────────────────────
    const categories = ['Hardware', 'Software', 'Network', 'Access', 'General', 'Onboarding', 'Payroll'];
    for (const name of categories) {
        await prisma.category.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }

    const hardwareCat = await prisma.category.findUnique({ where: { name: 'Hardware' } });
    const softwareCat = await prisma.category.findUnique({ where: { name: 'Software' } });
    const networkCat = await prisma.category.findUnique({ where: { name: 'Network' } });

    console.log('✅ Categories created');

    // ── Tags ───────────────────────────────────────────────────
    const tagData = [
        { name: 'urgent', color: '#ef4444' },
        { name: 'vpn', color: '#f59e0b' },
        { name: 'email', color: '#3b82f6' },
        { name: 'printer', color: '#10b981' },
        { name: 'new-hire', color: '#8b5cf6' },
        { name: 'password-reset', color: '#ec4899' },
    ];
    for (const t of tagData) {
        await prisma.tag.upsert({ where: { name: t.name }, update: {}, create: t });
    }

    console.log('✅ Tags created');

    // ── SLA Policies ───────────────────────────────────────────
    const slaPolicies = [
        { queueId: itQueue.id, priority: Priority.URGENT, firstResponseMinutes: 15, resolutionMinutes: 60 },
        { queueId: itQueue.id, priority: Priority.HIGH, firstResponseMinutes: 30, resolutionMinutes: 240 },
        { queueId: itQueue.id, priority: Priority.NORMAL, firstResponseMinutes: 120, resolutionMinutes: 1440 },
        { queueId: itQueue.id, priority: Priority.LOW, firstResponseMinutes: 480, resolutionMinutes: 4320 },
        { queueId: hrQueue.id, priority: Priority.NORMAL, firstResponseMinutes: 240, resolutionMinutes: 2880 },
    ];
    for (const sla of slaPolicies) {
        await prisma.slaPolicy.upsert({
            where: { queueId_priority: { queueId: sla.queueId, priority: sla.priority } },
            update: {},
            create: sla,
        });
    }

    console.log('✅ SLA Policies created');

    // ── Ticket Counter ─────────────────────────────────────────
    await prisma.ticketCounter.upsert({
        where: { id: 'singleton' },
        update: {},
        create: { id: 'singleton', year: 2026, count: 0 },
    });

    // ── Sample Tickets ─────────────────────────────────────────
    const tickets = [
        {
            key: 'TCK-2026-000001',
            title: 'Cannot connect to VPN from home',
            description: 'I am unable to connect to the company VPN using Cisco AnyConnect. I get a timeout error after entering my credentials.',
            status: TicketStatus.OPEN,
            priority: Priority.HIGH,
            queueId: itQueue.id,
            categoryId: networkCat?.id,
            requesterId: user1.id,
            assigneeId: agent1.id,
        },
        {
            key: 'TCK-2026-000002',
            title: 'New laptop setup for new hire',
            description: 'Please set up a laptop with standard software for a new team member starting on March 1st.',
            status: TicketStatus.NEW,
            priority: Priority.NORMAL,
            queueId: itQueue.id,
            categoryId: hardwareCat?.id,
            requesterId: user2.id,
            assigneeId: null,
        },
        {
            key: 'TCK-2026-000003',
            title: 'Outlook not syncing emails',
            description: 'My Outlook desktop client stopped syncing about 2 hours ago. Web version works fine.',
            status: TicketStatus.PENDING_USER,
            priority: Priority.NORMAL,
            queueId: itQueue.id,
            categoryId: softwareCat?.id,
            requesterId: user1.id,
            assigneeId: agent2.id,
        },
        {
            key: 'TCK-2026-000004',
            title: 'Request PTO approval process documentation',
            description: 'Can you provide the current PTO approval process and any forms needed?',
            status: TicketStatus.RESOLVED,
            priority: Priority.LOW,
            queueId: hrQueue.id,
            requesterId: user2.id,
            assigneeId: agent2.id,
            resolvedAt: new Date(),
        },
        {
            key: 'TCK-2026-000005',
            title: 'Printer on 3rd floor not working',
            description: 'The HP printer in the 3rd floor common area is showing an error code E3. Paper tray seems fine.',
            status: TicketStatus.OPEN,
            priority: Priority.URGENT,
            queueId: itQueue.id,
            categoryId: hardwareCat?.id,
            requesterId: user2.id,
            assigneeId: agent1.id,
        },
        {
            // Keys deliberately outside the normal auto-generated sequence range
            // (see counter-safety note below) to avoid colliding with real tickets
            // created through the app on a DB that already has organic activity.
            key: 'TCK-2026-SEED91',
            title: 'Expense report reimbursement delayed',
            description: 'I submitted my March expense report three weeks ago and have not received reimbursement yet. Report ID: EXP-4471.',
            status: TicketStatus.PENDING_AGENT,
            priority: Priority.NORMAL,
            queueId: financeQueue.id,
            requesterId: user1.id,
            assigneeId: agent2.id,
        },
        {
            key: 'TCK-2026-SEED92',
            title: 'Need updated W-9 form for vendor onboarding',
            description: 'Our new vendor needs our company\'s current W-9 to set up payment. Can Finance provide the latest version?',
            status: TicketStatus.NEW,
            priority: Priority.LOW,
            queueId: financeQueue.id,
            requesterId: user2.id,
            assigneeId: null,
        },
    ];

    // Bump the counter forward only if needed — never rewind it. The app's
    // ticket-key generator reads this counter to mint the *next* real ticket
    // key, so setting it backwards on a DB that already has organic tickets
    // would hand out a key that collides with an existing one.
    const currentCounter = await prisma.ticketCounter.findUnique({ where: { id: 'singleton' } });
    if ((currentCounter?.count ?? 0) < tickets.length) {
        await prisma.ticketCounter.update({
            where: { id: 'singleton' },
            data: { count: tickets.length },
        });
    }

    for (const t of tickets) {
        const alreadyExisted = await prisma.ticket.findUnique({ where: { key: t.key } });

        const ticket = await prisma.ticket.upsert({
            where: { key: t.key },
            update: {},
            create: t as any,
        });

        // Add requester as watcher
        await prisma.ticketWatcher.upsert({
            where: { ticketId_userId: { ticketId: ticket.id, userId: t.requesterId } },
            update: {},
            create: { ticketId: ticket.id, userId: t.requesterId },
        });

        // Add created timeline event — only for tickets seeded for the first
        // time. Re-running this script against an already-seeded DB must not
        // append another "Ticket created" entry to the timeline.
        if (!alreadyExisted) {
            await prisma.timelineEvent.create({
                data: {
                    ticketId: ticket.id,
                    userId: t.requesterId,
                    type: 'CREATED',
                    content: `Ticket created: ${t.title}`,
                },
            });
        }
    }

    console.log('✅ Sample tickets created');

    // ── Sample Replies / Conversation Threads ───────────────────
    // Guarded: only seed a ticket's conversation once (skip if it already
    // has more than the single CREATED event from above).
    const replyThreads: Record<string, Array<{ userId: string; type: 'COMMENT' | 'INTERNAL_NOTE'; content: string }>> = {
        'TCK-2026-000001': [
            { userId: agent1.id, type: 'INTERNAL_NOTE', content: 'Checked VPN concentrator logs — seeing repeated auth timeouts from this user\'s IP range. Might be an MFA push issue.' },
            { userId: agent1.id, type: 'COMMENT', content: 'Hi Jean, could you confirm whether you\'re getting an MFA prompt on your phone before the timeout happens?' },
            { userId: user1.id, type: 'COMMENT', content: 'No prompt at all, it just times out after ~10 seconds on the "Connecting..." screen.' },
            { userId: agent1.id, type: 'COMMENT', content: 'Thanks — that points to a client-side cache issue rather than MFA. Please clear the Cisco AnyConnect profile cache and retry, steps here: %APPDATA%\\Cisco\\Cisco AnyConnect Secure Mobility Client\\Profile — delete the .xml files and reconnect.' },
        ],
        'TCK-2026-000003': [
            { userId: agent2.id, type: 'COMMENT', content: 'Hi Jean, thanks for the report. Can you try Outlook > Account Settings > Repair for the affected profile?' },
            { userId: user1.id, type: 'COMMENT', content: 'Just tried that, still not syncing. Web version is fine as I mentioned.' },
            { userId: agent2.id, type: 'INTERNAL_NOTE', content: 'Escalating internally to check if this is the known Exchange cache corruption issue from last week\'s patch.' },
        ],
        'TCK-2026-000005': [
            { userId: agent1.id, type: 'COMMENT', content: 'On it — heading up to the 3rd floor now to check the printer.' },
            { userId: agent1.id, type: 'COMMENT', content: 'Confirmed E3 is a fuser unit error. Ordering a replacement part, should be resolved by tomorrow morning.' },
            { userId: user2.id, type: 'COMMENT', content: 'Thanks for the quick update!' },
        ],
        'TCK-2026-SEED91': [
            { userId: agent2.id, type: 'COMMENT', content: 'Hi, thanks for following up. I can see your report in the queue — it\'s pending approval from your manager before payment can be released.' },
            { userId: user1.id, type: 'COMMENT', content: 'Ah I wasn\'t aware it needed manager approval. I\'ll follow up with them directly, thanks!' },
        ],
    };

    for (const [ticketKey, events] of Object.entries(replyThreads)) {
        const ticket = await prisma.ticket.findUnique({ where: { key: ticketKey } });
        if (!ticket) continue;

        const existingReplyCount = await prisma.timelineEvent.count({
            where: { ticketId: ticket.id, type: { in: ['COMMENT', 'INTERNAL_NOTE'] } },
        });
        if (existingReplyCount > 0) continue; // conversation already seeded

        for (const event of events) {
            await prisma.timelineEvent.create({
                data: {
                    ticketId: ticket.id,
                    userId: event.userId,
                    type: event.type,
                    content: event.content,
                },
            });
        }
    }

    console.log('✅ Sample replies created');

    // ── Canned Responses ───────────────────────────────────────
    const cannedResponses = [
        {
            title: 'Password Reset Instructions',
            content: 'To reset your password, please visit https://passwordreset.microsoftonline.com and follow the self-service password reset flow. If you encounter issues, let us know.',
            category: 'Access',
        },
        {
            title: 'VPN Troubleshooting',
            content: 'Please try the following steps:\n1. Restart your computer\n2. Disconnect and reconnect to your internet\n3. Clear Cisco AnyConnect cache\n4. Try connecting again\n\nIf the issue persists, let us know your OS version and error message.',
            category: 'Network',
        },
        {
            title: 'Request Received',
            content: 'Thank you for your request. We have received it and will get back to you shortly. If your issue is urgent, please don\'t hesitate to follow up.',
            category: 'General',
        },
    ];

    for (const cr of cannedResponses) {
        await prisma.cannedResponse.create({ data: cr });
    }

    console.log('✅ Canned responses created');
    console.log('🎉 Seed complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
