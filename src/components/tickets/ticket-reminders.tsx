'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
type Reminder = { id: string; scheduledAt: string; note: string; email: boolean; status: string; deliveredAt: string | null; emailAccepted: boolean };
export function TicketReminders({ ticketId, status }: { ticketId: string; status: string }) {
    const { t, language } = useLanguage();
    const client = useQueryClient();
    const [open, setOpen] = useState(false);
    const [id, setId] = useState('');
    const [at, setAt] = useState('');
    const [note, setNote] = useState('');
    const [email, setEmail] = useState(false);
    const [error, setError] = useState('');
    const url = `/api/tickets/${ticketId}/reminders`;
    const query = useQuery<Reminder[]>({ queryKey: ['ticket-reminders', ticketId], queryFn: async () => { const res = await fetch(url); if (!res.ok) throw new Error('Reminders unavailable'); const result = await res.json(); if (!Array.isArray(result)) throw new Error('Invalid reminders'); return result; }, refetchInterval: 60000 });
    const save = useMutation({ mutationFn: async () => { if (!at || Number.isNaN(new Date(at).getTime())) throw new Error(t('Choose a reminder time')); const res = await fetch(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(id ? { id } : {}), scheduledAt: new Date(at).toISOString(), note, email }) }); if (!res.ok) throw new Error(t('Reminder could not be saved')); }, onSuccess: () => { setOpen(false); void client.invalidateQueries({ queryKey: ['ticket-reminders', ticketId] }); }, onError: (value: Error) => setError(value.message) });
    const cancel = useMutation({ mutationFn: async (id: string) => { const res = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (!res.ok) throw new Error(t('Reminder could not be cancelled')); }, onSuccess: () => void client.invalidateQueries({ queryKey: ['ticket-reminders', ticketId] }), onError: (value: Error) => setError(value.message) });
    const edit = (value?: Reminder) => { setId(value?.id || ''); setNote(value?.note || ''); setEmail(value?.email || false); const date = value ? new Date(value.scheduledAt) : new Date(Date.now() + 3600000); setAt(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)); setError(''); setOpen(true); };
    return <Card className="border-0 shadow-sm"><CardHeader className="pb-3"><CardTitle className="text-base">{t('Reminders')}</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('Private reminders for you. Closed tickets and revoked access cancel pending delivery.')}</p>
        {query.isError ? <p role="alert">{t('Reminders unavailable')} <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('Retry')}</Button></p> : null}
        {(query.data || []).filter((value) => value.status !== 'CANCELLED').map((value) => <div key={value.id} className="space-y-1 rounded border p-2 text-sm"><time dateTime={value.scheduledAt}>{new Date(value.scheduledAt).toLocaleString(language === 'fr' ? 'fr-FR' : 'en-GB')}</time><p className="break-words whitespace-pre-wrap">{value.note}</p><p className="text-xs text-muted-foreground">{t(value.status === 'FAILED' ? 'Email delivery failed; in-app reminder is available' : value.status === 'DELIVERED' ? 'Reminder delivered' : value.deliveredAt ? 'Email retry pending' : 'Scheduled')}{value.emailAccepted ? ` · ${t('Email accepted')}` : ''}</p>{value.status === 'PENDING' ? <div className="flex gap-2">{!value.deliveredAt ? <Button size="sm" variant="ghost" onClick={() => edit(value)}>{t('Edit')}</Button> : null}<Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(value.id)}>{t('Cancel reminder')}</Button></div> : null}</div>)}
        <Button variant="outline" size="sm" disabled={['RESOLVED', 'CLOSED', 'WITHDRAWN'].includes(status)} onClick={() => edit()}>{t('Remind me')}</Button>
        {!open && error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Dialog open={open} onOpenChange={(value) => { if (!save.isPending) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>{t('Remind me')}</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="reminder-time">{t('Date and time')}</Label><Input id="reminder-time" type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} /><p className="text-xs text-muted-foreground">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p></div><div className="space-y-2"><Label htmlFor="reminder-note">{t('Private note')}</Label><Input id="reminder-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} />{t('Also send an email')}</label><p className="text-xs text-muted-foreground">{t('In-app notification is always included. Email requires a configured mail provider.')}</p>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex justify-end gap-2"><Button variant="outline" disabled={save.isPending} onClick={() => setOpen(false)}>{t('Cancel')}</Button><Button disabled={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('Save reminder')}</Button></div></div></DialogContent></Dialog>
    </CardContent></Card>;
}
