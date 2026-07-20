/* eslint-disable @next/next/no-img-element */
'use client';

import { use, useCallback, useRef, useState } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
    ArrowLeft, MessageSquare, Lock, User, AlertTriangle,
    Send, Eye, Shield, XCircle, ArrowUpCircle,
    Paperclip, Download, FileIcon, Trash2, Upload,
    Hand, Pencil, X, Check, Trash, ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatTicketValue, getPriorityBadgeClass, getStatusBadgeClass } from '@/lib/ticket-display';

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(mimetype: string) {
    return mimetype.startsWith('image/');
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

// Render description with inline images (markdown ![alt](url) syntax)
function RenderDescription({ text }: { text: string }) {
    const parts = text.split(/(!\[.*?\]\(.*?\))/g);
    return (
        <div className="text-sm space-y-2">
            {parts.map((part, i) => {
                const match = part.match(/^!\[(.*?)\]\((.*?)\)$/);
                if (match) {
                    return (
                        <div key={i} className="my-2">
                            <img
                                src={match[2]}
                                alt={match[1]}
                                className="max-w-full max-h-96 rounded-lg border shadow-sm"
                            />
                            {match[1] && <p className="text-xs text-muted-foreground mt-1">{match[1]}</p>}
                        </div>
                    );
                }
                if (part.trim()) {
                    return <p key={i} className="whitespace-pre-wrap">{part}</p>;
                }
                return null;
            })}
        </div>
    );
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
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [deleteTicketOpen, setDeleteTicketOpen] = useState(false);
    const [timelineOpen, setTimelineOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isAgent = session?.user?.role === 'AGENT' || session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';

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
        queryKey: ['categories'],
        queryFn: async () => {
            const res = await fetch('/api/categories');
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
                throw new Error(err.error || 'Failed to delete');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ticket', id] });
            toast({ title: 'Timeline entry deleted' });
        },
        onError: (e: Error) => {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        },
    });

    const deleteTicket = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to delete');
            }
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Ticket deleted' });
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

    // Agents/admins can clean up timeline history; users can still edit their own recent comments.
    const canEditTimelineEvent = (event: any) => {
        if (!event.content) return false;
        if (isAgent) return true;
        if (event.userId !== session?.user?.id || !isConversationEvent(event)) return false;
        const hours = (Date.now() - new Date(event.createdAt).getTime()) / 3600000;
        return hours <= 24;
    };

    const canDeleteTimelineEvent = (event: any) => {
        if (isAgent) return true;
        return isConversationEvent(event) && event.userId === session?.user?.id;
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
                <Link href="/tickets" className="mt-4"><Button variant="outline">Back to tickets</Button></Link>
            </div>
        );
    }

    const imageAttachments = (ticket.attachments ?? []).filter((a: any) => isImageType(a.mimetype));
    const fileAttachments = (ticket.attachments ?? []).filter((a: any) => !isImageType(a.mimetype));
    const isRequester = ticket.requesterId === session?.user?.id;
    const canDeleteTicket = isRequester && !ticket.assigneeId;
    const conversationEvents = (ticket.timeline ?? []).filter((event: any) => isConversationEvent(event));
    const timelineEvents = (ticket.timeline ?? []).filter((event: any) => !isConversationEvent(event));

    const renderTimelineEntry = (event: any, compact = false) => {
        const isEditing = editingEventId === event.id;
        const showEditBtn = canEditTimelineEvent(event);
        const showDeleteBtn = canDeleteTimelineEvent(event);
        const isEdited = event.metadata?.edited;

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
                        {isEdited && (
                            <span className="text-xs text-muted-foreground italic">(edited)</span>
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
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                        onClick={() => deleteComment.mutate(event.id)}>
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
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
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/tickets">
                        <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
                    </Link>
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-mono text-muted-foreground">{ticket.key}</span>
                            <StatusBadge value={ticket.status} />
                            <PriorityBadge value={ticket.priority} />
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

                <div className="flex items-center gap-2">
                    {/* Claim button for agents when unassigned */}
                    {isAgent && !ticket.assigneeId && (
                        <Button
                            onClick={() => updateTicket.mutate({ assigneeId: session?.user?.id })}
                            className="gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-lg"
                            disabled={updateTicket.isPending}
                        >
                            <Hand className="h-4 w-4" /> Claim Ticket
                        </Button>
                    )}

                    {/* Delete ticket for requester when unassigned */}
                    {canDeleteTicket && (
                        <Dialog open={deleteTicketOpen} onOpenChange={setDeleteTicketOpen}>
                            <DialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="gap-1.5">
                                    <Trash className="h-3.5 w-3.5" /> Delete
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader><DialogTitle>Delete Ticket</DialogTitle></DialogHeader>
                                <p className="text-sm text-muted-foreground">
                                    Are you sure you want to delete ticket <strong>{ticket.key}</strong>? This action cannot be undone.
                                </p>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setDeleteTicketOpen(false)}>Cancel</Button>
                                    <Button variant="destructive" onClick={() => deleteTicket.mutate()} disabled={deleteTicket.isPending}>
                                        {deleteTicket.isPending ? 'Deleting...' : 'Delete'}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}

                    {ticket.lockInfo && ticket.lockInfo.lockedBy !== session?.user?.name && (
                        <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                            <Lock className="h-3 w-3" /> Being viewed by {ticket.lockInfo.lockedBy}
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
                                    <Paperclip className="h-4 w-4 text-primary" /> Attachments ({ticket.attachments.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {/* Image thumbnails */}
                                {imageAttachments.length > 0 && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {imageAttachments.map((att: any) => (
                                            <div key={att.id} className="relative group rounded-lg overflow-hidden border bg-muted/30">
                                                <a href={att.path} target="_blank" rel="noopener noreferrer">
                                                    <img src={att.path} alt={att.filename} className="w-full h-32 object-cover" />
                                                </a>
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                    <a href={att.path} download={att.filename}>
                                                        <Button size="icon" variant="ghost" className="text-white h-8 w-8"><Download className="h-4 w-4" /></Button>
                                                    </a>
                                                    <Button size="icon" variant="ghost" className="text-white h-8 w-8" onClick={() => deleteAttachment(att.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <p className="text-xs truncate p-1.5 text-muted-foreground">{att.filename}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* File list */}
                                {fileAttachments.map((att: any) => (
                                    <div key={att.id} className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30">
                                        <FileIcon className="h-8 w-8 text-muted-foreground p-1 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{att.filename}</p>
                                            <p className="text-xs text-muted-foreground">{formatFileSize(att.size)}</p>
                                        </div>
                                        <a href={att.path} download={att.filename}>
                                            <Button size="icon" variant="ghost" className="h-8 w-8"><Download className="h-3.5 w-3.5" /></Button>
                                        </a>
                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteAttachment(att.id)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </CardContent>
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
