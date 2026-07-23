'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { Ticket, Plus, Search, AlertTriangle, SlidersHorizontal, X } from 'lucide-react';

const DEFAULT_LIMIT = 20;
const PAGE_LIMITS = [10, 20, 50] as const;
const TICKET_PAGE_SIZE_KEY = 'excodesk-ticket-page-size';

const STATUS_VALUES = ['all', 'NEW', 'OPEN', 'PENDING_USER', 'PENDING_AGENT', 'RESOLVED', 'CLOSED'] as const;
const PRIORITY_VALUES = ['all', 'LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const VIEW_VALUES = ['my', 'queue', 'all'] as const;

function readParamValue(value: string | null, allowedValues: readonly string[], fallback: string) {
    if (!value) return fallback;
    return allowedValues.includes(value) ? value : fallback;
}

function readPositiveInt(value: string | null, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default function TicketsPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { data: session } = useSession();

    const userRole = session?.user?.role ?? 'USER';

    const allowedViews = useMemo<string[]>(() => {
        if (userRole === 'USER') return ['my'];
        if (userRole === 'AGENT') return ['my', 'queue'];
        return [...VIEW_VALUES];
    }, [userRole]);

    const initialUrlSearch = searchParams.get('search') ?? '';
    const initialPage = readPositiveInt(searchParams.get('page'), 1);
    const initialStatus = readParamValue(searchParams.get('status'), STATUS_VALUES, 'all');
    const initialPriority = readParamValue(searchParams.get('priority'), PRIORITY_VALUES, 'all');
    const initialView = readParamValue(searchParams.get('view'), allowedViews, 'my');

    const initialLimitFromQuery = readPositiveInt(searchParams.get('limit'), DEFAULT_LIMIT);
    const initialLimit = PAGE_LIMITS.includes(initialLimitFromQuery as any)
        ? initialLimitFromQuery
        : (() => {
            if (typeof window === 'undefined') return DEFAULT_LIMIT;
            const stored = Number.parseInt(localStorage.getItem(TICKET_PAGE_SIZE_KEY) ?? '', 10);
            return PAGE_LIMITS.includes(stored as any) ? stored : DEFAULT_LIMIT;
        })();

    const [searchInput, setSearchInput] = useState(initialUrlSearch);
    const [search, setSearch] = useState(initialUrlSearch.trim());
    const [status, setStatus] = useState(initialStatus);
    const [priority, setPriority] = useState(initialPriority);
    const [view, setView] = useState(initialView);
    const [page, setPage] = useState(initialPage);
    const [limit, setLimit] = useState(initialLimit);

    useEffect(() => {
        if (session === undefined) return; // wait for session

        const nextSearch = searchParams.get('search') ?? '';
        const nextStatus = readParamValue(searchParams.get('status'), STATUS_VALUES, 'all');
        const nextPriority = readParamValue(searchParams.get('priority'), PRIORITY_VALUES, 'all');
        const nextView = readParamValue(searchParams.get('view'), allowedViews, 'my');
        const nextPage = readPositiveInt(searchParams.get('page'), 1);

        setSearchInput((prev) => (prev !== nextSearch ? nextSearch : prev));
        setSearch((prev) => (prev !== nextSearch.trim() ? nextSearch.trim() : prev));
        setStatus((prev) => (prev !== nextStatus ? nextStatus : prev));
        setPriority((prev) => (prev !== nextPriority ? nextPriority : prev));
        setView((prev) => (prev !== nextView ? nextView : prev));
        setPage((prev) => (prev !== nextPage ? nextPage : prev));
    }, [searchParams, allowedViews, session]);

    // Handle initial limit from local storage
    useEffect(() => {
        if (searchParams.get('limit')) return;
        const stored = Number.parseInt(localStorage.getItem(TICKET_PAGE_SIZE_KEY) ?? '', 10);
        if (PAGE_LIMITS.includes(stored as any) && stored !== limit) {
            setLimit(stored);
        }
    }, [limit, searchParams]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 250);
        return () => window.clearTimeout(timeout);
    }, [searchInput]);

    useEffect(() => {
        localStorage.setItem(TICKET_PAGE_SIZE_KEY, String(limit));
    }, [limit]);

    // Push local state to URL
    useEffect(() => {
        if (session === undefined) return; // don't push until loaded

        const params = new URLSearchParams();
        if (view !== 'my') params.set('view', view);
        if (status !== 'all') params.set('status', status);
        if (priority !== 'all') params.set('priority', priority);
        if (search.trim()) params.set('search', search.trim());
        if (page > 1) params.set('page', String(page));
        if (limit !== DEFAULT_LIMIT) params.set('limit', String(limit));

        const query = params.toString();
        router.replace(query ? `/tickets?${query}` : '/tickets', { scroll: false });
    }, [router, view, status, priority, search, page, limit, session]);

    const { data, isLoading } = useQuery({
        queryKey: ['tickets', view, status, priority, search, page, limit],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.set('page', String(page));
            params.set('limit', String(limit));
            params.set('view', view);
            if (status !== 'all') params.set('status', status);
            if (priority !== 'all') params.set('priority', priority);
            if (search) params.set('search', search);
            const res = await fetch(`/api/tickets?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch tickets');
            return res.json();
        },
    });

    const tickets = data?.tickets ?? [];
    const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0 };
    const hasFilters = status !== 'all' || priority !== 'all' || !!searchInput.trim() || view !== 'my';

    return (
        <div className="space-y-6">
            <PageHeader
                title="Tickets"
                description={`${pagination.total} ticket${pagination.total !== 1 ? 's' : ''} total`}
            >
                <Link href="/tickets/new">
                    <Button className="gap-2 shadow-lg shadow-primary/25">
                        <Plus className="h-4 w-4" />
                        New Ticket
                    </Button>
                </Link>
            </PageHeader>

            {/* Filters */}
            <Card className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <Tabs value={view} onValueChange={(v) => { setView(v); setPage(1); }} className="mr-auto">
                            <TabsList>
                                <TabsTrigger value="my">My Tickets</TabsTrigger>
                                {allowedViews.includes('queue') ? (
                                    <TabsTrigger value="queue">Department</TabsTrigger>
                                ) : null}
                                {allowedViews.includes('all') ? (
                                    <TabsTrigger value="all">All</TabsTrigger>
                                ) : null}
                            </TabsList>
                        </Tabs>

                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                className="w-52 pl-9 h-9"
                            />
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

                        <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                            <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PAGE_LIMITS.map((size) => (
                                    <SelectItem key={size} value={String(size)}>{size}/page</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {hasFilters ? (
                            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => {
                                setView('my'); setStatus('all'); setPriority('all'); setSearchInput(''); setPage(1);
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
                            <div className="rounded-full bg-muted p-4 mb-4">
                                <Ticket className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <p className="text-lg font-medium">No tickets found</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Try adjusting your filters or create a new ticket
                            </p>
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
                                            <td className="px-4 py-3 font-medium max-w-[200px] sm:max-w-[280px]">
                                                <span className="truncate block">{ticket.title}</span>
                                                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground md:hidden">
                                                    {ticket.queue?.name ?? '—'}{ticket.requester?.name ? ` · ${ticket.requester.name}` : ''}
                                                </span>
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

                    {pagination.pages > 1 ? (
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
                    ) : null}
                </CardContent>
            </Card>
        </div>
    );
}
