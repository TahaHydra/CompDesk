'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Loader2 } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';

/** Optional job title shown on the person card; who sees it follows Admin → Settings → Privacy. */
export function ProfileJobTitle({ initialJobTitle }: { initialJobTitle: string | null }) {
    const { t } = useLanguage();
    const { toast } = useToast();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [saved, setSaved] = useState(initialJobTitle ?? '');
    const [value, setValue] = useState(initialJobTitle ?? '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const response = await fetch('/api/profile/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobTitle: value.trim() }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Request failed');
            setSaved(payload.jobTitle ?? '');
            setValue(payload.jobTitle ?? '');
            void queryClient.invalidateQueries({ queryKey: ['person-card'] });
            toast({ title: t('Job title saved') });
            router.refresh();
        } catch {
            toast({ title: t('Could not save your job title'), variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="border shadow-sm">
            <CardHeader className="bg-muted/30 pb-4">
                <CardTitle className="flex items-center gap-2 text-lg"><BriefcaseBusiness className="h-4 w-4" />{t('Job title')}</CardTitle>
                <CardDescription>{t('Optional. Shown on your person card to the people allowed to see it.')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row">
                <Input value={value} maxLength={80} placeholder={t('For example: IT support technician')} aria-label={t('Job title')} onChange={(event) => setValue(event.target.value)} />
                <Button className="shrink-0" disabled={saving || value.trim() === saved} onClick={save}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{t('Save')}
                </Button>
            </CardContent>
        </Card>
    );
}
