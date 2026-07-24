'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
    AlertCircle,
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Clock,
    Flame,
    Link as LinkIcon,
    Plus,
    Ticket,
    TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { useBranding } from '@/components/providers/branding-provider';
import { useLanguage } from '@/components/providers/language-provider';
import type { DashboardLink } from '@/lib/dashboard-links';

interface RecentTicket {
    id: string;
    key: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
    slaBreached?: boolean;
    requester?: { name: string } | null;
    assignee?: { name: string } | null;
}

interface DashboardData {
    stats: { total: number; open: number; pending: number; resolved: number; urgent: number; escalated: number };
    recentTickets: RecentTicket[];
    customLinks: DashboardLink[];
}

export default function DashboardPage() {
    const branding = useBranding();
    const { t, language } = useLanguage();
    const { data, isLoading } = useQuery<DashboardData>({
        queryKey: ['dashboard-stats'],
        queryFn: async () => {
            const response = await fetch('/api/dashboard/stats');
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to fetch dashboard');
            return payload;
        },
    });

    const stats = data?.stats ?? { total: 0, open: 0, pending: 0, resolved: 0, urgent: 0, escalated: 0 };
    const recentTickets = data?.recentTickets ?? [];
    const customLinks = data?.customLinks ?? [];
    const statCards = [
        { label: 'Total Tickets', value: stats.total, icon: Ticket, className: 'text-primary', href: '/tickets?view=all' },
        { label: 'Open', value: stats.open, icon: AlertCircle, className: 'text-sky-700 dark:text-sky-300', href: '/tickets?view=all&status=OPEN' },
        { label: 'Pending', value: stats.pending, icon: Clock, className: 'text-amber-700 dark:text-amber-300', href: '/tickets?view=all&status=PENDING_USER' },
        { label: 'Resolved', value: stats.resolved, icon: CheckCircle2, className: 'text-emerald-700 dark:text-emerald-300', href: '/tickets?view=all&status=RESOLVED' },
        { label: 'Urgent', value: stats.urgent, icon: Flame, className: 'text-rose-700 dark:text-rose-300', href: '/tickets?view=all&priority=URGENT' },
    ];
    const dateFormatter = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short' });

    return (
        <div className="space-y-8">
            <PageHeader eyebrow={t('Overview')} title={t('Dashboard')} description={t('A snapshot of activity across {name}', { name: branding.shortApplicationName })}>
                <Button asChild><Link href="/tickets/new"><Plus className="mr-2 h-4 w-4" />{t('New Ticket')}</Link></Button>
            </PageHeader>

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
                {statCards.map((stat, index) => (
                    <Link key={stat.label} href={stat.href} className="animate-rise" style={{ '--i': index } as React.CSSProperties}>
                        <Card className="group h-full border shadow-sm transition-colors hover:border-primary/40">
                            <CardContent className="p-4 sm:p-5">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0"><p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{t(stat.label)}</p><p className={`mt-1 text-2xl font-bold tabular-nums sm:text-3xl ${stat.className}`}>{isLoading ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-muted align-middle" /> : stat.value}</p></div>
                                    <div className="shrink-0 rounded-lg border bg-muted/40 p-2.5"><stat.icon className={`h-5 w-5 ${stat.className}`} /></div>
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>

            {customLinks.length ? (
                <section className="space-y-4">
                    <h2 className="flex items-center gap-2 text-lg font-semibold"><LinkIcon className="h-5 w-5 text-primary" />{t('Quick Links')}</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {customLinks.map((link) => (
                            <a href={link.url} target="_blank" rel="noopener noreferrer" key={`${link.title}:${link.url}`} className="group block">
                                <Card className="h-full border shadow-sm transition-colors hover:border-primary/45">
                                    <CardContent className="flex items-center gap-3 p-4">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/35">
                                            {link.iconUrl ? <Image src={link.iconUrl} alt="" width={32} height={32} className="h-8 w-8 object-contain" unoptimized /> : <LinkIcon className="h-4 w-4 text-muted-foreground" />}
                                        </div>
                                        <p className="min-w-0 flex-1 truncate text-sm font-medium">{link.title}</p>
                                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                                    </CardContent>
                                </Card>
                            </a>
                        ))}
                    </div>
                </section>
            ) : null}

            <Card className="border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="flex items-center gap-2 text-lg"><TrendingUp className="h-5 w-5 text-primary" />{t('Recent Activity')}</CardTitle>
                    <Button asChild variant="ghost" size="sm" className="text-primary"><Link href="/tickets">{t('View all')}<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                    {isLoading ? (
                        <div className="space-y-2 px-4 pb-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-11 animate-pulse rounded-lg bg-muted/60" />)}</div>
                    ) : !recentTickets.length ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center"><div className="mb-4 rounded-full border bg-muted/40 p-4"><Ticket className="h-7 w-7 text-muted-foreground" /></div><p className="text-lg font-medium">{t('No tickets yet')}</p><p className="mt-1 text-sm text-muted-foreground">{t('Create your first ticket to get started')}</p><Button asChild size="sm" className="mt-4"><Link href="/tickets/new"><Plus className="mr-2 h-3.5 w-3.5" />{t('Create Ticket')}</Link></Button></div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead><tr className="border-b bg-muted/35"><Header>{t('ID')}</Header><Header>{t('Title')}</Header><Header className="hidden md:table-cell">{t('Requester')}</Header><Header className="hidden lg:table-cell">{t('Assignee')}</Header><Header>{t('Status')}</Header><Header className="hidden sm:table-cell">{t('Priority')}</Header><Header className="hidden lg:table-cell">{t('Date')}</Header></tr></thead>
                                <tbody className="divide-y">
                                    {recentTickets.map((ticket) => (
                                        <tr key={ticket.id} className="cursor-pointer transition-colors hover:bg-muted/30" onClick={() => window.location.href = `/tickets/${ticket.id}`}>
                                            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{ticket.key}{ticket.slaBreached ? <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" /> : null}</td>
                                            <td className="max-w-[200px] truncate px-4 py-3 font-medium">{ticket.title}</td>
                                            <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{ticket.requester?.name ?? '—'}</td>
                                            <td className="hidden px-4 py-3 lg:table-cell">{ticket.assignee?.name ?? <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{t('Unassigned')}</span>}</td>
                                            <td className="px-4 py-3"><Badge className={`status-${ticket.status.toLowerCase()} text-xs`}>{ticket.status.replaceAll('_', ' ')}</Badge></td>
                                            <td className="hidden px-4 py-3 sm:table-cell"><Badge variant="outline" className={`priority-${ticket.priority.toLowerCase()} text-xs`}>{ticket.priority}</Badge></td>
                                            <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground lg:table-cell">{dateFormatter.format(new Date(ticket.createdAt))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function Header({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <th className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground ${className}`}>{children}</th>;
}