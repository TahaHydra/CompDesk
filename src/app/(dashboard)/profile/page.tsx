import { redirect } from 'next/navigation';
import { Calendar, CheckCircle2, Mail, Shield, Ticket, AlertTriangle } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeLanguage, translate } from '@/lib/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageHeader } from '@/components/layout/page-header';
import { LanguagePreference } from '@/components/profile-language-preference';
import { cn } from '@/lib/utils';

export default async function ProfilePage() {
    const session = await auth();
    if (!session?.user) redirect('/auth/signin');

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
            queueMemberships: { include: { queue: true } },
            groupMemberships: {
                include: {
                    group: { include: { queueAssignments: { include: { queue: true } } } },
                },
            },
        },
    });
    if (!user) redirect('/auth/signin');

    const language = normalizeLanguage(user.preferredLanguage);
    const t = (key: string) => translate(language, key);
    const assignedQueues = [...new Map([
        ...user.queueMemberships.map((membership) => membership.queue),
        ...user.groupMemberships.flatMap((membership) =>
            membership.group.queueAssignments.map((assignment) => assignment.queue)
        ),
    ].map((queue) => [queue.id, queue])).values()];

    const [ticketsSubmitted, ticketsResolved, ticketsEscalated, ticketsCurrentlyAssigned] = await Promise.all([
        prisma.ticket.count({ where: { requesterId: user.id } }),
        prisma.ticket.count({ where: { assignments: { some: { userId: user.id } }, status: { in: ['CLOSED', 'RESOLVED'] } } }),
        prisma.ticket.count({ where: { escalatedById: user.id } }),
        prisma.ticket.count({ where: { assignments: { some: { userId: user.id } }, status: { notIn: ['CLOSED', 'RESOLVED'] } } }),
    ]);

    const isAgentRole = ['AGENT', 'ADMIN', 'SUPER_ADMIN'].includes(user.role);
    const initials = (user.name || user.email || '?').split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2);
    const dateFormatter = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium' });

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <PageHeader title={t('My Profile')} description={t('View your account details, preferences, and helpdesk activity.')} />

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <Card className="flex flex-col items-center space-y-4 border p-6 text-center shadow-sm md:col-span-1">
                    <Avatar className="h-24 w-24 border-4 border-background shadow-lg">
                        <AvatarFallback className="brand-gradient text-3xl font-bold text-white">{initials}</AvatarFallback>
                    </Avatar>
                    <div>
                        <h2 className="text-xl font-bold text-foreground">{user.name || user.email}</h2>
                        <div className="mt-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" />{user.email}
                        </div>
                    </div>
                    <div className="mt-4 flex w-full flex-col gap-2">
                        <div className="flex justify-between border-b py-2 text-sm">
                            <span className="flex items-center gap-1 text-muted-foreground"><Shield className="h-4 w-4" />{t('Role')}</span>
                            <span className="font-semibold">{user.role.replace('_', ' ')}</span>
                        </div>
                        <div className="flex justify-between border-b py-2 text-sm">
                            <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-4 w-4" />{t('Joined')}</span>
                            <span className="font-semibold">{dateFormatter.format(user.createdAt)}</span>
                        </div>
                    </div>
                </Card>

                <div className="space-y-6 md:col-span-2">
                    <LanguagePreference initialLanguage={language} />

                    <Card className="border shadow-sm">
                        <CardHeader className="bg-muted/30 pb-4">
                            <CardTitle className="text-lg">{t('Lifetime Ticket Statistics')}</CardTitle>
                            <CardDescription>{t('An overview of your helpdesk activity.')}</CardDescription>
                        </CardHeader>
                        <CardContent className={cn('grid gap-3 p-4 text-center', isAgentRole ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1')}>
                            <Stat label={t('Submitted')} value={ticketsSubmitted} className="text-primary" />
                            {isAgentRole ? (
                                <>
                                    <Stat label={t('Active')} value={ticketsCurrentlyAssigned} icon={Ticket} className="text-sky-700 dark:text-sky-300" />
                                    <Stat label={t('Resolved')} value={ticketsResolved} icon={CheckCircle2} className="text-emerald-700 dark:text-emerald-300" />
                                    <Stat label={t('Escalated')} value={ticketsEscalated} icon={AlertTriangle} className="text-rose-700 dark:text-rose-300" />
                                </>
                            ) : null}
                        </CardContent>
                    </Card>

                    <Card className="border shadow-sm">
                        <CardHeader className="bg-muted/30 pb-4">
                            <CardTitle className="text-lg">{t('Department Access')}</CardTitle>
                            <CardDescription>{t('The departments you are assigned to or administer.')}</CardDescription>
                        </CardHeader>
                        <CardContent className="p-4">
                            {assignedQueues.length ? (
                                <div className="flex flex-wrap gap-2">
                                    {assignedQueues.map((queue) => <Badge key={queue.id} variant="secondary" className="px-3 py-1.5 text-sm">{queue.name}</Badge>)}
                                </div>
                            ) : (
                                <div className="py-6 text-center text-sm text-muted-foreground">{t('You are not assigned to any departments.')}</div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

function Stat({
    label,
    value,
    icon: Icon,
    className,
}: {
    label: string;
    value: number;
    icon?: typeof Ticket;
    className: string;
}) {
    return (
        <div className="space-y-1 rounded-lg border bg-muted/35 p-3">
            <p className="flex items-center justify-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {Icon ? <Icon className="h-3.5 w-3.5" /> : null}{label}
            </p>
            <p className={cn('text-3xl font-bold', className)}>{value}</p>
        </div>
    );
}