'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Lock, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { useLanguage } from '@/components/providers/language-provider';
import { DEFAULT_TAG_COLOR, TagChip } from '@/components/tags/tag-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { describeTagScope, normalizeTagScopes, type NamedTagScope, type TagScopeRule } from '@/lib/tag-scope';
import { cn } from '@/lib/utils';

interface ManagedTag { id: string; name: string; color: string; allDepartments: boolean; scopes: NamedTagScope[]; ticketCount: number; canManage: boolean }
interface Department { id: string; name: string; isActive?: boolean }
interface CategoryOption { id: string; name: string; queueId: string }
interface Draft { id?: string; name: string; color: string; allDepartments: boolean; scopes: TagScopeRule[] }

const SWATCHES = ['#6366f1', '#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#475569'];

async function json<T>(response: Response, fallback: string): Promise<T> {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || fallback);
    return payload as T;
}

export default function AdminTagsPage() {
    const { t } = useLanguage();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: session } = useSession();
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN';
    const [filterQueueId, setFilterQueueId] = useState('all');
    const [draft, setDraft] = useState<Draft | null>(null);

    const tagsQuery = useQuery<ManagedTag[]>({ queryKey: ['tags', 'manage'], queryFn: async () => json(await fetch('/api/tags?manage=true'), 'Failed to load tags') });
    const departmentsQuery = useQuery<Department[]>({ queryKey: ['queues', 'tag-admin'], queryFn: async () => json(await fetch('/api/queues'), 'Failed to load departments') });
    const categoriesQuery = useQuery<CategoryOption[]>({ queryKey: ['categories', 'tag-admin'], queryFn: async () => json(await fetch('/api/categories'), 'Failed to load categories') });
    const departments = departmentsQuery.data ?? [];
    const categories = categoriesQuery.data ?? [];

    const visibleTags = useMemo(() => (tagsQuery.data ?? []).filter((tag) => filterQueueId === 'all'
        || tag.allDepartments || tag.scopes.some((scope) => scope.queueId === filterQueueId)), [filterQueueId, tagsQuery.data]);

    const refresh = () => { for (const queryKey of [['tags'], ['tickets'], ['ticket']]) void queryClient.invalidateQueries({ queryKey }); };
    const save = useMutation({
        mutationFn: async (value: Draft) => {
            const body = { name: value.name.trim(), color: value.color, allDepartments: value.allDepartments, scopes: value.allDepartments ? [] : normalizeTagScopes(value.scopes) };
            return json(await fetch('/api/tags', { method: value.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value.id ? { id: value.id, ...body } : body) }), 'Tag could not be saved');
        },
        onSuccess: (_result, value) => { refresh(); setDraft(null); toast({ title: t(value.id ? 'Tag updated' : 'Tag created') }); },
        onError: (error: Error) => toast({ title: t('Tag could not be saved'), description: error.message, variant: 'destructive' }),
    });
    const remove = useMutation({
        mutationFn: async (id: string) => json<{ removedFromTickets: number }>(await fetch(`/api/tags?id=${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Tag could not be deleted'),
        onSuccess: () => { refresh(); toast({ title: t('Tag deleted') }); },
        onError: (error: Error) => toast({ title: t('Tag could not be deleted'), description: error.message, variant: 'destructive' }),
    });

    const openNew = () => setDraft({
        name: '', color: DEFAULT_TAG_COLOR,
        // Department Admins can only create limited tags; start them in the department they are filtering.
        allDepartments: isSuperAdmin,
        scopes: !isSuperAdmin && filterQueueId !== 'all' ? [{ queueId: filterQueueId, categoryId: null }] : [],
    });

    return (
        <div className="space-y-6">
            <PageHeader icon={Tag} title={t('Tags')} description={t('Labels agents add to tickets for triage and reporting. Limit a tag to the departments and categories where it makes sense.')} />
            <Card className="border shadow-sm pt-4">
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="w-full max-w-xs space-y-1.5">
                            <Label htmlFor="tag-department-filter" className="text-xs text-muted-foreground">{t('Filter by department')}</Label>
                            <Select value={filterQueueId} onValueChange={setFilterQueueId}>
                                <SelectTrigger id="tag-department-filter"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('All departments')}</SelectItem>
                                    {departments.map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button size="sm" className="gap-1" onClick={openNew} disabled={!isSuperAdmin && departments.length === 0}><Plus className="h-3.5 w-3.5" /> {t('Add Tag')}</Button>
                    </div>

                    {tagsQuery.isError ? <p role="alert" className="text-sm text-destructive">{t('Tags could not be loaded')}</p> : null}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {visibleTags.map((tag) => (
                            <Card key={tag.id} className="border shadow-none">
                                <CardContent className="flex items-start justify-between gap-3 p-4 py-3">
                                    <div className="min-w-0 space-y-1.5">
                                        <TagChip tag={tag} />
                                        <p className={cn('text-xs', !tag.allDepartments && tag.scopes.length === 0 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{t(describeTagScope(tag))}</p>
                                        <p className="text-[11px] text-muted-foreground">{tag.ticketCount === 1 ? t('Used on 1 ticket') : t('Used on {count} tickets', { count: tag.ticketCount })}</p>
                                    </div>
                                    {tag.canManage ? (
                                        <div className="flex shrink-0 gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={t('Edit {name}', { name: tag.name })}
                                                onClick={() => setDraft({ id: tag.id, name: tag.name, color: tag.color, allDepartments: tag.allDepartments, scopes: tag.scopes.map(({ queueId, categoryId }) => ({ queueId, categoryId })) })}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <ConfirmDestructiveAction
                                                title={t('Delete tag?')}
                                                description={tag.ticketCount > 1
                                                    ? t('The tag {name} will be removed from the {count} tickets that use it.', { name: tag.name, count: tag.ticketCount })
                                                    : tag.ticketCount === 1
                                                        ? t('The tag {name} will be removed from the ticket that uses it.', { name: tag.name })
                                                        : t('The tag {name} is not used on any ticket.', { name: tag.name })}
                                                pending={remove.isPending}
                                                onConfirm={() => remove.mutate(tag.id)}
                                                trigger={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t('Delete {name}', { name: tag.name })}><Trash2 className="h-4 w-4" /></Button>}
                                            />
                                        </div>
                                    ) : (
                                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={t('Also used outside your departments; a Super Admin manages it.')}><Lock className="h-3 w-3" />{t('Read only')}</span>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                        {tagsQuery.isSuccess && visibleTags.length === 0 ? (
                            <div className="col-span-full rounded-lg border border-dashed py-8 text-center"><p className="text-sm text-muted-foreground">{t(filterQueueId === 'all' ? 'No tags yet' : 'No tags are available in this department')}</p></div>
                        ) : null}
                    </div>
                </CardContent>
            </Card>

            <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
                {draft ? (
                    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>{t(draft.id ? 'Edit Tag' : 'New Tag')}</DialogTitle>
                            <DialogDescription>{t('Narrowing where a tag is available never removes it from tickets that already have it.')}</DialogDescription>
                        </DialogHeader>
                        <TagEditor draft={draft} onChange={setDraft} departments={departments} categories={categories} isSuperAdmin={isSuperAdmin} />
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDraft(null)}>{t('Cancel')}</Button>
                            <Button onClick={() => save.mutate(draft)} disabled={!draft.name.trim() || save.isPending || (!draft.allDepartments && draft.scopes.length === 0)}>{t(draft.id ? 'Save changes' : 'Create')}</Button>
                        </DialogFooter>
                    </DialogContent>
                ) : null}
            </Dialog>
        </div>
    );
}

function TagEditor({ draft, onChange, departments, categories, isSuperAdmin }: {
    draft: Draft;
    onChange: (draft: Draft) => void;
    departments: Department[];
    categories: CategoryOption[];
    isSuperAdmin: boolean;
}) {
    const { t } = useLanguage();
    const update = (changes: Partial<Draft>) => onChange({ ...draft, ...changes });
    const scopesFor = (queueId: string) => draft.scopes.filter((scope) => scope.queueId === queueId);
    const setDepartment = (queueId: string, included: boolean) => update({
        scopes: included ? [...draft.scopes.filter((scope) => scope.queueId !== queueId), { queueId, categoryId: null }] : draft.scopes.filter((scope) => scope.queueId !== queueId),
    });
    const setCategoryMode = (queueId: string, wholeDepartment: boolean) => {
        const first = categories.find((category) => category.queueId === queueId);
        update({ scopes: [...draft.scopes.filter((scope) => scope.queueId !== queueId), { queueId, categoryId: wholeDepartment || !first ? null : first.id }] });
    };
    const toggleCategory = (queueId: string, categoryId: string) => {
        const current = scopesFor(queueId).flatMap((scope) => scope.categoryId ? [scope.categoryId] : []);
        const next = current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId];
        // Unchecking the last category keeps the department instead of silently dropping it.
        update({ scopes: [...draft.scopes.filter((scope) => scope.queueId !== queueId), ...(next.length ? next.map((id) => ({ queueId, categoryId: id })) : [{ queueId, categoryId: null }])] });
    };
    // Scopes in departments missing from the list (archived, or outside an Admin's view) are kept untouched.
    const listedIds = new Set(departments.map((department) => department.id));
    const unlistedScopes = draft.scopes.filter((scope) => !listedIds.has(scope.queueId));

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="tag-name">{t('Name')}</Label>
                <Input id="tag-name" value={draft.name} maxLength={50} onChange={(event) => update({ name: event.target.value })} placeholder={t('e.g. vpn')} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="tag-color">{t('Color')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                    {SWATCHES.map((swatch) => (
                        <button key={swatch} type="button" aria-label={swatch} aria-pressed={draft.color.toLowerCase() === swatch}
                            className={cn('h-6 w-6 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', draft.color.toLowerCase() === swatch ? 'border-foreground' : 'border-transparent')}
                            style={{ backgroundColor: swatch }} onClick={() => update({ color: swatch })} />
                    ))}
                    <Input id="tag-color" type="color" value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : DEFAULT_TAG_COLOR} onChange={(event) => update({ color: event.target.value })} className="h-8 w-12 p-1" aria-label={t('Custom color')} />
                    <TagChip tag={{ id: 'preview', name: draft.name.trim() || t('Preview'), color: draft.color }} />
                </div>
            </div>

            <fieldset className="space-y-3">
                <legend className="text-sm font-medium">{t('Available in')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm', draft.allDepartments && 'border-primary bg-primary/5', !isSuperAdmin && 'cursor-not-allowed opacity-60')}>
                        <input type="radio" name="tag-availability" className="mt-0.5" checked={draft.allDepartments} disabled={!isSuperAdmin} onChange={() => update({ allDepartments: true })} />
                        <span><span className="block font-medium">{t('All departments')}</span><span className="text-xs text-muted-foreground">{t(isSuperAdmin ? 'Offered on every ticket.' : 'Only a Super Admin can share a tag with every department.')}</span></span>
                    </label>
                    <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm', !draft.allDepartments && 'border-primary bg-primary/5')}>
                        <input type="radio" name="tag-availability" className="mt-0.5" checked={!draft.allDepartments} onChange={() => update({ allDepartments: false })} />
                        <span><span className="block font-medium">{t('Selected departments')}</span><span className="text-xs text-muted-foreground">{t('Optionally only some of their categories.')}</span></span>
                    </label>
                </div>

                {!draft.allDepartments ? (
                    <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-2">
                        {departments.length === 0 ? <p className="p-2 text-xs text-muted-foreground">{t('No departments available')}</p> : departments.map((department) => {
                            const departmentScopes = scopesFor(department.id);
                            const included = departmentScopes.length > 0;
                            const wholeDepartment = departmentScopes.some((scope) => scope.categoryId === null);
                            const departmentCategories = categories.filter((category) => category.queueId === department.id);
                            return (
                                <div key={department.id} className={cn('rounded-md p-2', included && 'bg-muted/40')}>
                                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                                        <input type="checkbox" checked={included} onChange={(event) => setDepartment(department.id, event.target.checked)} />
                                        {department.name}
                                    </label>
                                    {included && departmentCategories.length > 0 ? (
                                        <div className="ml-6 mt-2 space-y-2">
                                            <Select value={wholeDepartment ? 'all' : 'some'} onValueChange={(value) => setCategoryMode(department.id, value === 'all')}>
                                                <SelectTrigger className="h-8 text-xs" aria-label={t('Categories in {department}', { department: department.name })}><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">{t('All categories')}</SelectItem>
                                                    <SelectItem value="some">{t('Only selected categories')}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {!wholeDepartment ? (
                                                <div className="grid gap-1 sm:grid-cols-2">
                                                    {departmentCategories.map((category) => (
                                                        <label key={category.id} className="flex cursor-pointer items-center gap-2 text-xs">
                                                            <input type="checkbox" checked={departmentScopes.some((scope) => scope.categoryId === category.id)} onChange={() => toggleCategory(department.id, category.id)} />
                                                            <span className="truncate">{category.name}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                        {unlistedScopes.length > 0 ? <p className="px-2 text-[11px] text-muted-foreground">{t('Also kept in {count} department(s) not listed here.', { count: new Set(unlistedScopes.map((scope) => scope.queueId)).size })}</p> : null}
                    </div>
                ) : null}
                {!draft.allDepartments && draft.scopes.length === 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('Choose at least one department.')}</p> : null}
            </fieldset>
        </div>
    );
}
