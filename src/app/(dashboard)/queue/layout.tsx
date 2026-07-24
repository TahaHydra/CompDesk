import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAgentRole } from '@/lib/permissions';

export default async function QueueLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user || !isAgentRole(session.user.role)) {
        redirect('/tickets');
    }

    return children;
}
