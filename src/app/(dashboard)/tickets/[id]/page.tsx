/* eslint-disable @next/next/no-img-element */
'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';
import {
    ArrowLeft, MessageSquare, User, AlertTriangle,
    Send, Eye, Shield, XCircle, ArrowUpCircle,
    Paperclip, Download, FileIcon, Trash2, Upload,
    Hand, Pencil, X, Check, ChevronDown, BellRing,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatTicketValue, getPriorityBadgeClass, getStatusBadgeClass } from '@/lib/ticket-display';
import { UserSearchCombobox } from '@/components/tickets/user-search-combobox';
import { parseTicketContent } from '@/lib/ticket-content';

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsed(value: string | Date) {
    const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
    if (hours < 1) return 'less than an hour';
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
}


const CONVERSATION_EVENT_TYPES = ['COMMENT', 'INTERNAL_NOTE'];
const STATUS_OPTIONS = ['NEW', 'OPEN', 'PENDING_USER', 'PENDING_AGENT', 'RESOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

function StatusBadge({ value }: { value: string }) {
    return (
        <Badge className={cn('text-xs', getStatusBadgeClass(value))}>
            {formatTicketValue(value)}
        </Badge>
    );
}

function PriorityBadge({ value }: { value: string }) {
    return (
        <Badge variant="outline" className={cn('text-xs', getPriorityBadgeClass(value))}>
            {formatTicketValue(value)}
        </Badge>
    );
}

function RenderDescription({ text }: { text: string }) {
    return <div className="space-y-2 text-sm">{parseTicketContent(text).map((part, index) => {
        if (part.kind === 'inline-image') return <div key={index} className="my-2"><img src={part.url} alt={part.alt} className="max-h-96 max-w-full rounded-lg border shadow-sm" />{part.alt ? <p className="mt-1 text-xs text-muted-foreground">{part.alt}</p> : null}</div>;
        if (part.kind === 'external-image-link') return <p key={index} className="rounded border bg-muted/30 p-2 text-xs">Remote image blocked. <a href={part.url} target="_blank" rel="noopener noreferrer" className="underline">Open link</a>{part.alt ? `: ${part.alt}` : ''}</p>;
        if (part.kind === 'blocked-image') return <p key={index} className="rounded border bg-muted/30 p-2 text-xs text-muted-foreground">Unsafe image reference blocked{part.alt ? `: ${part.alt}` : ''}.</p>;
        return part.value ? <p key={index} className="whitespace-pre-wrap">{part.value}</p> : null;
    })}</div>;
}
export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session } = useSession();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const router = useRouter();
    const [comment, setComment] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [escalateOpen, setEscalateOpen] = useState(false);
    const [escalateReason, setEscalateReason] = useState('');
    const [escalateToId, setEscalateToId] = useState('');
    const [assignmentCandidateId, setAssignmentCandidateId] = useState('');
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [reminderOpen, setReminderOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const assignmentRequestLock = useRef(false);
    const reminderRequestLock = useRef(false);

    const isAgent = session?.user?.role === 'AGENT' || session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';
    const isAdministrator = session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';

    useEffect(() => {
        if (!isAgent) return;
        let active = true;
        const heartbeat = () => {
            if (active) void fetch(`/api/tickets/${id}/presence`, { method: 'POST' });
        };
        heartbeat();
        const interval = window.setInterval(heartbeat, 45_000);
        return () => {
            active = false;
            window.clearInterval(interval);
            void fetch(`/api/tickets/${id}/presence`, { method: 'DELETE', keepalive: true });
        };
    }, [id, isAgent]);
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

    const { data: categories } = useQuery({
        queryKey: ['categories', ticket?.queueId],
        queryFn: async () => {
            const res = await fetch(`/api/categories?queueId=${ticket.queueId}`);
            if (!res.ok) throw new Error('Failed to load department categories');
            return res.json();
        },
        enabled: isAgent && !!ticket?.queueId,
    });

    const reminderQuery = useQuery({
        queryKey: ['ticket-reminders', id],
        queryFn: async () => {
            const response = await fetch(`/api/tickets/${id}/reminders`);
            const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
            if (!response.ok) throw new Error(payload.error || 'Failed to load reminder availability');
            return payload as {
                allowed: boolean;
                reason: string | null;
                enabled: boolean;
                reminderCount: number;
                maxPerCycle: number;
                cooldownHours: number;
                lastReminderAt: string | null;
                nextAvailableAt: string | null;
                waitingSince: string;
                unresolvedReminder: { id: string; status: 'PENDING' | 'DELIVERY_UNKNOWN'; createdAt: string; clearableAt: string } | null;
                requester: { id: string; name: string };
            };
        },
        enabled: Boolean(isAgent && ticket?.status === 'PENDING_USER'),
        refetchInterval: 60_000,
    });

    const updateTicket = useMutation({
        mutationFn: async (data: Record<string, unknown>) => {
            const res = await fetch(`/api/tickets/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, expectedVersion: ticket.version }),
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

    const assignmentMutation = useMutation({
        mutationFn: async ({ operation, userId }: { operation: 'add' | 'remove' | 'claim' | 'unclaim'; userId?: string }) => {
            const claim = operation === 'claim' || operation === 'unclaim';
            const method = operation === 'remove' || operation === 'unclaim' ? 'DELETE' : 'POST';
            const versionQuery = `expectedVersion=${encodeURIComponent(String(ticket.version))}`;
            const endpoint = claim
                ? `/api/tickets/${id}/assignees/claim${method === 'DELETE' ? `?${versionQuery}` : ''}`
                : `/api/tickets/${id}/assignees${method === 'DELETE' ? `?userId=${encodeURIComponent(userId ?? '')}&${versionQuery}` : ''}`;
            const res = await fetch(endpoint, {
                method,
                headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
                body: method === 'POST' ? JSON.stringify(claim ? { expectedVersion: ticket.version } : { userId, expectedVersion: ticket.version }) : undefined,
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Assignment operation failed');
            return { payload, operation };
        },
        onSuccess: ({ payload, operation }) => {
            setAssignmentCandidateId('');
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            queryClient.invalidateQueries({ queryKey: ['tickets'] });
            queryClient.invalidateQueries({ queryKey: ['queue-tickets'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            toast({ title: payload.alreadyAssigned ? 'Already assigned' : operation === 'remove' || operation === 'unclaim' ? 'Assignee removed' : 'Assignee added' });
        },
        onError: (error: Error) => toast({ title: 'Assignment failed', description: error.message, variant: 'destructive' }),
        onSettled: () => { assignmentRequestLock.current = false; },
    });
    const runAssignment = (operation: 'add' | 'remove' | 'claim' | 'unclaim', userId?: string) => {
        if (assignmentRequestLock.current) return;
        assignmentRequestLock.current = true;
        assignmentMutation.mutate({ operation, userId });
    };
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

    const editComment = useMutation({
        mutationFn: async ({ eventId, content }: { eventId: string; content: string }) => {
            const res = await fetch(`/api/tickets/${id}/comments`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId, content }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to edit');
            }
            return res.json();
        },
        onSuccess: () => {
            setEditingEventId(null);
            setEditContent('');
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: 'Timeline entry updated' });
        },
        onError: (e: Error) => {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        },
    });

    const deleteComment = useMutation({
        mutationFn: async (eventId: string) => {
            const res = await fetch(`/api/tickets/${id}/comments?eventId=${eventId}`, {
                method: 'DELETE',
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to remove timeline entry');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: 'Timeline entry removed from conversation' });
        },
        onError: (e: Error) => {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        },
    });

    const deleteTicket = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/tickets/${id}?expectedVersion=${encodeURIComponent(String(ticket.version))}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to withdraw');
            }
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Ticket withdrawn' });
            router.push('/tickets');
        },
        onError: (e: Error) => {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        },
    });

    const escalateTicket = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/tickets/${id}/escalate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ escalateToId: escalateToId || null, reason: escalateReason, expectedVersion: ticket.version }),
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

    const sendReminder = useMutation({
        mutationFn: async () => {
            const response = await fetch(`/api/tickets/${id}/reminders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expectedVersion: ticket.version }),
            });
            const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
            if (!response.ok) throw new Error(payload.error || 'Failed to send reminder');
            return payload;
        },
        onSuccess: async () => {
            setReminderOpen(false);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['ticket-reminders', id] }),
                queryClient.invalidateQueries({ queryKey: ['ticket', id] }),
            ]);
            toast({ title: 'Reminder sent', description: `The requester was emailed about ${ticket.key}.` });
        },
        onError: (error: Error) => toast({ title: 'Reminder was not sent', description: error.message, variant: 'destructive' }),
        onSettled: () => { reminderRequestLock.current = false; },
    });
    const confirmReminder = () => {
        if (reminderRequestLock.current) return;
        reminderRequestLock.current = true;
        sendReminder.mutate();
    };
    const clearUnresolvedReminder = useMutation({
        mutationFn: async (reminderId: string) => {
            const response = await fetch(`/api/tickets/${id}/reminders`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reminderId }),
            });
            const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
            if (!response.ok) throw new Error(payload.error || 'Failed to clear unresolved reminder');
            return payload;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['ticket-reminders', id] });
            toast({ title: 'Uncertain delivery cleared', description: 'A new reminder can be attempted after the normal policy checks.' });
        },
        onError: (error: Error) => toast({ title: 'Uncertain delivery was not cleared', description: error.message, variant: 'destructive' }),
    });

    // File upload to existing ticket
    const uploadToTicket = useCallback(async (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('ticketId', id);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: 'File uploaded' });
        } catch (err: any) {
            toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
        }
    }, [id, queryClient, toast]);

    const deleteAttachment = async (attachmentId: string) => {
        try {
            const res = await fetch(`/api/upload/${attachmentId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed');
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: 'Attachment removed' });
        } catch {
            toast({ title: 'Failed to delete', variant: 'destructive' });
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        files.forEach(f => uploadToTicket(f));
        e.target.value = '';
    };

    // Handle paste in comment textarea
    const handleCommentPaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    const named = new File([file], `screenshot-${Date.now()}.png`, { type: file.type });
                    uploadToTicket(named);
                }
                break;
            }
        }
    }, [uploadToTicket]);

    const isConversationEvent = (event: any) => CONVERSATION_EVENT_TYPES.includes(event.type);

    // Administrators can moderate conversation history. Agents and users can
    // modify only their own entries; users can never modify internal notes.
    const canEditTimelineEvent = (event: any) => {
        if (event.deletedAt || !event.content || !isConversationEvent(event)) return false;
        if (isAdministrator) return true;
        if (event.userId !== session?.user?.id) return false;
        if (session?.user?.role === 'USER' && event.type !== 'COMMENT') return false;
        const hours = (Date.now() - new Date(event.createdAt).getTime()) / 3600000;
        return hours <= 24;
    };

    const canDeleteTimelineEvent = (event: any) => {
        if (event.deletedAt || !isConversationEvent(event)) return false;
        if (isAdministrator) return true;
        return event.userId === session?.user?.id
            && !(session?.user?.role === 'USER' && event.type === 'INTERNAL_NOTE');
    };

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
                <Button asChild variant="outline" className="mt-4"><Link href="/tickets">Back to tickets</Link></Button>
            </div>
        );
    }

    const activeAttachments = (ticket.attachments ?? []).filter((attachment: any) => !attachment.deletedAt && attachment.path);
    const removedAttachments = (ticket.attachments ?? []).filter((attachment: any) => Boolean(attachment.deletedAt));
    const isRequester = ticket.requesterId === session?.user?.id;
    const assignments = ticket.assignments ?? [];
    const assignedToCurrentUser = assignments.some((assignment: any) => assignment.userId === session?.user?.id);
    const canDeleteTicket = ticket.status !== 'WITHDRAWN' && (session?.user?.role === 'SUPER_ADMIN' || (isRequester && assignments.length === 0));
    const conversationEvents = (ticket.timeline ?? []).filter((event: any) => isConversationEvent(event));
    const timelineEvents = (ticket.timeline ?? []).filter((event: any) => !isConversationEvent(event));

    const renderTimelineEntry = (event: any, compact = false) => {
        const isEditing = editingEventId === event.id;
        const showEditBtn = canEditTimelineEvent(event);
        const showDeleteBtn = canDeleteTimelineEvent(event);
        const isEdited = event.metadata?.edited;
        const isDeleted = Boolean(event.deletedAt);

        return (
            <div
                key={event.id}
                className={cn(
                    'flex gap-3 animate-fade-in',
                    event.type === 'INTERNAL_NOTE' && 'bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800',
                    compact && event.type !== 'INTERNAL_NOTE' && 'rounded-lg border bg-muted/20 p-3'
                )}
            >
                <Avatar className={cn('shrink-0 mt-0.5', compact ? 'h-7 w-7' : 'h-8 w-8')}>
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
                        {event.type === 'PRIORITY_CHANGE' && (
                            <Badge variant="secondary" className="text-xs">Priority</Badge>
                        )}
                        {event.type === 'REMINDER_SENT' && (
                            <Badge variant="secondary" className="gap-1 text-xs"><BellRing className="h-3 w-3" /> Reminder Sent</Badge>
                        )}
                        {isEdited && (
                            <span className="text-xs text-muted-foreground italic">(edited)</span>
                        )}
                        {isDeleted && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Deleted · history retained</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                            {new Date(event.createdAt).toLocaleString()}
                        </span>

                        {(showEditBtn || showDeleteBtn) && !isEditing && (
                            <div className="ml-auto flex gap-1">
                                {showEditBtn && (
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary"
                                        onClick={() => { setEditingEventId(event.id); setEditContent(event.content || ''); }}>
                                        <Pencil className="h-3 w-3" />
                                    </Button>
                                )}
                                {showDeleteBtn && (
                                    <ConfirmDestructiveAction
                                        title="Remove timeline entry?"
                                        description="The entry will be hidden from normal conversation views, while its content and deletion evidence remain available to authorized administrators."
                                        pending={deleteComment.isPending}
                                        onConfirm={() => deleteComment.mutate(event.id)}
                                        trigger={
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" aria-label="Remove timeline entry">
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        }
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {isEditing ? (
                        <div className="mt-2 space-y-2">
                            <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={3} autoFocus />
                            <div className="flex gap-2">
                                <Button size="sm" className="gap-1" disabled={editComment.isPending}
                                    onClick={() => editComment.mutate({ eventId: event.id, content: editContent })}>
                                    <Check className="h-3 w-3" /> Save
                                </Button>
                                <Button size="sm" variant="ghost" className="gap-1"
                                    onClick={() => { setEditingEventId(null); setEditContent(''); }}>
                                    <X className="h-3 w-3" /> Cancel
                                </Button>
                            </div>
                        </div>
                    ) : (
                        event.content && <RenderDescription text={event.content} />
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-2 sm:gap-3">
<Button asChild variant="ghost" size="icon" className="shrink-0"><Link href="/tickets" aria-label="Back to tickets"><ArrowLeft className="h-4 w-4" /></Link></Button>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm text-muted-foreground">{ticket.key}</span>
                            <StatusBadge value={ticket.status} />
                            <PriorityBadge value={ticket.priority} />
                            {ticket.escalationLevel > 0 && (
                                <Badge variant="destructive" className="gap-1"><ArrowUpCircle className="h-3 w-3" /> Escalated L{ticket.escalationLevel}</Badge>
                            )}
                            {ticket.slaInfo?.resolutionBreached && (
                                <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> SLA Breached</Badge>
                            )}
                        </div>
                        <h1 className="mt-1.5 text-xl font-bold sm:text-2xl">{ticket.title}</h1>
                    </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 pl-11 sm:pl-0">
                    {isAgent && ticket.status !== 'WITHDRAWN' && !assignedToCurrentUser ? (
                        <Button onClick={() => runAssignment('claim')} className="gap-2 bg-emerald-600 shadow-lg hover:bg-emerald-700" disabled={assignmentMutation.isPending}>
                            <Hand className="h-4 w-4" /> Claim Ticket
                        </Button>
                    ) : null}
                    {isAgent && ticket.status !== 'WITHDRAWN' && assignedToCurrentUser ? (
                        <Button variant="outline" onClick={() => runAssignment('unclaim')} className="gap-2" disabled={assignmentMutation.isPending}>
                            <Check className="h-4 w-4" /> Assigned · Unclaim myself
                        </Button>
                    ) : null}

                    {/* Super administrators can delete any ticket; requesters can withdraw unassigned tickets. */}
                    {canDeleteTicket && (
                        <ConfirmDestructiveAction
                            title="Withdraw ticket?"
                            description={<>Ticket <strong>{ticket.key}</strong> will be marked withdrawn. Its conversation, attachments, and audit history will be retained.</>}
                            pending={deleteTicket.isPending}
                            onConfirm={() => deleteTicket.mutate()}
                            trigger={
                                <Button variant="destructive" size="sm" className="gap-1.5">
                                    <Trash2 className="h-3.5 w-3.5" /> Withdraw
                                </Button>
                            }
                        />
                    )}

                    {Array.isArray(ticket.presenceInfo?.viewers) && ticket.presenceInfo.viewers.some((viewer: { id: string }) => viewer.id !== session?.user?.id) && (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <Eye className="h-3 w-3" /> Viewing now: {ticket.presenceInfo.viewers
                                .filter((viewer: { id: string }) => viewer.id !== session?.user?.id)
                                .map((viewer: { name: string }) => viewer.name)
                                .join(', ')} · non-exclusive presence
                        </Badge>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Description with inline images */}
                    {ticket.description && (
                        <Card className="border-0 shadow-sm">
                            <CardContent className="p-5">
                                <RenderDescription text={ticket.description} />
                            </CardContent>
                        </Card>
                    )}

                    {/* Attachments */}
                    {(ticket.attachments ?? []).length > 0 && (
                        <Card className="border-0 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Paperclip className="h-4 w-4 text-primary" /> Attachments ({activeAttachments.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {activeAttachments.map((att: any) => (
                                    <div key={att.id} className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30">
                                        <FileIcon className="h-8 w-8 text-muted-foreground p-1 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{att.filename}</p>
                                            <p className="text-xs text-muted-foreground">{formatFileSize(att.size)} · {att.scanStatus === 'CLEAN' ? 'Malware scan passed' : 'Malware scanner not configured'}</p>
                                        </div>
                                        <Button asChild size="icon" variant="ghost" className="h-8 w-8"><a href={att.path} download={att.filename} aria-label={`Download ${att.filename}`}><Download className="h-3.5 w-3.5" /></a></Button>
                                        <ConfirmDestructiveAction
                                            title="Remove attachment?"
                                            description={<>The stored file <strong>{att.filename}</strong> will be removed, while its history record and audit evidence are retained.</>}
                                            onConfirm={() => void deleteAttachment(att.id)}
                                            trigger={<Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Remove ${att.filename}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
                                        />
                                    </div>
                                ))}
                                {removedAttachments.map((att: any) => (
                                    <div key={att.id} className="flex items-center gap-3 rounded-lg border border-dashed p-2 text-muted-foreground">
                                        <FileIcon className="h-8 w-8 p-1 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{att.filename}</p>
                                            <p className="text-xs">Removed · history retained</p>
                                        </div>
                                    </div>
                                ))}                            </CardContent>
                        </Card>
                    )}

                    {/* Conversation */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-primary" /> Conversation
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {conversationEvents.length > 0 ? (
                                conversationEvents.map((event: any) => renderTimelineEntry(event))
                            ) : (
                                <div className="rounded-lg border border-dashed py-8 text-center">
                                    <p className="text-sm text-muted-foreground">No conversation yet.</p>
                                </div>
                            )}

                            {/* Comment input */}
                            <Separator className="my-4" />
                            <div className="space-y-3">
                                {isAgent && ticket.status !== 'WITHDRAWN' && (
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
                                    placeholder={isInternal ? 'Write an internal note... (Paste screenshots with Ctrl+V)' : 'Write a reply... (Paste screenshots with Ctrl+V)'}
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    onPaste={handleCommentPaste}
                                    rows={3}
                                    className={isInternal ? 'border-amber-300 focus-visible:ring-amber-400' : ''}
                                />
                                <div className="flex justify-between">
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Upload className="h-3.5 w-3.5" /> Attach file
                                        </Button>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            multiple
                                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt,.csv"
                                            onChange={handleFileSelect}
                                            className="hidden"
                                        />
                                    </div>
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
                    {isAgent && ticket.status !== 'WITHDRAWN' && (
                        <Card className="border-0 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-primary" /> Actions
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {ticket.status === 'PENDING_USER' ? (
                                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                                        <div className="flex items-start gap-2">
                                            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium">Waiting for requester</p>
                                                {reminderQuery.data ? <p className="text-xs text-muted-foreground">Waiting for {formatElapsed(reminderQuery.data.waitingSince)} · {reminderQuery.data.reminderCount}/{reminderQuery.data.maxPerCycle} reminders this cycle</p> : null}
                                            </div>
                                        </div>
                                        {reminderQuery.data?.lastReminderAt ? <p className="text-xs text-muted-foreground">Last reminder: {new Date(reminderQuery.data.lastReminderAt).toLocaleString()}</p> : null}
                                        {reminderQuery.isError ? <p role="alert" className="text-xs text-destructive">{reminderQuery.error instanceof Error ? reminderQuery.error.message : 'Reminder availability could not be loaded.'}</p> : null}
                                        {reminderQuery.data?.reason ? <p className="text-xs text-muted-foreground">{reminderQuery.data.reason}{reminderQuery.data.nextAvailableAt && new Date(reminderQuery.data.nextAvailableAt) > new Date() ? ` Try again after ${new Date(reminderQuery.data.nextAvailableAt).toLocaleString()}.` : ''}</p> : null}
                                        {session?.user?.role === 'SUPER_ADMIN' && reminderQuery.data?.unresolvedReminder ? (
                                            <ConfirmDestructiveAction
                                                title="Clear uncertain reminder delivery?"
                                                description="Only continue after checking the mail provider or server logs. The email may already have reached the requester; clearing this state permits a later reminder and could otherwise create a duplicate."
                                                confirmLabel="Mark as failed"
                                                pending={clearUnresolvedReminder.isPending}
                                                disabled={new Date(reminderQuery.data.unresolvedReminder.clearableAt) > new Date()}
                                                onConfirm={() => clearUnresolvedReminder.mutate(reminderQuery.data.unresolvedReminder!.id)}
                                                trigger={<Button type="button" variant="outline" size="sm" className="w-full text-destructive">Review and clear uncertain delivery</Button>}
                                            />
                                        ) : null}
                                        {session?.user?.role === 'SUPER_ADMIN' && reminderQuery.data?.unresolvedReminder && new Date(reminderQuery.data.unresolvedReminder.clearableAt) > new Date() ? <p className="text-xs text-muted-foreground">For safety, this state can be cleared after {new Date(reminderQuery.data.unresolvedReminder.clearableAt).toLocaleString()}.</p> : null}
                                        <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
                                            <DialogTrigger asChild>
                                                <Button type="button" variant="outline" size="sm" className="w-full gap-2" disabled={reminderQuery.isLoading || reminderQuery.isError || !reminderQuery.data?.allowed || sendReminder.isPending}><BellRing className="h-3.5 w-3.5" />Remind requester</Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Send reminder to requester?</DialogTitle>
                                                    <DialogDescription>This sends one branded email to {reminderQuery.data?.requester.name ?? ticket.requester?.name} for {ticket.key}: {ticket.title}. It will be recorded in the ticket timeline and audit log.</DialogDescription>
                                                </DialogHeader>
                                                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                                                    <p>Reminders in this waiting cycle: <strong>{reminderQuery.data?.reminderCount ?? 0} of {reminderQuery.data?.maxPerCycle ?? 0}</strong></p>
                                                    <p className="mt-1 text-xs text-muted-foreground">After sending, the {reminderQuery.data?.cooldownHours ?? 24}-hour cooldown applies. A requester reply resets the cycle.</p>
                                                </div>
                                                <DialogFooter>
                                                    <Button type="button" variant="outline" onClick={() => setReminderOpen(false)} disabled={sendReminder.isPending}>Cancel</Button>
                                                    <Button type="button" onClick={confirmReminder} disabled={sendReminder.isPending}>{sendReminder.isPending ? 'Sending…' : 'Yes, send reminder'}</Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    </div>
                                ) : null}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                                    <Select
                                        value={ticket.status}
                                        onValueChange={(v) => updateTicket.mutate({ status: v })}
                                    >
                                        <SelectTrigger className="h-9">
                                            <StatusBadge value={ticket.status} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {STATUS_OPTIONS.map((s) => (
                                                <SelectItem key={s} value={s}>
                                                    <StatusBadge value={s} />
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-xs font-medium text-muted-foreground">Assignees</label>
                                    {assignments.length === 0 ? <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Unassigned</p> : (
                                        <div className="space-y-2">
                                            {assignments.map((assignment: any) => (
                                                <div key={assignment.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium">{assignment.user.name}</p>
                                                        <p className="truncate text-xs text-muted-foreground">{assignment.user.email} · {assignment.user.role}</p>
                                                    </div>
                                                    <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${assignment.user.name}`} disabled={assignmentMutation.isPending} onClick={() => runAssignment('remove', assignment.userId)}>
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <UserSearchCombobox
                                        kind="assignee"
                                        queueId={ticket.queueId}
                                        value={assignmentCandidateId}
                                        placeholder="Search to add an assignee"
                                        disabled={assignmentMutation.isPending}
                                        onValueChange={(value) => {
                                            if (!value || assignments.some((assignment: any) => assignment.userId === value) || assignmentMutation.isPending) return;
                                            setAssignmentCandidateId(value);
                                            runAssignment('add', value);
                                        }}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Priority</label>
                                    <Select
                                        value={ticket.priority}
                                        onValueChange={(v) => updateTicket.mutate({ priority: v })}
                                    >
                                        <SelectTrigger className="h-9">
                                            <PriorityBadge value={ticket.priority} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PRIORITY_OPTIONS.map((p) => (
                                                <SelectItem key={p} value={p}>
                                                    <PriorityBadge value={p} />
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Category selector for agents */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Category</label>
                                    <Select
                                        value={ticket.categoryId ?? 'none'}
                                        onValueChange={(v) => updateTicket.mutate({ categoryId: v === 'none' ? null : v })}
                                    >
                                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">No category</SelectItem>
                                            {(categories ?? []).map((cat: any) => (
                                                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Escalate button */}
                                {ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && ticket.status !== 'WITHDRAWN' && (
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

                    {/* Collapsible audit timeline */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader className="pb-3">
                            <button
                                type="button"
                                className="flex w-full items-center justify-between gap-3 text-left"
                                onClick={() => setTimelineOpen((open) => !open)}
                                aria-expanded={timelineOpen}
                            >
                                <CardTitle className="text-base flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4 text-primary" />
                                    Timeline
                                    <Badge variant="secondary" className="text-xs">{timelineEvents.length}</Badge>
                                </CardTitle>
                                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', timelineOpen && 'rotate-180')} />
                            </button>
                        </CardHeader>
                        {timelineOpen && (
                            <CardContent className="space-y-3">
                                {timelineEvents.length > 0 ? (
                                    timelineEvents.map((event: any) => renderTimelineEntry(event, true))
                                ) : (
                                    <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                                        No status, priority, assignment, or escalation events yet.
                                    </p>
                                )}
                            </CardContent>
                        )}
                    </Card>

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
                                <span className="text-muted-foreground">Assignees</span>
                                <span className="text-right font-medium">{assignments.length ? assignments.map((assignment: any) => assignment.user.name).join(', ') : 'Unassigned'}</span>
                            </div>
                            {ticket.historicalForm ? (
                                <div className="flex justify-between gap-4 text-sm">
                                    <span className="text-muted-foreground">Ticket form</span>
                                    <span className="text-right font-medium">{ticket.historicalForm.templateName} v{ticket.historicalForm.version}</span>
                                </div>
                            ) : null}
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

                    {/* Immutable historical form submission */}
                    {ticket.historicalForm && ticket.historicalForm.fields.some((field: { builtIn: string | null }) => !field.builtIn) ? (
                        <Card className="border-0 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Submitted form data</CardTitle>
                                <p className="text-xs text-muted-foreground">{ticket.historicalForm.templateName} · version {ticket.historicalForm.version}</p>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {ticket.historicalForm.fields
                                    .filter((field: { builtIn: string | null }) => !field.builtIn)
                                    .map((field: { id: string; fieldKey: string; label: string }) => {
                                        const value = ticket.historicalForm.values[field.fieldKey];
                                        if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
                                        const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : Array.isArray(value)
                                            ? value.map((item) => typeof item === 'object' && item && 'filename' in item ? String(item.filename) : String(item)).join(', ')
                                            : String(value);
                                        return (
                                            <div key={field.id} className="flex flex-col text-sm">
                                                <span className="text-xs text-muted-foreground">{field.label}</span>
                                                <span className="mt-0.5 whitespace-pre-wrap font-medium">{display}</span>
                                            </div>
                                        );
                                    })}
                            </CardContent>
                        </Card>
                    ) : null}
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
