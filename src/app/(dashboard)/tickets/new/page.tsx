'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, Route, Send, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { DynamicTicketForm } from '@/components/ticket-form/dynamic-ticket-form';
import { isFieldConditionVisible } from '@/lib/ticket-form/conditions';
import type { TicketFormFieldDefinition, TicketFormTemplateDefinition, TemplateResolutionSource } from '@/lib/ticket-form/types';

interface Department { id: string; name: string; description?: string | null }
interface Category { id: string; name: string; description?: string | null }
interface TagOption { id: string; name: string; color?: string }
interface ResolvedResponse {
    template: TicketFormTemplateDefinition;
    fields: TicketFormFieldDefinition[];
    source: TemplateResolutionSource;
    queue: { id: string; name: string };
    category: { id: string; name: string } | null;
}

function hasMeaningfulValues(values: Record<string, unknown>) {
    return Object.values(values).some((value) => {
        if (value === undefined || value === null || value === '') return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'boolean') return value;
        return true;
    });
}

function compatibleValues(
    current: Record<string, unknown>,
    previousFields: TicketFormFieldDefinition[],
    nextFields: TicketFormFieldDefinition[]
) {
    const previous = new Map(previousFields.map((field) => [field.fieldKey, field]));
    return Object.fromEntries(nextFields.flatMap((field) => {
        const oldField = previous.get(field.fieldKey);
        if (oldField?.type === field.type && Object.prototype.hasOwnProperty.call(current, field.fieldKey)) {
            return [[field.fieldKey, current[field.fieldKey]]];
        }
        return field.defaultValue === undefined || field.defaultValue === null
            ? []
            : [[field.fieldKey, field.defaultValue]];
    }));
}

