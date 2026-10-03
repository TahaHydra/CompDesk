'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/components/providers/language-provider';

interface DemoLoginSettingsValue { showDemoAccounts: boolean; demoAccountInfo: string }
async function request(method = 'GET', value?: DemoLoginSettingsValue): Promise<DemoLoginSettingsValue> {
    const response = await fetch('/api/settings/demo/visibility', { method,
        ...(value ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) } : {}),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not save demo visibility');
    return body;
}
export function DemoLoginSettings() {
    const { t } = useLanguage();
    const client = useQueryClient();
    const query = useQuery({ queryKey: ['demo-visibility'], queryFn: () => request() });
    const [draft, setDraft] = useState<DemoLoginSettingsValue | null>(null);
    const form = draft ?? query.data ?? { showDemoAccounts: false, demoAccountInfo: '' };
    const save = useMutation({ mutationFn: () => request('PATCH', form), onSuccess: async value => {
        client.setQueryData(['demo-visibility'], value); setDraft(null);
        await client.invalidateQueries({ queryKey: ['branding'] });
    } });
    return <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-4"><Label htmlFor="demo-visible">{t('Show demo account information')}</Label>
            <Switch id="demo-visible" checked={form.showDemoAccounts} disabled={!query.data || save.isPending} onCheckedChange={checked => setDraft({ ...form, showDemoAccounts: checked })} /></div>
        <p className="text-xs text-muted-foreground">{t('Keep this disabled in production. Only publish safe demo instructions; this text is visible before sign-in.')}</p>
        {form.showDemoAccounts && <div className="space-y-2"><Label htmlFor="demo-info">{t('Demo account information')}</Label><Textarea id="demo-info" maxLength={1000} value={form.demoAccountInfo} onChange={event => setDraft({ ...form, demoAccountInfo: event.target.value })} /></div>}
        {(query.error || save.error) && <p role="alert" className="text-destructive">{t((query.error || save.error)?.message || '')}</p>}
        {save.isSuccess && !draft && <p role="status">{t('Demo visibility saved')}</p>}
        <div className="flex justify-end"><Button onClick={() => save.mutate()} disabled={!query.data || !draft || save.isPending || form.showDemoAccounts && !form.demoAccountInfo.trim()}>{t('Save demo settings')}</Button></div>
    </div>;
}
