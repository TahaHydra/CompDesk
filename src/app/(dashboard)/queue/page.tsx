'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { Inbox, Search, AlertTriangle, SlidersHorizontal, X } from 'lucide-react';

const DEFAULT_LIMIT = 20;
const PAGE_LIMITS = [10, 20, 50] as const;
const PAGE_SIZE_KEY = 'excodesk-queue-page-size';

export default function QueueInboxPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [queueId, setQueueId] = useState(searchParams.get('queueId') ?? 'all');
    const [search, setSearch] = useState(searchParams.get('search') ?? '');
    const [status, setStatus] = useState(searchParams.get('status') ?? 'all');
    const [priority, setPriority] = useState(searchParams.get('priority') ?? 'all');
    const [page, setPage] = useState(Number(searchParams.get('page') ?? '1') || 1);
    const [limit, setLimit] = useState(() => {
        const q = Number(searchParams.get('limit'));
        if (PAGE_LIMITS.includes(q as any)) return q;
        if (typeof window === 'undefined') return DEFAULT_LIMIT;
        const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
        return PAGE_LIMITS.includes(stored as any) ? stored : DEFAULT_LIMIT;
    });

    // Reset page on filter change
    useEffect(() => { setPage(1); }, [queueId, search, status, priority, limit]);

    // Persist page size
    useEffect(() => { localStorage.setItem(PAGE_SIZE_KEY, String(limit)); }, [limit]);

    // Sync URL
    useEffect(() => {
        const params = new URLSearchParams();
        if (queueId !== 'all') params.set('queueId', queueId);
        if (status !== 'all') params.set('status', status);
        if (priority !== 'all') params.set('priority', priority);
        if (search.trim()) params.set('search', search.trim());
        if (page > 1) params.set('page', String(page));
        if (limit !== DEFAULT_LIMIT) params.set('limit', String(limit));
        const query = params.toString();
        router.replace(query ? `/queue?${query}` : '/queue', { scroll: false });
    }, [router, queueId, status, priority, search, page, limit]);

    const { data: queues, isLoading: isLoadingQueues } = useQuery({
        queryKey: ['queues'],
        queryFn: async () => { const res = await fetch('/api/queues?accessible=true'); return res.json(); },
    });

    const { data, isLoading } = useQuery({
        queryKey: ['queue-tickets', queueId, search, status, priority, page, limit],
        queryFn: async () => {
            const params = new URLSearchParams({ view: 'queue', page: String(page), limit: String(limit) });
            if (queueId !== 'all') params.set('queueId', queueId);
            if (search.trim()) params.set('search', search.trim());
            if (status !== 'all') params.set('status', status);
            if (priority !== 'all') params.set('priority', priority);
            const res = await fetch(`/api/tickets?${params}`);
            return res.json();
        },
        refetchInterval: 15000,
        enabled: queues !== undefined && queues.length > 0, // only run if they have access to some departments
    });

    const tickets = data?.tickets ?? [];
    const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0 };
    const hasFilters = queueId !== 'all' || status !== 'all' || priority !== 'all' || !!search.trim();

    const noAccess = !isLoadingQueues && queues?.length === 0;

    if (noAccess) {
        return (
            <div className="flex flex-col items-center justify-center py-32 text-center h-full">
                <div className="rounded-full bg-destructive/10 p-6 mb-6">
                    <AlertTriangle className="h-12 w-12 text-destructive" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">No Access</h1>
                <p className="text-muted-foreground mt-2 max-w-md">
                    You do not currently have agent access to any departments. Please contact an administrator to be assigned to a department.
                </p>
                <Button variant="outline" className="mt-6" onClick={() => router.push('/tickets')}>
                    Return to My Tickets
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Inbox}
                title="Department Inbox"
                description={`${pagination.total} ticket${pagination.total !== 1 ? 's' : ''} in your departments`}
            />

            {/* Filters */}
            <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Select value={queueId} onValueChange={(v) => { setQueueId(v); setPage(1); }}>
                            <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All Departments" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Departments</SelectItem>
                                {(queues ?? []).map((q: any) => (
                                    <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-52 pl-9 h-9" />
                        </div>

                        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="NEW">New</SelectItem>
                                <SelectItem value="OPEN">Open</SelectItem>
                                <SelectItem value="PENDING_USER">Pending User</SelectItem>
                                <SelectItem value="PENDING_AGENT">Pending Agent</SelectItem>
                                <SelectItem value="RESOLVED">Resolved</SelectItem>
                                <SelectItem value="CLOSED">Closed</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
                            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Priority" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Priority</SelectItem>
                                <SelectItem value="LOW">Low</SelectItem>
                                <SelectItem value="NORMAL">Normal</SelectItem>
                                <SelectItem value="HIGH">High</SelectItem>
                                <SelectItem value="URGENT">Urgent</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}>
                            <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PAGE_LIMITS.map((size) => (
                                    <SelectItem key={size} value={String(size)}>{size}/page</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {hasFilters ? (
                            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => {
                                setQueueId('all'); setStatus('all'); setPriority('all'); setSearch(''); setPage(1);
                            }}>
                                <X className="h-3.5 w-3.5" /> Clear
                            </Button>
                        ) : (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <SlidersHorizontal className="h-3.5 w-3.5" /> Filters ready
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Ticket Table */}
            <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                        </div>
                    ) : tickets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <Inbox className="h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-lg font-medium">No tickets</p>
                            <p className="text-sm text-muted-foreground">No tickets matching your filters</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/40">
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Department</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Requester</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Assignee</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Priority</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Created</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {tickets.map((ticket: any) => (
                                        <tr
                                            key={ticket.id}
                                            className="hover:bg-muted/30 transition-colors cursor-pointer"
                                            onClick={() => router.push(`/tickets/${ticket.id}`)}
                                        >
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                {ticket.key}
                                                {ticket.slaBreached && <AlertTriangle className="inline h-3 w-3 text-destructive ml-1" />}
                                            </td>
                                            <td className="px-4 py-3 font-medium max-w-[280px]">
                                                <span className="truncate block">{ticket.title}</span>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                                                {ticket.queue?.name ?? '—'}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                                                {ticket.requester?.name ?? '—'}
                                            </td>
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
                                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap hidden xl:table-cell">
                                                {new Date(ticket.createdAt).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-between p-4 border-t">
                            <p className="text-sm text-muted-foreground">
                                Page {pagination.page} of {pagination.pages}
                            </p>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm"
                                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                    disabled={page === 1}>
                                    Previous
                                </Button>
                                <Button variant="outline" size="sm"
                                    onClick={() => setPage((prev) => Math.min(pagination.pages, prev + 1))}
                                    disabled={page >= pagination.pages}>
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
