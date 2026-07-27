import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getAgentAccessibleQueueIds, getQueueInboxQueueIds, isAgentRole } from '@/lib/permissions';

// Generate a secure random password
function generatePassword(length = 16): string {
    const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    const bytes = crypto.randomBytes(length);
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset[bytes[i] % charset.length];
    }
    return password;
}

// GET /api/users — list all users
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        if (!isAgentRole(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const userSelect = {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            entraObjectId: true,
            queueMemberships: { select: { queueId: true } },
        } as const;

        let users;
        if (session.user.role === 'SUPER_ADMIN') {
            users = await prisma.user.findMany({
                select: userSelect,
                orderBy: { name: 'asc' },
            });
        } else {
            const accessibleQueueIds = session.user.role === 'ADMIN'
                ? await getQueueInboxQueueIds(session.user.id, session.user.role) ?? []
                : await getAgentAccessibleQueueIds(session.user.id);
            users = await prisma.user.findMany({
                where: {
                    OR: [
                        { id: session.user.id },
                        {
                            queueMemberships: {
                                some: {
                                    queueId: { in: accessibleQueueIds },
                                    role: { in: ['agent', 'admin'] },
                                },
                            },
                        },
                        {
                            groupMemberships: {
                                some: {
                                    group: {
                                        queueAssignments: {
                                            some: { queueId: { in: accessibleQueueIds }, role: { in: ['agent', 'admin'] } },
                                        },
                                    },
                                },
                            },
                        },
                        { role: 'SUPER_ADMIN', isActive: true },
                    ],
                },
                select: userSelect,
                orderBy: { name: 'asc' },
            });
        }

        const usersWithMeta = users.map(u => ({
            ...u,
            loginMethod: u.entraObjectId ? 'SSO' : 'Local',
            hasPassword: false,
        }));

        return NextResponse.json(usersWithMeta);
    } catch (error) {
        logger.error('Failed to fetch users', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/users — create a new local user
export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can manage users' }, { status: 403 });
        }

        const { name, email, role, password: providedPassword } = await req.json();

        if (role === 'SUPER_ADMIN' && session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only a super administrator can grant the super administrator role' }, { status: 403 });
        }

        if (!name || !email) {
            return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
        }

        // Check for duplicate email
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return NextResponse.json({ error: 'A user with this email already exists' }, { status: 400 });
        }

        // Generate or use provided password
        const plainPassword = providedPassword || generatePassword();
        const passwordHash = await bcrypt.hash(plainPassword, 12);

        const validRoles = ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'];
        const userRole = validRoles.includes(role) ? role : 'USER';

        const user = await prisma.user.create({
            data: {
                name,
                email: email.toLowerCase().trim(),
                passwordHash,
                role: userRole,
                isActive: true,
            },
            select: { id: true, name: true, email: true, role: true },
        });

        const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
        const ua = req.headers.get('user-agent') || undefined;
        auditLog({
            userId: session.user.id,
            action: 'user.created',
            entity: 'user',
            entityId: user.id,
            metadata: { targetEmail: user.email, targetRole: user.role },
            ipAddress: ip,
            userAgent: ua,
        });

        return NextResponse.json({
            ...user,
            generatedPassword: plainPassword, // Shown once, never stored in plaintext
        }, { status: 201 });
    } catch (error) {
        logger.error('Failed to create user', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/users — update user (role, name, email, active, departments, password reset)
export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can manage users' }, { status: 403 });
        }

        const { userId, role, name, email, isActive, queueIds, resetPassword } = await req.json();
        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, isActive: true },
        });
        if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        if (session.user.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only a super administrator can modify a super administrator' }, { status: 403 });
        }
        if (role === 'SUPER_ADMIN' && session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only a super administrator can grant the super administrator role' }, { status: 403 });
        }
        const validRoles = ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'];
        if (role !== undefined && !validRoles.includes(role)) {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
        }
        if (userId === session.user.id && ((role && role !== targetUser.role) || isActive === false)) {
            return NextResponse.json({ error: 'You cannot demote or deactivate your own account' }, { status: 400 });
        }
        if (targetUser.role === 'SUPER_ADMIN' && ((role && role !== 'SUPER_ADMIN') || isActive === false)) {
            const otherActiveSuperAdmins = await prisma.user.count({
                where: { role: 'SUPER_ADMIN', isActive: true, id: { not: userId } },
            });
            if (otherActiveSuperAdmins === 0) {
                return NextResponse.json({ error: 'At least one active super administrator is required' }, { status: 409 });
            }
        }
        if (Array.isArray(queueIds)) {
            const uniqueQueueIds = [...new Set(queueIds.filter((id: unknown): id is string => typeof id === 'string'))];
            if (uniqueQueueIds.length !== queueIds.length) {
                return NextResponse.json({ error: 'Department assignments contain invalid or duplicate IDs' }, { status: 400 });
            }
            const existingQueueCount = await prisma.queue.count({ where: { id: { in: uniqueQueueIds } } });
            if (existingQueueCount !== uniqueQueueIds.length) {
                return NextResponse.json({ error: 'One or more departments do not exist' }, { status: 400 });
            }
        }

        const updateData: Record<string, unknown> = {};
        if (role) updateData.role = role;
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email.toLowerCase().trim();
        if (isActive !== undefined) updateData.isActive = isActive;

        // Password reset
        let newPassword: string | undefined;
        if (resetPassword) {
            newPassword = generatePassword();
            updateData.passwordHash = await bcrypt.hash(newPassword, 12);
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: { id: true, name: true, email: true, role: true, isActive: true },
        });

        // Handle department assignments
        if (Array.isArray(queueIds)) {
            await prisma.queueMember.deleteMany({ where: { userId, role: 'agent' } });
            if (queueIds.length > 0) {
                await prisma.queueMember.createMany({
                    data: queueIds.map((queueId: string) => ({
                        userId,
                        queueId,
                        role: 'agent',
                    }))
                });
            }
        }

        const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
        const ua = req.headers.get('user-agent') || undefined;
        auditLog({
            userId: session.user.id,
            action: resetPassword ? 'user.password_reset' : 'user.updated',
            entity: 'user',
            entityId: userId,
            metadata: { changes: Object.keys(updateData) },
            ipAddress: ip,
            userAgent: ua,
        });

        return NextResponse.json({
            ...user,
            ...(newPassword ? { generatedPassword: newPassword } : {}),
        });
    } catch (error: any) {
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'A user with this email already exists' }, { status: 400 });
        }
        logger.error('Failed to update user', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/users?id=xxx — delete a user
export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can manage users' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'User ID required' }, { status: 400 });

        // Prevent self-deletion
        if (id === session.user.id) {
            return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id },
            select: { role: true, isActive: true },
        });
        if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        if (session.user.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only a super administrator can remove a super administrator' }, { status: 403 });
        }
        if (targetUser.role === 'SUPER_ADMIN' && targetUser.isActive) {
            const otherActiveSuperAdmins = await prisma.user.count({
                where: { role: 'SUPER_ADMIN', isActive: true, id: { not: id } },
            });
            if (otherActiveSuperAdmins === 0) {
                return NextResponse.json({ error: 'At least one active super administrator is required' }, { status: 409 });
            }
        }

        // Restrictive assignment history and requested tickets require deactivation.
        const [ticketCount, assignmentHistoryCount] = await Promise.all([
            prisma.ticket.count({ where: { requesterId: id } }),
            prisma.ticketAssignee.count({ where: { OR: [{ userId: id }, { assignedById: id }] } }),
        ]);
        const dependencyCount = ticketCount + assignmentHistoryCount;

        if (dependencyCount > 0) {
            // Soft delete — deactivate the user
            await prisma.user.update({
                where: { id },
                data: { isActive: false },
            });

            const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
            auditLog({
                userId: session.user.id,
                action: 'user.deactivated',
                entity: 'user',
                entityId: id,
                metadata: { reason: 'has_ticket_or_assignment_history', ticketCount, assignmentHistoryCount },
                ipAddress: ip,
            });

            return NextResponse.json({
                success: true,
                deactivated: true,
                message: `User deactivated (has ${dependencyCount} ticket or assignment-history dependencies). Use edit to reactivate.`,
            });
        }

        // Hard delete — remove queue memberships first, then user
        await prisma.queueMember.deleteMany({ where: { userId: id } });
        await prisma.groupMember.deleteMany({ where: { userId: id } });
        await prisma.user.delete({ where: { id } });

        const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
        auditLog({
            userId: session.user.id,
            action: 'user.deleted',
            entity: 'user',
            entityId: id,
            ipAddress: ip,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete user', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
