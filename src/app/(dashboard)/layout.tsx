import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import AppShell from '@/components/layout/app-shell';
import { AuthProvider } from '@/components/providers/auth-provider';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user?.id || !session.user.role) {
        redirect('/auth/signin');
    }

    return (
        <AuthProvider session={session}>
            <AppShell initialSession={session}>{children}</AppShell>
        </AuthProvider>
    );
}
