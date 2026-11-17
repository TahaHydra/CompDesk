'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Minus, Save, Users } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
    DEFAULT_PEOPLE_PRIVACY,
    PRIVACY_FIELDS,
    PRIVACY_LEVELS,
    visibleFieldsFor,
    type PeoplePrivacyPolicy,
    type PrivacyField,
    type PrivacyLevel,
} from '@/lib/people-privacy';

const FIELD_LABELS: Record<PrivacyField, string> = { email: 'Email address', language: 'Preferred language', jobTitle: 'Job title' };
const LEVEL_LABELS: Record<PrivacyLevel, string> = {
    higher: 'Higher roles only',
    same_or_higher: 'Same role and higher',
    staff: 'All staff',
    everyone: 'Everyone',
};
const LEVEL_HINTS: Record<PrivacyLevel, string> = {
    higher: 'A department admin sees agents and requesters of their departments; agents see requesters; requesters see nobody else’s.',
    same_or_higher: 'Also colleagues with the same role, for example agents see other agents.',
    staff: 'Agents and administrators see everyone they work with; requesters do not.',
    everyone: 'Everyone, including requesters looking at the staff on their own tickets.',
};

type PreviewViewer = 'USER' | 'AGENT' | 'ADMIN_OWN' | 'ADMIN_OTHER';
type PreviewSubject = 'USER' | 'AGENT' | 'ADMIN' | 'SUPER_ADMIN';
const VIEWER_LABELS: Record<PreviewViewer, string> = {
    USER: 'A requester',
    AGENT: 'An agent',
    ADMIN_OWN: 'A department admin (same department)',
    ADMIN_OTHER: 'A department admin (other department)',
};
const SUBJECT_LABELS: Record<PreviewSubject, string> = { USER: 'a requester', AGENT: 'an agent', ADMIN: 'a department admin', SUPER_ADMIN: 'a Super Admin' };

async function request(method: 'GET' | 'PUT', body?: PeoplePrivacyPolicy) {
    const response = await fetch('/api/settings/people-privacy', {
        method,
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload as { policy: PeoplePrivacyPolicy };
}

/** Admin → Settings → Privacy: who sees each person's contact and profile details. */
export function PeoplePrivacySettings() {
    const { t } = useLanguage();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({ queryKey: ['people-privacy'], queryFn: () => request('GET') });
    const [draft, setDraft] = useState<PeoplePrivacyPolicy | null>(null);
    const [viewer, setViewer] = useState<PreviewViewer>('USER');
    const [subject, setSubject] = useState<PreviewSubject>('AGENT');
    useEffect(() => { if (data?.policy && !draft) setDraft(data.policy); }, [data, draft]);

    const save = useMutation({
        mutationFn: (policy: PeoplePrivacyPolicy) => request('PUT', policy),
        onSuccess: (result) => {
            setDraft(result.policy);
            void queryClient.invalidateQueries({ queryKey: ['people-privacy'] });
            void queryClient.invalidateQueries({ queryKey: ['person-card'] });
            toast({ title: t('Privacy settings saved') });
        },
        onError: (error: Error) => toast({ title: t('Could not save privacy settings'), description: error.message, variant: 'destructive' }),
    });

    const preview = useMemo(() => {
        if (!draft) return null;
        const department = 'preview-department';
        const viewerRole = viewer === 'ADMIN_OWN' || viewer === 'ADMIN_OTHER' ? 'ADMIN' : viewer;
        return visibleFieldsFor(
            draft,
            { id: 'preview-viewer', role: viewerRole, administeredQueueIds: new Set(viewer === 'ADMIN_OWN' ? [department] : []) },
            { id: 'preview-subject', role: subject },
            [department],
        );
    }, [draft, viewer, subject]);

    if (isLoading || !draft) {
        return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('Loading...')}</div>;
    }
    const changed = JSON.stringify(draft) !== JSON.stringify(data?.policy);
    const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_PEOPLE_PRIVACY);

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" />{t('People and privacy')}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        {t('Choose who can see each person’s details on person cards, ticket pages, lists and pickers. Name, photo, role and the relevant department are always shown so everyone knows who they are talking to.')}
                    </p>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="divide-y rounded-md border">
                        {PRIVACY_FIELDS.map((field) => (
                            <div key={field} className="grid gap-2 p-3 sm:grid-cols-[1fr_16rem] sm:items-center">
                                <div>
                                    <p className="text-sm font-medium">{t(FIELD_LABELS[field])}</p>
                                    <p className="text-xs text-muted-foreground">{t(LEVEL_HINTS[draft[field]])}</p>
                                </div>
                                <Select value={draft[field]} onValueChange={(value) => setDraft({ ...draft, [field]: value as PrivacyLevel })}>
                                    <SelectTrigger aria-label={t(FIELD_LABELS[field])}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {PRIVACY_LEVELS.map((level) => (
                                            <SelectItem key={level} value={level}>{t(LEVEL_LABELS[level])}{level === DEFAULT_PEOPLE_PRIVACY[field] ? ` (${t('default')})` : ''}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>
                    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                        <li>{t('Details are only ever shown for people someone already works with: people on a ticket they can open, or staff in their departments.')}</li>
                        <li>{t('A department admin counts as an administrator only for people in the departments they administer.')}</li>
                        <li>{t('Super Admins always see everything, and everyone always sees their own details.')}</li>
                    </ul>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" disabled={isDefault} onClick={() => setDraft({ ...DEFAULT_PEOPLE_PRIVACY })}>{t('Restore defaults')}</Button>
                        <Button className="gap-2" disabled={!changed || save.isPending} onClick={() => save.mutate(draft)}>
                            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('Save')}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('Preview')}</CardTitle>
                    <p className="text-sm text-muted-foreground">{t('What one person sees on another person’s card with the settings above (before saving).')}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Select value={viewer} onValueChange={(value) => setViewer(value as PreviewViewer)}>
                            <SelectTrigger aria-label={t('Viewer')}><SelectValue /></SelectTrigger>
                            <SelectContent>{(Object.keys(VIEWER_LABELS) as PreviewViewer[]).map((key) => <SelectItem key={key} value={key}>{t(VIEWER_LABELS[key])}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={subject} onValueChange={(value) => setSubject(value as PreviewSubject)}>
                            <SelectTrigger aria-label={t('Person viewed')}><SelectValue /></SelectTrigger>
                            <SelectContent>{(Object.keys(SUBJECT_LABELS) as PreviewSubject[]).map((key) => <SelectItem key={key} value={key}>{t('looking at {person}', { person: t(SUBJECT_LABELS[key]) })}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    {preview ? (
                        <ul className="grid gap-2 sm:grid-cols-2">
                            {[{ label: 'Name, photo, role and department' as const, visible: true }, ...PRIVACY_FIELDS.map((field) => ({ label: FIELD_LABELS[field], visible: preview[field] }))].map((item) => (
                                <li key={item.label} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                                    {item.visible ? <Check className="h-4 w-4 text-emerald-600" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
                                    <span className={item.visible ? '' : 'text-muted-foreground line-through'}>{t(item.label)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </CardContent>
            </Card>
        </div>
    );
}
