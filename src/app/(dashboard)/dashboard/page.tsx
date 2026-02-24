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
            color: 'from-indigo-500 to-indigo-600',
            textColor: 'text-indigo-600',
            bgColor: 'bg-indigo-50 dark:bg-indigo-950/30',
        },
        {
            label: 'Open',
            value: stats.open,
            icon: AlertCircle,
            color: 'from-emerald-500 to-emerald-600',
            textColor: 'text-emerald-600',
            bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
        },
        {
            label: 'Pending',
            value: stats.pending,
            icon: Clock,
            color: 'from-amber-500 to-amber-600',
            textColor: 'text-amber-600',
            bgColor: 'bg-amber-50 dark:bg-amber-950/30',
        },
        {
            label: 'Resolved',
            value: stats.resolved,
            icon: CheckCircle2,
            color: 'from-purple-500 to-purple-600',
            textColor: 'text-purple-600',
            bgColor: 'bg-purple-50 dark:bg-purple-950/30',
        },
        {
            label: 'Urgent',
            value: stats.urgent,
            icon: Flame,
            color: 'from-red-500 to-red-600',
            textColor: 'text-red-600',
            bgColor: 'bg-red-50 dark:bg-red-950/30',
        },
        {
            label: 'Escalated',
            value: stats.escalated,
            icon: AlertCircle,
            color: 'from-rose-500 to-rose-600',
            textColor: 'text-rose-600',
            bgColor: 'bg-rose-50 dark:bg-rose-950/30',
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

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {statCards.map((stat) => (
                    <Card key={stat.label} className="overflow-hidden border-0 shadow-sm">
                        <CardContent className="p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
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

            {/* Recent Tickets */}
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
                <CardContent>
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
                        <div className="space-y-2">
                            {recentTickets.map((ticket: any) => (
                                <Link
                                    key={ticket.id}
                                    href={`/tickets/${ticket.id}`}
                                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                                            {ticket.key}
                                        </span>
                                        <span className="text-sm font-medium truncate">{ticket.title}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Badge
                                            variant="secondary"
                                            className={`status-${ticket.status.toLowerCase()} text-xs`}
                                        >
                                            {ticket.status.replace('_', ' ')}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            className={`priority-${ticket.priority.toLowerCase()} text-xs`}
                                        >
                                            {ticket.priority}
                                        </Badge>
                                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
