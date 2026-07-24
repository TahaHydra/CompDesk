import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ArrowRight, FileText, Pencil } from 'lucide-react';
import { auth } from '@/lib/auth';
import { localizedHelpFields } from '@/lib/help-center';
import { normalizeLanguage, translate } from '@/lib/i18n';
import { isAdminRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { MarkdownArticle, extractHelpHeadings } from '@/components/help/markdown-article';

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
    const session = await auth();
    if (!session?.user?.id) redirect('/auth/signin');
    const { slug } = await params;
    const [user, article] = await Promise.all([
        prisma.user.findUnique({ where: { id: session.user.id }, select: { preferredLanguage: true } }),
        prisma.helpArticle.findUnique({
            where: { slug },
            include: {
                collection: {
                    include: { articles: { where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { titleEn: 'asc' }] } },
                },
            },
        }),
    ]);
    if (!article || (!article.isPublished && !isAdminRole(session.user.role)) || (!article.collection.isPublished && !isAdminRole(session.user.role))) notFound();

    const language = normalizeLanguage(user?.preferredLanguage);
    const t = (key: string) => translate(language, key);
    const localized = localizedHelpFields(article, language);
    const collection = localizedHelpFields(article.collection, language);
    const headings = extractHelpHeadings(localized.content || '');
    const collectionArticles = article.collection.articles.map((item) => ({ ...item, ...localizedHelpFields(item, language) }));

    return (
        <div className="mx-auto max-w-7xl">
            <div className="mb-6 flex items-center justify-between gap-4 border-b pb-4">
                <Link href="/help" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />{t('Back to Help Center')}
                </Link>
                {isAdminRole(session.user.role) ? (
                    <Button asChild size="sm" variant="outline"><Link href={`/admin/help?article=${article.id}`}><Pencil className="mr-2 h-3.5 w-3.5" />{t('Edit')}</Link></Button>
                ) : null}
            </div>

            <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,760px)_200px]">
                <aside className="hidden lg:block">
                    <div className="sticky top-6 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{collection.title}</p>
                        <nav className="space-y-1 border-l pl-3">
                            {collectionArticles.map((item) => (
                                <Link key={item.id} href={`/help/${item.slug}`} className={`block rounded-md px-2 py-1.5 text-sm leading-snug ${item.id === article.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                                    {item.title}
                                </Link>
                            ))}
                        </nav>
                    </div>
                </aside>

                <article className="min-w-0">
                    <div className="mb-8">
                        <div className="mb-4 flex items-center gap-2 text-sm text-primary"><FileText className="h-4 w-4" />{collection.title}</div>
                        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{localized.title}</h1>
                        {localized.summary ? <p className="mt-4 text-lg leading-8 text-muted-foreground">{localized.summary}</p> : null}
                    </div>
                    <MarkdownArticle content={localized.content || ''} />
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