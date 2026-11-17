'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { MarkdownArticle } from '@/components/help/markdown-article';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Suggestion { id: string; slug: string; title: string; summary: string | null }
interface ArticleDetail { title: string; summary: string | null; content: string }

/**
 * Help Center articles an administrator linked to the chosen category. Shown between routing and
 * the form; it never blocks submitting. Articles open in a dialog so the draft stays on the page.
 */
export function HelpSuggestionsPanel({ categoryId, onSolved }: { categoryId: string; onSolved: () => void }) {
    const { t, language } = useLanguage();
    const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
    const [reading, setReading] = useState<Suggestion | null>(null);

    const suggestions = useQuery<Suggestion[]>({
        queryKey: ['help-suggestions', language, categoryId],
        enabled: Boolean(categoryId),
        queryFn: async () => {
            const response = await fetch(`/api/help/suggestions?categoryId=${encodeURIComponent(categoryId)}`, { cache: 'no-store' });
            return response.ok ? response.json() : [];
        },
        staleTime: 5 * 60_000,
    });
    const article = useQuery<ArticleDetail>({
        queryKey: ['help-article', language, reading?.slug],
        enabled: Boolean(reading),
        queryFn: async () => {
            const response = await fetch(`/api/help/articles?slug=${encodeURIComponent(reading!.slug)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Unavailable');
            return response.json();
        },
    });

    const items = suggestions.data ?? [];
    if (!categoryId || items.length === 0) return null;
    const collapsed = collapsedFor === categoryId;

    if (collapsed) {
        return (
            <button type="button" onClick={() => setCollapsedFor(null)} className="flex w-full items-center gap-2 rounded-lg border border-dashed px-4 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/40">
                <BookOpen className="h-4 w-4 shrink-0" />
                <span className="flex-1">{t(items.length === 1 ? '1 help article may answer this request' : '{count} help articles may answer this request', { count: items.length })}</span>
                <span className="text-xs font-medium text-primary">{t('Show')}</span>
            </button>
        );
    }

    return (
        <section aria-labelledby="help-suggestions-title" className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <h2 id="help-suggestions-title" className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4 text-primary" />{t('This might answer your question')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('If it doesn’t solve your problem, or isn’t the problem you have, continue with your request below.')}</p>
            <ul className="mt-3 space-y-2">
                {items.map((item) => (
                    <li key={item.id}>
                        <button type="button" onClick={() => setReading(item)} className="flex w-full items-start gap-3 rounded-md border bg-background p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">{item.title}</span>
                                {item.summary ? <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{item.summary}</span> : null}
                            </span>
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                    </li>
                ))}
            </ul>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" size="sm" onClick={onSolved}>{t('This solved it')}</Button>
                <Button variant="outline" size="sm" onClick={() => setCollapsedFor(categoryId)}>{t('Continue with my request')}</Button>
            </div>

            <Dialog open={reading !== null} onOpenChange={(open) => { if (!open) setReading(null); }}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{article.data?.title ?? reading?.title}</DialogTitle>
                        {article.data?.summary ?? reading?.summary ? <DialogDescription>{article.data?.summary ?? reading?.summary}</DialogDescription> : null}
                    </DialogHeader>
                    {article.isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : null}
                    {article.isError ? <p className="text-sm text-muted-foreground">{t('This article is not available right now.')}</p> : null}
                    {article.data ? <MarkdownArticle content={article.data.content} /> : null}
                    <DialogFooter className="gap-2 sm:justify-between">
                        {reading ? (
                            <Button asChild variant="ghost" size="sm" className="gap-1.5">
                                <Link href={`/help/${reading.slug}`} target="_blank" rel="noopener"><ExternalLink className="h-3.5 w-3.5" />{t('Open in Help Center')}</Link>
                            </Button>
                        ) : <span />}
                        <div className="flex flex-col-reverse gap-2 sm:flex-row">
                            <Button variant="ghost" size="sm" onClick={() => { setReading(null); onSolved(); }}>{t('This solved it')}</Button>
                            <Button size="sm" onClick={() => { setReading(null); setCollapsedFor(categoryId); }}>{t('Continue with my request')}</Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
