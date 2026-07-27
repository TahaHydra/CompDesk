'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FileText, Pencil, Plus, RotateCcw, Tags, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';

interface Queue { id: string; name: string; defaultTemplateId: string | null; defaultTemplate?: { id: string; name: string } | null }
interface Template { id: string; name: string; isSystemDefault: boolean; archivedAt: string | null }
interface Category {
    id: string;
    queueId: string;
    templateId: string | null;
    name: string;
    description: string | null;
    isActive: boolean;
    archivedAt: string | null;
    queue: Queue;
    template: { id: string; name: string } | null;
    _count: { tickets: number };
}

export default function AdminCategoriesPage() {
    const { data: session } = useSession();
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN';
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [filterQueueId, setFilterQueueId] = useState('all');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Category | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [queueId, setQueueId] = useState('');
    const [templateId, setTemplateId] = useState('inherit');
    const [isActive, setIsActive] = useState(true);

    const categoriesQuery = useQuery<Category[]>({
        queryKey: ['categories', 'admin'],
        queryFn: async () => {
            const response = await fetch('/api/categories?includeInactive=true');
            if (!response.ok) throw new Error('Failed to load categories');
            return response.json();
        },
    });
    const queuesQuery = useQuery<Queue[]>({
        queryKey: ['queues', 'admin'],
        queryFn: async () => {
            const response = await fetch('/api/queues?includeInactive=true');
            if (!response.ok) throw new Error('Failed to load departments');
            return response.json();
        },
    });
    const templatesQuery = useQuery<Template[]>({
        queryKey: ['ticket-form-templates', 'active'],
        queryFn: async () => {
            const response = await fetch('/api/ticket-form-templates');
            if (!response.ok) throw new Error('Failed to load templates');
            return response.json();
        },
    });
    const systemTemplate = templatesQuery.data?.find((template) => template.isSystemDefault);

    const groups = useMemo(() => {
        const categories = (categoriesQuery.data ?? []).filter((category) => filterQueueId === 'all' || category.queueId === filterQueueId);
        return (queuesQuery.data ?? [])
            .filter((queue) => filterQueueId === 'all' || queue.id === filterQueueId)
            .map((queue) => ({ queue, categories: categories.filter((category) => category.queueId === queue.id) }));
    }, [categoriesQuery.data, queuesQuery.data, filterQueueId]);

    const openCreate = () => {
        setEditing(null);
        setName('');
        setDescription('');
        setQueueId(filterQueueId === 'all' ? (queuesQuery.data?.[0]?.id ?? '') : filterQueueId);
        setTemplateId('inherit');
        setIsActive(true);
        setDialogOpen(true);
    };
    const openEdit = (category: Category) => {
        setEditing(category);
        setName(category.name);
        setDescription(category.description ?? '');
        setQueueId(category.queueId);
        setTemplateId(category.templateId ?? 'inherit');
        setIsActive(category.isActive);
        setDialogOpen(true);
    };
    const saveMutation = useMutation({
        mutationFn: async () => {
            const selectedTemplateId = templateId === 'inherit' ? null : templateId;
            const body = isSuperAdmin
                ? {
                    ...(editing ? { id: editing.id } : {}),
                    name,
                    description: description || undefined,
                    queueId,
                    templateId: selectedTemplateId,
                    isActive,
                }
                : { id: editing?.id, templateId: selectedTemplateId };
            const response = await fetch('/api/categories', {
                method: editing ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to save category');
            return payload;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['categories'] });
            setDialogOpen(false);
            toast({ title: isSuperAdmin ? (editing ? 'Category updated' : 'Category created') : 'Category template assigned' });
        },
        onError: (error: Error) => toast({ title: 'Category could not be saved', description: error.message, variant: 'destructive' }),
    });
    const removeMutation = useMutation({
        mutationFn: async ({ category, mode }: { category: Category; mode: 'archive' | 'hard' }) => {
            const response = await fetch(`/api/categories?id=${category.id}&mode=${mode}`, { method: 'DELETE' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to remove category');
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['categories'] });
            toast({ title: 'Category updated' });
        },
        onError: (error: Error) => toast({ title: 'Category action failed', description: error.message, variant: 'destructive' }),
    });
    const restore = (category: Category) => {
        openEdit(category);
        setIsActive(true);
    };
    const queues = queuesQuery.data ?? [];

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Tags}
                title="Categories"
                description={isSuperAdmin
                    ? 'Manage department-owned categories and optional ticket-form overrides.'
                    : 'Assign ticket-form overrides to categories in departments you administer.'}
            >
                {isSuperAdmin ? <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> Add category</Button> : null}
            </PageHeader>

            {queues.length ? (
                <div className="max-w-sm space-y-2">
                    <Label>Filter by department</Label>
                    <Select value={filterQueueId} onValueChange={setFilterQueueId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All departments</SelectItem>
                            {queues.map((queue) => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            ) : null}

            {groups.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {isSuperAdmin ? 'No departments or categories are available.' : 'You are not assigned as an administrator of any department.'}
                </div>
            ) : groups.map(({ queue, categories }) => (
                <section key={queue.id} className="space-y-3">
                    <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{queue.name}</h2><Badge variant="secondary">{categories.length} categories</Badge></div>
                    {categories.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No categories in this department.</div>
                    ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                            {categories.map((category) => {
                                const effectiveTemplate = category.template?.name ?? queue.defaultTemplate?.name ?? systemTemplate?.name ?? 'System default';
                                return (
                                    <Card key={category.id}>
                                        <CardContent className="space-y-3 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="font-medium">{category.name}</h3>
                                                        <Badge variant={category.isActive ? 'secondary' : 'destructive'}>{category.isActive ? 'Active' : 'Archived'}</Badge>
                                                    </div>
                                                    <p className="mt-1 text-sm text-muted-foreground">{category.description || 'No description'}</p>
                                                </div>
                                                <Badge variant="outline">{category._count.tickets} tickets</Badge>
                                            </div>
                                            <div className="rounded-md bg-muted/50 p-2 text-xs">
                                                <span className="text-muted-foreground">Effective template: </span>
                                                <span className="font-medium">{effectiveTemplate}</span>
                                                <span className="text-muted-foreground"> · {category.templateId ? 'Override' : 'Inherited'}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button size="sm" variant="outline" onClick={() => openEdit(category)}>
                                                    {isSuperAdmin ? <Pencil className="mr-1 h-3.5 w-3.5" /> : <FileText className="mr-1 h-3.5 w-3.5" />}
                                                    {isSuperAdmin ? 'Edit' : 'Assign template'}
                                                </Button>
                                                {isSuperAdmin ? (
                                                    <>
                                                        {category.isActive ? (
                                                            <Button size="sm" variant="outline" onClick={() => removeMutation.mutate({ category, mode: 'archive' })}><Archive className="mr-1 h-3.5 w-3.5" /> Archive</Button>
                                                        ) : (
                                                            <Button size="sm" variant="outline" onClick={() => restore(category)}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore</Button>
                                                        )}
                                                        {category._count.tickets === 0 ? (
                                                            <ConfirmDestructiveAction title="Delete category?" description={<>The unused category <strong>{category.name}</strong> will be permanently deleted.</>} pending={removeMutation.isPending} onConfirm={() => removeMutation.mutate({ category, mode: 'hard' })} trigger={<Button size="sm" variant="destructive"><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete</Button>} />
                                                        ) : null}
                                                    </>
                                                ) : null}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </section>
            ))}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{isSuperAdmin ? (editing ? 'Edit category' : 'Create category') : `Assign template · ${editing?.name ?? ''}`}</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        {isSuperAdmin ? (
                            <>
                                <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
                                <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></div>
                                <div className="space-y-2">
                                    <Label>Owning department</Label>
                                    <Select value={queueId} onValueChange={setQueueId}>
                                        <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                                        <SelectContent>{queues.map((queue) => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                    {editing && editing._count.tickets > 0 && queueId !== editing.queueId ? <p className="text-xs text-destructive">Categories with historical tickets cannot be moved.</p> : null}
                                </div>
                            </>
                        ) : null}
                        <div className="space-y-2">
                            <Label>Template assignment</Label>
                            <Select value={templateId} onValueChange={setTemplateId}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="inherit">Inherit department template</SelectItem>
                                    {(templatesQuery.data ?? []).filter((template) => !template.archivedAt).map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        {isSuperAdmin ? (
                            <div className="flex items-center justify-between rounded-md border p-3">
                                <div><Label>Active</Label><p className="text-xs text-muted-foreground">Archived categories remain on historical tickets.</p></div>
                                <Switch checked={isActive} onCheckedChange={setIsActive} />
                            </div>
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={() => saveMutation.mutate()} disabled={(isSuperAdmin && (!name.trim() || !queueId)) || !editing && !isSuperAdmin || saveMutation.isPending}>
                            {isSuperAdmin ? 'Save category' : 'Assign template'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
