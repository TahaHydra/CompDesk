'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { Inbox, Search, AlertTriangle, SlidersHorizontal, X } from 'lucide-react';
import { AssigneeSummary } from '@/components/tickets/assignee-summary';
import { useLanguage } from '@/components/providers/language-provider';

const DEFAULT_LIMIT = 20;
const PAGE_LIMITS = [10, 20, 50] as const;
const PAGE_SIZE_KEY = 'compdesk-queue-page-size';

export default function QueueInboxPage() {
    const router = useRouter();
    const { t } = useLanguage();
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

    const urlSnapshot = searchParams.toString();
    const previousUrl = useRef(urlSnapshot);
    const reconcilingUrl = useRef(false);
    const pendingUrls = useRef(new Set<string>());
    const latestOwnUrl = useRef<string | null>(null);
    useEffect(() => {
        if (previousUrl.current === urlSnapshot) return;
        previousUrl.current = urlSnapshot;
        // An earlier router acknowledgment may arrive after the user types again.
        if (pendingUrls.current.delete(urlSnapshot)) {
            if (latestOwnUrl.current === urlSnapshot) { pendingUrls.current.clear(); latestOwnUrl.current = null; }
            return;
        }
        pendingUrls.current.clear(); latestOwnUrl.current = null;
        reconcilingUrl.current = true;
        const incoming = new URLSearchParams(urlSnapshot);
        setQueueId(incoming.get('queueId') ?? 'all'); setSearch(incoming.get('search') ?? '');
        setStatus(incoming.get('status') ?? 'all'); setPriority(incoming.get('priority') ?? 'all');
        setPage(Math.max(1, Number(incoming.get('page') ?? '1') || 1));
        const requestedLimit = Number(incoming.get('limit'));
        const storedLimit = Number(localStorage.getItem(PAGE_SIZE_KEY));
        setLimit(PAGE_LIMITS.includes(requestedLimit as any) ? requestedLimit : PAGE_LIMITS.includes(storedLimit as any) ? storedLimit : DEFAULT_LIMIT);
    }, [urlSnapshot]);

    // Persist page size
    useEffect(() => { localStorage.setItem(PAGE_SIZE_KEY, String(limit)); }, [limit]);

    // Sync URL
    useEffect(() => {
        if (reconcilingUrl.current) { reconcilingUrl.current = false; return; }
        const params = new URLSearchParams();
        if (queueId !== 'all') params.set('queueId', queueId);
        if (status !== 'all') params.set('status', status);
        if (priority !== 'all') params.set('priority', priority);
        if (search.trim()) params.set('search', search.trim());
        if (page > 1) params.set('page', String(page));
        if (limit !== DEFAULT_LIMIT) params.set('limit', String(limit));
        const query = params.toString();
        if (query !== urlSnapshot) {
            pendingUrls.current.add(query); latestOwnUrl.current = query;
            router.replace(query ? `/queue?${query}` : '/queue', { scroll: false });
        }
    }, [router, queueId, status, priority, search, page, limit, urlSnapshot]);

    const { data: queues, isLoading: isLoadingQueues, error: queuesError, refetch: retryQueues } = useQuery({
        queryKey: ['queues', 'accessible'],
        queryFn: async () => {
            const res = await fetch('/api/queues?accessible=true');
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Failed to load departments');
            if (!Array.isArray(payload)) throw new Error('The server returned an invalid department list');
            return payload;
        },
    });

    const { data, isLoading, error: ticketsError, refetch: retryTickets } = useQuery({
        queryKey: ['queue-tickets', queueId, search, status, priority, page, limit],
        queryFn: async () => {
            const params = new URLSearchParams({ view: 'queue', page: String(page), limit: String(limit) });
            if (queueId !== 'all') params.set('queueId', queueId);
            if (search.trim()) params.set('search', search.trim());
            if (status !== 'all') params.set('status', status);
            if (priority !== 'all') params.set('priority', priority);
            const res = await fetch(`/api/tickets?${params}`);
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Failed to load department tickets');
            if (!Array.isArray(payload.tickets) || !payload.pagination || !['page', 'pages', 'total'].every((key) => typeof payload.pagination[key] === 'number')) throw new Error('The server returned an invalid ticket list');
            return payload;
        },
        refetchInterval: 15000,
        enabled: queues !== undefined && queues.length > 0, // only run if they have access to some departments
    });

    const tickets = data?.tickets ?? [];
    const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0 };
    const hasFilters = queueId !== 'all' || status !== 'all' || priority !== 'all' || !!search.trim();

    const noAccess = !isLoadingQueues && queues?.length === 0;

    if ((queuesError && !queues) || (ticketsError && !data)) {
        const message = queuesError instanceof Error
            ? queuesError.message
            : ticketsError instanceof Error ? ticketsError.message : 'The Department Inbox could not be loaded.';
        return (
            <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
                <AlertTriangle className="h-10 w-10 text-destructive" />
                <h1 className="mt-4 text-xl font-semibold">{t("Department Inbox unavailable")}</h1>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
                <Button className="mt-5" variant="outline" onClick={() => { void retryQueues(); void retryTickets(); }}>{t("Try again")}</Button>
            </div>
        );
    }

    if (noAccess) {
        return (
            <div className="flex flex-col items-center justify-center py-32 text-center h-full">
                <div className="rounded-full bg-destructive/10 p-6 mb-6">
                    <AlertTriangle className="h-12 w-12 text-destructive" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">{t("No Access")}</h1>
                <p className="text-muted-foreground mt-2 max-w-md"> {t("You do not currently have agent access to any departments. Please contact an administrator to be assigned to a department.")} </p>
                <Button variant="outline" className="mt-6" onClick={() => router.push('/tickets')}> {t("Return to My Tickets")} </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {queuesError || ticketsError ? <div role="alert" className="rounded-lg border p-4 text-destructive">{(queuesError || ticketsError)?.message}<Button className="ml-3" variant="outline" onClick={() => { void retryQueues(); void retryTickets(); }}>{t('Try again')}</Button></div> : null}
            <PageHeader
                icon={Inbox}
                title={t("Department Inbox")}
                description={t('{count} tickets in your departments', { count: pagination.total })}
            />

            {/* Filters */}
            <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Select value={queueId} onValueChange={(v) => { setQueueId(v); setPage(1); }}>
                            <SelectTrigger className="w-48 h-9"><SelectValue placeholder={t("All Departments")} /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("All Departments")}</SelectItem>
                                {(queues ?? []).map((q: any) => (
                                    <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder={t("Search...")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-52 pl-9 h-9" />
                        </div>

                        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                            <SelectTrigger className="w-40 h-9"><SelectValue placeholder={t("Status")} /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("All Status")}</SelectItem>
                                <SelectItem value="NEW">{t("New")}</SelectItem>
                                <SelectItem value="OPEN">{t("Open")}</SelectItem>
                                <SelectItem value="PENDING_USER">{t("Pending User")}</SelectItem>
                                <SelectItem value="PENDING_AGENT">{t("Pending Agent")}</SelectItem>
                                <SelectItem value="RESOLVED">{t("Resolved")}</SelectItem>
                                <SelectItem value="CLOSED">{t("Closed")}</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
                            <SelectTrigger className="w-36 h-9"><SelectValue placeholder={t("Priority")} /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("All Priority")}</SelectItem>
                                <SelectItem value="LOW">{t("Low")}</SelectItem>
                                <SelectItem value="NORMAL">{t("Normal")}</SelectItem>
                                <SelectItem value="HIGH">{t("High")}</SelectItem>
                                <SelectItem value="URGENT">{t("Urgent")}</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}>
                            <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PAGE_LIMITS.map((size) => (
                                    <SelectItem key={size} value={String(size)}>{size}{t("/page")}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {hasFilters ? (
                            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => {
                                setQueueId('all'); setStatus('all'); setPriority('all'); setSearch(''); setPage(1);
                            }}>
                                <X className="h-3.5 w-3.5" /> {t("Clear")} </Button>
                        ) : (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <SlidersHorizontal className="h-3.5 w-3.5" /> {t("Filters ready")} </div>
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
                            <p className="text-lg font-medium">{t("No tickets")}</p>
                            <p className="text-sm text-muted-foreground">{t("No tickets matching your filters")}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/40">
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("ID")}</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("Title")}</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">{t("Department")}</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">{t("Requester")}</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">{t("Assignee")}</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("Status")}</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">{t("Priority")}</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">{t("Created")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {tickets.map((ticket: any) => (
                                        <tr
                                            key={ticket.id}
                                            className="transition-colors hover:bg-muted/30"
                                        >
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                {ticket.key}
                                                {ticket.slaBreached && <AlertTriangle className="inline h-3 w-3 text-destructive ml-1" />}
                                            </td>
                                            <td className="px-4 py-3 font-medium max-w-[280px]">
                                                <Link href={`/tickets/${ticket.id}`} className="block truncate rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{ticket.title}</Link>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                                                {ticket.queue?.name ?? '—'}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                                                {ticket.requester?.name ?? '—'}
                                            </td>
                                            <td className="px-4 py-3 hidden lg:table-cell">
                                                <AssigneeSummary assignees={ticket.assignees} className="text-sm" />
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge className={`status-${ticket.status.toLowerCase()} text-xs`}>
                                                    {t(ticket.status.replace(/_/g, ' '))}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 hidden sm:table-cell">
                                                <Badge variant="outline" className={`priority-${ticket.priority.toLowerCase()} text-xs`}>
                                                    {t(ticket.priority)}
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
                            <p className="text-sm text-muted-foreground"> {t("Page")} {pagination.page} {t("of")} {pagination.pages}
                            </p>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm"
                                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                    disabled={page === 1}> {t("Previous")} </Button>
                                <Button variant="outline" size="sm"
                                    onClick={() => setPage((prev) => Math.min(pagination.pages, prev + 1))}
                                    disabled={page >= pagination.pages}> {t("Next")} </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
