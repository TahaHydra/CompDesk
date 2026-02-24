'use client';

import { use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
    ArrowLeft, MessageSquare, Lock, User, AlertTriangle,
    Send, Eye, Shield, XCircle, ArrowUpCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session } = useSession();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [comment, setComment] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [escalateOpen, setEscalateOpen] = useState(false);
    const [escalateReason, setEscalateReason] = useState('');
    const [escalateToId, setEscalateToId] = useState('');

    const isAgent = session?.user?.role !== 'USER';

    const { data: ticket, isLoading } = useQuery({
        queryKey: ['ticket', id],
        queryFn: async () => {
            const res = await fetch(`/api/tickets/${id}`);
            if (!res.ok) throw new Error('Failed to fetch ticket');
            return res.json();
        },
        refetchInterval: 15000,
    });

    const { data: users } = useQuery({
        queryKey: ['users'],
        queryFn: async () => {
            const res = await fetch('/api/users');
            return res.json();
        },
        enabled: isAgent,
    });

    const { data: customFields } = useQuery({
        queryKey: ['form-fields', ticket?.queueId],
        queryFn: async () => {
            const res = await fetch(`/api/form-fields?queueId=${ticket.queueId}`);
            if (!res.ok) return [];
            return res.json();
        },
        enabled: !!ticket?.queueId,
    });

    const updateTicket = useMutation({
        mutationFn: async (data: Record<string, unknown>) => {
            const res = await fetch(`/api/tickets/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to update');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: 'Ticket updated' });
        },
        onError: (e: Error) => {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        },
    });

    const addComment = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/tickets/${id}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: comment, isInternal }),
            });
            if (!res.ok) throw new Error('Failed to add comment');
            return res.json();
        },
        onSuccess: () => {
            setComment('');
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: isInternal ? 'Internal note added' : 'Comment added' });
        },
    });

    const escalateTicket = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/tickets/${id}/escalate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ escalateToId: escalateToId || null, reason: escalateReason }),
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
            return res.json();
        },
        onSuccess: (data) => {
            setEscalateOpen(false); setEscalateReason(''); setEscalateToId('');
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: `Ticket escalated to level ${data.escalationLevel}` });
        },
        onError: (e: Error) => toast({ title: 'Escalation failed', description: e.message, variant: 'destructive' }),
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
        );
    }

    if (!ticket) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <XCircle className="h-12 w-12 text-destructive mb-4" />
                <h2 className="text-xl font-bold">Ticket not found</h2>
                <Link href="/tickets" className="mt-4"><Button variant="outline">Back to tickets</Button></Link>
            </div>
        );
    }

    const statusColor: Record<string, string> = {
        NEW: 'status-new', OPEN: 'status-open', PENDING_USER: 'status-pending_user',
        PENDING_AGENT: 'status-pending_agent', RESOLVED: 'status-resolved', CLOSED: 'status-closed',
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/tickets">
                        <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
                    </Link>
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-mono text-muted-foreground">{ticket.key}</span>
                            <Badge className={statusColor[ticket.status]}>{ticket.status.replace(/_/g, ' ')}</Badge>
                            <Badge variant="outline" className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</Badge>
                            {ticket.escalationLevel > 0 && (
                                <Badge variant="destructive" className="gap-1"><ArrowUpCircle className="h-3 w-3" /> Escalated L{ticket.escalationLevel}</Badge>
                            )}
                            {ticket.slaInfo?.resolutionBreached && (
                                <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> SLA Breached</Badge>
                            )}
                        </div>
                        <h1 className="text-2xl font-bold mt-1">{ticket.title}</h1>
                    </div>
                </div>

                {ticket.lockInfo && ticket.lockInfo.lockedBy !== session?.user?.name && (
                    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                        <Lock className="h-3 w-3" /> Being viewed by {ticket.lockInfo.lockedBy}
                    </Badge>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Description */}
                    {ticket.description && (
                        <Card className="border-0 shadow-sm">
                            <CardContent className="p-5">
                                <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Timeline */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-primary" /> Timeline
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {ticket.timeline?.map((event: any) => (
                                <div
                                    key={event.id}
                                    className={`flex gap-3 animate-fade-in ${event.type === 'INTERNAL_NOTE' ? 'bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800' : ''
                                        }`}
                                >
                                    <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                                        <AvatarFallback className="text-xs bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                                            {event.user?.name?.split(' ').map((n: string) => n[0]).join('') ?? '?'}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-medium">{event.user?.name}</span>
                                            {event.type === 'INTERNAL_NOTE' && (
                                                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                                                    <Eye className="h-3 w-3 mr-1" /> Internal
                                                </Badge>
                                            )}
                                            {event.type === 'ESCALATED' && (
                                                <Badge variant="destructive" className="text-xs gap-1">
                                                    <ArrowUpCircle className="h-3 w-3" /> Escalated
                                                </Badge>
                                            )}
                                            {event.type === 'STATUS_CHANGE' && (
                                                <Badge variant="secondary" className="text-xs">Status Change</Badge>
                                            )}
                                            {event.type === 'ASSIGNMENT_CHANGE' && (
                                                <Badge variant="secondary" className="text-xs">Assignment</Badge>
                                            )}
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(event.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                        {event.content && (
                                            <p className="text-sm mt-1 whitespace-pre-wrap">{event.content}</p>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* Comment input */}
                            <Separator className="my-4" />
                            <div className="space-y-3">
                                {isAgent && (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant={isInternal ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setIsInternal(!isInternal)}
                                            className={isInternal ? 'bg-amber-500 hover:bg-amber-600' : ''}
                                        >
                                            <Eye className="h-3.5 w-3.5 mr-1" />
                                            {isInternal ? 'Internal Note' : 'Public Reply'}
                                        </Button>
                                    </div>
                                )}
                                <Textarea
                                    placeholder={isInternal ? 'Write an internal note...' : 'Write a reply...'}
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    rows={3}
                                    className={isInternal ? 'border-amber-300 focus-visible:ring-amber-400' : ''}
                                />
                                <div className="flex justify-end">
                                    <Button
                                        onClick={() => addComment.mutate()}
                                        disabled={!comment.trim() || addComment.isPending}
                                        className="gap-2"
                                        size="sm"
                                    >
                                        <Send className="h-3.5 w-3.5" />
                                        {isInternal ? 'Add Note' : 'Send Reply'}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar */}
                <div className="space-y-4">
                    {/* Actions */}
                    {isAgent && (
                        <Card className="border-0 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-primary" /> Actions
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                                    <Select
                                        value={ticket.status}
                                        onValueChange={(v) => updateTicket.mutate({ status: v })}
                                    >
                                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {['NEW', 'OPEN', 'PENDING_USER', 'PENDING_AGENT', 'RESOLVED', 'CLOSED'].map((s) => (
                                                <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Assignee</label>
                                    <Select
                                        value={ticket.assigneeId ?? 'unassigned'}
                                        onValueChange={(v) => updateTicket.mutate({ assigneeId: v === 'unassigned' ? null : v })}
                                    >
                                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unassigned">Unassigned</SelectItem>
                                            {(users ?? []).filter((u: any) => u.role !== 'USER').map((u: any) => (
                                                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Priority</label>
                                    <Select
                                        value={ticket.priority}
                                        onValueChange={(v) => updateTicket.mutate({ priority: v })}
                                    >
                                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                                                <SelectItem key={p} value={p}>{p}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Escalate button */}
                                {ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && (
                                    <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
                                        <DialogTrigger asChild>
                                            <Button variant="destructive" size="sm" className="w-full gap-2">
                                                <ArrowUpCircle className="h-3.5 w-3.5" />
                                                Escalate Ticket{ticket.escalationLevel > 0 ? ` (Currently L${ticket.escalationLevel})` : ''}
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <DialogHeader><DialogTitle>Escalate Ticket</DialogTitle></DialogHeader>
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>Escalate To (optional)</Label>
                                                    <Select value={escalateToId} onValueChange={setEscalateToId}>
                                                        <SelectTrigger><SelectValue placeholder="Select agent/admin" /></SelectTrigger>
                                                        <SelectContent>
                                                            {(users ?? []).filter((u: any) => u.role !== 'USER').map((u: any) => (
                                                                <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Reason</Label>
                                                    <Textarea placeholder="Why is this ticket being escalated?" value={escalateReason}
                                                        onChange={(e) => setEscalateReason(e.target.value)} rows={3} />
                                                </div>
                                                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                                                    <p>Escalating will:</p>
                                                    <ul className="list-disc ml-4 mt-1 space-y-0.5">
                                                        <li>Increase escalation level to L{(ticket.escalationLevel ?? 0) + 1}</li>
                                                        <li>Re-assign to selected agent (if chosen)</li>
                                                        {(ticket.escalationLevel ?? 0) >= 1 && <li>Auto-upgrade priority to URGENT</li>}
                                                        <li>Add escalation event to timeline</li>
                                                        <li>Notify the escalation target via email</li>
                                                    </ul>
                                                </div>
                                            </div>
                                            <DialogFooter>
                                                <Button variant="outline" onClick={() => setEscalateOpen(false)}>Cancel</Button>
                                                <Button variant="destructive" onClick={() => escalateTicket.mutate()}
                                                    disabled={escalateTicket.isPending} className="gap-2">
                                                    <ArrowUpCircle className="h-4 w-4" />
                                                    {escalateTicket.isPending ? 'Escalating...' : 'Escalate'}
                                                </Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Details */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Department</span>
                                <span className="font-medium">{ticket.queue?.name}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Category</span>
                                <span className="font-medium">{ticket.category?.name ?? '—'}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Requester</span>
                                <span className="font-medium">{ticket.requester?.name}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Assignee</span>
                                <span className="font-medium">{ticket.assignee?.name ?? 'Unassigned'}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Created</span>
                                <span className="text-xs">{new Date(ticket.createdAt).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Updated</span>
                                <span className="text-xs">{new Date(ticket.updatedAt).toLocaleString()}</span>
                            </div>
                            {ticket.dueAt && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Due</span>
                                    <span className={`text-xs ${ticket.slaInfo?.resolutionBreached ? 'text-destructive font-bold' : ''}`}>
                                        {new Date(ticket.dueAt).toLocaleString()}
                                    </span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Custom Fields */}
                    {ticket.formData && Object.keys(ticket.formData).length > 0 && customFields && customFields.length > 0 && (
                        <Card className="border-0 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Custom Fields</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {customFields.map((field: any) => {
                                    const val = ticket.formData[field.fieldKey];
                                    if (val === undefined || val === null || val === '') return null;
                                    return (
                                        <div key={field.id} className="flex justify-between text-sm flex-col">
                                            <span className="text-muted-foreground text-xs">{field.label}</span>
                                            <span className="font-medium whitespace-pre-wrap mt-0.5">
                                                {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </CardContent>
                        </Card>
                    )}

                    {/* Watchers */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <User className="h-4 w-4 text-primary" /> Watchers ({ticket.watchers?.length ?? 0})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-2">
                                {ticket.watchers?.map((w: any) => (
                                    <Badge key={w.user.id} variant="secondary" className="text-xs">
                                        {w.user.name}
                                    </Badge>
                                ))}
                                {(!ticket.watchers || ticket.watchers.length === 0) && (
                                    <p className="text-xs text-muted-foreground">No watchers</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
