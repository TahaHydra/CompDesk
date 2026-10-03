import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import { decode as decodeSessionJwt } from 'next-auth/jwt';
import { PrismaAdapter } from '@auth/prisma-adapter';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import type { Role } from '@prisma/client';
import { isLoginMethodEnabled } from '@/lib/login-policy';
import { scheduleEntraStartupDiagnostic } from '@/lib/entra-diagnostic';
import { normalizeEmail } from '@/lib/email-identity';
import { applyLoginFailureDelay, checkLoginThrottle, clearLoginFailures, recordLoginFailure } from '@/lib/login-throttle';
import { isSessionTokenCurrent } from '@/lib/session-security';
import { requestSourceIp } from '@/lib/request-ip';
scheduleEntraStartupDiagnostic();

const DUMMY_PASSWORD_HASH = '$2b$12$VjAsOWYkTDNoqAiLrdLiKe7cDytL3er7DkCV.wXN5TQAXsF3csbLC';


declare module 'next-auth' {
    interface Session {
        user: {
            id: string;
            entraObjectId?: string | null;
            email: string;
            name: string;
            image?: string | null;
            role: Role;
            groupIds: string[];
            sessionVersion: number;
        };
    }
    interface User {
        role?: Role;
        entraObjectId?: string | null;
        sessionVersion?: number;
    }
}

declare module 'next-auth' {
    interface JWT {
        id: string;
        role: Role;
        entraObjectId?: string | null;
        groupIds: string[];
        sessionVersion: number;
    }
}

