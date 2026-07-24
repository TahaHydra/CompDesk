'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, FileText, Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { TemplateEditor } from '@/components/admin/template-editor';
import type { TicketFormTemplateDefinition } from '@/lib/ticket-form/types';

interface TemplateListItem extends TicketFormTemplateDefinition {
    updatedAt: string;
    usage: {
        departments: Array<{ id: string; name: string }>;
        categories: Array<{ id: string; name: string; queue: { name: string } }>;
        historicalTickets: number;
    };
}

export default function AdminTemplatesPage() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [editing, setEditing] = useState<TicketFormTemplateDefinition | null>(null);

    const templatesQuery = useQuery<TemplateListItem[]>({
        queryKey: ['ticket-form-templates', 'all'],
        queryFn: async () => {
            const response = await fetch('/api/ticket-form-templates?includeArchived=true');
            if (!response.ok) throw new Error('Failed to load ticket templates');
            return response.json();
        },
    });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['ticket-form-templates'] });
    const createTemplate = useMutation({
        mutationFn: async (input: { name: string; description?: string | null; sourceTemplateId?: string }) => {
            const response = await fetch('/api/ticket-form-templates', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to create template');
            return payload;
        },
        onSuccess: async (template) => {
            await refresh();
            setCreateOpen(false); setName(''); setDescription('');
            toast({ title: 'Template created' });
            setEditing(template);
        },
        onError: (error: Error) => toast({ title: 'Template could not be created', description: error.message, variant: 'destructive' }),
    });
    const lifecycle = useMutation({
        mutationFn: async ({ template, action }: { template: TemplateListItem; action: 'archive' | 'restore' | 'delete' }) => {
            const endpoint = action === 'restore'
                ? `/api/ticket-form-templates/${template.id}?action=restore`
                : `/api/ticket-form-templates/${template.id}?mode=${action === 'delete' ? 'hard' : 'archive'}`;
            const response = await fetch(endpoint, { method: action === 'restore' ? 'POST' : 'DELETE' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || `Failed to ${action} template`);
            return { action };
        },
        onSuccess: async ({ action }) => { await refresh(); toast({ title: `Template ${action === 'delete' ? 'deleted' : action === 'restore' ? 'restored' : 'archived'}` }); },
        onError: (error: Error) => toast({ title: 'Template action failed', description: error.message, variant: 'destructive' }),
    });

    const templates = templatesQuery.data ?? [];
    return (
        <div className="space-y-6">
            <PageHeader icon={FileText} title="Ticket Templates" description="Build reusable forms and assign them to departments or category overrides.">
                <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New template</Button>
            </PageHeader>

            {templatesQuery.isLoading ? <div className="rounded-lg border p-10 text-center text-muted-foreground">Loading templates…</div> : null}
            {templatesQuery.isError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">{templatesQuery.error.message}</div> : null}
            {!templatesQuery.isLoading && templates.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">No ticket templates are available yet.</div> : null}

            <div className="grid gap-4 lg:grid-cols-2">{templates.map((template) => {
                const assigned = template.usage.departments.length + template.usage.categories.length;
                const canHardDelete = !template.isSystemDefault && assigned === 0 && template.usage.historicalTickets === 0;
                return (
                    <Card key={template.id} className={template.isSystemDefault ? 'border-primary/40 shadow-sm' : 'shadow-sm'}>
                        <CardContent className="space-y-4 p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{template.name}</h2>{template.isSystemDefault ? <Badge className="gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Protected default</Badge> : null}<Badge variant={template.archivedAt ? 'destructive' : 'secondary'}>{template.archivedAt ? 'Archived' : 'Active'}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{template.description || 'No description'}</p></div>
                                <Badge variant="outline">v{template.version}</Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Fields</p><p className="font-medium">{template.fields.length}</p></div><div><p className="text-xs text-muted-foreground">Departments</p><p className="font-medium">{template.usage.departments.length}</p></div><div><p className="text-xs text-muted-foreground">Overrides</p><p className="font-medium">{template.usage.categories.length}</p></div><div><p className="text-xs text-muted-foreground">Historical tickets</p><p className="font-medium">{template.usage.historicalTickets}</p></div></div>
                            {assigned > 0 ? <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Assignments</p>{template.usage.departments.length ? <p>Departments: {template.usage.departments.map((item) => item.name).join(', ')}</p> : null}{template.usage.categories.length ? <p>Category overrides: {template.usage.categories.map((item) => `${item.queue.name} / ${item.name}`).join(', ')}</p> : null}</div> : null}
                            <p className="text-xs text-muted-foreground">Updated {new Date(template.updatedAt).toLocaleString()}</p>
                            <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" onClick={() => setEditing(template)}><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button>
                                <Button size="sm" variant="outline" onClick={() => createTemplate.mutate({ sourceTemplateId: template.id, name: `${template.name} Copy`, description: template.description })}><Copy className="mr-1 h-3.5 w-3.5" /> Duplicate</Button>
                                {!template.isSystemDefault && !template.archivedAt ? <Button size="sm" variant="outline" onClick={() => lifecycle.mutate({ template, action: 'archive' })}><Archive className="mr-1 h-3.5 w-3.5" /> Archive</Button> : null}
                                {template.archivedAt ? <Button size="sm" variant="outline" onClick={() => lifecycle.mutate({ template, action: 'restore' })}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore</Button> : null}
                                {canHardDelete ? <Button size="sm" variant="destructive" onClick={() => window.confirm('Permanently delete this unused template?') && lifecycle.mutate({ template, action: 'delete' })}><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete</Button> : null}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}</div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent><DialogHeader><DialogTitle>Create Ticket Template</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></div><div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></div><p className="text-sm text-muted-foreground">The new template will clone the current protected system default and can then be customized.</p></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={!name.trim() || createTemplate.isPending} onClick={() => createTemplate.mutate({ name, description: description || null })}>Create and edit</Button></DialogFooter></DialogContent>
            </Dialog>
            <TemplateEditor template={editing} open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }} onSaved={() => void refresh()} />
        </div>
    );
}