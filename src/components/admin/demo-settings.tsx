'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';
import { useLanguage } from '@/components/providers/language-provider';
import { copyText } from '@/lib/browser-clipboard';
import { DemoLoginSettings } from './demo-login-settings';
import type { DemoCredentials, DemoState } from '../../../scripts/demo-data.mjs';

async function demoRequest<T>(method = 'GET'): Promise<T> {
    const response = await fetch('/api/settings/demo', {
        method, headers: { 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify({ confirmation: method === 'POST' ? 'INSTALL-DEMO-DATA' : 'REMOVE-DEMO-DATA' }) }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not manage demo data. No partial database changes were committed.');
    return body;
}

export function DemoSettings() {
    const { data: session } = useSession();
    const { t, language } = useLanguage();
    const queryClient = useQueryClient();
    const privileged = session?.user.role === 'SUPER_ADMIN';
    const state = useQuery<DemoState>({ queryKey: ['demo-data'], queryFn: () => demoRequest(), enabled: privileged });
    const [credentials, setCredentials] = useState<DemoCredentials | null>(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const refresh = () => queryClient.invalidateQueries();
    const install = useMutation({
        mutationFn: () => demoRequest<DemoCredentials>('POST'),
        onSuccess: (result) => { setCredentials(result); setMessage('Demo data installed. Save these credentials before leaving this tab.'); setError(''); void refresh(); },
        onError: (failure: Error) => setError(failure.message),
    });
    const remove = useMutation({
        mutationFn: () => demoRequest<{ removed: number; retained: number; deactivated: number; filesRetained: number }>('DELETE'),
        onSuccess: (result) => {
            setCredentials(null); setError('');
            setMessage(result.retained || result.deactivated ? 'Demo content removed. Some entries were preserved because real data depends on them; referenced demo accounts were deactivated.' : 'Demo data deleted. Your Super Admin, settings and personal content were preserved.');
            if (result.filesRetained) setError('Some demo attachment files could not be removed from storage.');
            void refresh();
        },
        onError: (failure: Error) => setError(failure.message),
    });
    if (!privileged) return null;
    const busy = install.isPending || remove.isPending;
    const credentialsText = credentials ? `${credentials.accounts.map((account) => `${account.role}: ${account.email}`).join('\n')}\n${t('Password')}: ${credentials.password}\n` : '';
    return <Card>
        <CardHeader><CardTitle className="text-base">{t('Demo data')}</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">{t('Explore CompDesk with 3 departments, 18 categories, 5 example tickets, 6 demo accounts, templates and bilingual help articles.')}</p>
            <p className="text-xs text-muted-foreground">{t('Your Super Admin and settings are preserved. Demo accounts use a random password shown once and require local sign-in.')}</p>
            {state.data && <dl className="grid grid-cols-2 gap-2 text-xs">
                <dt>{t('Demo accounts')}</dt><dd>{state.data.accounts}</dd>
                <dt>{t('Example tickets')}</dt><dd>{state.data.tickets}</dd>
                {state.data.installedAt && <><dt>{t('Installed')}</dt><dd>{new Date(state.data.installedAt).toLocaleString(language === 'fr' ? 'fr-FR' : 'en-GB')}</dd></>}
            </dl>}
            {state.data?.installed && !state.data.managed && <p className="text-muted-foreground">{t('Legacy demo accounts detected. Only marked accounts can be cleaned up; older untracked content is preserved.')}</p>}
            <div className="flex flex-wrap gap-2">
                <ConfirmDestructiveAction trigger={<Button variant="outline" disabled={busy || !state.data || state.data.managed}>{t('Install demo data')}</Button>}
                    title={t('Install demo data')} description={t('Add the complete example dataset? Existing accounts and configuration will remain unchanged.')}
                    confirmLabel={t('Install demo data')} cancelLabel={t('Cancel')} pendingLabel={t('Installing…')} pending={busy} disabled={!state.data || state.data.managed}
                    actionClassName="bg-primary text-primary-foreground hover:bg-primary/90" onConfirm={() => { setError(''); setMessage(''); install.mutate(); }} />
                <ConfirmDestructiveAction trigger={<Button variant="destructive" disabled={busy || !state.data?.installed}>{t('Delete demo data')}</Button>}
                    title={t('Delete demo data')} description={t('Permanently delete seeded tickets, including their history and attachments, and demo content? Your Super Admin, settings, and users and tickets you created are kept. Entries required by real data are preserved; referenced demo accounts are deactivated.')}
                    confirmLabel={t('Delete demo data')} cancelLabel={t('Cancel')} pendingLabel={t('Deleting…')} pending={busy} disabled={!state.data?.installed}
                    onConfirm={() => { setError(''); setMessage(''); remove.mutate(); }} />
            </div>
            <DemoLoginSettings />
            {busy && <p role="status">{t('Please wait…')}</p>}
            {message && <p role="status">{t(message)}</p>}
            {(error || state.error) && <p role="alert" className="text-destructive">{t(error || state.error?.message || '')}</p>}
            {credentials && <div className="space-y-3 rounded-md border p-4">
                <h3 className="font-medium">{t('Demo credentials (shown once)')}</h3>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{credentialsText}</pre>
                <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={async () => { try { if (!await copyText(credentialsText)) setError('Could not copy demo credentials. Select and copy them manually.'); } catch { setError('Could not copy demo credentials. Select and copy them manually.'); } }}>{t('Copy demo credentials')}</Button>
                    <Button variant="outline" size="sm" onClick={() => { const url = URL.createObjectURL(new Blob([credentialsText], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'compdesk-demo-credentials.txt'; link.click(); URL.revokeObjectURL(url); }}>{t('Download demo credentials')}</Button>
                </div>
            </div>}
        </CardContent>
    </Card>;
}
