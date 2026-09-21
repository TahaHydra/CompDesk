'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';
import { MarkdownArticle } from '@/components/help/markdown-article';
import { useLanguage } from '@/components/providers/language-provider';
import { HELP_ICON_KEYS, helpContentLanguages, localizedHelpTitle } from '@/lib/help-center';
import type { AppLanguage } from '@/lib/i18n';

interface RawCollection {
    id: string;
    slug: string;
    titleEn: string;
    titleFr: string;
    descriptionEn: string | null;
    descriptionFr: string | null;
    icon: string | null;
    sortOrder: number;
    isPublished: boolean;
    _count: { articles: number };
}

interface RawArticle {
    id: string;
    collectionId: string;
    slug: string;
    titleEn: string;
    titleFr: string;
    summaryEn: string | null;
    summaryFr: string | null;
    contentEn: string;
    contentFr: string;
    sortOrder: number;
    isPublished: boolean;
    collection: RawCollection;
}

type CollectionDraft = Omit<RawCollection, 'id' | '_count'> & { id?: string };
type ArticleDraft = Omit<RawArticle, 'id' | 'collection'> & { id?: string };

const emptyCollection = (): CollectionDraft => ({
    slug: '', titleEn: '', titleFr: '', descriptionEn: '', descriptionFr: '', icon: 'book', sortOrder: 0, isPublished: true,
});
const emptyArticle = (collectionId = ''): ArticleDraft => ({
    collectionId, slug: '', titleEn: '', titleFr: '', summaryEn: '', summaryFr: '', contentEn: '', contentFr: '', sortOrder: 0, isPublished: true,
});

async function requestJson(url: string, options?: RequestInit) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
}

