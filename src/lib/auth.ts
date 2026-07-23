import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import type { Role } from '@prisma/client';

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
        };
    }
    interface User {
        role?: Role;
        entraObjectId?: string | null;
    }
}

declare module 'next-auth' {
    interface JWT {
        id: string;
        role: Role;
        entraObjectId?: string | null;
        groupIds: string[];
    }
}

// Check if local login is enabled via app settings
async function isLocalLoginEnabled(): Promise<boolean> {
    try {
        const setting = await prisma.appSetting.findUnique({
            where: { key: 'login_local_enabled' },
        });
        // Default to true if setting doesn't exist
        return setting ? setting.value !== 'false' : true;
    } catch {
        return true; // Fail open
    }
}

export const authConfig: NextAuthConfig = {
    adapter: PrismaAdapter(prisma),
    // AUTH_SECRET is the Auth.js v5 name. NEXTAUTH_SECRET remains a
    // compatibility fallback, but both must resolve to one stable key.
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    session: { strategy: 'jwt' },
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
                profile(profile) {
                    return {
                        id: profile.sub,
                        entraObjectId: profile.oid ?? profile.sub,
                        name: profile.name ?? profile.preferred_username,
                        email: profile.email ?? profile.preferred_username,
                        image: null,
                    };
                },
            })]
            : []),

        // ── Local Credentials (email + password) ────────────────
        Credentials({
            name: 'Email & Password',
            credentials: {
                email: { label: 'Email', type: 'email', placeholder: 'you@example.invalid' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;

                const email = (credentials.email as string).toLowerCase().trim();
                const password = credentials.password as string;

                // Check if local login is enabled
                const localEnabled = await isLocalLoginEnabled();
                if (!localEnabled) {
                    return null; // Local login disabled by admin
                }

                const user = await prisma.user.findUnique({
                    where: { email },
                }) as any;

                if (!user || !user.passwordHash) {
                    // Log failed attempt
                    auditLog({
                        action: 'auth.login_failed',
                        entity: 'auth',
                        metadata: { email, reason: !user ? 'user_not_found' : 'no_password_set', method: 'credentials' },
                    });
                    return null;
                }

                // Check if user is active
                if (!user.isActive) {
                    auditLog({
                        userId: user.id,
                        action: 'auth.login_failed',
                        entity: 'auth',
                        metadata: { email, reason: 'account_deactivated', method: 'credentials' },
                    });
                    return null;
                }

                const isValid = await bcrypt.compare(password, user.passwordHash as string);
                if (!isValid) {
                    auditLog({
                        userId: user.id,
                        action: 'auth.login_failed',
                        entity: 'auth',
                        metadata: { email, reason: 'invalid_password', method: 'credentials' },
                    });
                    return null;
                }

                // Log successful local login
                auditLog({
                    userId: user.id,
                    action: 'auth.login',
                    entity: 'auth',
                    metadata: { method: 'credentials', email },
                });

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    image: user.image,
                    role: user.role,
                    entraObjectId: user.entraObjectId,
                };
            },
        }),
    ],
    callbacks: {
        async signIn({ user, account }) {
            if (account?.provider === 'microsoft-entra-id' && user.email) {
                // Upsert user with Entra Object ID
                const existingUser = await prisma.user.findUnique({
                    where: { email: user.email },
                });

                if (existingUser) {
                    // Check if user is active
                    if (!existingUser.isActive) {
                        auditLog({
                            userId: existingUser.id,
                            action: 'auth.login_failed',
                            entity: 'auth',
                            metadata: { email: user.email, reason: 'account_deactivated', method: 'sso' },
                        });
                        return false; // Block deactivated users
                    }

                    await prisma.user.update({
                        where: { id: existingUser.id },
                        data: {
                            entraObjectId: user.entraObjectId,
                            name: user.name ?? existingUser.name,
                        },
                    });

                    // Log SSO login
                    auditLog({
                        userId: existingUser.id,
                        action: 'auth.login',
                        entity: 'auth',
                        metadata: { method: 'sso', provider: 'microsoft-entra-id', email: user.email },
                    });
                } else {
                    // Log new SSO user creation
                    auditLog({
                        action: 'auth.login',
                        entity: 'auth',
                        metadata: { method: 'sso', provider: 'microsoft-entra-id', email: user.email, newUser: true },
                    });
                }
            }
            return true;
        },
        async jwt({ token, user }) {
            // Hydrate on sign-in and repair older/incomplete tokens.
            if (user || !token.id || !token.role || !Array.isArray(token.groupIds)) {
                const email = user?.email ?? token.email;
                if (!email) return token;

                const dbUser = await prisma.user.findUnique({
                    where: { email },
                    include: { groupMemberships: true },
                });
                if (dbUser) {
                    token.id = dbUser.id;
                    token.role = dbUser.role;
                    token.entraObjectId = dbUser.entraObjectId;
                    token.groupIds = dbUser.groupMemberships.map((m) => m.groupId);
                }
            }
            return token;
        },
        async session({ session, token }) {
            if (token) {
                session.user.id = token.id as string;
                session.user.role = token.role as Role;
                session.user.entraObjectId = token.entraObjectId as string | null;
                session.user.groupIds = (token.groupIds as string[]) ?? [];
            }
            return session;
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
