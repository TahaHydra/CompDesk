'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Save, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useSettingsDraft } from '@/components/admin/use-settings-draft';
import { loadSettings, readPemFile, updateSettings, type SettingsMap } from '@/lib/settings-client';

const KEYS = ['smtp_ca_certificate', 'smtp_client_certificate', 'smtp_client_key'] as const;
type PemKey = (typeof KEYS)[number];

export function SmtpCertificates() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<SettingsMap>({ queryKey: ['settings'], queryFn: loadSettings, throwOnError: true });
    const { draft, set, markSaved, changes } = useSettingsDraft(settings, KEYS);
    const encryptionReady = settings?.smtp_encryption_key_configured === 'true';
    const keyConfigured = settings?.smtp_client_key_configured === 'true';
    const pending = changes();

    const save = useMutation({
        mutationFn: async (payload: Record<string, string | null>) => {
            await updateSettings(payload as Record<string, string>);
            markSaved(Object.keys(payload));
        },
        onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['settings'] }); toast({ title: 'SMTP certificates saved' }); },
        onError: (error: Error) => toast({ title: 'SMTP certificates could not be saved', description: error.message, variant: 'destructive' }),
    });

    const field = (key: PemKey, label: string, help: string, placeholder?: string) => (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <Label htmlFor={key}>{label}</Label>
                <label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-2 text-xs font-medium"><Upload className="mr-1 h-3.5 w-3.5" />Load file
                    <input type="file" accept=".pem,.crt,.cer,.key" className="sr-only" onChange={async (event) => {
                        try { const text = await readPemFile(event.target.files?.[0]); if (text !== null) set(key, text); }
                        catch (error) { toast({ title: 'File not loaded', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
                        event.target.value = '';
                    }} /></label>
            </div>
            <Textarea id={key} rows={4} spellCheck={false} className="font-mono text-xs" placeholder={placeholder ?? '-----BEGIN CERTIFICATE-----'} value={draft[key] ?? ''} onChange={(event) => set(key, event.target.value)} />
            <p className="text-xs text-muted-foreground">{help}</p>
        </div>
    );

    return (
        <Card className="border-0 shadow-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4" /> SMTP certificates (optional)</CardTitle>
                <CardDescription>For relays that use a private certificate authority or authenticate clients by certificate (mutual TLS). Certificate verification always stays enabled.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {field('smtp_ca_certificate', 'Trusted CA certificates', settings?.smtp_ca_summary
                    ? `Current: ${settings.smtp_ca_summary}. Replaces the system trust store for SMTP only.`
                    : 'One or more PEM certificates. When set, only these authorities are trusted for SMTP.')}
                {field('smtp_client_certificate', 'Client certificate', settings?.smtp_client_certificate_summary ? `Current: ${settings.smtp_client_certificate_summary}.` : 'Presented to the relay during the TLS handshake. Username and password become optional.')}
                {field('smtp_client_key', 'Client private key', 'Unencrypted PEM key matching the client certificate. Stored with the same AES-256-GCM envelope as the SMTP password and never returned.',
                    keyConfigured ? 'A private key is configured. Paste or load a new one to replace it.' : '-----BEGIN PRIVATE KEY-----')}
                {!encryptionReady ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">APP_SETTINGS_ENCRYPTION_KEY is required before a client private key can be saved.</p> : null}
                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                    {settings?.smtp_ca_certificate ? <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => save.mutate({ smtp_ca_certificate: null })}><Trash2 className="mr-2 h-4 w-4" />Remove CA</Button> : null}
                    {settings?.smtp_client_certificate ? <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => save.mutate({ smtp_client_certificate: null })}><Trash2 className="mr-2 h-4 w-4" />Remove client certificate and key</Button> : null}
                    <Button className="ml-auto" disabled={!settings || save.isPending || Object.keys(pending).length === 0 || Boolean(pending.smtp_client_key && !encryptionReady)}
                        onClick={() => save.mutate(pending)}><Save className="mr-2 h-4 w-4" />Save certificates</Button>
                </div>
            </CardContent>
        </Card>
    );
}
