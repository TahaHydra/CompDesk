'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileText, Loader2, Pencil, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownArticle, extractHelpHeadings } from '@/components/help/markdown-article';
import { useLanguage } from '@/components/providers/language-provider';

interface HelpArticleDetail {
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    content: string;
    collection: {
        id: string;
        slug: string;
        title: string;
        articles: Array<{ id: string; slug: string; title: string }>;
    };
}

async function loadArticle(slug: string): Promise<HelpArticleDetail> {
    const response = await fetch(`/api/help/articles?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
    if (!response.ok) throw new Error(payload.error || 'Failed to load this help article');
    return payload;
}

export default function HelpArticlePage() {
    const { slug } = useParams<{ slug: string }>();
    const { data: session } = useSession();
    const { t } = useLanguage();
    const articleQuery = useQuery({
        queryKey: ['help-article', slug],
        queryFn: () => loadArticle(slug),
        enabled: Boolean(slug),
        retry: 1,
    });

    if (articleQuery.isLoading) {
        return (
            <div className="flex min-h-[45vh] items-center justify-center" role="status">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="sr-only">Loading article</span>
            </div>
        );
    }

    if (articleQuery.isError || !articleQuery.data) {
        return (
            <div className="mx-auto max-w-xl rounded-xl border bg-card p-8 text-center shadow-sm">
                <FileText className="mx-auto h-9 w-9 text-muted-foreground" />
                <h1 className="mt-4 text-xl font-semibold">This article could not be loaded</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {articleQuery.error instanceof Error ? articleQuery.error.message : 'The article may have been removed or is temporarily unavailable.'}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <Button asChild variant="outline"><Link href="/help"><ArrowLeft className="mr-2 h-4 w-4" />{t('Back to Help Center')}</Link></Button>
                    <Button onClick={() => articleQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
                </div>
            </div>
        );
    }

    const article = articleQuery.data;
    const headings = extractHelpHeadings(article.content);
    const admin = session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';

    return (
        <div className="mx-auto max-w-7xl">
            <div className="mb-6 flex items-center justify-between gap-4 border-b pb-4">
                <Link href="/help" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />{t('Back to Help Center')}
                </Link>
                {admin ? (
                    <Button asChild size="sm" variant="outline"><Link href={`/admin/help?article=${article.id}`}><Pencil className="mr-2 h-3.5 w-3.5" />{t('Edit')}</Link></Button>
                ) : null}
            </div>

            <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,760px)_200px]">
                <aside className="hidden lg:block">
                    <div className="sticky top-6 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{article.collection.title}</p>
                        <nav className="space-y-1 border-l pl-3">
                            {article.collection.articles.map((item) => (
                                <Link key={item.id} href={`/help/${item.slug}`} className={`block rounded-md px-2 py-1.5 text-sm leading-snug ${item.id === article.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                                    {item.title}
                                </Link>
                            ))}
                        </nav>
                    </div>
                </aside>

                <article className="min-w-0">
                    <div className="mb-8">
                        <div className="mb-4 flex items-center gap-2 text-sm text-primary"><FileText className="h-4 w-4" />{article.collection.title}</div>
                        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{article.title}</h1>
                        {article.summary ? <p className="mt-4 text-lg leading-8 text-muted-foreground">{article.summary}</p> : null}
                    </div>
                    <MarkdownArticle content={article.content} />
                    <div className="mt-12 rounded-xl border bg-muted/25 p-5">
                        <p className="font-medium">{t('Need more help? Create a ticket and our team will assist you.')}</p>
                        <Button asChild size="sm" className="mt-4"><Link href="/tickets/new">{t('New Ticket')}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
                    </div>
                </article>

                <aside className="hidden xl:block">
                    {headings.length ? (
                        <div className="sticky top-6">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('On this page')}</p>
                            <nav className="space-y-2 border-l pl-3">
                                {headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} className={`block text-xs leading-snug text-muted-foreground hover:text-foreground ${heading.level === 3 ? 'pl-2' : ''}`}>{heading.text}</a>)}
                            </nav>
                        </div>
                    ) : null}
                </aside>
            </div>
        </div>
    );
}