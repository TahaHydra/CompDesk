'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronDown, Plus, Search, Settings2 } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { SAVED_REPLY_TITLE_MAX } from '@/lib/saved-replies';

export interface SavedReplyView { id: string; title: string; content: string; useCount?: number }
interface SharedResponseView { id: string; title: string; content: string; category?: string | null }

export const SAVED_REPLIES_QUERY_KEY = ['saved-replies'] as const;

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Request failed');
    return response.json();
}

function matches(item: { title: string; content: string }, needle: string) {
    return !needle || item.title.toLowerCase().includes(needle) || item.content.toLowerCase().includes(needle);
}

function suggestedTitle(draft: string) {
    const firstLine = draft.trim().split('\n')[0]?.trim() ?? '';
    return firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
}

/**
 * Staff-only reply helper shown next to the Public reply / Internal note toggle.
 * Choosing an entry inserts its text at the caret; nothing is ever sent automatically.
 */
export function SavedRepliesMenu({ draft, onInsert, disabled = false }: {
    draft: string;
    onInsert: (text: string) => void;
    disabled?: boolean;
}) {
    const { t } = useLanguage();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [active, setActive] = useState(0);
    const [saving, setSaving] = useState<{ title: string } | null>(null);

    const { data: mine = [], isLoading } = useQuery<SavedReplyView[]>({
        queryKey: SAVED_REPLIES_QUERY_KEY,
        queryFn: () => fetchJson('/api/saved-replies'),
        enabled: open,
    });
    // Older installations may have shared canned responses; they stay usable, read-only.
    const { data: shared = [] } = useQuery<SharedResponseView[]>({
        queryKey: ['canned-responses'],
        queryFn: () => fetchJson('/api/canned-responses'),
        enabled: open,
        staleTime: 5 * 60_000,
    });

    const needle = search.trim().toLowerCase();
    const visibleMine = useMemo(() => mine.filter((item) => matches(item, needle)), [mine, needle]);
    const visibleShared = useMemo(() => shared.filter((item) => matches(item, needle)), [shared, needle]);
    const entries = useMemo(() => [
        ...visibleMine.map((item) => ({ ...item, kind: 'mine' as const })),
        ...visibleShared.map((item) => ({ ...item, kind: 'shared' as const })),
    ], [visibleMine, visibleShared]);

    const recordUse = useMutation({
        mutationFn: (id: string) => fetch(`/api/saved-replies/${id}/use`, { method: 'POST' }),
        onSettled: () => queryClient.invalidateQueries({ queryKey: SAVED_REPLIES_QUERY_KEY }),
    });
    const save = useMutation({
        mutationFn: async (title: string) => {
            const response = await fetch('/api/saved-replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content: draft }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Could not save the reply');
            return body as SavedReplyView;
        },
        onSuccess: () => {
            toast({ title: t('Reply saved') });
            setSaving(null);
            void queryClient.invalidateQueries({ queryKey: SAVED_REPLIES_QUERY_KEY });
        },
        onError: (error: Error) => toast({ title: t(error.message), variant: 'destructive' }),
    });

    const close = () => { setOpen(false); setSearch(''); setActive(0); setSaving(null); };
    const choose = (entry: (typeof entries)[number]) => {
        onInsert(entry.content);
        if (entry.kind === 'mine') recordUse.mutate(entry.id);
        close();
    };
    const onListKey = (event: React.KeyboardEvent) => {
        if (!entries.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % entries.length); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + entries.length) % entries.length); }
        if (event.key === 'Enter') { event.preventDefault(); const entry = entries[Math.min(active, entries.length - 1)]; if (entry) choose(entry); }
    };
    const canSaveDraft = draft.trim().length > 0;

    const renderEntry = (entry: (typeof entries)[number], index: number) => (
        <button
            key={`${entry.kind}:${entry.id}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(entry)}
            className={cn('flex w-full flex-col rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none', index === active && 'bg-accent')}
        >
            <span className="truncate text-sm font-medium">{entry.title}</span>
            <span className="line-clamp-1 text-xs text-muted-foreground">{entry.content}</span>
        </button>
    );

    return (
        <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} className="ml-auto gap-1.5 font-normal">
                    <Bookmark className="h-3.5 w-3.5" />
                    {t('Saved replies')}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" collisionPadding={8} className="w-[min(22rem,calc(100vw-1rem))] p-0">
                {saving ? (
                    <form
                        className="space-y-3 p-3"
                        onSubmit={(event) => { event.preventDefault(); if (saving.title.trim()) save.mutate(saving.title.trim()); }}
                    >
                        <p className="text-sm font-medium">{t('Save current reply')}</p>
                        <div className="space-y-1.5">
                            <label htmlFor="saved-reply-title" className="block text-xs font-medium text-muted-foreground">{t('Title')}</label>
                            <Input id="saved-reply-title" autoFocus maxLength={SAVED_REPLY_TITLE_MAX} value={saving.title} onChange={(event) => setSaving({ title: event.target.value })} className="h-8" />
                        </div>
                        <p className="line-clamp-3 whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">{draft.trim()}</p>
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setSaving(null)}>{t('Cancel')}</Button>
                            <Button type="submit" size="sm" disabled={!saving.title.trim() || save.isPending}>{t('Save')}</Button>
                        </div>
                    </form>
                ) : (
                    <>
                        <div className="relative border-b p-2">
                            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                autoFocus={typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches}
                                value={search}
                                onChange={(event) => { setSearch(event.target.value); setActive(0); }}
                                onKeyDown={onListKey}
                                placeholder={t('Search saved replies…')}
                                aria-label={t('Search saved replies…')}
                                className="h-8 pl-8"
                            />
                        </div>
                        <div role="listbox" aria-label={t('Saved replies')} className="max-h-72 overflow-y-auto p-1">
                            {isLoading ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('Loading...')}</p> : null}
                            {!isLoading && entries.length === 0 ? (
                                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                                    {needle ? t('No matching replies') : t('No saved replies yet. Write a reply, then save it here to reuse it.')}
                                </p>
                            ) : null}
                            {visibleMine.length > 0 ? visibleMine.map((_, index) => renderEntry(entries[index], index)) : null}
                            {visibleShared.length > 0 ? (
                                <>
                                    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Shared responses')}</p>
                                    {visibleShared.map((_, offset) => renderEntry(entries[visibleMine.length + offset], visibleMine.length + offset))}
                                </>
                            ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t p-1.5">
                            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={!canSaveDraft}
                                title={canSaveDraft ? undefined : t('Write a reply first')}
                                onClick={() => setSaving({ title: suggestedTitle(draft) })}>
                                <Plus className="h-3.5 w-3.5" /> {t('Save current reply')}
                            </Button>
                            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                                <Link href="/profile#saved-replies" onClick={close}><Settings2 className="h-3.5 w-3.5" /> {t('Manage')}</Link>
                            </Button>
                        </div>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}