export function HelpCenterManager() {
    const { language, t } = useLanguage();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const [collectionDialog, setCollectionDialog] = useState(false);
    const [articleDialog, setArticleDialog] = useState(false);
    const [collectionDraft, setCollectionDraft] = useState<CollectionDraft>(emptyCollection());
    const [articleDraft, setArticleDraft] = useState<ArticleDraft>(emptyArticle());
    const [collectionFilter, setCollectionFilter] = useState('all');
    const [collectionLanguages, setCollectionLanguages] = useState<AppLanguage[]>([language]);
    const [articleLanguages, setArticleLanguages] = useState<AppLanguage[]>([language]);
    const openedArticleId = useRef<string | null>(null);

    const collectionsQuery = useQuery({
        queryKey: ['help-admin-collections'],
        queryFn: () => requestJson('/api/help/collections?includeDrafts=true&raw=true') as Promise<RawCollection[]>,
    });
    const articlesQuery = useQuery({
        queryKey: ['help-admin-articles'],
        queryFn: () => requestJson('/api/help/articles?includeDrafts=true&raw=true') as Promise<RawArticle[]>,
    });
    const collections = useMemo(() => collectionsQuery.data ?? [], [collectionsQuery.data]);
    const articles = useMemo(() => articlesQuery.data ?? [], [articlesQuery.data]);
    const visibleArticles = useMemo(() => collectionFilter === 'all' ? articles : articles.filter((article) => article.collectionId === collectionFilter), [articles, collectionFilter]);

    useEffect(() => {
        const articleId = searchParams.get('article');
        if (!articleId) { openedArticleId.current = null; return; }
        if (!articles.length || articleDialog || openedArticleId.current === articleId) return;
        const article = articles.find((item) => item.id === articleId);
        if (article) {
            openedArticleId.current = articleId;
            setArticleDraft({
                id: article.id, collectionId: article.collectionId, slug: article.slug, titleEn: article.titleEn, titleFr: article.titleFr,
                summaryEn: article.summaryEn, summaryFr: article.summaryFr, contentEn: article.contentEn, contentFr: article.contentFr,
                sortOrder: article.sortOrder, isPublished: article.isPublished,
            });
            setArticleLanguages(helpContentLanguages(article, language));
            setArticleDialog(true);
        }
    }, [articleDialog, articles, language, searchParams]);

    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['help-admin-collections'] }),
            queryClient.invalidateQueries({ queryKey: ['help-admin-articles'] }),
            queryClient.invalidateQueries({ queryKey: ['help-collections'] }),
            queryClient.invalidateQueries({ queryKey: ['help-articles'] }),
        ]);
    };

    const saveCollection = useMutation({
        mutationFn: () => requestJson('/api/help/collections', {
            method: collectionDraft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectionDraft),
        }),
        onSuccess: async () => { await refresh(); setCollectionDialog(false); toast({ title: t('Help collection saved') }); },
        onError: (error: Error) => toast({ title: t('Help content could not be saved'), description: error.message, variant: 'destructive' }),
    });
    const saveArticle = useMutation({
        mutationFn: () => requestJson('/api/help/articles', {
            method: articleDraft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(articleDraft),
        }),
        onSuccess: async () => { await refresh(); setArticleDialog(false); toast({ title: t('Help article saved') }); },
        onError: (error: Error) => toast({ title: t('Help content could not be saved'), description: error.message, variant: 'destructive' }),
    });
    const deleteCollection = useMutation({
        mutationFn: (id: string) => requestJson(`/api/help/collections?id=${id}`, { method: 'DELETE' }),
        onSuccess: refresh,
        onError: (error: Error) => toast({ title: t('Help content could not be saved'), description: error.message, variant: 'destructive' }),
    });
    const deleteArticle = useMutation({
        mutationFn: (id: string) => requestJson(`/api/help/articles?id=${id}`, { method: 'DELETE' }),
        onSuccess: refresh,
        onError: (error: Error) => toast({ title: t('Help content could not be saved'), description: error.message, variant: 'destructive' }),
    });

    const editCollection = (collection: RawCollection) => {
        setCollectionDraft({ id: collection.id, slug: collection.slug, titleEn: collection.titleEn, titleFr: collection.titleFr, descriptionEn: collection.descriptionEn, descriptionFr: collection.descriptionFr, icon: collection.icon, sortOrder: collection.sortOrder, isPublished: collection.isPublished });
        setCollectionLanguages(helpContentLanguages(collection, language));
        setCollectionDialog(true);
    };
    const editArticle = (article: RawArticle) => {
        setArticleDraft({ id: article.id, collectionId: article.collectionId, slug: article.slug, titleEn: article.titleEn, titleFr: article.titleFr, summaryEn: article.summaryEn, summaryFr: article.summaryFr, contentEn: article.contentEn, contentFr: article.contentFr, sortOrder: article.sortOrder, isPublished: article.isPublished });
        setArticleLanguages(helpContentLanguages(article, language));
        setArticleDialog(true);
    };
    const createCollection = () => {
        setCollectionDraft(emptyCollection());
        setCollectionLanguages([language]);
        setCollectionDialog(true);
    };
    const createArticle = () => {
        setArticleDraft(emptyArticle(collections[0]?.id));
        setArticleLanguages([language]);
        setArticleDialog(true);
    };

    return (
        <Tabs defaultValue="articles" className="space-y-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <TabsList><TabsTrigger value="articles">{t('Articles')} ({articles.length})</TabsTrigger><TabsTrigger value="collections">{t('Collections')} ({collections.length})</TabsTrigger></TabsList>
            </div>

            <TabsContent value="articles" className="space-y-4">
                {collections.length ? <><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <Select value={collectionFilter} onValueChange={setCollectionFilter}>
                        <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="all">{t('Collections')}</SelectItem>{collections.map((collection) => <SelectItem key={collection.id} value={collection.id}>{localizedHelpTitle(collection, language)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button onClick={createArticle}><Plus className="mr-2 h-4 w-4" />{t('Add article')}</Button>
                </div>
                <div className="space-y-2">
                    {visibleArticles.map((article) => (
                        <Card key={article.id} className="shadow-sm"><CardContent className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
                            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{localizedHelpTitle(article, language)}</p><Badge variant={article.isPublished ? 'secondary' : 'outline'}>{article.isPublished ? t('Published') : t('Draft')}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{localizedHelpTitle(article.collection, language)} · /help/{article.slug}</p></div>
                            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => editArticle(article)}><Pencil className="mr-1 h-3.5 w-3.5" />{t('Edit')}</Button><ConfirmDestructiveAction title="Delete article?" description={<>The article <strong>{localizedHelpTitle(article, language)}</strong> will be permanently deleted.</>} pending={deleteArticle.isPending} onConfirm={() => deleteArticle.mutate(article.id)} trigger={<Button size="sm" variant="ghost" className="text-destructive" aria-label={`Delete ${localizedHelpTitle(article, language)}`}><Trash2 className="h-3.5 w-3.5" /></Button>} /></div>
                        </CardContent></Card>
                    ))}
                    {!visibleArticles.length ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('No articles yet.')}</div> : null}
                </div>
                </> : <div className="rounded-xl border border-dashed p-8 text-center"><BookOpen className="mx-auto h-8 w-8 text-muted-foreground" /><h3 className="mt-4 font-semibold">Create your first help collection</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Collections organize related articles. Create one before adding your first article.</p><Button className="mt-5" onClick={createCollection}><Plus className="mr-2 h-4 w-4" />Create collection</Button></div>}
            </TabsContent>

            <TabsContent value="collections" className="space-y-4">
                <div className="flex justify-end"><Button onClick={createCollection}><Plus className="mr-2 h-4 w-4" />{t('Add collection')}</Button></div>
                <div className="grid gap-4 md:grid-cols-2">
                    {collections.map((collection) => (
                        <Card key={collection.id} className="shadow-sm"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4 text-primary" />{localizedHelpTitle(collection, language)}</CardTitle>{collection.titleEn && collection.titleFr ? <p className="mt-1 text-sm text-muted-foreground">{language === 'fr' ? collection.titleEn : collection.titleFr}</p> : null}</div><Badge variant={collection.isPublished ? 'secondary' : 'outline'}>{collection.isPublished ? t('Published') : t('Draft')}</Badge></div></CardHeader><CardContent className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{collection._count.articles} {t(collection._count.articles === 1 ? 'article' : 'articles')}</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => editCollection(collection)}><Pencil className="mr-1 h-3.5 w-3.5" />{t('Edit')}</Button><ConfirmDestructiveAction title="Delete collection?" description={<>The empty collection <strong>{localizedHelpTitle(collection, language)}</strong> will be permanently deleted.</>} pending={deleteCollection.isPending} disabled={collection._count.articles > 0} onConfirm={() => deleteCollection.mutate(collection.id)} trigger={<Button size="sm" variant="ghost" className="text-destructive" disabled={collection._count.articles > 0} aria-label={`Delete ${localizedHelpTitle(collection, language)}`}><Trash2 className="h-3.5 w-3.5" /></Button>} /></div></CardContent></Card>
                    ))}
                    {!collections.length ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('No collections yet.')}</div> : null}
                </div>
            </TabsContent>

            <CollectionDialog open={collectionDialog} onOpenChange={setCollectionDialog} draft={collectionDraft} setDraft={setCollectionDraft} languages={collectionLanguages} setLanguages={setCollectionLanguages} save={() => saveCollection.mutate()} saving={saveCollection.isPending} />
            <ArticleDialog open={articleDialog} onOpenChange={setArticleDialog} draft={articleDraft} setDraft={setArticleDraft} collections={collections} languages={articleLanguages} setLanguages={setArticleLanguages} language={language} save={() => saveArticle.mutate()} saving={saveArticle.isPending} />
        </Tabs>
    );
}

