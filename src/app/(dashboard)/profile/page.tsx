import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import { Shield, Mail, Calendar, CheckCircle2, Ticket, AlertTriangle } from 'lucide-react';

export default async function ProfilePage() {
    const session = await auth();
    if (!session?.user) redirect('/auth/signin');

    const user: any = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
            queueMemberships: { include: { queue: true } },
            groupMemberships: {
                include: {
                    group: {
                        include: { queueAssignments: { include: { queue: true } } }
                    }
                }
            }
        }
    });

    if (!user) redirect('/auth/signin');

    // Combine queue memberships from both groups and direct assignment
    const explicitQueues = user.queueMemberships.map((m: any) => m.queue);
    const groupQueues = user.groupMemberships.flatMap((gm: any) => gm.group.queueAssignments.map((qa: any) => qa.queue));

    const uniqueQueuesMap = new Map();
    [...explicitQueues, ...groupQueues].forEach((q: any) => uniqueQueuesMap.set(q.id, q));
    const assignedQueues = Array.from(uniqueQueuesMap.values());

    // Fetch user statistics
    const [ticketsSubmitted, ticketsResolved, ticketsEscalated] = await Promise.all([
        prisma.ticket.count({ where: { requesterId: user.id } }),
        prisma.ticket.count({ where: { assigneeId: user.id, status: { in: ['CLOSED', 'RESOLVED'] } } }),
        prisma.ticket.count({ where: { escalatedById: user.id } })
    ]);

    const ticketsCurrentlyAssigned = await prisma.ticket.count({
        where: { assigneeId: user.id, status: { notIn: ['CLOSED', 'RESOLVED'] } }
    });

    const isAgentRole = user.role === 'AGENT' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const initials = (user.name ?? user.email ?? '?').split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2);

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <PageHeader title="My Profile" description="View your account details and statistics." />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* User Card */}
                <Card className="col-span-1 md:col-span-1 border shadow-sm flex flex-col items-center p-6 text-center space-y-4">
                    <Avatar className="h-24 w-24 border-4 border-background shadow-lg">
                        <AvatarFallback className="brand-gradient text-white text-3xl font-bold">
                            {initials}
                        </AvatarFallback>
                    </Avatar>

                    <div>
                        <h2 className="text-xl font-bold text-foreground">{user.name ?? 'Unnamed user'}</h2>
                        <div className="flex items-center justify-center gap-2 mt-1 text-muted-foreground text-sm">
                            <Mail className="h-3.5 w-3.5" />
                            {user.email}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 w-full mt-4">
                        <div className="flex justify-between text-sm py-2 border-b">
                            <span className="text-muted-foreground flex items-center gap-1"><Shield className="h-4 w-4" /> Role</span>
                            <span className="font-semibold">{user.role}</span>
                        </div>
                        <div className="flex justify-between text-sm py-2 border-b">
                            <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-4 w-4" /> Joined</span>
                            <span className="font-semibold">{new Date(user.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                </Card>

                {/* Stats & Departments */}
                <div className="col-span-1 md:col-span-2 space-y-6">

                    <Card className="border shadow-sm">
                        <CardHeader className="bg-muted/30 pb-4">
                            <CardTitle className="text-lg">Lifetime Ticket Statistics</CardTitle>
                            <CardDescription>An overview of your helpdesk activity.</CardDescription>
                        </CardHeader>
                        <CardContent className={cn('grid gap-4 p-4 text-center', isAgentRole ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1')}>
                            <div className="space-y-1 p-3 bg-accent rounded-lg">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Submitted</p>
                                <p className="text-3xl font-bold text-primary">{ticketsSubmitted}</p>
                            </div>
                            {isAgentRole && (
                                <>
                                    <div className="space-y-1 p-3 bg-accent rounded-lg">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-center gap-1"><Ticket className="h-3.5 w-3.5" /> Active</p>
                                        <p className="text-3xl font-bold text-blue-600">{ticketsCurrentlyAssigned}</p>
                                    </div>
                                    <div className="space-y-1 p-3 bg-accent rounded-lg">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Resolved</p>
                                        <p className="text-3xl font-bold text-green-600">{ticketsResolved}</p>
                                    </div>
                                    <div className="space-y-1 p-3 bg-accent rounded-lg">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Escalated</p>
                                        <p className="text-3xl font-bold text-red-600">{ticketsEscalated}</p>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border shadow-sm">
                        <CardHeader className="bg-muted/30 pb-4">
                            <CardTitle className="text-lg">Department Access</CardTitle>
                            <CardDescription>The queues and departments you have permission to view.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-4">
                            {assignedQueues.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {assignedQueues.map(q => (
                                        <Badge key={q.id} variant="secondary" className="px-3 py-1.5 text-sm">
                                            {q.name}
                                        </Badge>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-muted-foreground text-sm">
                                    {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')
                                        ? 'You are an administrator and have access to all departments globally.'
                                        : 'You are not assigned to any departments.'}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                </div>
            </div>
        </div>
    );
}
