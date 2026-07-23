'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { FolderKanban, Plus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

export default function AdminDepartmentsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');

    const [editOpen, setEditOpen] = useState(false);
    const [editId, setEditId] = useState('');
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');

    const { data: queues } = useQuery({
        queryKey: ['queues'],
        queryFn: async () => { const res = await fetch('/api/queues'); return res.json(); },
    });

    const createQueue = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/queues', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: desc }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['queues'] });
            setOpen(false); setName(''); setDesc('');
            toast({ title: 'Department created' });
        },
        onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' })
    });

    const updateQueue = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/queues', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editId, name: editName, description: editDesc }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['queues'] });
            setEditOpen(false); setEditId(''); setEditName(''); setEditDesc('');
            toast({ title: 'Department updated' });
        },
        onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' })
    });

    const removeQueue = useMutation({
        mutationFn: async (id: string) => {
            if (!confirm('Are you sure you want to delete this department? You cannot delete a department if it still has active tickets.')) return Promise.reject(new Error('Cancelled'));
            const res = await fetch(`/api/queues?id=${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['queues'] });
            toast({ title: 'Department deleted' });
        },
        onError: (e) => {
            if (e.message !== 'Cancelled') toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    });

    const handleEditClick = (q: any) => {
        setEditId(q.id);
        setEditName(q.name);
        setEditDesc(q.description || '');
        setEditOpen(true);
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={FolderKanban}
                title="Departments"
                description="Manage organizational departments and routing queues"
            />

            <Card className="border shadow-sm pt-4">
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">All Departments</h2>
                        <Dialog open={open} onOpenChange={setOpen}>
                            <DialogTrigger asChild>
                                <Button size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" /> Add Department</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader><DialogTitle>New Department</DialogTitle></DialogHeader>
                                <div className="space-y-4 pt-2">
                                    <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                                    <div><Label>Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
                                </div>
                                <DialogFooter>
                                    <Button onClick={() => createQueue.mutate()} disabled={!name}>Create</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(queues ?? []).map((q: any) => (
                            <Card key={q.id} className="border shadow-none">
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="truncate font-medium">{q.name}</h3>
                                            <p className="mt-1 truncate text-sm text-muted-foreground">{q.description || 'No description provided'}</p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <Badge variant="secondary" className="whitespace-nowrap">{q._count?.tickets ?? 0} tickets</Badge>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleEditClick(q)}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => removeQueue.mutate(q.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {(!queues || queues.length === 0) && (
                            <div className="col-span-full py-8 text-center border rounded-lg border-dashed">
                                <p className="text-sm text-muted-foreground">No departments exist yet.</p>
                            </div>
                        )}
                    </div>

                    {/* Edit Dialog */}
                    <Dialog open={editOpen} onOpenChange={setEditOpen}>
                        <DialogContent>
                            <DialogHeader><DialogTitle>Edit Department</DialogTitle></DialogHeader>
                            <div className="space-y-4 pt-2">
                                <div><Label>Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
                                <div><Label>Description</Label><Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} /></div>
                            </div>
                            <DialogFooter>
                                <Button onClick={() => updateQueue.mutate()} disabled={!editName || (editName === queues?.find((q: any) => q.id === editId)?.name && editDesc === (queues?.find((q: any) => q.id === editId)?.description || ''))}>Save changes</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardContent>
            </Card>
        </div>
    );
}
