'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Inbox, Search, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export default function QueueInboxPage() {
    const [queueId, setQueueId] = useState('all');
    const [search, setSearch] = useState('');

    const { data: queues } = useQuery({
        queryKey: ['queues'],
        queryFn: async () => { const res = await fetch('/api/queues'); return res.json(); },
    });

    const { data, isLoading } = useQuery({
        queryKey: ['queue-tickets', queueId, search],
        queryFn: async () => {
            const params = new URLSearchParams({ view: 'queue' });
            if (queueId !== 'all') params.set('queueId', queueId);
            if (search) params.set('search', search);
            const res = await fetch(`/api/tickets?${params}`);
            return res.json();
        },
        refetchInterval: 15000,
    });

    const tickets = data?.tickets ?? [];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Inbox className="h-8 w-8 text-primary" /> Department Inbox
                </h1>
                <p className="text-muted-foreground mt-1">Tickets assigned to your departments</p>
            </div>

            <div className="flex items-center gap-3">
                <Select value={queueId} onValueChange={setQueueId}>
                    <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All Departments" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        {(queues ?? []).map((q: any) => (
                            <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
                </div>
            </div>

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
                        <div className="divide-y">
                            {tickets.map((ticket: any) => (
                                <Link key={ticket.id} href={`/tickets/${ticket.id}`}
                                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                                    <div className="flex flex-col gap-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-muted-foreground">{ticket.key}</span>
                                            {ticket.slaBreached && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                                        </div>
                                        <h3 className="text-sm font-medium truncate">{ticket.title}</h3>
                                        <span className="text-xs text-muted-foreground">
                                            {ticket.queue?.name} · {ticket.requester?.name} · {new Date(ticket.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 ml-4">
                                        <Badge className={`status-${ticket.status.toLowerCase()} text-xs`}>{ticket.status.replace(/_/g, ' ')}</Badge>
                                        <Badge variant="outline" className={`priority-${ticket.priority.toLowerCase()} text-xs`}>{ticket.priority}</Badge>
                                        {ticket.assignee ? (
                                            <Badge variant="secondary" className="text-xs">{ticket.assignee.name}</Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-xs text-amber-600">Unassigned</Badge>
                                        )}
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
