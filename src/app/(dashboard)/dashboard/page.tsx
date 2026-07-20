'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
    Ticket,
    AlertCircle,
    CheckCircle2,
    Clock,
    Flame,
    Plus,
    ArrowRight,
    TrendingUp,
    Link as LinkIcon,
    AlertTriangle,
} from 'lucide-react';

export default function DashboardPage() {
    const { data, isLoading } = useQuery({
        queryKey: ['dashboard-stats'],
        queryFn: async () => {
            const res = await fetch('/api/dashboard/stats');
            if (!res.ok) throw new Error('Failed to fetch stats');
            return res.json();
        },
    });

    const stats = data?.stats ?? { total: 0, open: 0, pending: 0, resolved: 0, urgent: 0, escalated: 0 };
    const recentTickets = data?.recentTickets ?? [];
    const customLinks = data?.customLinks ?? [];

    const statCards = [
        {
            label: 'Total Tickets',
            value: stats.total,
            icon: Ticket,
            textColor: 'text-indigo-600',
            bgColor: 'bg-indigo-50 dark:bg-indigo-950/30',
            href: '/tickets?view=all',
        },
        {
            label: 'Open',
            value: stats.open,
            icon: AlertCircle,
            textColor: 'text-blue-600',
            bgColor: 'bg-blue-50 dark:bg-blue-950/30',
            href: '/tickets?view=all&status=OPEN',
        },
        {
            label: 'Pending',
            value: stats.pending,
            icon: Clock,
            textColor: 'text-amber-600',
            bgColor: 'bg-amber-50 dark:bg-amber-950/30',
            href: '/tickets?view=all&status=PENDING_USER',
        },
        {
            label: 'Resolved',
            value: stats.resolved,
            icon: CheckCircle2,
            textColor: 'text-purple-600',
            bgColor: 'bg-purple-50 dark:bg-purple-950/30',
            href: '/tickets?view=all&status=RESOLVED',
        },
        {
            label: 'Urgent',
            value: stats.urgent,
            icon: Flame,
            textColor: 'text-red-600',
            bgColor: 'bg-red-50 dark:bg-red-950/30',
            href: '/tickets?view=all&priority=URGENT',
        },
    ];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
                    <p className="text-muted-foreground mt-1">Overview of your helpdesk activity</p>
                </div>
                <Link href="/tickets/new">
                    <Button className="gap-2 shadow-lg shadow-primary/25">
                        <Plus className="h-4 w-4" />
                        New Ticket
                    </Button>
                </Link>
            </div>

            {/* Stats Grid — each card links to filtered ticket list */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {statCards.map((stat) => (
                    <Link key={stat.label} href={stat.href}>
                        <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
                            <CardContent className="p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">{stat.label}</p>
                                        <p className={`text-3xl font-bold mt-1 ${stat.textColor}`}>
                                            {isLoading ? '—' : stat.value}
                                        </p>
                                    </div>
                                    <div className={`${stat.bgColor} p-3 rounded-xl`}>
                                        <stat.icon className={`h-5 w-5 ${stat.textColor}`} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>

            {/* Quick Links */}
            {customLinks.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <LinkIcon className="h-5 w-5 text-primary" /> Quick Links
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {customLinks.map((link: any, i: number) => (
                            <a href={link.url} target="_blank" rel="noopener noreferrer" key={i} className="block group">
                                <Card className="border shadow-sm hover:shadow-md transition-all group-hover:border-primary/50 overflow-hidden relative">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-primary/20 group-hover:bg-primary transition-colors" />
                                    <CardContent className="p-4 flex items-center justify-between">
                                        <p className="font-medium text-sm pl-2">{link.title}</p>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors group-hover:translate-x-1" />
                                    </CardContent>
                                </Card>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Recent Tickets — table format */}
            <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">Recent Activity</CardTitle>
                    </div>
                    <Link href="/tickets">
                        <Button variant="ghost" size="sm" className="gap-1 text-primary">
                            View all <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                    </Link>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                    {recentTickets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="rounded-full bg-muted p-4 mb-4">
                                <Ticket className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <p className="text-lg font-medium">No tickets yet</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Create your first ticket to get started
                            </p>
                            <Link href="/tickets/new" className="mt-4">
                                <Button size="sm" className="gap-2">
                                    <Plus className="h-3.5 w-3.5" />
                                    Create Ticket
                                </Button>
                            </Link>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/40">
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Requester</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Assignee</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Priority</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Date</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {recentTickets.map((ticket: any) => (
                                        <tr key={ticket.id} className="hover:bg-muted/30 transition-colors cursor-pointer group"
                                            onClick={() => window.location.href = `/tickets/${ticket.id}`}>
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                {ticket.key}
                                                {ticket.slaBreached && <AlertTriangle className="inline h-3 w-3 text-destructive ml-1" />}
                                            </td>
                                            <td className="px-4 py-3 font-medium max-w-[200px] truncate">{ticket.title}</td>
                                            <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{ticket.requester?.name ?? '—'}</td>
                                            <td className="px-4 py-3 hidden lg:table-cell">
                                                {ticket.assignee ? (
                                                    <span className="text-sm">{ticket.assignee.name}</span>
                                                ) : (
                                                    <span className="text-xs text-amber-600 font-medium">Unassigned</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge className={`status-${ticket.status.toLowerCase()} text-xs`}>
                                                    {ticket.status.replace(/_/g, ' ')}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 hidden sm:table-cell">
                                                <Badge variant="outline" className={`priority-${ticket.priority.toLowerCase()} text-xs`}>
                                                    {ticket.priority}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                                                {new Date(ticket.createdAt).toLocaleDateString()}
                                            </td>
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
