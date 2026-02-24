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
import { Ticket, Plus, Search, AlertTriangle, SlidersHorizontal, X } from 'lucide-react';

const DEFAULT_LIMIT = 20;
const PAGE_LIMITS = [10, 20, 50] as const;
const TICKET_PAGE_SIZE_KEY = 'excodesk-ticket-page-size';

const STATUS_VALUES = [
    'all',
    'NEW',
    'OPEN',
    'PENDING_USER',
    'PENDING_AGENT',
    'RESOLVED',
    'CLOSED',
] as const;

const PRIORITY_VALUES = ['all', 'LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

const VIEW_VALUES = ['my', 'queue', 'all'] as const;

function readParamValue(
    value: string | null,
    allowedValues: readonly string[],
    fallback: string
) {
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
        const nextSearch = searchParams.get('search') ?? '';
        const nextStatus = readParamValue(searchParams.get('status'), STATUS_VALUES, 'all');
        const nextPriority = readParamValue(searchParams.get('priority'), PRIORITY_VALUES, 'all');
        const nextView = readParamValue(searchParams.get('view'), allowedViews, 'my');
        const nextPage = readPositiveInt(searchParams.get('page'), 1);
        const nextLimitCandidate = readPositiveInt(searchParams.get('limit'), limit);
        const nextLimit = PAGE_LIMITS.includes(nextLimitCandidate as any) ? nextLimitCandidate : limit;

        if (nextSearch !== searchInput) setSearchInput(nextSearch);
        if (nextStatus !== status) setStatus(nextStatus);
        if (nextPriority !== priority) setPriority(nextPriority);
        if (nextView !== view) setView(nextView);
        if (nextPage !== page) setPage(nextPage);
        if (nextLimit !== limit) setLimit(nextLimit);
    }, [searchParams, allowedViews, limit, page, priority, searchInput, status, view]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setSearch(searchInput.trim());
        }, 250);
        return () => window.clearTimeout(timeout);
    }, [searchInput]);

    useEffect(() => {
        localStorage.setItem(TICKET_PAGE_SIZE_KEY, String(limit));
    }, [limit]);

    useEffect(() => {
        if (searchParams.get('limit')) return;
        const stored = Number.parseInt(localStorage.getItem(TICKET_PAGE_SIZE_KEY) ?? '', 10);
        if (PAGE_LIMITS.includes(stored as any) && stored !== limit) {
            setLimit(stored);
        }
    }, [limit, searchParams]);

    useEffect(() => {
        if (!allowedViews.includes(view as any)) {
            setView('my');
            setPage(1);
        }
    }, [allowedViews, view]);

    useEffect(() => {
        setPage(1);
    }, [view, status, priority, search, limit]);

    useEffect(() => {
        const params = new URLSearchParams();
        if (view !== 'my') params.set('view', view);
        if (status !== 'all') params.set('status', status);
        if (priority !== 'all') params.set('priority', priority);
        if (searchInput.trim()) params.set('search', searchInput.trim());
        if (page > 1) params.set('page', String(page));
        if (limit !== DEFAULT_LIMIT) params.set('limit', String(limit));

        const query = params.toString();
        router.replace(query ? `/tickets?${query}` : '/tickets', { scroll: false });
    }, [router, view, status, priority, searchInput, page, limit]);

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
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
                    <p className="text-muted-foreground mt-1">
                        {pagination.total} ticket{pagination.total !== 1 ? 's' : ''} total
                    </p>
                </div>
                <Link href="/tickets/new">
                    <Button className="gap-2 shadow-lg shadow-primary/25">
                        <Plus className="h-4 w-4" />
                        New Ticket
                    </Button>
                </Link>
            </div>

            <Card className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <Tabs value={view} onValueChange={setView} className="mr-auto">
                            <TabsList>
                                <TabsTrigger value="my">My Tickets</TabsTrigger>
                                {allowedViews.includes('queue') ? (
                                    <TabsTrigger value="queue">Queue</TabsTrigger>
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

                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger className="w-40 h-9">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
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

                        <Select value={priority} onValueChange={setPriority}>
                            <SelectTrigger className="w-36 h-9">
                                <SelectValue placeholder="Priority" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Priority</SelectItem>
                                <SelectItem value="LOW">Low</SelectItem>
                                <SelectItem value="NORMAL">Normal</SelectItem>
                                <SelectItem value="HIGH">High</SelectItem>
                                <SelectItem value="URGENT">Urgent</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                            <SelectTrigger className="w-28 h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PAGE_LIMITS.map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size}/page
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {hasFilters ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => {
                                    setView('my');
                                    setStatus('all');
                                    setPriority('all');
                                    setSearchInput('');
                                    setPage(1);
                                }}
                            >
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
                        <div className="divide-y">
                            {tickets.map((ticket: any) => (
                                <Link
                                    key={ticket.id}
                                    href={`/tickets/${ticket.id}`}
                                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                                >
                                    <div className="flex items-start gap-4 min-w-0 flex-1">
                                        <div className="flex flex-col gap-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono text-muted-foreground">
                                                    {ticket.key}
                                                </span>
                                                {ticket.slaBreached ? (
                                                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                                                ) : null}
                                            </div>
                                            <h3 className="text-sm font-medium truncate">{ticket.title}</h3>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <span>{ticket.queue?.name}</span>
                                                <span>·</span>
                                                <span>{ticket.requester?.name}</span>
                                                <span>·</span>
                                                <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0 ml-4">
                                        {ticket.assignee ? (
                                            <span className="text-xs text-muted-foreground hidden sm:block">
                                                → {ticket.assignee.name}
                                            </span>
                                        ) : null}
                                        <Badge
                                            variant="secondary"
                                            className={`status-${ticket.status.toLowerCase()} text-xs`}
                                        >
                                            {ticket.status.replace(/_/g, ' ')}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            className={`priority-${ticket.priority.toLowerCase()} text-xs`}
                                        >
                                            {ticket.priority}
                                        </Badge>
                                        {ticket.tags?.map((tt: any) => (
                                            <Badge
                                                key={tt.tag.id}
                                                variant="outline"
                                                className="text-xs"
                                                style={{ borderColor: tt.tag.color, color: tt.tag.color }}
                                            >
                                                {tt.tag.name}
                                            </Badge>
                                        ))}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}

                    {pagination.pages > 1 ? (
                        <div className="flex items-center justify-between p-4 border-t">
                            <p className="text-sm text-muted-foreground">
                                Page {pagination.page} of {pagination.pages}
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                    disabled={page === 1}
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage((prev) => Math.min(pagination.pages, prev + 1))}
                                    disabled={page >= pagination.pages}
                                >
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
