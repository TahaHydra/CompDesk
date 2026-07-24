import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export default async function UsersLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') redirect('/admin/departments');
    return children;
}
