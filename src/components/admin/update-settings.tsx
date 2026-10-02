'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/components/providers/language-provider';
import { requestUpdateState, useUpdates } from '@/components/providers/update-provider';

export function UpdateSettings() {
    const updates = useUpdates();
    const { t, language } = useLanguage();
    const queryClient = useQueryClient();
    const [saved, setSaved] = useState(false);
    const save = useMutation({
        mutationFn: async (enabled: boolean) => {
            const response = await fetch('/api/settings', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates_automatic: String(enabled) }),
            });
            if (!response.ok) throw new Error('Could not save update preference');
            return requestUpdateState();
        },
        onSuccess: (state) => {
            queryClient.setQueryData(['compdesk-updates', updates.userId], state);
            void queryClient.invalidateQueries({ queryKey: ['settings'] });
            setSaved(true);
        },
    });
    if (updates.role !== 'SUPER_ADMIN') return null;
    return <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{t('CompDesk updates')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
                <label htmlFor="updates-automatic">{t('Check for updates automatically')}</label>
                <Switch id="updates-automatic" checked={updates.state.automatic} onCheckedChange={(value) => { setSaved(false); save.mutate(value); }} disabled={save.isPending || updates.busy || !updates.loaded} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t('Last checked')}</dt><dd>{updates.state.lastChecked ? new Date(updates.state.lastChecked).toLocaleString(language === 'fr' ? 'fr-FR' : 'en-GB') : t('Not checked yet')}</dd>
                <dt className="text-muted-foreground">{t('Installed version')}</dt><dd>v{updates.state.installed}</dd>
                <dt className="text-muted-foreground">{t('Latest version')}</dt><dd>{updates.state.manifest ? `v${updates.state.manifest.latest}` : t('Unknown')}</dd>
            </dl>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={updates.refresh} disabled={updates.busy || save.isPending}>{t('Check now')}</Button><Button size="sm" variant="ghost" onClick={() => updates.setOpen(true)}>{t('Update & recovery')}</Button></div>
            {updates.state.refreshLimited && <p role="status" className="text-xs text-muted-foreground">{t('Please wait one minute between update checks.')}</p>}
            {(updates.refreshError || updates.state.checkStatus === 'unavailable') && <p role="status" className="text-xs text-muted-foreground">{t('Update check unavailable')}</p>}
            {save.isError && <p role="alert" className="text-xs text-destructive">{t('Could not save update preference')}</p>}
            {saved && <p role="status" className="text-xs text-muted-foreground">{t('Update preference saved')}</p>}
            <p className="text-xs text-muted-foreground">{t('Checks send an anonymous HTTPS request for a public release manifest. No tenant, user, or installed version is sent. The source can see the server IP address.')}</p>
        </CardContent>
    </Card>;
}
