'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { isFieldConditionVisible } from '@/lib/ticket-form/conditions';
import type { TicketFormFieldDefinition, UploadedFieldFile } from '@/lib/ticket-form/types';

interface TagOption { id: string; name: string; color?: string }

const WIDTH_CLASSES: Record<number, string> = {
    1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4',
    5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8',
    9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12',
};

function fieldOptions(field: TicketFormFieldDefinition, tags: TagOption[]) {
    return field.builtIn === 'TAGS'
        ? tags.map((tag) => ({ value: tag.id, label: tag.name, color: tag.color }))
        : field.options.map((option) => ({ value: option, label: option }));
}

function fileList(value: unknown): UploadedFieldFile[] {
    return Array.isArray(value)
        ? value.filter((item): item is UploadedFieldFile => Boolean(item && typeof item === 'object' && 'url' in item))
        : [];
}

export function DynamicTicketForm({
    fields,
    values,
    errors = {},
    tags = [],
    disabled = false,
    allowUploads = true,
    onUploadingChange,
    onChange,
}: {
    fields: TicketFormFieldDefinition[];
    values: Record<string, unknown>;
    errors?: Record<string, string>;
    tags?: TagOption[];
    disabled?: boolean;
    allowUploads?: boolean;
    onUploadingChange?: (uploading: boolean) => void;
    onChange: (fieldKey: string, value: unknown) => void;
}) {
    const [uploading, setUploading] = useState<Set<string>>(new Set());
    const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
    useEffect(() => onUploadingChange?.(uploading.size > 0), [onUploadingChange, uploading.size]);

    const uploadFiles = async (field: TicketFormFieldDefinition, selected: FileList | null) => {
        if (!selected?.length) return;
        setUploading((current) => new Set(current).add(field.fieldKey));
        setUploadErrors((current) => { const next = { ...current }; delete next[field.fieldKey]; return next; });
        try {
            const uploaded: UploadedFieldFile[] = [];
            for (const file of Array.from(selected)) {
                const body = new FormData();
                body.append('file', file);
                const response = await fetch('/api/upload', { method: 'POST', body });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || `Failed to upload ${file.name}`);
                uploaded.push({ url: payload.url, filename: payload.filename, mimetype: payload.mimetype, size: payload.size });
            }
            onChange(field.fieldKey, [...fileList(values[field.fieldKey]), ...uploaded]);
        } catch (error) {
            setUploadErrors((current) => ({ ...current, [field.fieldKey]: error instanceof Error ? error.message : 'File upload failed' }));
        } finally {
            setUploading((current) => {
                const next = new Set(current);
                next.delete(field.fieldKey);
                return next;
            });
        }
    };

    return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
            {fields.filter((field) => isFieldConditionVisible(field.conditionalRules, values)).map((field) => {
                const value = values[field.fieldKey];
                const options = fieldOptions(field, tags);
                const error = errors[field.fieldKey];
                const inputId = `ticket-field-${field.id}`;
                const selectedValues = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
                const isUploading = uploading.has(field.fieldKey);

                return (
                    <div key={field.id} className={cn('space-y-2 md:col-span-12', WIDTH_CLASSES[field.width] ?? 'md:col-span-12')}>
                        <Label htmlFor={inputId} className="flex items-center gap-1.5">
                            {field.label}{field.required ? <span className="text-destructive" aria-hidden="true">*</span> : null}
                        </Label>
                        {field.helpText ? <p id={`${inputId}-help`} className="text-xs text-muted-foreground">{field.helpText}</p> : null}

                        {field.type === 'TEXT' ? (
                            <Input id={inputId} value={typeof value === 'string' ? value : ''} placeholder={field.placeholder ?? undefined}
                                aria-invalid={Boolean(error)} aria-describedby={field.helpText ? `${inputId}-help` : undefined}
                                disabled={disabled} onChange={(event) => onChange(field.fieldKey, event.target.value)} />
                        ) : null}
                        {field.type === 'TEXTAREA' ? (
                            <Textarea id={inputId} value={typeof value === 'string' ? value : ''} placeholder={field.placeholder ?? undefined}
                                aria-invalid={Boolean(error)} rows={6} disabled={disabled}
                                onChange={(event) => onChange(field.fieldKey, event.target.value)} />
                        ) : null}
                        {field.type === 'DROPDOWN' ? (
                            <Select value={typeof value === 'string' ? value : ''} disabled={disabled}
                                onValueChange={(next) => onChange(field.fieldKey, next)}>
                                <SelectTrigger id={inputId} aria-invalid={Boolean(error)}><SelectValue placeholder={field.placeholder ?? `Select ${field.label}`} /></SelectTrigger>
                                <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                            </Select>
                        ) : null}
                        {field.type === 'MULTISELECT' ? (
                            <div id={inputId} className="flex min-h-10 flex-wrap gap-2 rounded-md border p-2" aria-invalid={Boolean(error)}>
                                {options.length === 0 ? <p className="px-1 text-xs text-muted-foreground">No options available</p> : options.map((option) => {
                                    const selected = selectedValues.includes(option.value);
                                    return (
                                        <Button key={option.value} type="button" size="sm" variant={selected ? 'default' : 'outline'}
                                            aria-pressed={selected} disabled={disabled}
                                            onClick={() => onChange(field.fieldKey, selected ? selectedValues.filter((item) => item !== option.value) : [...selectedValues, option.value])}>
                                            {option.label}
                                        </Button>
                                    );
                                })}
                            </div>
                        ) : null}
                        {field.type === 'CHECKBOX' ? (
                            <label htmlFor={inputId} className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
                                <input id={inputId} type="checkbox" checked={value === true} disabled={disabled}
                                    onChange={(event) => onChange(field.fieldKey, event.target.checked)} />
                                <span>{field.placeholder || field.label}</span>
                            </label>
                        ) : null}
                        {field.type === 'DATE' ? (
                            <Input id={inputId} type="date" value={typeof value === 'string' ? value : ''} disabled={disabled}
                                aria-invalid={Boolean(error)} onChange={(event) => onChange(field.fieldKey, event.target.value)} />
                        ) : null}
                        {field.type === 'FILE' ? (
                            <div className="space-y-2">
                                <label htmlFor={inputId} className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                    {isUploading ? 'Uploading…' : allowUploads ? 'Choose files' : 'File input preview'}
                                </label>
                                <input id={inputId} type="file" multiple className="sr-only" disabled={disabled || isUploading || !allowUploads}
                                    accept={field.validationRules?.allowedFileTypes?.join(',')}
                                    onChange={(event) => { void uploadFiles(field, event.target.files); event.target.value = ''; }} />
                                {fileList(value).map((file) => (
                                    <div key={file.url} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                                        <Badge variant="outline">{Math.max(1, Math.round(file.size / 1024))} KB</Badge>
                                        <Button type="button" variant="ghost" size="icon" disabled={disabled}
                                            aria-label={`Remove ${file.filename}`}
                                            onClick={() => onChange(field.fieldKey, fileList(value).filter((item) => item.url !== file.url))}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        {uploadErrors[field.fieldKey] ? <p className="text-xs font-medium text-destructive" role="alert">{uploadErrors[field.fieldKey]}</p> : null}
                        {error ? <p className="text-xs font-medium text-destructive" role="alert">{error}</p> : null}
                    </div>
                );
            })}
        </div>
    );
}