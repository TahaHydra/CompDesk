'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertTriangle, Plus, Search, Ticket, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { UserSearchCombobox } from '@/components/tickets/user-search-combobox';
import { AssigneeSummary } from '@/components/tickets/assignee-summary';
import { useLanguage } from '@/components/providers/language-provider';

const DEFAULT_LIMIT = 20;
const PAGE_LIMITS = [10, 20, 50] as const;
const STATUS_VALUES = ['all', 'pending', 'NEW,OPEN', 'NEW,OPEN,PENDING_USER,PENDING_AGENT', 'NEW', 'OPEN', 'PENDING_USER', 'PENDING_AGENT', 'RESOLVED', 'CLOSED', 'RESOLVED,CLOSED'] as const;
const PRIORITY_VALUES = ['all', 'LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
interface Option { id: string; name: string; queueId?: string }

function positive(value: string | null, fallback: number) { const parsed = Number.parseInt(value ?? '', 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function valid(value: string | null, values: readonly string[], fallback: string) { return value && values.includes(value) ? value : fallback; }
function broadest(role?: string) { return role === 'USER' ? 'my' : role === 'AGENT' ? 'queue' : 'all'; }
function scopeLabel(role: string | undefined, view: string) {
    if (view === 'my') return 'Scope: my requested or assigned tickets';
    if (role === 'SUPER_ADMIN') return 'Scope: all tickets globally';
    return 'Scope: all tickets in departments you can access';
}

export default function TicketsPage() {
    const params = useSearchParams();
    const { t } = useLanguage();
    const router = useRouter();
    const { data: session } = useSession();
    const role = session?.user?.role;
    const views = useMemo(() => role === 'USER' ? ['my'] : role === 'AGENT' ? ['my', 'queue'] : ['my', 'all'], [role]);
    const scopeExplicit = useRef(params.has('view'));
    const initialSearch = params.get('search') ?? '';
    const [searchInput, setSearchInput] = useState(initialSearch);
    const [search, setSearch] = useState(initialSearch.trim());
    const [view, setView] = useState(() => params.get('view') ?? (initialSearch.trim() ? broadest(role) : 'my'));
    const [status, setStatus] = useState(() => valid(params.get('status'), STATUS_VALUES, 'all'));
    const [priority, setPriority] = useState(() => valid(params.get('priority'), PRIORITY_VALUES, 'all'));
    const [queueId, setQueueId] = useState(params.get('queueId') ?? 'all');
    const [categoryId, setCategoryId] = useState(params.get('categoryId') ?? 'all');
    const [requesterId, setRequesterId] = useState(params.get('requesterId') ?? 'all');
    const [assigneeId, setAssigneeId] = useState(params.get('assigneeId') ?? 'all');
    const [tagIds, setTagIds] = useState(() => (params.get('tagIds') ?? '').split(',').filter(Boolean));
    const [ticketRef, setTicketRef] = useState(params.get('ticketId') ?? params.get('ticketKey') ?? '');
    const [page, setPage] = useState(positive(params.get('page'), 1));
    const [limit, setLimit] = useState(Math.min(50, positive(params.get('limit'), DEFAULT_LIMIT)));

    const urlSnapshot = params.toString();
    const previousUrl = useRef(urlSnapshot);
    const reconcilingUrl = useRef(false);
    const pendingUrls = useRef(new Set<string>());
    const latestOwnUrl = useRef<string | null>(null);
    useEffect(() => {
        if (previousUrl.current === urlSnapshot) return;
        previousUrl.current = urlSnapshot;
        // Router acknowledgments must not replace newer local edits or search drafts.
        if (pendingUrls.current.delete(urlSnapshot)) {
            if (latestOwnUrl.current === urlSnapshot) { pendingUrls.current.clear(); latestOwnUrl.current = null; }
            return;
        }
        pendingUrls.current.clear(); latestOwnUrl.current = null;
        reconcilingUrl.current = true;
        const incoming = new URLSearchParams(urlSnapshot);
        const incomingSearch = incoming.get('search') ?? '';
        scopeExplicit.current = incoming.has('view');
        setSearchInput(incomingSearch); setSearch(incomingSearch.trim());
        setView(incoming.get('view') ?? (incomingSearch.trim() ? broadest(role) : 'my'));
        setStatus(valid(incoming.get('status'), STATUS_VALUES, 'all'));
        setPriority(valid(incoming.get('priority'), PRIORITY_VALUES, 'all'));
        setQueueId(incoming.get('queueId') ?? 'all'); setCategoryId(incoming.get('categoryId') ?? 'all');
        setRequesterId(incoming.get('requesterId') ?? 'all'); setAssigneeId(incoming.get('assigneeId') ?? 'all');
        setTagIds((incoming.get('tagIds') ?? '').split(',').filter(Boolean));
        setTicketRef(incoming.get('ticketId') ?? incoming.get('ticketKey') ?? '');
        setPage(positive(incoming.get('page'), 1)); setLimit(Math.min(50, positive(incoming.get('limit'), DEFAULT_LIMIT)));
    }, [urlSnapshot, role]);

    useEffect(() => {
        if (searchInput.trim() === search) return;
        const timeout = window.setTimeout(() => {
            const next = searchInput.trim();
            if (next && !search && !scopeExplicit.current) setView(broadest(role));
            setSearch(next); setPage(1);
        }, 250);
        return () => window.clearTimeout(timeout);
    }, [role, search, searchInput]);

    useEffect(() => {
        if (!role) return;
        if (!views.includes(view)) setView(broadest(role));
    }, [role, view, views]);

    const queuesQuery = useQuery<Option[]>({ queryKey: ['queues', 'ticket-filters'], queryFn: async () => { const response = await fetch('/api/queues?accessible=true'); if (!response.ok) throw new Error('Failed to load departments'); const payload = await response.json(); if (!Array.isArray(payload)) throw new Error('The server returned an invalid list'); return payload; }, enabled: Boolean(role && role !== 'USER') });
    const categoriesQuery = useQuery<Option[]>({ queryKey: ['categories', 'ticket-filters', queueId], queryFn: async () => { const response = await fetch(`/api/categories?queueId=${encodeURIComponent(queueId)}`); if (!response.ok) throw new Error('Failed to load categories'); return response.json(); }, enabled: queueId !== 'all' });
    const tagsQuery = useQuery<Option[]>({ queryKey: ['tags', 'ticket-filters'], queryFn: async () => { const response = await fetch('/api/tags'); if (!response.ok) throw new Error('Failed to load tags'); const payload = await response.json(); if (!Array.isArray(payload)) throw new Error('The server returned an invalid list'); return payload; } });

    useEffect(() => {
        if (!role) return;
        if (reconcilingUrl.current) { reconcilingUrl.current = false; return; }
        const next = new URLSearchParams();
        if (view !== 'my' || search || scopeExplicit.current) next.set('view', view);
        if (search) next.set('search', search);
        if (status !== 'all') next.set('status', status);
        if (priority !== 'all') next.set('priority', priority);
        if (queueId !== 'all') next.set('queueId', queueId);
        if (categoryId !== 'all') next.set('categoryId', categoryId);
        if (requesterId !== 'all') next.set('requesterId', requesterId);
        if (assigneeId !== 'all') next.set('assigneeId', assigneeId);
        if (tagIds.length) next.set('tagIds', tagIds.join(','));
        if (ticketRef.trim()) next.set(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(ticketRef.trim()) ? 'ticketId' : 'ticketKey', ticketRef.trim());
        if (page > 1) next.set('page', String(page));
        if (limit !== DEFAULT_LIMIT) next.set('limit', String(limit));
        if (next.toString() !== urlSnapshot) {
            const query = next.toString();
            pendingUrls.current.add(query); latestOwnUrl.current = query;
            router.replace(next.size ? `/tickets?${next}` : '/tickets', { scroll: false });
        }
    }, [assigneeId, categoryId, limit, page, priority, queueId, requesterId, role, router, search, status, tagIds, ticketRef, view, urlSnapshot]);

    const queryValues = { view, search, status, priority, queueId, categoryId, requesterId, assigneeId, tagIds: tagIds.join(','), ticketRef: ticketRef.trim(), page, limit };
    const ticketsQuery = useQuery({
        queryKey: ['tickets', queryValues], enabled: Boolean(role),
        queryFn: async () => {
            const query = new URLSearchParams({ view, page: String(page), limit: String(limit) });
            if (search) query.set('search', search); if (status !== 'all') query.set('status', status); if (priority !== 'all') query.set('priority', priority);
            if (queueId !== 'all') query.set('queueId', queueId); if (categoryId !== 'all') query.set('categoryId', categoryId);
            if (requesterId !== 'all') query.set('requesterId', requesterId); if (assigneeId !== 'all') query.set('assigneeId', assigneeId);
            if (tagIds.length) query.set('tagIds', tagIds.join(','));
            if (ticketRef.trim()) query.set(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(ticketRef.trim()) ? 'ticketId' : 'ticketKey', ticketRef.trim());
            const response = await fetch(`/api/tickets?${query}`); const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to fetch tickets');
            if (!Array.isArray(payload.tickets) || !payload.pagination || !['page', 'pages', 'total'].every((key) => typeof payload.pagination[key] === 'number')) throw new Error('The server returned an invalid ticket list');
            return payload;
        },
    });
    const tickets = ticketsQuery.data?.tickets ?? [];
    const pagination = ticketsQuery.data?.pagination ?? { page: 1, pages: 1, total: 0 };
    const hasFilters = Boolean(searchInput.trim() || status !== 'all' || priority !== 'all' || queueId !== 'all' || categoryId !== 'all' || requesterId !== 'all' || assigneeId !== 'all' || tagIds.length || ticketRef.trim());
    const reset = () => { scopeExplicit.current = false; setView('my'); setSearchInput(''); setSearch(''); setStatus('all'); setPriority('all'); setQueueId('all'); setCategoryId('all'); setRequesterId('all'); setAssigneeId('all'); setTagIds([]); setTicketRef(''); setPage(1); };

    const filterQueries = [queuesQuery, categoriesQuery, tagsQuery];
    const readError = ticketsQuery.error || filterQueries.find((query) => query.error)?.error;
    return <div className="space-y-6">
        {readError ? <div role="alert" className="rounded-lg border p-4 text-destructive">{readError instanceof Error ? readError.message : t('Request failed')}<Button className="ml-3" variant="outline" onClick={() => { void ticketsQuery.refetch(); filterQueries.forEach((query) => { if (query.error) void query.refetch(); }); }}>{t('Try again')}</Button></div> : null}
        <PageHeader title={t("Tickets")} description={t('{count} tickets total', { count: pagination.total })}><Button asChild className="gap-2"><Link href="/tickets/new"><Plus className="h-4 w-4" /> {t("New Ticket")}</Link></Button></PageHeader>
        <Card><CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-3"><Tabs value={view} onValueChange={(next) => { scopeExplicit.current = true; setView(next); setPage(1); }}><TabsList><TabsTrigger value="my">{t("My Tickets")}</TabsTrigger>{views.includes('queue') ? <TabsTrigger value="queue">{t("Departments")}</TabsTrigger> : null}{views.includes('all') ? <TabsTrigger value="all">{t("All permitted")}</TabsTrigger> : null}</TabsList></Tabs><Badge variant="outline">{t(ticketsQuery.data?.scope?.label ?? scopeLabel(role, view))}</Badge><div className="relative ml-auto"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={t("Search tickets")} placeholder={t("Key, title, people, tags, category…")} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="w-72 pl-9" /></div></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Filter label={t("Status")}><Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("All statuses")}</SelectItem><SelectItem value="pending">{t("Pending (user or agent)")}</SelectItem><SelectItem value="NEW,OPEN">{t("New or open")}</SelectItem><SelectItem value="NEW,OPEN,PENDING_USER,PENDING_AGENT">{t("Active")}</SelectItem><SelectItem value="NEW">{t("New")}</SelectItem><SelectItem value="OPEN">{t("Open")}</SelectItem><SelectItem value="PENDING_USER">{t("Pending user")}</SelectItem><SelectItem value="PENDING_AGENT">{t("Pending agent")}</SelectItem><SelectItem value="RESOLVED">{t("Resolved")}</SelectItem><SelectItem value="CLOSED">{t("Closed")}</SelectItem><SelectItem value="RESOLVED,CLOSED">{t("Resolved or closed")}</SelectItem></SelectContent></Select></Filter>
                <Filter label={t("Priority")}><Select value={priority} onValueChange={(value) => { setPriority(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITY_VALUES.map((value) => <SelectItem key={value} value={value}>{value === 'all' ? t("All priorities") : value}</SelectItem>)}</SelectContent></Select></Filter>
                {role !== 'USER' ? <Filter label={t("Department")}><Select value={queueId} onValueChange={(value) => { setQueueId(value); setCategoryId('all'); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("All permitted departments")}</SelectItem>{(queuesQuery.data ?? []).map((queue) => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}</SelectContent></Select></Filter> : null}
                {role !== 'USER' ? <Filter label={t("Category")}><Select value={categoryId} disabled={queueId === 'all'} onValueChange={(value) => { setCategoryId(value); setPage(1); }}><SelectTrigger><SelectValue placeholder={t("Select department first")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("All categories")}</SelectItem>{(categoriesQuery.data ?? []).map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></Filter> : null}
                {role !== 'USER' ? <Filter label={t("Requester")}><UserSearchCombobox kind="requester" queueId={queueId === 'all' ? undefined : queueId} value={requesterId} allowAny onValueChange={(value) => { setRequesterId(value); setPage(1); }} /></Filter> : null}
                {role !== 'USER' ? <Filter label={t("Assignee")}><UserSearchCombobox kind="assignee" queueId={queueId === 'all' ? undefined : queueId} value={assigneeId} allowAny allowUnassigned onValueChange={(value) => { setAssigneeId(value); setPage(1); }} /></Filter> : null}
                <Filter label={t("Ticket key or exact ID")}><Input value={ticketRef} onChange={(event) => { setTicketRef(event.target.value); setPage(1); }} placeholder="TCK-2026-000001 or UUID" /></Filter>
                <Filter label={t("Page size")}><Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAGE_LIMITS.map((size) => <SelectItem key={size} value={String(size)}>{size} {t("per page")}</SelectItem>)}</SelectContent></Select></Filter>
            </div>
            <div><Label className="text-xs text-muted-foreground">{t("Tags (matches any selected tag)")}</Label><div className="mt-2 flex flex-wrap gap-2">{(tagsQuery.data ?? []).map((tag) => <Button key={tag.id} type="button" size="sm" variant={tagIds.includes(tag.id) ? 'default' : 'outline'} onClick={() => { setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id]); setPage(1); }}>{tag.name}</Button>)}</div></div>
            {hasFilters ? <Button variant="ghost" size="sm" onClick={reset}><X className="mr-1 h-4 w-4" /> {t("Reset filters")}</Button> : null}
        </CardContent></Card>
        {ticketsQuery.isError && !ticketsQuery.data ? null : <Card><CardContent className="p-0">{ticketsQuery.isLoading ? <div className="py-20 text-center text-muted-foreground">{t("Loading tickets…")}</div> : !tickets.length ? <div className="py-20 text-center"><Ticket className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p>{t("No tickets found")}</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/40"><Th>{t("ID")}</Th><Th>{t("Title")}</Th><Th>{t("Department")}</Th><Th>{t("Requester")}</Th><Th>{t("Assignee")}</Th><Th>{t("Status")}</Th><Th>{t("Priority")}</Th></tr></thead><tbody className="divide-y">{tickets.map((ticket: any) => <tr key={ticket.id} className="hover:bg-muted/30"><td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{ticket.key}{ticket.slaBreached ? <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" /> : null}</td><td className="max-w-72 px-4 py-3 font-medium"><Link href={`/tickets/${ticket.id}`} className="block truncate rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{ticket.title}</Link></td><td className="px-4 py-3">{ticket.queue?.name ?? '—'}</td><td className="px-4 py-3">{ticket.requester?.name ?? '—'}</td><td className="px-4 py-3"><AssigneeSummary assignees={ticket.assignees} /></td><td className="px-4 py-3"><Badge className={`status-${ticket.status.toLowerCase()}`}>{t(ticket.status.replaceAll('_', ' '))}</Badge></td><td className="px-4 py-3"><Badge variant="outline">{t(ticket.priority)}</Badge></td></tr>)}</tbody></table></div>}{pagination.pages > 1 ? <div className="flex items-center justify-between border-t p-4"><span className="text-sm text-muted-foreground">{t("Page")} {pagination.page} {t("of")} {pagination.pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{t("Previous")}</Button><Button variant="outline" size="sm" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>{t("Next")}</Button></div></div> : null}</CardContent></Card>}
    </div>;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>; }
function Th({ children }: { children: React.ReactNode }) { return <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>; }