interface LanguageProps {
    languages: AppLanguage[];
    setLanguages: (languages: AppLanguage[]) => void;
}

function LanguageSelector({ languages, setLanguages }: LanguageProps) {
    const addLanguage = (language: AppLanguage) => {
        if (!languages.includes(language)) setLanguages([...languages, language].sort());
    };
    const missingLanguage = (['en', 'fr'] as const).find((item) => !languages.includes(item));
    return <div className="space-y-2"><Label>Content languages</Label><div className="flex flex-wrap gap-2" aria-label="Content languages">{languages.map((item) => <Badge key={item} variant="secondary">{item === 'en' ? 'English' : 'Français'}</Badge>)}{missingLanguage ? <Button type="button" size="sm" variant="outline" onClick={() => addLanguage(missingLanguage)}><Plus className="mr-1 h-3.5 w-3.5" />{missingLanguage === 'en' ? 'Add English translation' : 'Add French translation'}</Button> : null}</div><p className="text-xs text-muted-foreground">Your primary language is selected first. Add the other translation whenever it is ready.</p></div>;
}

function CollectionFields({ language, draft, setDraft }: { language: AppLanguage; draft: CollectionDraft; setDraft: (draft: CollectionDraft) => void }) {
    const french = language === 'fr';
    return <div className="space-y-4"><Field label={french ? 'Titre' : 'Title'}><Input value={french ? draft.titleFr : draft.titleEn} onChange={(event) => setDraft({ ...draft, [french ? 'titleFr' : 'titleEn']: event.target.value })} /></Field><Field label={french ? 'Description' : 'Description'}><Textarea value={(french ? draft.descriptionFr : draft.descriptionEn) ?? ''} onChange={(event) => setDraft({ ...draft, [french ? 'descriptionFr' : 'descriptionEn']: event.target.value })} /></Field></div>;
}

