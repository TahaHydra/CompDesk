'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { DynamicTicketForm } from '@/components/ticket-form/dynamic-ticket-form';
import { copyTemplateFieldForEditing, createBlankTemplateField } from '@/lib/ticket-form/client-field-draft';
import type { ConditionalOperator, TicketFormFieldDefinition, TicketFormTemplateDefinition } from '@/lib/ticket-form/types';
import type { BuiltInTicketField, FormFieldType, Role } from '@prisma/client';

const FIELD_TYPES: Array<{ value: FormFieldType; label: string }> = [
    { value: 'TEXT', label: 'Single-line text' }, { value: 'TEXTAREA', label: 'Multiline text' },
    { value: 'DROPDOWN', label: 'Dropdown' }, { value: 'MULTISELECT', label: 'Multi-select' },
    { value: 'CHECKBOX', label: 'Checkbox' }, { value: 'DATE', label: 'Date' }, { value: 'FILE', label: 'File' },
];
const ROLES: Role[] = ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'];
const BUILT_INS: Array<{ value: BuiltInTicketField; key: string; label: string; type: FormFieldType }> = [
    { value: 'TITLE', key: 'title', label: 'Title', type: 'TEXT' },
    { value: 'DESCRIPTION', key: 'description', label: 'Description', type: 'TEXTAREA' },
    { value: 'PRIORITY', key: 'priority', label: 'Priority', type: 'DROPDOWN' },
    { value: 'SEVERITY', key: 'severity', label: 'Severity', type: 'DROPDOWN' },
    { value: 'ATTACHMENTS', key: 'attachments', label: 'Attachments', type: 'FILE' },
    { value: 'TAGS', key: 'tags', label: 'Tags', type: 'MULTISELECT' },
];

function roleButton(role: Role) { return role.replace('_', ' '); }

