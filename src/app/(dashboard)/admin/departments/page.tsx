'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Pencil, Plus, Trash2, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';
import { useToast } from '@/components/ui/use-toast';

interface Template { id: string; name: string; isSystemDefault: boolean; archivedAt: string | null }
interface Administrator { id: string; name: string; email: string; role: string; isActive: boolean }
interface DepartmentMember { id: string; role: string; user: Administrator }
interface Department {
    id: string;
    name: string;
    description: string | null;
    isPublic: boolean;
    isActive: boolean;
    autoAssign: boolean;
    defaultTemplateId: string | null;
    defaultTemplate: { id: string; name: string } | null;
    members: DepartmentMember[];
    _count: { tickets: number; categories: number };
}

export default function AdminDepartmentsPage() {
    const { data: session } = useSession();
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN';
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Department | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [isActive, setIsActive] = useState(true);
    const [autoAssign, setAutoAssign] = useState(false);
    const [defaultTemplateId, setDefaultTemplateId] = useState('system');
    const [administratorIds, setAdministratorIds] = useState<string[]>([]);

    const departmentsQuery = useQuery<Department[]>({
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
    const administratorsQuery = useQuery<Administrator[]>({
        queryKey: ['users', 'department-administrators'],
        enabled: isSuperAdmin,
        queryFn: async () => {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to load administrators');
            const users = await response.json() as Administrator[];
            return users.filter((user) => user.role === 'ADMIN' && user.isActive);
        },
    });
    const systemTemplate = templatesQuery.data?.find((template) => template.isSystemDefault);

    const openCreate = () => {
        setEditing(null);
        setName('');
        setDescription('');
        setIsPublic(false);
        setIsActive(true);
        setAutoAssign(false);
        setDefaultTemplateId('system');
        setAdministratorIds([]);
        setDialogOpen(true);
    };
    const openEdit = (department: Department) => {
        setEditing(department);
        setName(department.name);
        setDescription(department.description ?? '');
        setIsPublic(department.isPublic);
        setIsActive(department.isActive);
        setAutoAssign(department.autoAssign);
        setDefaultTemplateId(department.defaultTemplateId ?? 'system');
        setAdministratorIds(department.members.map((member) => member.user.id));
        setDialogOpen(true);
    };

    const save = useMutation({
        mutationFn: async () => {
            const selectedTemplateId = defaultTemplateId === 'system' ? null : defaultTemplateId;
            const body = isSuperAdmin
                ? {
                    ...(editing ? { id: editing.id } : {}),
                    name,
                    description: description || undefined,
                    isPublic,
                    isActive,
                    autoAssign,
                    defaultTemplateId: selectedTemplateId,
                    ...(editing ? { administratorIds } : {}),
                }
                : { id: editing?.id, defaultTemplateId: selectedTemplateId };
            const response = await fetch('/api/queues', {
                method: editing ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to save department');
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['queues'] });
            setDialogOpen(false);
            toast({ title: isSuperAdmin ? (editing ? 'Department updated' : 'Department created') : 'Department template assigned' });
        },
        onError: (error: Error) => toast({ title: 'Department could not be saved', description: error.message, variant: 'destructive' }),
    });
    const remove = useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/queues?id=${id}`, { method: 'DELETE' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to delete department');
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['queues'] });
            toast({ title: 'Department deleted' });
        },
        onError: (error: Error) => toast({ title: 'Department could not be deleted', description: error.message, variant: 'destructive' }),
    });

    const toggleAdministrator = (userId: string, checked: boolean) => {
        setAdministratorIds((current) => checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId));
    };
    const departments = departmentsQuery.data ?? [];

    return (
        <div className="space-y-6">
            <PageHeader
                icon={FolderKanban}
                title="Departments"
                description={isSuperAdmin
                    ? 'Manage departments, their administrators, and default ticket templates.'
                    : 'Assign the default ticket form for departments you administer.'}
            >
                {isSuperAdmin ? <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> Add department</Button> : null}
            </PageHeader>

            {departments.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {isSuperAdmin ? 'No departments have been created.' : 'You are not assigned as an administrator of any department. Ask a super administrator to assign you.'}
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {departments.map((department) => (
                        <Card key={department.id}>
                            <CardContent className="space-y-4 p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="font-semibold">{department.name}</h2>
                                            <Badge variant={department.isActive ? 'secondary' : 'destructive'}>{department.isActive ? 'Active' : 'Inactive'}</Badge>
                                            {department.isPublic ? <Badge variant="outline">Public</Badge> : null}
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">{department.description || 'No description'}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div><p className="text-xs text-muted-foreground">Tickets</p><p className="font-medium">{department._count.tickets}</p></div>
                                    <div><p className="text-xs text-muted-foreground">Categories</p><p className="font-medium">{department._count.categories}</p></div>
                                </div>
                                <div className="rounded-md bg-muted/50 p-3 text-sm">
                                    <span className="text-muted-foreground">Default form: </span>
                                    <span className="font-medium">{department.defaultTemplate?.name ?? systemTemplate?.name ?? 'System default'}</span>
                                    <span className="text-xs text-muted-foreground"> · {department.defaultTemplateId ? 'Explicit' : 'System fallback'}</span>
                                </div>
                                {isSuperAdmin ? (
                                    <div className="text-xs text-muted-foreground">
                                        <UserCog className="mr-1 inline h-3.5 w-3.5" />
                                        {department.members.length
                                            ? department.members.map((member) => member.user.name).join(', ')
                                            : 'No department administrators assigned'}
                                    </div>
                                ) : null}
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openEdit(department)}>
                                        <Pencil className="mr-1 h-3.5 w-3.5" /> {isSuperAdmin ? 'Edit' : 'Assign template'}
                                    </Button>
                                    {isSuperAdmin && department._count.tickets === 0 && department._count.categories === 0 ? (
                                        <Button size="sm" variant="destructive" onClick={() => window.confirm('Permanently delete this empty department?') && remove.mutate(department.id)}>
                                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                                        </Button>
                                    ) : null}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{isSuperAdmin ? (editing ? 'Edit department' : 'Create department') : `Assign template · ${editing?.name ?? ''}`}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        {isSuperAdmin ? (
                            <>
                                <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
                                <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></div>
                            </>
                        ) : null}
                        <div className="space-y-2">
                            <Label>Default ticket form</Label>
                            <Select value={defaultTemplateId} onValueChange={setDefaultTemplateId}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="system">System default (fallback)</SelectItem>
                                    {(templatesQuery.data ?? []).filter((template) => !template.isSystemDefault && !template.archivedAt).map((template) => (
                                        <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {isSuperAdmin ? (
                            <>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="flex items-center justify-between rounded-md border p-3"><Label>Active</Label><Switch checked={isActive} onCheckedChange={setIsActive} /></div>
                                    <div className="flex items-center justify-between rounded-md border p-3"><Label>Public</Label><Switch checked={isPublic} onCheckedChange={setIsPublic} /></div>
                                    <div className="flex items-center justify-between rounded-md border p-3"><Label>Auto-assign</Label><Switch checked={autoAssign} onCheckedChange={setAutoAssign} /></div>
                                </div>
                                {editing ? (
                                    <div className="space-y-2">
                                        <Label>Department administrators</Label>
                                        <p className="text-xs text-muted-foreground">These ADMIN users can assign this department and its categories to any active ticket template.</p>
                                        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                                            {(administratorsQuery.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No active ADMIN users are available.</p> : null}
                                            {(administratorsQuery.data ?? []).map((administrator) => (
                                                <label key={administrator.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted">
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-border accent-primary"
                                                        checked={administratorIds.includes(administrator.id)}
                                                        onChange={(event) => toggleAdministrator(administrator.id, event.target.checked)}
                                                    />
                                                    <span><span className="block text-sm font-medium">{administrator.name}</span><span className="block text-xs text-muted-foreground">{administrator.email}</span></span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={() => save.mutate()} disabled={(isSuperAdmin && !name.trim()) || !editing && !isSuperAdmin || save.isPending}>
                            {isSuperAdmin ? 'Save department' : 'Assign template'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}