export const authConfig: NextAuthConfig = {
    adapter: PrismaAdapter(prisma),
    // AUTH_SECRET is the Auth.js v5 name. NEXTAUTH_SECRET remains a
    // compatibility fallback, but both must resolve to one stable key.
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    session: { strategy: 'jwt' },
    jwt: {
        async decode(params) {
            const token = await decodeSessionJwt(params);
            if (!token) return null;
            // Auth.js also decodes cookies directly when linking OAuth accounts,
            // before the normal jwt callback checks revocation.
            const userId = typeof token.sub === 'string' ? token.sub : typeof token.id === 'string' ? token.id : null;
            if (!userId) return null;
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, sessionVersion: true, credentialsChangedAt: true } });
            return user?.isActive && isSessionTokenCurrent({
                isInitialSignIn: false,
                tokenSessionVersion: token.sessionVersion,
                tokenIssuedAtSeconds: token.iat,
                databaseSessionVersion: user.sessionVersion,
                credentialsChangedAt: user.credentialsChangedAt,
            }) ? token : null;
        },
    },
    trustHost: true,
    providers: [
        // ── Microsoft Entra ID SSO (only if configured) ─────────
        ...(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET && process.env.AZURE_AD_TENANT_ID
            ? [MicrosoftEntraID({
                clientId: process.env.AZURE_AD_CLIENT_ID,
                clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
                issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
                authorization: {
                    params: {
                        scope: 'openid profile email User.Read',
                    },
                },
                // Signed Microsoft email claims are mutable, not proof of local-account
                // ownership. Existing accounts link only from an authenticated session.
                allowDangerousEmailAccountLinking: false,
                profile(profile) {
                    return {
                        id: profile.sub,
                        entraObjectId: profile.oid ?? profile.sub,
                        name: profile.name ?? profile.preferred_username,
                        email: normalizeEmail(profile.email ?? profile.preferred_username ?? ''),
                        image: null,
                    };
                },
            })]
            : []),

        // ── Local Credentials (email + password) ────────────────
        Credentials({
            name: 'Email & Password',
            credentials: {
                email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials, request) {
                if (!credentials?.email || !credentials?.password) return null;

                const email = normalizeEmail(String(credentials.email));
                const password = String(credentials.password);
                const sourceIp = requestSourceIp(request);
                const localEnabled = await isLoginMethodEnabled('login_local_enabled');
                if (!localEnabled) return null;

                const throttle = await checkLoginThrottle(email, sourceIp);
                if (throttle.blocked) {
                    void auditLog({
                        action: 'auth.login_failed',
                        entity: 'auth',
                        metadata: { email, reason: 'rate_limited', method: 'credentials', retryAfterSeconds: throttle.retryAfterSeconds },
                        ipAddress: sourceIp,
                    });
                    await applyLoginFailureDelay(throttle.delayMs);
                    return null;
                }

                const user = await prisma.user.findUnique({ where: { normalizedEmail: email } });
                const isValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
                if (!user || !user.passwordHash || !user.isActive || !isValid) {
                    const failure = await recordLoginFailure(email, sourceIp);
                    void auditLog({
                        userId: user?.id,
                        action: 'auth.login_failed',
                        entity: 'auth',
                        metadata: {
                            email,
                            reason: !user ? 'user_not_found' : !user.passwordHash ? 'no_password_set' : !user.isActive ? 'account_deactivated' : 'invalid_password',
                            method: 'credentials',
                            rateLimited: failure.blocked,
                        },
                        ipAddress: sourceIp,
                    });
                    await applyLoginFailureDelay(failure.delayMs);
                    return null;
                }

                await clearLoginFailures(email, sourceIp);
                void auditLog({
                    userId: user.id,
                    action: 'auth.login',
                    entity: 'auth',
                    metadata: { method: 'credentials', email },
                    ipAddress: sourceIp,
                });
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    image: user.image,
                    role: user.role,
                    entraObjectId: user.entraObjectId,
                    sessionVersion: user.sessionVersion,
                };
            },
        }),
    ],
    callbacks: {
        async signIn({ user, account }) {
            const normalizedEmail = user.email ? normalizeEmail(user.email) : null;
            if (normalizedEmail) user.email = normalizedEmail;
            if (account?.provider === 'microsoft-entra-id' && !normalizedEmail) {
                void auditLog({ action: 'auth.login_failed', entity: 'auth', metadata: { reason: 'missing_email_claim', method: 'sso' } });
                return false;
            }
            if (account?.provider === 'microsoft-entra-id' && !(await isLoginMethodEnabled('login_microsoft_enabled'))) {
                void auditLog({ action: 'auth.login_failed', entity: 'auth', metadata: { email: normalizedEmail, reason: 'microsoft_login_disabled', method: 'sso' } });
                return false;
            }
            if (account?.provider === 'microsoft-entra-id' && normalizedEmail) {
                const linked = await prisma.account.findUnique({
                    where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
                    select: { user: { select: { id: true, isActive: true } } },
                });
                const existingUser = linked?.user ?? await prisma.user.findUnique({ where: { normalizedEmail }, select: { id: true, isActive: true } });
                if (existingUser) {
                    if (!existingUser.isActive) {
                        void auditLog({
                            userId: existingUser.id,
                            action: 'auth.login_failed',
                            entity: 'auth',
                            metadata: { email: normalizedEmail, reason: 'account_deactivated', method: 'sso' },
                        });
                        return false;
                    }
                }
            }
            return true;
        },
        async jwt({ token, user }) {
            const isInitialSignIn = Boolean(user);
            const userId = typeof user?.id === 'string'
                ? user.id
                : typeof token.id === 'string' ? token.id : null;
            const email = typeof user?.email === 'string'
                ? normalizeEmail(user.email)
                : typeof token.email === 'string' ? normalizeEmail(token.email) : null;
            if (!userId && !email) return null;

            const dbUser = await prisma.user.findUnique({
                where: userId ? { id: userId } : { normalizedEmail: email! },
                include: { groupMemberships: true },
            });
            if (!dbUser?.isActive) return null;
            if (!isSessionTokenCurrent({
                isInitialSignIn,
                tokenSessionVersion: token.sessionVersion,
                tokenIssuedAtSeconds: token.iat,
                databaseSessionVersion: dbUser.sessionVersion,
                credentialsChangedAt: dbUser.credentialsChangedAt,
            })) return null;

            token.id = dbUser.id;
            token.email = dbUser.email;
            token.name = dbUser.name;
            token.picture = dbUser.image;
            token.role = dbUser.role;
            token.entraObjectId = dbUser.entraObjectId;
            token.groupIds = dbUser.groupMemberships.map((membership) => membership.groupId);
            token.sessionVersion = dbUser.sessionVersion;
            return token;
        },
        async session({ session, token }) {
            if (token) {
                session.user.id = token.id as string;
                session.user.role = token.role as Role;
                session.user.entraObjectId = token.entraObjectId as string | null;
                session.user.groupIds = (token.groupIds as string[]) ?? [];
                session.user.sessionVersion = token.sessionVersion as number;
            }
            return session;
        },
    },
    events: {
        async signIn({ user, account, profile }) {
            if (account?.provider !== 'microsoft-entra-id') return;
            // This event runs after Auth.js has resolved/linked the stable provider
            // account. Never update another local identity by an email claim.
            const objectId = typeof profile?.oid === 'string' ? profile.oid : undefined;
            if (objectId) await prisma.user.update({ where: { id: user.id }, data: { entraObjectId: objectId } });
            void auditLog({ userId: user.id, action: 'auth.login', entity: 'auth', metadata: { method: 'sso', provider: account.provider } });
        },
    },
    pages: {
        signIn: '/auth/signin',
        error: '/auth/error',
    },
};

export const {
    handlers: { GET, POST },
    auth,
    signIn,
    signOut,
} = NextAuth(authConfig);