export function TemplateEditor({
    template,
    open,
    onOpenChange,
    onSaved,
}: {
    template: TicketFormTemplateDefinition | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}) {
    const { toast } = useToast();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [fields, setFields] = useState<TicketFormFieldDefinition[]>([]);
    const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
    const [draft, setDraft] = useState<TicketFormFieldDefinition | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [previewRole, setPreviewRole] = useState<Role>('USER');
    const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!template) return;
        setName(template.name);
        setDescription(template.description ?? '');
        setFields(template.fields.map((field) => ({ ...field, visibleTo: [...field.visibleTo], editableBy: [...field.editableBy] })));
        setPreviewValues({});
    }, [template]);

    const previewFields = useMemo(() => fields.filter((field) => field.isActive && field.visibleTo.includes(previewRole)), [fields, previewRole]);
    const availableDependencies = draft ? fields.filter((field) => field.id !== draft.id) : [];
    const updateDraft = (update: (current: TicketFormFieldDefinition) => TicketFormFieldDefinition) => {
        setDraft((current) => current ? update(current) : null);
    };

    const openNewField = () => {
        setEditingId(null);
        setDraft(createBlankTemplateField((fields.length + 1) * 10));
        setFieldDialogOpen(true);
    };
    const openEditField = (field: TicketFormFieldDefinition) => {
        setEditingId(field.id);
        setDraft(copyTemplateFieldForEditing(field));
        setFieldDialogOpen(true);
    };
    const chooseBuiltIn = (value: string) => {
        if (value === 'custom') {
            updateDraft((current) => ({ ...current, builtIn: null, fieldKey: '', label: '', type: 'TEXT', options: [] }));
            return;
        }
        const builtIn = BUILT_INS.find((candidate) => candidate.value === value);
        if (!builtIn) return;
        const options = builtIn.value === 'PRIORITY' ? ['LOW', 'NORMAL', 'HIGH', 'URGENT'] : builtIn.value === 'SEVERITY' ? ['S1', 'S2', 'S3', 'S4'] : [];
        updateDraft((current) => ({ ...current, builtIn: builtIn.value, fieldKey: builtIn.key, label: builtIn.label, type: builtIn.type, options }));
    };
    const toggleRole = (property: 'visibleTo' | 'editableBy', role: Role) => {
        updateDraft((current) => {
            const selected = current[property].includes(role);
            let next = selected ? current[property].filter((item) => item !== role) : [...current[property], role];
            if (next.length === 0) next = [role];
            const update: Partial<TicketFormFieldDefinition> = { [property]: next };
            if (property === 'visibleTo' && selected) update.editableBy = current.editableBy.filter((item) => item !== role);
            if (property === 'editableBy' && !selected && !current.visibleTo.includes(role)) update.visibleTo = [...current.visibleTo, role];
            return { ...current, ...update };
        });
    };
    const commitField = () => {
        if (!draft) return;
        if (!draft.label.trim() || !/^[a-z_][a-z0-9_]*$/.test(draft.fieldKey)) {
            toast({ title: 'Enter a valid label and snake_case field key', variant: 'destructive' });
            return;
        }
        if (fields.some((field) => field.id !== editingId && field.fieldKey === draft.fieldKey)) {
            toast({ title: 'Field keys must be unique', variant: 'destructive' });
            return;
        }
        const committed = {
            ...draft,
            options: draft.options.map((option) => option.trim()).filter(Boolean),
            validationRules: draft.validationRules ? {
                ...draft.validationRules,
                allowedFileTypes: draft.validationRules.allowedFileTypes?.map((type) => type.trim()).filter(Boolean),
            } : null,
        };
        setFields((current) => editingId ? current.map((field) => field.id === editingId ? committed : field) : [...current, committed]);
        setFieldDialogOpen(false);
        setDraft(null);
    };
    const moveField = (index: number, direction: -1 | 1) => {
        const destination = index + direction;
        if (destination < 0 || destination >= fields.length) return;
        setFields((current) => {
            const next = [...current];
            [next[index], next[destination]] = [next[destination], next[index]];
            return next.map((field, position) => ({ ...field, sortOrder: (position + 1) * 10 }));
        });
    };
    const save = async () => {
        if (!template || !name.trim() || fields.length === 0) return;
        setSaving(true);
        try {
            const response = await fetch(`/api/ticket-form-templates/${template.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: description || null, fields }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to save template');
            toast({ title: 'Template saved', description: `Version ${payload.version}` });
            onSaved();
            onOpenChange(false);
        } catch (error) {
            toast({ title: 'Template could not be saved', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
        } finally { setSaving(false); }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
                    <DialogHeader><DialogTitle>Edit Ticket Template</DialogTitle></DialogHeader>
                    {template ? <div className="space-y-6">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2"><Label htmlFor="template-name">Name</Label><Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
                            <div className="space-y-2"><Label htmlFor="template-description">Description</Label><Input id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Form Fields</h3><p className="text-sm text-muted-foreground">Routing controls are resolved before these fields and cannot be removed.</p></div><Button type="button" size="sm" onClick={openNewField}><Plus className="mr-1 h-4 w-4" /> Add field</Button></div>
                            <div className="space-y-2">{fields.map((field, index) => (
                                <div key={field.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{field.label}</span><Badge variant="secondary">{field.type}</Badge>{field.builtIn ? <Badge variant="outline">Built-in</Badge> : null}{field.required ? <Badge variant="outline">Required</Badge> : null}{!field.isActive ? <Badge variant="destructive">Hidden</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">{field.fieldKey} · {field.width}/12 columns · {field.visibleTo.map(roleButton).join(', ')}</p></div>
                                    <Button type="button" variant="ghost" size="icon" aria-label={`Move ${field.label} up`} disabled={index === 0} onClick={() => moveField(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                                    <Button type="button" variant="ghost" size="icon" aria-label={`Move ${field.label} down`} disabled={index === fields.length - 1} onClick={() => moveField(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                                    <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${field.label}`} onClick={() => openEditField(field)}><Pencil className="h-4 w-4" /></Button>
                                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${field.label}`} className="text-destructive" onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            ))}</div>
                        </div>
                        <div className="space-y-3 rounded-lg border p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><Eye className="h-4 w-4" /> Preview</h3><div className="flex flex-wrap gap-1">{ROLES.map((role) => <Button key={role} type="button" size="sm" variant={previewRole === role ? 'default' : 'outline'} onClick={() => { setPreviewRole(role); setPreviewValues({}); }}>{roleButton(role)}</Button>)}</div></div>
                            <DynamicTicketForm fields={previewFields} values={previewValues} role={previewRole} allowUploads={false} onChange={(key, value) => setPreviewValues((current) => ({ ...current, [key]: value }))} />
                        </div>
                    </div> : null}
                    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !name.trim() || fields.length === 0}><Save className="mr-1 h-4 w-4" /> {saving ? 'Saving…' : 'Save template'}</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {draft ? <Dialog open={fieldDialogOpen} onOpenChange={(nextOpen) => { setFieldDialogOpen(nextOpen); if (!nextOpen) setDraft(null); }}>
                <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                    <DialogHeader><DialogTitle>{editingId ? 'Edit form field' : 'Add form field'}</DialogTitle></DialogHeader>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2"><Label>Field kind</Label><Select value={draft.builtIn ?? 'custom'} onValueChange={chooseBuiltIn}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="custom">Custom field</SelectItem>{BUILT_INS.filter((item) => !fields.some((field) => field.id !== editingId && field.builtIn === item.value)).map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
                        <div className="space-y-2"><Label>Type</Label><Select value={draft.type} disabled={Boolean(draft.builtIn)} onValueChange={(value) => updateDraft((current) => ({ ...current, type: value as FormFieldType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{FIELD_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></div>
                        <div className="space-y-2"><Label>Label</Label><Input value={draft.label} onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value, fieldKey: current.builtIn ? current.fieldKey : event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^\d/, '_$&') }))} /></div>
                        <div className="space-y-2"><Label>Stable key</Label><Input value={draft.fieldKey} disabled={Boolean(draft.builtIn)} onChange={(event) => updateDraft((current) => ({ ...current, fieldKey: event.target.value }))} /></div>
                        <div className="space-y-2"><Label>Placeholder</Label><Input value={draft.placeholder ?? ''} onChange={(event) => updateDraft((current) => ({ ...current, placeholder: event.target.value || null }))} /></div>
                        <div className="space-y-2"><Label>Help text</Label><Input value={draft.helpText ?? ''} onChange={(event) => updateDraft((current) => ({ ...current, helpText: event.target.value || null }))} /></div>
                        <div className="space-y-2"><Label>Width</Label><Select value={String(draft.width)} onValueChange={(value) => updateDraft((current) => ({ ...current, width: Number(value) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[4,6,8,12].map((width) => <SelectItem key={width} value={String(width)}>{width}/12 columns</SelectItem>)}</SelectContent></Select></div>
                        <div className="flex items-center justify-between rounded-md border p-3"><Label>Required</Label><Switch checked={draft.required} onCheckedChange={(required) => updateDraft((current) => ({ ...current, required }))} /></div>
                        <div className="flex items-center justify-between rounded-md border p-3"><Label>Active / visible</Label><Switch checked={draft.isActive} onCheckedChange={(isActive) => updateDraft((current) => ({ ...current, isActive }))} /></div>
                        {(draft.type === 'DROPDOWN' || draft.type === 'MULTISELECT') && draft.builtIn !== 'TAGS' ? <div className="space-y-2 sm:col-span-2"><Label>Options (one per line)</Label><Textarea value={draft.options.join('\n')} onChange={(event) => updateDraft((current) => ({ ...current, options: event.target.value.split('\n') }))} /></div> : null}
                        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3"><div className="space-y-2"><Label>Minimum length</Label><Input type="number" min="0" value={draft.validationRules?.minLength ?? ''} onChange={(event) => updateDraft((current) => ({ ...current, validationRules: { ...current.validationRules, minLength: event.target.value ? Number(event.target.value) : undefined } }))} /></div><div className="space-y-2"><Label>Maximum length</Label><Input type="number" min="1" value={draft.validationRules?.maxLength ?? ''} onChange={(event) => updateDraft((current) => ({ ...current, validationRules: { ...current.validationRules, maxLength: event.target.value ? Number(event.target.value) : undefined } }))} /></div><div className="space-y-2"><Label>Regular expression</Label><Input value={draft.validationRules?.regex ?? ''} onChange={(event) => updateDraft((current) => ({ ...current, validationRules: { ...current.validationRules, regex: event.target.value || undefined } }))} /></div></div>
                        {draft.type === 'FILE' ? <div className="space-y-2 sm:col-span-2"><Label>Allowed MIME types (comma-separated)</Label><Input value={draft.validationRules?.allowedFileTypes?.join(',') ?? ''} onChange={(event) => updateDraft((current) => ({ ...current, validationRules: { ...current.validationRules, allowedFileTypes: event.target.value.split(',') } }))} /></div> : null}
                        <div className="space-y-2 sm:col-span-2"><Label>Conditional visibility</Label><div className="grid gap-2 sm:grid-cols-3"><Select value={draft.conditionalRules?.fieldKey ?? 'none'} onValueChange={(value) => updateDraft((current) => ({ ...current, conditionalRules: value === 'none' ? null : { fieldKey: value, operator: 'equals', value: '' } }))}><SelectTrigger><SelectValue placeholder="Always visible" /></SelectTrigger><SelectContent><SelectItem value="none">Always visible</SelectItem>{availableDependencies.map((field) => <SelectItem key={field.fieldKey} value={field.fieldKey}>{field.label}</SelectItem>)}</SelectContent></Select>{draft.conditionalRules ? <><Select value={draft.conditionalRules.operator ?? 'equals'} onValueChange={(operator) => updateDraft((current) => ({ ...current, conditionalRules: current.conditionalRules ? { ...current.conditionalRules, operator: operator as ConditionalOperator } : null }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="equals">Equals</SelectItem><SelectItem value="notEquals">Does not equal</SelectItem><SelectItem value="contains">Contains</SelectItem><SelectItem value="truthy">Is truthy</SelectItem></SelectContent></Select><Input disabled={draft.conditionalRules.operator === 'truthy'} value={typeof draft.conditionalRules.value === 'string' ? draft.conditionalRules.value : ''} onChange={(event) => updateDraft((current) => ({ ...current, conditionalRules: current.conditionalRules ? { ...current.conditionalRules, value: event.target.value } : null }))} /></> : null}</div></div>
                        <div className="space-y-2 sm:col-span-2"><Label>Visible to roles</Label><div className="flex flex-wrap gap-2">{ROLES.map((role) => <Button key={role} type="button" size="sm" variant={draft.visibleTo.includes(role) ? 'default' : 'outline'} onClick={() => toggleRole('visibleTo', role)}>{roleButton(role)}</Button>)}</div></div>
                        <div className="space-y-2 sm:col-span-2"><Label>Editable by roles</Label><div className="flex flex-wrap gap-2">{ROLES.map((role) => <Button key={role} type="button" size="sm" variant={draft.editableBy.includes(role) ? 'default' : 'outline'} onClick={() => toggleRole('editableBy', role)}>{roleButton(role)}</Button>)}</div></div>
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => { setFieldDialogOpen(false); setDraft(null); }}>Cancel</Button><Button onClick={commitField}>{editingId ? 'Apply changes' : 'Add field'}</Button></DialogFooter>
                </DialogContent>
            </Dialog> : null}
        </>
    );
}
