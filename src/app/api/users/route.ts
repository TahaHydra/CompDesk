import { NextRequest, NextResponse } from 'next/server';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertApiResponseSafe } from '@/lib/api-dto';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { normalizeEmail } from '@/lib/email-identity';
import { clearLoginFailures } from '@/lib/login-throttle';
import { createUserSchema, deactivateUserSchema, updateUserSchema } from '@/lib/user-validation';
import { requestSourceIp } from '@/lib/request-ip';
import { getAgentAccessibleQueueIds, getQueueInboxQueueIds, isAgentRole } from '@/lib/permissions';

function generatePassword(length = 20): string {
    const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, (byte) => charset[byte % charset.length]).join('');
}



async function lockSuperAdminInvariant(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1937824631)`;
}

function prismaConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// GET /api/users — scoped staff directory and Super Admin management list.
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!isAgentRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const userSelect = {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            entraObjectId: true,
            passwordHash: true,
            queueMemberships: { select: { queueId: true } },
        } as const;
        let users;
        if (session.user.role === 'SUPER_ADMIN') {
            users = await prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } });
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
                                some: { queueId: { in: accessibleQueueIds }, role: { in: ['agent', 'admin'] } },
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
        }        return NextResponse.json(assertApiResponseSafe(users.map(({ passwordHash, ...user }) => ({
            ...user,
            loginMethod: user.entraObjectId ? 'SSO' : 'Local',
            hasPassword: Boolean(passwordHash),
        }))));
    } catch (error) {
        logger.error('Failed to fetch users', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/users — create a local account.
export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can manage users' }, { status: 403 });
        }
        const parsed = createUserSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'User validation failed', details: parsed.error.flatten() }, { status: 400 });
        const email = normalizeEmail(parsed.data.email);
        if (await prisma.user.findUnique({ where: { normalizedEmail: email }, select: { id: true } })) {
            return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
        }

        const generatedPassword = parsed.data.password ? undefined : generatePassword();
        const passwordHash = await bcrypt.hash(parsed.data.password ?? generatedPassword!, 12);
        const user = await prisma.user.create({
            data: {
                name: parsed.data.name,
                email,
                normalizedEmail: email,
                passwordHash,
                role: parsed.data.role,
                isActive: true,
            },
            select: { id: true, name: true, email: true, role: true, isActive: true },
        });
        void auditLog({
            userId: session.user.id,
            action: 'user.created',
            entity: 'user',
            entityId: user.id,
            metadata: { targetEmail: user.email, targetRole: user.role, generatedPassword: Boolean(generatedPassword) },
            ipAddress: requestSourceIp(req),
            userAgent: req.headers.get('user-agent') || undefined,
        });
        return NextResponse.json({ ...user, ...(generatedPassword ? { generatedPassword } : {}) }, { status: 201 });
    } catch (error) {
        if (prismaConflict(error)) return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
        logger.error('Failed to create user', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/users — atomically update account security and memberships.
export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can manage users' }, { status: 403 });
        }
        const parsed = updateUserSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'User validation failed', details: parsed.error.flatten() }, { status: 400 });
        const { userId, role, name, email: rawEmail, isActive, queueIds, resetPassword, password } = parsed.data;
        const normalizedEmail = rawEmail === undefined ? undefined : normalizeEmail(rawEmail);
        const generatedPassword = resetPassword ? generatePassword() : undefined;
        const nextPassword = password ?? generatedPassword;
        const passwordHash = nextPassword ? await bcrypt.hash(nextPassword, 12) : undefined;
        const securityChangedAt = new Date();

        const user = await prisma.$transaction(async (tx) => {
            await lockSuperAdminInvariant(tx);
            const target = await tx.user.findUnique({
                where: { id: userId },
                select: { id: true, role: true, isActive: true, normalizedEmail: true },
            });
            if (!target) throw new Error('USER_NOT_FOUND');
            if (userId === session.user.id && ((role && role !== target.role) || isActive === false)) {
                throw new Error('SELF_SECURITY_CHANGE');
            }
            if (target.role === 'SUPER_ADMIN' && ((role && role !== 'SUPER_ADMIN') || isActive === false)) {
                const activeSuperAdmins = await tx.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
                if (activeSuperAdmins <= 1) throw new Error('LAST_SUPER_ADMIN');
            }
            if (normalizedEmail && normalizedEmail !== target.normalizedEmail) {
                const duplicate = await tx.user.findUnique({ where: { normalizedEmail }, select: { id: true } });
                if (duplicate && duplicate.id !== userId) throw new Error('DUPLICATE_EMAIL');
            }
            if (queueIds) {
                const uniqueQueueIds = [...new Set(queueIds)];
                if (uniqueQueueIds.length !== queueIds.length) throw new Error('DUPLICATE_QUEUE');
                const queueCount = await tx.queue.count({ where: { id: { in: uniqueQueueIds }, isActive: true } });
                if (queueCount !== uniqueQueueIds.length) throw new Error('INVALID_QUEUE');
            }

            const revokesSessions = Boolean(
                passwordHash
                || normalizedEmail && normalizedEmail !== target.normalizedEmail
                || role && role !== target.role
                || isActive !== undefined && isActive !== target.isActive
            );
            const updateData: Prisma.UserUpdateInput = {
                ...(role ? { role } : {}),
                ...(name !== undefined ? { name } : {}),
                ...(normalizedEmail !== undefined ? { email: normalizedEmail, normalizedEmail } : {}),
                ...(isActive !== undefined ? { isActive } : {}),
                ...(passwordHash ? { passwordHash } : {}),
                ...(revokesSessions ? { sessionVersion: { increment: 1 }, credentialsChangedAt: securityChangedAt } : {}),
            };
            const updated = await tx.user.update({
                where: { id: userId },
                data: updateData,
                select: { id: true, name: true, email: true, role: true, isActive: true, normalizedEmail: true, sessionVersion: true },
            });
            if (queueIds) {
                await tx.queueMember.deleteMany({ where: { userId, role: 'agent' } });
                if (queueIds.length > 0) {
                    await tx.queueMember.createMany({ data: queueIds.map((queueId) => ({ userId, queueId, role: 'agent' })) });
                }
            }
            if (role === Role.USER) {
                await tx.queueMember.deleteMany({ where: { userId, role: { in: ['agent', 'admin'] } } });
            }
            return updated;
        });

        if (passwordHash) await clearLoginFailures(user.normalizedEmail, 'unknown');
        void auditLog({
            userId: session.user.id,
            action: resetPassword || password ? 'user.password_reset' : 'user.updated',
            entity: 'user',
            entityId: userId,
            metadata: {
                changes: [
                    role !== undefined && 'role',
                    name !== undefined && 'name',
                    normalizedEmail !== undefined && 'email',
                    isActive !== undefined && 'isActive',
                    queueIds !== undefined && 'queueIds',
                    passwordHash && 'passwordHash',
                ].filter(Boolean),
                sessionsRevoked: Boolean(passwordHash || normalizedEmail !== undefined || role !== undefined || isActive !== undefined),
            },
            ipAddress: requestSourceIp(req),
            userAgent: req.headers.get('user-agent') || undefined,
        });
        return NextResponse.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            ...(generatedPassword ? { generatedPassword } : {}),
        });
    } catch (error) {
        if (error instanceof Error) {
            const expected: Record<string, [string, number]> = {
                USER_NOT_FOUND: ['User not found', 404],
                SELF_SECURITY_CHANGE: ['You cannot demote or deactivate your own account', 400],
                LAST_SUPER_ADMIN: ['At least one active super administrator is required', 409],
                DUPLICATE_EMAIL: ['A user with this email already exists', 409],
                DUPLICATE_QUEUE: ['Department assignments contain duplicate IDs', 400],
                INVALID_QUEUE: ['One or more departments do not exist or are inactive', 400],
            };
            if (expected[error.message]) return NextResponse.json({ error: expected[error.message][0] }, { status: expected[error.message][1] });
        }
        if (prismaConflict(error)) return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
        logger.error('Failed to update user', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/users?id=... — routine removal is always deactivation.
export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can manage users' }, { status: 403 });
        }
        const parsed = deactivateUserSchema.safeParse({ id: req.nextUrl.searchParams.get('id') });
        if (!parsed.success) return NextResponse.json({ error: 'A valid user ID is required', details: parsed.error.flatten() }, { status: 400 });
        if (parsed.data.id === session.user.id) return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });

        const result = await prisma.$transaction(async (tx) => {
            await lockSuperAdminInvariant(tx);
            const target = await tx.user.findUnique({ where: { id: parsed.data.id }, select: { id: true, role: true, isActive: true, normalizedEmail: true } });
            if (!target) throw new Error('USER_NOT_FOUND');
            if (!target.isActive) return { target, changed: false };
            if (target.role === 'SUPER_ADMIN') {
                const activeSuperAdmins = await tx.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
                if (activeSuperAdmins <= 1) throw new Error('LAST_SUPER_ADMIN');
            }
            await tx.user.update({
                where: { id: target.id },
                data: { isActive: false, sessionVersion: { increment: 1 }, credentialsChangedAt: new Date() },
            });
            return { target, changed: true };
        });
        void auditLog({
            userId: session.user.id,
            action: 'user.deactivated',
            entity: 'user',
            entityId: parsed.data.id,
            metadata: { alreadyInactive: !result.changed, routineHardDeleteDisabled: true },
            ipAddress: requestSourceIp(req),
            userAgent: req.headers.get('user-agent') || undefined,
        });
        return NextResponse.json({
            success: true,
            deactivated: true,
            message: result.changed ? 'User deactivated. Existing sessions have been revoked.' : 'User was already deactivated.',
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'USER_NOT_FOUND') return NextResponse.json({ error: 'User not found' }, { status: 404 });
        if (error instanceof Error && error.message === 'LAST_SUPER_ADMIN') return NextResponse.json({ error: 'At least one active super administrator is required' }, { status: 409 });
        logger.error('Failed to deactivate user', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
