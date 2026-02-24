'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Tag, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

const DEFAULT_TAG_COLOR = '#6366f1';

export default function AdminTagsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [color, setColor] = useState(DEFAULT_TAG_COLOR);

    const [editOpen, setEditOpen] = useState(false);
    const [editId, setEditId] = useState('');
    const [editName, setEditName] = useState('');
    const [editColor, setEditColor] = useState(DEFAULT_TAG_COLOR);

    const { data: tags } = useQuery({
        queryKey: ['tags'],
        queryFn: async () => {
            const res = await fetch('/api/tags');
            if (!res.ok) throw new Error('Failed to load tags');
            return res.json();
        },
    });

    const createTag = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            setOpen(false);
            setName('');
            setColor(DEFAULT_TAG_COLOR);
            toast({ title: 'Tag created' });
        },
        onError: (error: Error) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const updateTag = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/tags', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editId, name: editName, color: editColor }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            setEditOpen(false);
            setEditId('');
            setEditName('');
            setEditColor(DEFAULT_TAG_COLOR);
            toast({ title: 'Tag updated' });
        },
        onError: (error: Error) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const removeTag = useMutation({
        mutationFn: async (id: string) => {
            if (!confirm('Delete this tag? It will be removed from existing tickets.')) {
                throw new Error('Cancelled');
            }
            const res = await fetch(`/api/tags?id=${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            toast({ title: 'Tag deleted' });
        },
        onError: (error: Error) => {
            if (error.message === 'Cancelled') return;
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Tag className="h-8 w-8 text-primary" /> Tags
                </h1>
                <p className="text-muted-foreground mt-1">Manage reusable ticket tags</p>
            </div>

            <Card className="border shadow-sm pt-4">
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">All Tags</h2>
                        <Dialog open={open} onOpenChange={setOpen}>
                            <DialogTrigger asChild>
                                <Button size="sm" className="gap-1">
                                    <Plus className="h-3.5 w-3.5" /> Add Tag
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>New Tag</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 pt-2">
                                    <div className="space-y-2">
                                        <Label>Name</Label>
                                        <Input
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="e.g. vpn"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Color</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="color"
                                                value={color}
                                                onChange={(e) => setColor(e.target.value)}
                                                className="h-10 w-14 p-1"
                                            />
                                            <Input value={color} onChange={(e) => setColor(e.target.value)} />
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button
                                        onClick={() => createTag.mutate()}
                                        disabled={!name.trim() || createTag.isPending}
                                    >
                                        Create
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {(tags ?? []).map((tag: any) => (
                            <Card key={tag.id} className="border shadow-none">
                                <CardContent className="p-4 py-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span
                                            className="h-3 w-3 rounded-full shrink-0"
                                            style={{ backgroundColor: tag.color }}
                                        />
                                        <div className="min-w-0">
                                            <p className="font-medium text-sm truncate">{tag.name}</p>
                                            <p className="text-xs text-muted-foreground">{tag.color}</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            onClick={() => {
                                                setEditId(tag.id);
                                                setEditName(tag.name);
                                                setEditColor(tag.color || DEFAULT_TAG_COLOR);
                                                setEditOpen(true);
                                            }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => removeTag.mutate(tag.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {(!tags || tags.length === 0) && (
                            <div className="col-span-full py-8 text-center border rounded-lg border-dashed">
                                <p className="text-sm text-muted-foreground">No tags yet</p>
                            </div>
                        )}
                    </div>

                    <Dialog open={editOpen} onOpenChange={setEditOpen}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Edit Tag</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <Label>Name</Label>
                                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Color</Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="color"
                                            value={editColor}
                                            onChange={(e) => setEditColor(e.target.value)}
                                            className="h-10 w-14 p-1"
                                        />
                                        <Input
                                            value={editColor}
                                            onChange={(e) => setEditColor(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    onClick={() => updateTag.mutate()}
                                    disabled={!editName.trim() || updateTag.isPending}
                                >
                                    Save changes
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardContent>
            </Card>
        </div>
    );
}

