'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft, Send, Sparkles, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CustomField {
    id: string;
    label: string;
    fieldKey: string;
    type: 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'MULTISELECT' | 'CHECKBOX' | 'DATE' | 'FILE';
    required: boolean;
    options?: string[];
}

interface ApiError extends Error {
    details?: Record<string, string>;
}

function isEmptyCustomValue(field: CustomField, value: unknown) {
    if (value === undefined || value === null) return true;
    if (field.type === 'CHECKBOX') return value !== true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

export default function NewTicketPage() {
    const router = useRouter();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        queueId: '',
        categoryId: '',
        priority: 'NORMAL',
    });

    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
    const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
    const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});

    const { data: queues } = useQuery({
        queryKey: ['queues'],
        queryFn: async () => {
            const res = await fetch('/api/queues');
            if (!res.ok) throw new Error('Failed to load departments');
            return res.json();
        },
    });

    const { data: categories } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const res = await fetch('/api/categories');
            if (!res.ok) throw new Error('Failed to load categories');
            return res.json();
        },
    });

    const { data: tags } = useQuery({
        queryKey: ['tags'],
        queryFn: async () => {
            const res = await fetch('/api/tags');
            if (!res.ok) throw new Error('Failed to load tags');
            return res.json();
        },
    });

    const { data: customFields } = useQuery<CustomField[]>({
        queryKey: ['form-fields', formData.queueId],
        queryFn: async () => {
            const res = await fetch(`/api/form-fields?queueId=${formData.queueId}`);
            if (!res.ok) return [];
            return res.json();
        },
        enabled: !!formData.queueId,
    });

    useEffect(() => {
        setCustomFieldValues({});
        setCustomFieldErrors({});
    }, [formData.queueId]);

    const normalizedCustomFieldData = useMemo(() => {
        return Object.fromEntries(
            Object.entries(customFieldValues).filter(([, value]) => {
                if (value === undefined || value === null) return false;
                if (typeof value === 'string' && value.trim() === '') return false;
                if (Array.isArray(value) && value.length === 0) return false;
                return true;
            })
        );
    }, [customFieldValues]);

    const validateCustomFields = () => {
        const errors: Record<string, string> = {};
        for (const field of customFields ?? []) {
            if (!field.required) continue;
            const value = customFieldValues[field.fieldKey];
            if (isEmptyCustomValue(field, value)) {
                errors[field.fieldKey] = `${field.label} is required`;
            }
        }
        setCustomFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const createTicket = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    categoryId: formData.categoryId || undefined,
                    tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
                    formData:
                        Object.keys(normalizedCustomFieldData).length > 0
                            ? normalizedCustomFieldData
                            : undefined,
                }),
            });

            const payload = await res.json();
            if (!res.ok) {
                const apiError = new Error(payload.error || 'Failed to create ticket') as ApiError;
                if (payload.details && typeof payload.details === 'object') {
                    apiError.details = payload.details as Record<string, string>;
                }
                throw apiError;
            }

            return payload;
        },
        onSuccess: (data) => {
            toast({ title: 'Ticket created!', description: `${data.key} has been created successfully.` });
            queryClient.invalidateQueries({ queryKey: ['tickets'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            router.push(`/tickets/${data.id}`);
        },
        onError: (error: ApiError) => {
            if (error.details) {
                setCustomFieldErrors(error.details);
            }
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const updateCustomFieldValue = (fieldKey: string, value: unknown) => {
        setCustomFieldValues((prev) => ({ ...prev, [fieldKey]: value }));
        setCustomFieldErrors((prev) => {
            const next = { ...prev };
            delete next[fieldKey];
            return next;
        });
    };

    const toggleTag = (tagId: string) => {
        setSelectedTagIds((prev) =>
            prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
        );
    };

    const toggleMultiSelectOption = (fieldKey: string, option: string) => {
        const current = customFieldValues[fieldKey];
        const currentValues = Array.isArray(current) ? (current as string[]) : [];
        const next = currentValues.includes(option)
            ? currentValues.filter((entry) => entry !== option)
            : [...currentValues, option];
        updateCustomFieldValue(fieldKey, next);
    };

    const handleSubmit = () => {
        if (!validateCustomFields()) {
            toast({
                title: 'Missing required fields',
                description: 'Please complete all required custom fields.',
                variant: 'destructive',
            });
            return;
        }
        createTicket.mutate();
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <Link href="/tickets">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">New Ticket</h1>
                    <p className="text-muted-foreground mt-1">Submit a support request</p>
                </div>
            </div>

            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">Ticket Details</CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="title">Title *</Label>
                        <Input
                            id="title"
                            placeholder="Brief summary of your issue"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Department *</Label>
                            <Select
                                value={formData.queueId}
                                onValueChange={(value) => setFormData({ ...formData, queueId: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select department" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(queues ?? []).map((queue: any) => (
                                        <SelectItem key={queue.id} value={queue.id}>
                                            {queue.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Priority</Label>
                            <Select
                                value={formData.priority}
                                onValueChange={(value) => setFormData({ ...formData, priority: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="LOW">Low</SelectItem>
                                    <SelectItem value="NORMAL">Normal</SelectItem>
                                    <SelectItem value="HIGH">High</SelectItem>
                                    <SelectItem value="URGENT">Urgent</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Category</Label>
                        <Select
                            value={formData.categoryId || 'none'}
                            onValueChange={(value) =>
                                setFormData({ ...formData, categoryId: value === 'none' ? '' : value })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select category (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No category</SelectItem>
                                {(categories ?? []).map((category: any) => (
                                    <SelectItem key={category.id} value={category.id}>
                                        {category.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea
                            id="description"
                            placeholder="Provide as much detail as possible..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            rows={6}
                        />
                    </div>

                    {(tags ?? []).length > 0 ? (
                        <div className="space-y-2">
                            <Label className="flex items-center gap-1.5">
                                <Tag className="h-3.5 w-3.5" /> Tags
                            </Label>
                            <div className="flex flex-wrap gap-2">
                                {(tags ?? []).map((tag: any) => {
                                    const selected = selectedTagIds.includes(tag.id);
                                    return (
                                        <Button
                                            key={tag.id}
                                            type="button"
                                            size="sm"
                                            variant={selected ? 'default' : 'outline'}
                                            className={cn('h-8 text-xs', selected ? '' : 'bg-transparent')}
                                            style={
                                                selected
                                                    ? {}
                                                    : {
                                                          borderColor: tag.color,
                                                          color: tag.color,
                                                      }
                                            }
                                            onClick={() => toggleTag(tag.id)}
                                        >
                                            {tag.name}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    {formData.queueId && (customFields ?? []).length > 0 ? (
                        <div className="space-y-4 border-t pt-4">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Custom Fields
                            </p>
                            {(customFields ?? []).map((field) => {
                                const value = customFieldValues[field.fieldKey];
                                const error = customFieldErrors[field.fieldKey];

                                return (
                                    <div key={field.id} className="space-y-2">
                                        <Label>
                                            {field.label}
                                            {field.required ? ' *' : ''}
                                        </Label>

                                        {field.type === 'TEXT' ? (
                                            <Input
                                                placeholder={field.label}
                                                value={(value as string) || ''}
                                                onChange={(e) =>
                                                    updateCustomFieldValue(field.fieldKey, e.target.value)
                                                }
                                            />
                                        ) : null}

                                        {field.type === 'TEXTAREA' ? (
                                            <Textarea
                                                placeholder={field.label}
                                                rows={3}
                                                value={(value as string) || ''}
                                                onChange={(e) =>
                                                    updateCustomFieldValue(field.fieldKey, e.target.value)
                                                }
                                            />
                                        ) : null}

                                        {field.type === 'DROPDOWN' ? (
                                            <Select
                                                value={(value as string) || ''}
                                                onValueChange={(nextValue) =>
                                                    updateCustomFieldValue(field.fieldKey, nextValue)
                                                }
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder={`Select ${field.label}`} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {(field.options ?? []).map((option: string) => (
                                                        <SelectItem key={option} value={option}>
                                                            {option}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : null}

                                        {field.type === 'MULTISELECT' ? (
                                            <div className="flex flex-wrap gap-2 rounded-md border p-3">
                                                {(field.options ?? []).map((option: string) => {
                                                    const selected = Array.isArray(value)
                                                        ? (value as string[]).includes(option)
                                                        : false;
                                                    return (
                                                        <Button
                                                            key={option}
                                                            type="button"
                                                            size="sm"
                                                            variant={selected ? 'default' : 'outline'}
                                                            className="h-7 text-xs"
                                                            onClick={() =>
                                                                toggleMultiSelectOption(field.fieldKey, option)
                                                            }
                                                        >
                                                            {option}
                                                        </Button>
                                                    );
                                                })}
                                            </div>
                                        ) : null}

                                        {field.type === 'CHECKBOX' ? (
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="rounded"
                                                    checked={Boolean(value)}
                                                    onChange={(e) =>
                                                        updateCustomFieldValue(field.fieldKey, e.target.checked)
                                                    }
                                                />
                                                {field.label}
                                            </label>
                                        ) : null}

                                        {field.type === 'DATE' ? (
                                            <Input
                                                type="date"
                                                value={(value as string) || ''}
                                                onChange={(e) =>
                                                    updateCustomFieldValue(field.fieldKey, e.target.value)
                                                }
                                            />
                                        ) : null}

                                        {field.type === 'FILE' ? (
                                            <Input
                                                type="file"
                                                multiple
                                                onChange={(e) =>
                                                    updateCustomFieldValue(
                                                        field.fieldKey,
                                                        Array.from(e.target.files ?? []).map((file) => file.name)
                                                    )
                                                }
                                            />
                                        ) : null}

                                        {error ? <p className="text-xs text-destructive">{error}</p> : null}
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-3 pt-4">
                        <Link href="/tickets">
                            <Button variant="outline">Cancel</Button>
                        </Link>
                        <Button
                            onClick={handleSubmit}
                            disabled={!formData.title || !formData.queueId || createTicket.isPending}
                            className="gap-2 shadow-lg shadow-primary/25"
                        >
                            {createTicket.isPending ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                            Submit Ticket
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
