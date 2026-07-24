'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import {
    ArrowRight,
    BookOpen,
    Headphones,
    Search,
    Settings,
    ShieldCheck,
    TicketCheck,
    UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/providers/language-provider';
import type { LocalizedHelpArticle, LocalizedHelpCollection } from '@/lib/help-center';

const icons: Record<string, LucideIcon> = {
    book: BookOpen,
    ticket: TicketCheck,
    user: UserRound,
    agent: Headphones,
    settings: Settings,
    shield: ShieldCheck,
};

async function readJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load help content');
    return payload;
}

export default function HelpCenterPage() {
    const { data: session } = useSession();
    const { t } = useLanguage();
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const admin = session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';
    const collectionsQuery = useQuery({
        queryKey: ['help-collections'],
        queryFn: () => readJson<LocalizedHelpCollection[]>('/api/help/collections'),
    });
    const articlesQuery = useQuery({
        queryKey: ['help-articles', deferredSearch],
        queryFn: () => readJson<LocalizedHelpArticle[]>(`/api/help/articles${deferredSearch ? `?q=${encodeURIComponent(deferredSearch)}` : ''}`),
    });

    const collections = collectionsQuery.data ?? [];
    const articles = articlesQuery.data ?? [];

    return (
        <div className="mx-auto max-w-6xl space-y-10 pb-10">
            <section className="rounded-2xl border bg-card px-5 py-10 text-center shadow-sm sm:px-10 sm:py-14">
                <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/40">
                    <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('Help Center')}</h1>
                <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{t('Find answers and step-by-step guidance')}</p>
                <div className="relative mx-auto mt-7 max-w-2xl">
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('Search the help center...')}
                        className="h-12 bg-background pl-12 text-base shadow-sm"
                        aria-label={t('Search the help center...')}
                    />
                </div>
                {admin ? (
                    <Button asChild variant="ghost" size="sm" className="mt-4 text-muted-foreground">
                        <Link href="/admin/help">{t('Manage Help Center')}</Link>
                    </Button>
                ) : null}
            </section>

            {deferredSearch ? (
                <section className="space-y-4" aria-live="polite">
                    <div className="flex items-end justify-between gap-4">
                        <h2 className="text-xl font-semibold">{t('Search results')}</h2>
                        <span className="text-sm text-muted-foreground">{articles.length} {t(articles.length === 1 ? 'article' : 'articles')}</span>
                    </div>
                    {articlesQuery.isLoading ? <LoadingRows /> : articles.length ? (
                        <div className="divide-y rounded-xl border bg-card">
                            {articles.map((article) => (
                                <Link key={article.id} href={`/help/${article.slug}`} className="group flex items-start justify-between gap-4 p-5 transition-colors hover:bg-muted/35">
                                    <div>
                                        <p className="text-xs font-medium text-primary">{article.collection?.title}</p>
                                        <h3 className="mt-1 font-semibold group-hover:text-primary">{article.title}</h3>
                                        {article.summary ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{article.summary}</p> : null}
                                    </div>
                                    <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('No articles match your search.')}</div>
                    )}
                </section>
            ) : (
                <section className="space-y-5">
                    <div className="flex items-end justify-between gap-4">
                        <h2 className="text-xl font-semibold">{t('Browse by topic')}</h2>
                        <span className="text-sm text-muted-foreground">{articles.length} {t(articles.length === 1 ? 'article' : 'articles')}</span>
                    </div>
                    {collectionsQuery.isLoading || articlesQuery.isLoading ? <LoadingGrid /> : (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {collections.map((collection) => {
                                const Icon = icons[collection.icon || 'book'] || BookOpen;
                                const collectionArticles = articles.filter((article) => article.collectionId === collection.id);
                                return (
                                    <Card key={collection.id} className="border shadow-sm">
                                        <CardHeader className="pb-3">
                                            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border bg-muted/45">
                                                <Icon className="h-4.5 w-4.5 text-primary" />
                                            </div>
                                            <CardTitle className="text-lg">{collection.title}</CardTitle>
                                            {collection.description ? <p className="text-sm leading-relaxed text-muted-foreground">{collection.description}</p> : null}
                                        </CardHeader>
                                        <CardContent className="space-y-1">
                                            {collectionArticles.map((article) => (
                                                <Link key={article.id} href={`/help/${article.slug}`} className="group flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                                    <span className="line-clamp-1 group-hover:text-primary">{article.title}</span>
                                                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                </Link>
                                            ))}
                                            {!collectionArticles.length ? <p className="px-2 py-2 text-sm text-muted-foreground">{t('No articles yet.')}</p> : null}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}

function LoadingRows() {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>;
}

function LoadingGrid() {
    return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-56 animate-pulse rounded-xl bg-muted" />)}</div>;
}