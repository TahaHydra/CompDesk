'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { Tags, Plus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

export default function AdminCategoriesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');

    const [editOpen, setEditOpen] = useState(false);
    const [editId, setEditId] = useState('');
    const [editName, setEditName] = useState('');

    const { data: categories } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => { const res = await fetch('/api/categories'); return res.json(); },
    });

    const createCategory = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/categories', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            setOpen(false); setName('');
            toast({ title: 'Category created' });
        },
        onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' })
    });

    const updateCategory = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/categories', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editId, name: editName }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            setEditOpen(false); setEditId(''); setEditName('');
            toast({ title: 'Category updated' });
        },
        onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' })
    });

    const removeCategory = useMutation({
        mutationFn: async (id: string) => {
            if (!confirm('Are you sure you want to delete this category? Valid tickets using this category will safely have their category removed without being deleted.')) return Promise.reject(new Error('Cancelled'));
            const res = await fetch(`/api/categories?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            toast({ title: 'Category deleted' });
        },
        onError: (e) => {
            if (e.message !== 'Cancelled') toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    });

    const handleEditClick = (c: any) => {
        setEditId(c.id);
        setEditName(c.name);
        setEditOpen(true);
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Tags}
                title="Categories"
                description="Manage ticket categories globally"
            />

            <Card className="border shadow-sm pt-4">
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">All Categories</h2>
                        <Dialog open={open} onOpenChange={setOpen}>
                            <DialogTrigger asChild>
                                <Button size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" /> Add Category</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
                                <div className="space-y-2 py-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                                <DialogFooter><Button onClick={() => createCategory.mutate()} disabled={!name}>Create</Button></DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {(categories ?? []).map((c: any) => (
                            <Card key={c.id} className="border shadow-none">
                                <CardContent className="p-4 py-3 flex items-center justify-between gap-2">
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                                    <div className="flex shrink-0 gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleEditClick(c)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => removeCategory.mutate(c.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {(!categories || categories.length === 0) && (
                            <div className="col-span-full py-8 text-center border rounded-lg border-dashed">
                                <p className="text-sm text-muted-foreground">No categories yet</p>
                            </div>
                        )}
                    </div>

                    {/* Edit Dialog */}
                    <Dialog open={editOpen} onOpenChange={setEditOpen}>
                        <DialogContent>
                            <DialogHeader><DialogTitle>Edit Category</DialogTitle></DialogHeader>
                            <div className="space-y-2 py-2"><Label>Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
                            <DialogFooter><Button onClick={() => updateCategory.mutate()} disabled={!editName || editName === categories?.find((c: any) => c.id === editId)?.name}>Save changes</Button></DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardContent>
            </Card>
        </div>
    );
}