export default function NewTicketPage() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const idempotencyKey = useRef(crypto.randomUUID());
    const previousFields = useRef<TicketFormFieldDefinition[]>([]);
    const [queueId, setQueueId] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [filesUploading, setFilesUploading] = useState(false);

    const departmentsQuery = useQuery<Department[]>({
        queryKey: ['queues', 'ticket-routing'],
        queryFn: async () => {
            const response = await fetch('/api/queues');
            if (!response.ok) throw new Error('Failed to load departments');
            return response.json();
        },
    });
    const categoriesQuery = useQuery<Category[]>({
        queryKey: ['categories', queueId],
        enabled: Boolean(queueId),
        queryFn: async () => {
            const response = await fetch(`/api/categories?queueId=${encodeURIComponent(queueId)}`);
            if (!response.ok) throw new Error('Failed to load categories');
            return response.json();
        },
    });
    const tagsQuery = useQuery<TagOption[]>({
        queryKey: ['tags'],
        queryFn: async () => {
            const response = await fetch('/api/tags');
            return response.ok ? response.json() : [];
        },
    });

    const routeComplete = Boolean(
        queueId && categoriesQuery.data && (categoriesQuery.data.length === 0 || categoryId)
    );
    const templateQuery = useQuery<ResolvedResponse>({
        queryKey: ['ticket-form-resolution', queueId, categoryId],
        enabled: routeComplete,
        queryFn: async () => {
            const params = new URLSearchParams({ queueId });
            if (categoryId) params.set('categoryId', categoryId);
            const response = await fetch(`/api/ticket-form/resolve?${params}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to resolve ticket form');
            return payload;
        },
    });

    useEffect(() => {
        const fields = templateQuery.data?.fields;
        if (!fields) return;
        setValues((current) => compatibleValues(current, previousFields.current, fields));
        setErrors({});
        previousFields.current = fields;
    }, [templateQuery.data?.template.id, templateQuery.data?.template.version, templateQuery.data?.fields]);

    const visibleRequiredErrors = useMemo(() => {
        const next: Record<string, string> = {};
        for (const field of templateQuery.data?.fields ?? []) {
            if (!field.required || !isFieldConditionVisible(field.conditionalRules, values)) continue;
            const value = values[field.fieldKey];
            const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (field.type === 'CHECKBOX' && value !== true);
            if (missing) next[field.fieldKey] = `${field.label} is required`;
        }
        return next;
    }, [templateQuery.data?.fields, values]);

    const confirmRoutingChange = () => !hasMeaningfulValues(values) || window.confirm(
        'Changing the department or category can change the ticket form. Compatible values will be kept, but other entered values may be removed. Continue?'
    );

    const changeDepartment = (nextQueueId: string) => {
        if (nextQueueId === queueId || !confirmRoutingChange()) return;
        setQueueId(nextQueueId);
        setCategoryId('');
        setErrors({});
    };
    const changeCategory = (nextCategoryId: string) => {
        if (nextCategoryId === categoryId || !confirmRoutingChange()) return;
        setCategoryId(nextCategoryId);
        setErrors({});
    };

    const createTicket = useMutation({
        mutationFn: async () => {
            const response = await fetch('/api/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idempotencyKey: idempotencyKey.current,
                    queueId,
                    categoryId: categoryId || undefined,
                    values,
                }),
            });
            const payload = await response.json();
            if (!response.ok) {
                const error = new Error(payload.error || 'Failed to create ticket') as Error & { details?: Record<string, string> };
                if (payload.details && typeof payload.details === 'object') error.details = payload.details;
                throw error;
            }
            return payload;
        },
        onSuccess: (ticket) => {
            void queryClient.invalidateQueries({ queryKey: ['tickets'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            toast({ title: 'Ticket created', description: `${ticket.key} was submitted successfully.` });
            router.push(`/tickets/${ticket.id}`);
        },
        onError: (error: Error & { details?: Record<string, string> }) => {
            if (error.details) setErrors(error.details);
            toast({ title: 'Ticket could not be created', description: error.message, variant: 'destructive' });
        },
    });

    const submit = () => {
        if (filesUploading) {
            toast({ title: 'Wait for file uploads to finish', variant: 'destructive' });
            return;
        }
        if (Object.keys(visibleRequiredErrors).length > 0) {
            setErrors(visibleRequiredErrors);
            toast({ title: 'Complete the required fields', variant: 'destructive' });
            return;
        }
        createTicket.mutate();
    };

    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <div className="flex items-start gap-3">
                <Button asChild variant="ghost" size="icon"><Link href="/tickets" aria-label="Back to tickets"><ArrowLeft className="h-4 w-4" /></Link></Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">New Ticket</h1>
                    <p className="mt-1 text-muted-foreground">Choose where the request belongs, then complete the resolved form.</p>
                </div>
            </div>

            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Route className="h-5 w-5 text-primary" /> 1. Route the request</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Department <span className="text-destructive">*</span></Label>
                        <Select value={queueId} onValueChange={changeDepartment} disabled={departmentsQuery.isLoading}>
                            <SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger>
                            <SelectContent>{(departmentsQuery.data ?? []).map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Category{(categoriesQuery.data?.length ?? 0) > 0 ? <span className="text-destructive"> *</span> : null}</Label>
                        <Select value={categoryId} onValueChange={changeCategory} disabled={!queueId || categoriesQuery.isLoading || categoriesQuery.data?.length === 0}>
                            <SelectTrigger><SelectValue placeholder={!queueId ? 'Select a department first' : categoriesQuery.data?.length === 0 ? 'No categories in this department' : 'Select a category'} /></SelectTrigger>
                            <SelectContent>{(categoriesQuery.data ?? []).map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
                        </Select>
                        {queueId && categoriesQuery.data?.length === 0 ? <p className="text-xs text-muted-foreground">This department has no active categories. Its default ticket form will be used.</p> : null}
                    </div>
                </CardContent>
            </Card>

            {routeComplete ? (
                <Card className="border-0 shadow-lg">
                    <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary" /> 2. Complete the form</CardTitle>
                            {templateQuery.data ? <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {templateQuery.data.template.name} · {templateQuery.data.source === 'category' ? 'Category override' : templateQuery.data.source === 'department' ? 'Department default' : 'System default'}</Badge> : null}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {templateQuery.isLoading ? <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading ticket form…</div> : null}
                        {templateQuery.isError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{templateQuery.error.message}</div> : null}
                        {templateQuery.data ? (
                            <DynamicTicketForm fields={templateQuery.data.fields} values={values} errors={errors} tags={tagsQuery.data ?? []}
                                disabled={createTicket.isPending} onUploadingChange={setFilesUploading} onChange={(key, value) => { setValues((current) => ({ ...current, [key]: value })); setErrors((current) => { const next = { ...current }; delete next[key]; return next; }); }} />
                        ) : null}
                        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
                            <Button asChild variant="outline"><Link href="/tickets">Cancel</Link></Button>
                            <Button onClick={submit} disabled={!templateQuery.data || createTicket.isPending || filesUploading} className="gap-2">
                                {createTicket.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                Submit Ticket
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Select a department{(categoriesQuery.data?.length ?? 0) > 0 ? ' and category' : ''} to load the correct ticket form.</div>
            )}
        </div>
    );
}