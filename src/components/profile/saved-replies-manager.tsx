'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { SAVED_REPLY_CONTENT_MAX, SAVED_REPLY_TITLE_MAX } from '@/lib/saved-replies';
import { SAVED_REPLIES_QUERY_KEY, type SavedReplyView } from '@/components/tickets/saved-replies-menu';

type Draft = { id?: string; title: string; content: string };

async function send(url: string, method: string, body?: unknown) {
    const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
}

/** Profile → My saved replies: create, edit and delete the signed-in staff member's own replies. */
export function SavedRepliesManager() {
    const { t } = useLanguage();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [draft, setDraft] = useState<Draft | null>(null);

    const { data: replies = [], isLoading, isError } = useQuery<SavedReplyView[]>({
        queryKey: SAVED_REPLIES_QUERY_KEY,
        queryFn: async () => {
            const response = await fetch('/api/saved-replies', { cache: 'no-store' });
            if (!response.ok) throw new Error('Request failed');
            return response.json();
        },
    });
    const needle = search.trim().toLowerCase();
    const visible = useMemo(() => replies.filter((reply) => !needle || reply.title.toLowerCase().includes(needle) || reply.content.toLowerCase().includes(needle)), [replies, needle]);
    const refresh = () => queryClient.invalidateQueries({ queryKey: SAVED_REPLIES_QUERY_KEY });

    const saveDraft = useMutation({
        mutationFn: (value: Draft) => value.id
            ? send(`/api/saved-replies/${value.id}`, 'PATCH', { title: value.title.trim(), content: value.content.trim() })
            : send('/api/saved-replies', 'POST', { title: value.title.trim(), content: value.content.trim() }),
        onSuccess: () => { toast({ title: t('Reply saved') }); setDraft(null); void refresh(); },
        onError: (error: Error) => toast({ title: t(error.message), variant: 'destructive' }),
    });
    const remove = useMutation({
        mutationFn: (id: string) => send(`/api/saved-replies/${id}`, 'DELETE'),
        onSuccess: () => { toast({ title: t('Saved reply deleted') }); void refresh(); },
        onError: (error: Error) => toast({ title: t(error.message), variant: 'destructive' }),
    });
    const draftValid = Boolean(draft?.title.trim() && draft.content.trim());

    return (
        <Card id="saved-replies" className="scroll-mt-20 border shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4 bg-muted/30 pb-4">
                <div className="space-y-1.5">
                    <CardTitle className="text-lg">{t('My saved replies')}</CardTitle>
                    <CardDescription>{t('Only you can see and use these. Insert them from the Saved replies button when answering a ticket.')}</CardDescription>
                </div>
                <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setDraft({ title: '', content: '' })}>
                    <Plus className="h-3.5 w-3.5" /> {t('New')}
                </Button>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
                {replies.length > 5 ? (
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search saved replies…')} aria-label={t('Search saved replies…')} className="h-9 pl-8" />
                    </div>
                ) : null}
                {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">{t('Loading...')}</p> : null}
                {isError ? <p className="py-6 text-center text-sm text-destructive">{t('Saved replies could not be loaded')}</p> : null}
                {!isLoading && !isError && visible.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">{needle ? t('No matching replies') : t('No saved replies yet.')}</p>
                ) : null}
                <ul className="divide-y rounded-md border">
                    {visible.map((reply) => (
                        <li key={reply.id} className="flex items-start gap-3 p-3">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{reply.title}</p>
                                <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{reply.content}</p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('Edit {name}', { name: reply.title })}
                                onClick={() => setDraft({ id: reply.id, title: reply.title, content: reply.content })}>
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <ConfirmDestructiveAction
                                title={t('Delete saved reply?')}
                                description={t('"{name}" will be deleted. Replies already sent are not affected.', { name: reply.title })}
                                pending={remove.isPending}
                                onConfirm={() => remove.mutate(reply.id)}
                                trigger={<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" aria-label={t('Delete {name}', { name: reply.title })}><Trash2 className="h-3.5 w-3.5" /></Button>}
                            />
                        </li>
                    ))}
                </ul>
                {visible.length === 0 ? null : <p className="text-right text-[11px] text-muted-foreground">{t('{count} of {max}', { count: String(replies.length), max: '200' })}</p>}
            </CardContent>

            <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{t(draft?.id ? 'Edit saved reply' : 'New saved reply')}</DialogTitle></DialogHeader>
                    <form id="saved-reply-form" className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (draft && draftValid) saveDraft.mutate(draft); }}>
                        <div className="space-y-1.5">
                            <label htmlFor="saved-reply-edit-title" className="block text-sm font-medium">{t('Title')}</label>
                            <Input id="saved-reply-edit-title" maxLength={SAVED_REPLY_TITLE_MAX} value={draft?.title ?? ''} onChange={(event) => setDraft((current) => current && { ...current, title: event.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <label htmlFor="saved-reply-edit-content" className="block text-sm font-medium">{t('Reply text')}</label>
                            <Textarea id="saved-reply-edit-content" rows={8} maxLength={SAVED_REPLY_CONTENT_MAX} value={draft?.content ?? ''} onChange={(event) => setDraft((current) => current && { ...current, content: event.target.value })} />
                        </div>
                    </form>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDraft(null)}>{t('Cancel')}</Button>
                        <Button type="submit" form="saved-reply-form" disabled={!draftValid || saveDraft.isPending}>{t('Save')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