function CollectionDialog({ open, onOpenChange, draft, setDraft, languages, setLanguages, save, saving }: { open: boolean; onOpenChange: (open: boolean) => void; draft: CollectionDraft; setDraft: (draft: CollectionDraft) => void; save: () => void; saving: boolean } & LanguageProps) {
    const { t } = useLanguage();
    const translations = languages.length === 2
        ? <Tabs defaultValue={languages[0]}><TabsList><TabsTrigger value="en">English</TabsTrigger><TabsTrigger value="fr">Français</TabsTrigger></TabsList><TabsContent value="en"><CollectionFields language="en" draft={draft} setDraft={setDraft} /></TabsContent><TabsContent value="fr"><CollectionFields language="fr" draft={draft} setDraft={setDraft} /></TabsContent></Tabs>
        : <CollectionFields language={languages[0]} draft={draft} setDraft={setDraft} />;
    const titleValid = languages.every((language) => (language === 'fr' ? draft.titleFr : draft.titleEn).trim().length >= 2);
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{draft.id ? t('Edit collection') : t('Add collection')}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label={t('Slug')}><Input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></Field><Field label={t('Order')}><Input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /></Field><div className="sm:col-span-2"><LanguageSelector languages={languages} setLanguages={setLanguages} /></div><div className="sm:col-span-2">{translations}</div><Field label="Icon"><Select value={draft.icon || 'book'} onValueChange={(icon) => setDraft({ ...draft, icon })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{HELP_ICON_KEYS.map((icon) => <SelectItem key={icon} value={icon}>{icon}</SelectItem>)}</SelectContent></Select></Field><div className="flex items-center justify-between rounded-md border p-3"><Label>{t('Published')}</Label><Switch checked={draft.isPublished} onCheckedChange={(isPublished) => setDraft({ ...draft, isPublished })} /></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button><Button onClick={save} disabled={saving || !draft.slug || !titleValid}>{t('Save')}</Button></DialogFooter></DialogContent></Dialog>;
}

function ArticleFields({ language, draft, setDraft }: { language: AppLanguage; draft: ArticleDraft; setDraft: (draft: ArticleDraft) => void }) {
    const french = language === 'fr';
    return <div className="space-y-4"><Field label={french ? 'Titre' : 'Title'}><Input value={french ? draft.titleFr : draft.titleEn} onChange={(event) => setDraft({ ...draft, [french ? 'titleFr' : 'titleEn']: event.target.value })} /></Field><Field label={french ? 'Résumé' : 'Summary'}><Textarea rows={2} value={(french ? draft.summaryFr : draft.summaryEn) ?? ''} onChange={(event) => setDraft({ ...draft, [french ? 'summaryFr' : 'summaryEn']: event.target.value })} /></Field><ContentEditor value={french ? draft.contentFr : draft.contentEn} onChange={(content) => setDraft({ ...draft, [french ? 'contentFr' : 'contentEn']: content })} /></div>;
}

function ArticleDialog({ open, onOpenChange, draft, setDraft, collections, languages, setLanguages, language, save, saving }: { open: boolean; onOpenChange: (open: boolean) => void; draft: ArticleDraft; setDraft: (draft: ArticleDraft) => void; collections: RawCollection[]; language: AppLanguage; save: () => void; saving: boolean } & LanguageProps) {
    const { t } = useLanguage();
    const translations = languages.length === 2
        ? <Tabs defaultValue={languages.includes(language) ? language : languages[0]}><TabsList><TabsTrigger value="en">English</TabsTrigger><TabsTrigger value="fr">Français</TabsTrigger></TabsList><TabsContent value="en"><ArticleFields language="en" draft={draft} setDraft={setDraft} /></TabsContent><TabsContent value="fr"><ArticleFields language="fr" draft={draft} setDraft={setDraft} /></TabsContent></Tabs>
        : <ArticleFields language={languages[0]} draft={draft} setDraft={setDraft} />;
    const translationsValid = languages.every((item) => (item === 'fr' ? draft.titleFr.trim().length >= 2 && draft.contentFr.trim().length >= 20 : draft.titleEn.trim().length >= 2 && draft.contentEn.trim().length >= 20));
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{draft.id ? t('Edit article') : t('Add article')}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-3"><Field label={t('Collections')}><Select value={draft.collectionId} onValueChange={(collectionId) => setDraft({ ...draft, collectionId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{collections.map((collection) => <SelectItem key={collection.id} value={collection.id}>{localizedHelpTitle(collection, language)}</SelectItem>)}</SelectContent></Select></Field><Field label={t('Slug')}><Input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></Field><Field label={t('Order')}><Input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /></Field></div><LanguageSelector languages={languages} setLanguages={setLanguages} />{translations}<div className="flex items-center justify-between rounded-md border p-3"><div><Label>{t('Published')}</Label><p className="text-xs text-muted-foreground">Draft articles are visible only to administrators.</p></div><Switch checked={draft.isPublished} onCheckedChange={(isPublished) => setDraft({ ...draft, isPublished })} /></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button><Button onClick={save} disabled={saving || !draft.collectionId || !draft.slug || !translationsValid}>{t('Save')}</Button></DialogFooter></DialogContent></Dialog>;
}

function ContentEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <div className="grid gap-4 lg:grid-cols-2"><Field label="Markdown content"><Textarea className="min-h-80 font-mono text-sm" value={value} onChange={(event) => onChange(event.target.value)} placeholder={'## Heading\n\nWrite clear guidance here.\n\n- First step\n- Second step'} /></Field><div className="min-h-80 rounded-lg border bg-card p-5"><p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>{value ? <MarkdownArticle content={value} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}</div></div>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return <div className={`space-y-2 ${wide ? 'sm:col-span-2' : ''}`}><Label>{label}</Label>{children}</div>;
}
