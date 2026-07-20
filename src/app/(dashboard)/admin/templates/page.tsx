'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatTicketValue, getTicketValueBadgeClass } from '@/lib/ticket-display';

function TemplateOptionBadge({ value }: { value: string }) {
    const badgeClass = getTicketValueBadgeClass(value);

    return (
        <Badge variant="outline" className={cn('text-xs', badgeClass)}>
            {formatTicketValue(value)}
        </Badge>
    );
}

export default function AdminTemplatesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [selectedQueue, setSelectedQueue] = useState('');
    const [fieldLabel, setFieldLabel] = useState('');
    const [fieldKey, setFieldKey] = useState('');
    const [fieldType, setFieldType] = useState('TEXT');
    const [fieldRequired, setFieldRequired] = useState(false);
    const [fieldOptions, setFieldOptions] = useState('');
    const [fieldVisibleTo, setFieldVisibleTo] = useState(['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN']);

    const { data: queues } = useQuery({
        queryKey: ['queues'],
        queryFn: async () => { const res = await fetch('/api/queues'); return res.json(); },
    });

    const { data: fields } = useQuery({
        queryKey: ['form-fields', selectedQueue],
        queryFn: async () => {
            if (!selectedQueue) return [];
            const res = await fetch(`/api/form-fields?queueId=${selectedQueue}`);
            return res.json();
        },
        enabled: !!selectedQueue,
    });

    const createField = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/form-fields', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    queueId: selectedQueue, label: fieldLabel, fieldKey,
                    type: fieldType, required: fieldRequired,
                    options: fieldOptions ? fieldOptions.split(',').map((o) => o.trim()) : null,
                    visibleTo: fieldVisibleTo,
                }),
            });
            if (!res.ok) throw new Error('Failed');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['form-fields', selectedQueue] });
            setOpen(false); setFieldLabel(''); setFieldKey(''); setFieldType('TEXT');
            setFieldRequired(false); setFieldOptions('');
            toast({ title: 'Custom field created' });
        },
    });

    const deleteField = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/form-fields?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['form-fields', selectedQueue] });
            toast({ title: 'Field deleted' });
        },
    });

    const toggleRole = (role: string) => {
        setFieldVisibleTo((prev) =>
            prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
        );
    };

    const fieldTypes = [
        { value: 'TEXT', label: 'Text' }, { value: 'TEXTAREA', label: 'Long Text' },
        { value: 'DROPDOWN', label: 'Dropdown' }, { value: 'MULTISELECT', label: 'Multi-Select' },
        { value: 'CHECKBOX', label: 'Checkbox' }, { value: 'DATE', label: 'Date' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Tag className="h-8 w-8 text-primary" /> Ticket Templates & Form Fields
                </h1>
                <p className="text-muted-foreground mt-1">Manage custom fields per department</p>
            </div>

            <Card className="border shadow-sm pt-4">
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                        <Select value={selectedQueue} onValueChange={setSelectedQueue}>
                            <SelectTrigger className="w-56 h-9"><SelectValue placeholder="Select department" /></SelectTrigger>
                            <SelectContent>
                                {(queues ?? []).map((q: any) => (
                                    <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedQueue && (
                            <Dialog open={open} onOpenChange={setOpen}>
                                <DialogTrigger asChild>
                                    <Button size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" /> Add Field</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader><DialogTitle>New Custom Field</DialogTitle></DialogHeader>
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div><Label>Label</Label><Input value={fieldLabel} onChange={(e) => { setFieldLabel(e.target.value); setFieldKey(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')); }} placeholder="e.g. Asset Tag" /></div>
                                            <div><Label>Key</Label><Input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="auto-generated" /></div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <Label>Type</Label>
                                                <Select value={fieldType} onValueChange={setFieldType}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {fieldTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="flex items-end gap-2 pb-1">
                                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                    <input type="checkbox" checked={fieldRequired} onChange={(e) => setFieldRequired(e.target.checked)} className="rounded" />
                                                    Required field
                                                </label>
                                            </div>
                                        </div>
                                        {(fieldType === 'DROPDOWN' || fieldType === 'MULTISELECT') && (
                                            <div><Label>Options (comma-separated)</Label><Input value={fieldOptions} onChange={(e) => setFieldOptions(e.target.value)} placeholder="Option 1, Option 2, Option 3" /></div>
                                        )}
                                        <div>
                                            <Label>Visible to roles</Label>
                                            <div className="flex gap-2 mt-1">
                                                {['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'].map((role) => (
                                                    <Badge key={role} variant={fieldVisibleTo.includes(role) ? 'default' : 'outline'}
                                                        className="cursor-pointer" onClick={() => toggleRole(role)}>
                                                        {role.replace('_', ' ')}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button onClick={() => createField.mutate()} disabled={!fieldLabel || !fieldKey}>Create Field</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        )}
                    </div>

                    {selectedQueue ? (
                        <div className="space-y-2">
                            {(fields ?? []).length === 0 ? (
                                <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg border-dashed">No custom fields for this department. Click "Add Field" to create one.</p>
                            ) : (
                                (fields ?? []).map((f: any) => (
                                    <Card key={f.id} className="border shadow-none">
                                        <CardContent className="p-3 flex items-center justify-between">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium">{f.label}</span>
                                                    <Badge variant="secondary" className="text-xs">{f.type}</Badge>
                                                    {f.required && <Badge variant="outline" className="text-xs text-red-600">Required</Badge>}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5">Key: {f.fieldKey} · Visible to: {f.visibleTo?.join(', ') || 'All'}</p>
                                                {Array.isArray(f.options) && f.options.length > 0 ? (
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {f.options.map((option: string) => (
                                                            <TemplateOptionBadge key={option} value={option} />
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => deleteField.mutate(f.id)}>Delete</Button>
                                        </CardContent>
                                    </Card>
                                ))
                            )}
                        </div>
                    ) : (
                        <div className="py-8 text-center border rounded-lg border-dashed">
                            <p className="text-sm text-muted-foreground">Select a department above to manage its custom forms</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
