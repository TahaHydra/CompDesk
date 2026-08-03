import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeLanguage } from '@/lib/i18n';
import AppShell from '@/components/layout/app-shell';
import { AuthProvider } from '@/components/providers/auth-provider';
import { LanguageProvider } from '@/components/providers/language-provider';
import { APP_VERSION } from '@/lib/version';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user?.id || !session.user.role) {
        redirect('/auth/signin');
    }

    const preference = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { preferredLanguage: true },
    });
    const initialLanguage = normalizeLanguage(preference?.preferredLanguage);

    return (
        <AuthProvider session={session}>
            <LanguageProvider initialLanguage={initialLanguage}>
                <AppShell initialSession={session} version={APP_VERSION}>{children}</AppShell>
            </LanguageProvider>
        </AuthProvider>
    );
}