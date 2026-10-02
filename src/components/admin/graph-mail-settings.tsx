'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
type Config = { provider: 'smtp' | 'graph'; tenantId: string; clientId: string; sender: string; secretConfigured: boolean; environmentProvider: boolean };
export function GraphMailSettings() {
    const { t } = useLanguage();
    const client = useQueryClient();
    const query = useQuery<Config>({ queryKey: ['mail-settings'], refetchOnWindowFocus: false, queryFn: async () => { const res = await fetch('/api/settings/mail'); if (!res.ok) throw new Error('Mail settings unavailable'); return res.json(); } });
    const [draft, setDraft] = useState({ provider: 'smtp' as 'smtp' | 'graph', tenantId: '', clientId: '', sender: '', secret: '' });
    const [recipient, setRecipient] = useState('');
    const [message, setMessage] = useState('');
    useEffect(() => { if (query.data) { const { provider, tenantId, clientId, sender } = query.data; setDraft({ provider, tenantId, clientId, sender, secret: '' }); } }, [query.data]);
    const save = useMutation({ mutationFn: async () => { const res = await fetch('/api/settings/mail', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); if (!res.ok) throw new Error(t('Could not save mail settings')); }, onSuccess: () => { setDraft((value) => ({ ...value, secret: '' })); setMessage(t('Mail settings saved')); void client.invalidateQueries({ queryKey: ['mail-settings'] }); }, onError: (error: Error) => setMessage(error.message) });
    const test = useMutation({ mutationFn: async () => { const res = await fetch('/api/settings/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient }) }); if (!res.ok) throw new Error(t('Microsoft 365 test failed')); }, onSuccess: () => setMessage(t('Microsoft 365 accepted the test message; delivery is not yet confirmed.')), onError: (error: Error) => setMessage(error.message) });
    return <Card><CardHeader><CardTitle>{t('Email delivery provider')}</CardTitle></CardHeader><CardContent className="space-y-4">
        {query.isError ? <p role="alert">{t('Mail settings unavailable')} <Button variant="outline" onClick={() => void query.refetch()}>{t('Retry')}</Button></p> : null}
        <div className="space-y-2"><Label htmlFor="mail-provider">{t('Provider')}</Label><Select value={draft.provider} disabled={!query.data || save.isPending || query.data.environmentProvider} onValueChange={(provider: 'smtp' | 'graph') => setDraft({ ...draft, provider })}><SelectTrigger id="mail-provider"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="smtp">SMTP</SelectItem><SelectItem value="graph">Microsoft 365 / Graph</SelectItem></SelectContent></Select></div>
        {query.data?.environmentProvider ? <p className="text-xs text-muted-foreground">{t('The environment controls the selected provider.')}</p> : null}
        {draft.provider === 'graph' ? <>
            <p className="text-sm text-muted-foreground">{t('Use a dedicated Entra mail application scoped to your sender mailbox. Sign-in configuration is separate.')}</p>
            <div className="grid gap-4 sm:grid-cols-2">{(['tenantId', 'clientId', 'sender', 'secret'] as const).map((key) => <div key={key} className="space-y-2"><Label htmlFor={`graph-${key}`}>{t({ tenantId: 'Tenant ID', clientId: 'Application client ID', sender: 'Sender mailbox', secret: 'Application client secret' }[key])}</Label><Input id={`graph-${key}`} type={key === 'secret' ? 'password' : key === 'sender' ? 'email' : 'text'} autoComplete={key === 'secret' ? 'new-password' : 'off'} value={draft[key]} placeholder={key === 'secret' && query.data?.secretConfigured ? t('Configured; enter a replacement only') : undefined} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></div>)}</div>
            <a className="text-sm underline" href="https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac" target="_blank" rel="noreferrer">{t('Mailbox permission documentation')}</a>
        </> : <p className="text-sm text-muted-foreground">{t('SMTP configuration remains available below.')}</p>}
        <Button disabled={!query.data || save.isPending} onClick={() => { setMessage(''); save.mutate(); }}>{t('Save mail settings')}</Button>
        {query.data?.provider === 'graph' ? <div className="flex flex-wrap items-end gap-3"><div className="space-y-2"><Label htmlFor="graph-recipient">{t('Test recipient')}</Label><Input id="graph-recipient" type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} /></div><Button variant="outline" disabled={!recipient || test.isPending || save.isPending} onClick={() => { setMessage(''); test.mutate(); }}>{t('Send test message')}</Button></div> : null}
        {message ? <p role="status" className="text-sm">{message}</p> : null}
    </CardContent></Card>;
}
