'use client';

import Image from 'next/image';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';
import { PageHeader } from '@/components/layout/page-header';
import { Settings, Mail, Shield, Send, Save, AlertTriangle, CheckCircle2, Link as LinkIcon, Plus, X, Lock, Palette, Upload, Loader2, Webhook } from 'lucide-react';
import { BrandingSettings } from '@/components/admin/branding-settings';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect } from 'react';
import { parseDashboardLinks, type DashboardLink } from '@/lib/dashboard-links';

type SettingsMap = Record<string, string>;

async function loadSettings(): Promise<SettingsMap> {
    const response = await fetch('/api/settings');
    const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
    if (!response.ok) throw new Error(payload.error || 'Failed to load settings');
    return payload;
}
async function updateSettings(data: Record<string, string>): Promise<{ success: boolean; restartRequired?: boolean }> {
    const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
    if (!response.ok) throw new Error(payload.error || 'Failed to update settings');
    return payload;
}

function SmtpSettingsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<SettingsMap>({ queryKey: ['settings'], queryFn: loadSettings, throwOnError: true });
    const [smtp, setSmtp] = useState({ smtp_host: '', smtp_port: '587', smtp_user: '', smtp_password: '', smtp_from: '', smtp_secure: 'false', smtp_require_tls: 'true' });
    const [diagnostic, setDiagnostic] = useState<{ success: boolean; correlationId: string; message?: string; error?: string; category?: string; fromAccepted?: boolean | null; relayAccepted?: boolean; acceptedRecipients?: string[]; rejectedRecipients?: string[]; response?: string | null; responseStatus?: string | null; messageId?: string | null } | null>(null);
    const smtpPasswordConfigured = settings?.smtp_password_configured === 'true';
    const migrationRequired = settings?.smtp_password_migration_required === 'true';
    const encryptionReady = settings?.smtp_encryption_key_configured === 'true';
    const passwordSource = settings?.smtp_password_source ?? 'missing';
    const ignoredEnvironmentPlaceholder = settings?.smtp_environment_placeholder_ignored === 'true';

    useEffect(() => { if (settings) setSmtp((current) => ({
        smtp_host: settings.smtp_host ?? current.smtp_host,
        smtp_port: settings.smtp_port ?? current.smtp_port,
        smtp_user: settings.smtp_user ?? current.smtp_user,
        smtp_password: '',
        smtp_from: settings.smtp_from ?? current.smtp_from,
        smtp_secure: settings.smtp_secure ?? current.smtp_secure,
        smtp_require_tls: settings.smtp_require_tls ?? 'true',
    })); }, [settings]);

    const save = async () => {
        await updateSettings(smtp);
        setSmtp((current) => ({ ...current, smtp_password: '' }));
        await queryClient.invalidateQueries({ queryKey: ['settings'] });
    };
    const saveMutation = useMutation({ mutationFn: save, onSuccess: () => toast({ title: 'SMTP settings saved' }), onError: (error: Error) => toast({ title: 'Failed to save SMTP settings', description: error.message, variant: 'destructive' }) });
    const runDiagnostic = async (path: string) => {
        await save();
        const response = await fetch(path, { method: 'POST' });
        const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
        setDiagnostic(payload);
        if (!response.ok) throw new Error(payload.error || 'SMTP diagnostic failed');
        return payload;
    };
    const verifyMutation = useMutation({ mutationFn: () => runDiagnostic('/api/settings/verify-smtp'), onSuccess: (data) => toast({ title: 'SMTP verification succeeded', description: data.message }), onError: (error: Error) => toast({ title: 'SMTP verification failed', description: error.message, variant: 'destructive' }) });
    const sendMutation = useMutation({ mutationFn: () => runDiagnostic('/api/settings/test-email'), onSuccess: (data) => toast({ title: 'Real test message submitted', description: data.message }), onError: (error: Error) => toast({ title: 'SMTP delivery test failed', description: error.message, variant: 'destructive' }) });
    const migrateMutation = useMutation({ mutationFn: async () => { const response = await fetch('/api/settings/migrate-smtp-secret', { method: 'POST' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Migration failed'); return payload; }, onSuccess: async (data) => { await queryClient.invalidateQueries({ queryKey: ['settings'] }); toast({ title: 'SMTP secret migration', description: data.message }); }, onError: (error: Error) => toast({ title: 'Migration failed', description: error.message, variant: 'destructive' }) });
    const pending = saveMutation.isPending || verifyMutation.isPending || sendMutation.isPending || migrateMutation.isPending;
    const validFrom = /^(?:.*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(smtp.smtp_from.trim());

    return <div className="space-y-6"><Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" /> SMTP Configuration</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="smtp-host">SMTP Host</Label><Input id="smtp-host" value={smtp.smtp_host} onChange={(event) => setSmtp({ ...smtp, smtp_host: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="smtp-port">Port</Label><Input id="smtp-port" inputMode="numeric" value={smtp.smtp_port} onChange={(event) => setSmtp({ ...smtp, smtp_port: event.target.value })} /></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="smtp-user">Username / Email</Label><Input id="smtp-user" autoComplete="username" value={smtp.smtp_user} onChange={(event) => setSmtp({ ...smtp, smtp_user: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="smtp-password">Password</Label><Input id="smtp-password" type="password" autoComplete="new-password" placeholder={smtpPasswordConfigured ? 'Configured; enter a replacement only' : 'Required'} value={smtp.smtp_password} onChange={(event) => setSmtp({ ...smtp, smtp_password: event.target.value })} /><p className="text-xs text-muted-foreground">Database passwords use an authenticated enc:v1 AES-256-GCM envelope. Effective source: {passwordSource === 'environment' ? 'environment (overrides the saved password)' : passwordSource === 'database' ? 'encrypted database setting' : 'not configured'}.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="smtp-from">From Address</Label><Input id="smtp-from" value={smtp.smtp_from} onChange={(event) => setSmtp({ ...smtp, smtp_from: event.target.value })} aria-invalid={Boolean(smtp.smtp_from && !validFrom)} /><p className="text-xs text-muted-foreground">Required before notifications or a real-send test.</p></div><div className="space-y-2"><Label htmlFor="smtp-secure">Transport security</Label><Select value={smtp.smtp_secure} onValueChange={(value) => setSmtp({ ...smtp, smtp_secure: value, smtp_require_tls: value === 'true' ? 'false' : 'true' })}><SelectTrigger id="smtp-secure"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="false">STARTTLS</SelectItem><SelectItem value="true">Implicit TLS</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="smtp-require-tls">Require STARTTLS</Label><Select value={smtp.smtp_require_tls} disabled={smtp.smtp_secure === 'true'} onValueChange={(value) => setSmtp({ ...smtp, smtp_require_tls: value })}><SelectTrigger id="smtp-require-tls"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Required</SelectItem><SelectItem value="false">Not required</SelectItem></SelectContent></Select></div></div>
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Port 587 requires STARTTLS and keeps certificate verification enabled. Port 465 requires implicit TLS. Verification checks connectivity and authentication only. A real-send test can show that the SMTP server accepted a message for relay using the configured From address; it cannot prove final mailbox delivery.</div>
        {ignoredEnvironmentPlaceholder ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">A documented placeholder in SMTP_PASS/SMTP_PASSWORD was ignored. The encrypted database password is being used when available.</div> : null}
        {!encryptionReady ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">APP_SETTINGS_ENCRYPTION_KEY is not available to this running server. Configure a 32-byte key and restart the standalone server or app container before saving a database SMTP password.</div> : null}
        {migrationRequired ? <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><span>An existing plaintext SMTP password requires one-time encryption.</span><Button variant="outline" size="sm" onClick={() => migrateMutation.mutate()} disabled={pending || !encryptionReady}>Encrypt existing password</Button></div> : null}
        {diagnostic ? <div role="status" className={`rounded-lg border p-3 text-sm ${diagnostic.success ? 'border-green-300 bg-green-50 text-green-900' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}><p>{diagnostic.message ?? diagnostic.error}</p><p className="mt-1 text-xs">Correlation ID: {diagnostic.correlationId}{diagnostic.category ? ` · ${diagnostic.category}` : ''}</p>{diagnostic.fromAccepted === null ? <p className="mt-1 text-xs">From address was not tested.</p> : null}{diagnostic.acceptedRecipients ? <p className="mt-1 text-xs">Accepted recipients: {diagnostic.acceptedRecipients.length ? diagnostic.acceptedRecipients.join(', ') : 'none'}</p> : null}{diagnostic.rejectedRecipients?.length ? <p className="mt-1 text-xs">Rejected recipients: {diagnostic.rejectedRecipients.join(', ')}</p> : null}{diagnostic.responseStatus || diagnostic.response ? <p className="mt-1 break-words text-xs">SMTP response{diagnostic.responseStatus ? ` (${diagnostic.responseStatus})` : ''}: {diagnostic.response ?? 'not provided'}</p> : null}{diagnostic.messageId ? <p className="mt-1 break-all text-xs">Message ID: {diagnostic.messageId}</p> : null}</div> : null}
        <div className="flex flex-wrap gap-3"><Button onClick={() => saveMutation.mutate()} disabled={!settings || pending || Boolean(smtp.smtp_password && !encryptionReady)}><Save className="mr-2 h-4 w-4" />Save Settings</Button><Button variant="outline" onClick={() => verifyMutation.mutate()} disabled={!settings || pending || Boolean(smtp.smtp_password && !encryptionReady)}><Shield className="mr-2 h-4 w-4" />Verify Connection & Authentication</Button><Button variant="outline" onClick={() => sendMutation.mutate()} disabled={!settings || pending || !validFrom || Boolean(smtp.smtp_password && !encryptionReady)}><Send className="mr-2 h-4 w-4" />Send Real Test Message</Button></div>
    </CardContent></Card></div>;
}
function EmailTogglesTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: loadSettings,
        throwOnError: true,
    });

    const toggles = [
        { key: 'email_on_ticket_created', label: 'Ticket Created', desc: 'Notify the requester and department agents when a ticket is created' },
        { key: 'email_on_ticket_assigned', label: 'Ticket Assigned', desc: 'Notify the agent when a ticket is assigned to them' },
        { key: 'email_on_ticket_updated', label: 'Ticket Updated', desc: 'Notify watchers when tracked ticket fields change; this also controls escalation emails' },
        { key: 'email_on_new_comment', label: 'New Comment', desc: 'Notify watchers when a new comment is added' },
    ];

    const saveMutation = useMutation({
        mutationFn: async (data: Record<string, string>) => updateSettings(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Email preferences saved' });
        },
        onError: (error: Error) => toast({ title: 'Email preference could not be saved', description: error.message, variant: 'destructive' }),
    });

    const handleToggle = (key: string) => {
        const current = settings?.[key] === 'true';
        saveMutation.mutate({ [key]: String(!current) });
    };

    return (
        <Card className="border-0 shadow-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Mail className="h-4 w-4" /> Email Notifications
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {toggles.map((t) => {
                    const enabled = settings?.[t.key] === 'true';
                    return (
                        <div key={t.key} className="flex items-center justify-between p-3 rounded-lg border">
                            <div>
                                <p className="text-sm font-medium">{t.label}</p>
                                <p className="text-xs text-muted-foreground">{t.desc}</p>
                            </div>
                            <Button
                                variant={enabled ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handleToggle(t.key)}
                                aria-pressed={enabled}
                                disabled={saveMutation.isPending || (!enabled && !settings?.smtp_from)}
                                className="gap-1.5 min-w-[80px]"
                            >
                                {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                                {enabled ? 'On' : 'Off'}
                            </Button>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}

function EntraSettingsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: loadSettings,
        throwOnError: true,
    });

    const [entra, setEntra] = useState({
        azure_ad_client_id: '', azure_ad_client_secret: '', azure_ad_tenant_id: '',
    });
    const entraSecretConfigured = settings?.azure_ad_client_secret_configured === 'true';
    const entraRuntimeConfigured = settings?.azure_ad_runtime_configured === 'true';
    const entraSavedConfigured = Boolean(settings?.azure_ad_client_id && settings?.azure_ad_tenant_id && entraSecretConfigured);

    useEffect(() => {
        if (settings) {
            setEntra((prev) => ({
                azure_ad_client_id: settings.azure_ad_client_id ?? prev.azure_ad_client_id,
                azure_ad_client_secret: settings.azure_ad_client_secret ?? prev.azure_ad_client_secret,
                azure_ad_tenant_id: settings.azure_ad_tenant_id ?? prev.azure_ad_tenant_id,
            }));
        }
    }, [settings]);

    const saveMutation = useMutation({
        mutationFn: async () => updateSettings(entra),
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({
                title: 'Entra ID settings saved',
                description: result.restartRequired ? 'Restart the application before Microsoft sign-in becomes available.' : 'No runtime restart is required.',
            });
        },
        onError: (error: Error) => toast({ title: 'Entra ID settings could not be saved', description: error.message, variant: 'destructive' }),
    });

    const [diagnostic, setDiagnostic] = useState<{ success: boolean; correlationId: string; stage: string; message?: string; error?: string; expectedCallbackUri?: string | null } | null>(null);
    const diagnosticMutation = useMutation({
        mutationFn: async () => {
            const response = await fetch('/api/settings/entra-diagnostic', { method: 'POST' });
            const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
            setDiagnostic(payload);
            if (!response.ok) throw new Error(payload.message || payload.error || 'Entra diagnostic failed');
            return payload;
        },
        onSuccess: (result) => toast({ title: 'Entra diagnostic succeeded', description: `${result.message} Correlation ID: ${result.correlationId}` }),
        onError: (error: Error) => toast({ title: 'Entra diagnostic failed', description: error.message, variant: 'destructive' }),
    });
    return (
        <div className="space-y-4">
            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Shield className="h-4 w-4" /> Microsoft Entra ID (Azure AD)
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                            Changes to Entra ID settings require an <strong>application restart</strong> to take effect.
                            Local standalone changes are saved persistently. Container deployments must be configured through their environment.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="entra-client-id">Client ID</Label>
                        <Input id="entra-client-id" autoComplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={entra.azure_ad_client_id}
                            onChange={(e) => setEntra({ ...entra, azure_ad_client_id: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="entra-client-secret">Client Secret</Label>
                        <Input
                            id="entra-client-secret"
                            type="password"
                            autoComplete="new-password"
                            placeholder={entraSecretConfigured ? 'Saved secret configured. Enter a new one to replace it.' : '••••••••'}
                            value={entra.azure_ad_client_secret}
                            onChange={(e) => setEntra({ ...entra, azure_ad_client_secret: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="entra-tenant-id">Tenant ID</Label>
                        <Input id="entra-tenant-id" autoComplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={entra.azure_ad_tenant_id}
                            onChange={(e) => setEntra({ ...entra, azure_ad_tenant_id: e.target.value })} />
                    </div>
                    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
                        <Save className="h-4 w-4" /> Save Entra Settings
                    </Button>
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-base">Microsoft login status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                        {entraRuntimeConfigured ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                        <span>{entraRuntimeConfigured ? 'Active in the running application' : entraSavedConfigured ? 'Saved; application restart required' : 'Incomplete configuration'}</span>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                        <span>Client ID: {settings?.azure_ad_client_id ? 'configured' : 'missing'}</span>
                        <span>Client secret: {entraSecretConfigured ? 'configured' : 'missing'}</span>
                        <span>Tenant ID: {settings?.azure_ad_tenant_id ? 'configured' : 'missing'}</span>
                    </div>                    <Button variant="outline" onClick={() => diagnosticMutation.mutate()} disabled={diagnosticMutation.isPending} className="gap-2"><Shield className="h-4 w-4" />{diagnosticMutation.isPending ? 'Testing running configuration…' : 'Diagnose Running Entra Configuration'}</Button>
                    {diagnostic ? <div className={`rounded-lg border p-3 text-sm ${diagnostic.success ? 'border-green-300 bg-green-50 text-green-900' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}><p>{diagnostic.message ?? diagnostic.error}</p><p className="mt-1 text-xs">Stage: {diagnostic.stage} · Correlation ID: {diagnostic.correlationId}</p>{diagnostic.expectedCallbackUri ? <p className="mt-1 break-all text-xs">Expected callback: {diagnostic.expectedCallbackUri}</p> : null}<p className="mt-2 text-xs">Values are never returned: only presence, format validity, and metadata checks are reported.</p></div> : null}
                </CardContent>
            </Card>
        </div>
    );
}

function DashboardLinksTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<SettingsMap>({ queryKey: ['settings'], queryFn: loadSettings, throwOnError: true });
    const { data: queues = [] } = useQuery<Array<{ id: string; name: string }>>({
        queryKey: ['queues', 'quick-links'],
        queryFn: async () => { const response = await fetch('/api/queues?accessible=true'); if (!response.ok) throw new Error('Failed to load departments'); return response.json(); },
    });
    const { data: categories = [] } = useQuery<Array<{ id: string; name: string; queueId: string }>>({
        queryKey: ['categories', 'quick-links'],
        queryFn: async () => { const response = await fetch('/api/categories'); if (!response.ok) throw new Error('Failed to load categories'); return response.json(); },
    });
    const [links, setLinks] = useState<DashboardLink[]>([]);
    const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

    useEffect(() => { if (settings?.dashboard_links) setLinks(parseDashboardLinks(settings.dashboard_links)); }, [settings]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dashboard_links: links }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to save dashboard links');
        },
        onSuccess: async () => {
            await Promise.all([queryClient.invalidateQueries({ queryKey: ['settings'] }), queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })]);
            toast({ title: 'Dashboard links saved' });
        },
        onError: (error: Error) => toast({ title: 'Links could not be saved', description: error.message, variant: 'destructive' }),
    });

    const addLink = () => setLinks((current) => [...current, { type: 'external', title: '', url: '', iconUrl: '' }]);
    const removeLink = (index: number) => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index));
    const updateCommon = (index: number, values: Partial<Pick<DashboardLink, 'title' | 'iconUrl'>>) => setLinks((current) => current.map((link, itemIndex) => itemIndex === index ? { ...link, ...values } : link));
    const changeType = (index: number, type: DashboardLink['type']) => setLinks((current) => current.map((link, itemIndex) => {
        if (itemIndex !== index || link.type === type) return link;
        return type === 'external'
            ? { type: 'external', title: link.title, url: '', iconUrl: link.iconUrl }
            : { type: 'ticket_form', title: link.title, queueId: '', iconUrl: link.iconUrl };
    }));
    const uploadIcon = async (index: number, file?: File) => {
        if (!file) return;
        const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']);
        if (!allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024) { toast({ title: 'Icon could not be uploaded', description: 'Choose a supported image no larger than 5 MB.', variant: 'destructive' }); return; }
        setUploadingIndex(index);
        try {
            const form = new FormData(); form.set('file', file);
            const response = await fetch('/api/settings/quick-link-icons', { method: 'POST', body: form });
            const payload = await response.json() as { url?: string; error?: string };
            if (!response.ok || !payload.url) throw new Error(payload.error || 'Icon upload failed');
            updateCommon(index, { iconUrl: payload.url });
            toast({ title: 'Icon ready', description: 'Save links to publish it.' });
        } catch (error) { toast({ title: 'Icon could not be uploaded', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }); }
        finally { setUploadingIndex(null); }
    };
    const invalid = links.some((link) => !link.title.trim() || (link.type === 'external' ? !link.url.trim() : !link.queueId || Boolean(link.categoryId && !categories.some((category) => category.id === link.categoryId && category.queueId === link.queueId))));

    return (
        <Card className="border-0 shadow-sm"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2 text-base"><LinkIcon className="h-4 w-4" /> Custom Dashboard Links</CardTitle><Button variant="outline" size="sm" onClick={addLink} disabled={links.length >= 16} className="h-8 gap-1"><Plus className="h-3.5 w-3.5" /> Add Link</Button></CardHeader>
            <CardContent className="space-y-4"><p className="rounded-lg border bg-muted/35 p-3 text-sm text-muted-foreground">External resources open in a new tab. Ticket-form links preselect routing and always use the current server-resolved form template.</p>
                {!links.length ? <div className="rounded-lg border border-dashed py-8 text-center text-muted-foreground">No custom links added yet.</div> : <div className="space-y-3">{links.map((link, index) => {
                    const departmentCategories = categories.filter((category) => link.type === 'ticket_form' && category.queueId === link.queueId);
                    return <div key={index} className="grid gap-3 rounded-lg border bg-muted/25 p-3 lg:grid-cols-[160px_minmax(0,1fr)_minmax(0,2fr)_220px_auto] lg:items-end">
                        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Type</Label><Select value={link.type} onValueChange={(value) => changeType(index, value as DashboardLink['type'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="external">External resource</SelectItem><SelectItem value="ticket_form">Ticket form</SelectItem></SelectContent></Select></div>
                        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Title</Label><Input value={link.title} onChange={(event) => updateCommon(index, { title: event.target.value })} /></div>
                        {link.type === 'external' ? <div className="space-y-1"><Label className="text-xs text-muted-foreground">URL</Label><Input placeholder="https://intranet.example.com" value={link.url} onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index && item.type === 'external' ? { ...item, url: event.target.value } : item))} /></div> : <div className="grid gap-2 sm:grid-cols-2"><div className="space-y-1"><Label className="text-xs text-muted-foreground">Department</Label><Select value={link.queueId || undefined} onValueChange={(queueId) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index && item.type === 'ticket_form' ? { ...item, queueId, categoryId: undefined } : item))}><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger><SelectContent>{queues.map((queue) => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label className="text-xs text-muted-foreground">Category (optional)</Label><Select value={link.categoryId ?? 'none'} disabled={!link.queueId} onValueChange={(categoryId) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index && item.type === 'ticket_form' ? { ...item, categoryId: categoryId === 'none' ? undefined : categoryId } : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Department default</SelectItem>{departmentCategories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></div></div>}
                        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Icon (optional)</Label><div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border bg-card">{link.iconUrl ? <Image src={link.iconUrl} alt="" width={32} height={32} className="h-8 w-8 object-contain" unoptimized /> : <LinkIcon className="h-4 w-4 text-muted-foreground" />}</div><label className="inline-flex h-9 cursor-pointer items-center rounded-md border bg-background px-3 text-xs font-medium">{uploadingIndex === index ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,.ico" className="sr-only" disabled={uploadingIndex !== null} onChange={(event) => uploadIcon(index, event.target.files?.[0])} /></label>{link.iconUrl ? <Button type="button" variant="ghost" size="icon" aria-label={`Remove icon from ${link.title || 'quick link'}`} onClick={() => updateCommon(index, { iconUrl: '' })}><X className="h-4 w-4" /></Button> : null}</div></div>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeLink(index)} aria-label="Remove link"><X className="h-4 w-4" /></Button>
                    </div>;
                })}</div>}
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || uploadingIndex !== null || invalid} className="gap-2"><Save className="h-4 w-4" /> Save Links</Button>
            </CardContent></Card>
    );
}
function SecuritySettingsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: loadSettings,
        throwOnError: true,
    });

    const localEnabled = settings?.login_local_enabled !== 'false';

    const toggleMutation = useMutation({
        mutationFn: async (enabled: boolean) => updateSettings({ login_local_enabled: String(enabled) }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Security setting updated' });
        },
        onError: (error: Error) => toast({ title: 'Security setting could not be updated', description: error.message, variant: 'destructive' }),
    });

    return (
        <Card className="mt-4 border-0 shadow-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" /> Login Security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="space-y-1">
                        <p className="font-medium">Allow local password login</p>
                        <p className="text-sm text-muted-foreground">
                            When disabled, users can only sign in via Microsoft Entra ID SSO.
                            Local accounts created in the admin panel will not be able to log in with their password.
                        </p>
                    </div>
                    <Switch
                        checked={localEnabled}
                        onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                        disabled={toggleMutation.isPending}
                    />
                </div>
                {!localEnabled && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                            Local login is currently <strong>disabled</strong>. Only Microsoft Entra ID SSO is allowed.
                            Make sure SSO is properly configured before disabling local login.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function FeatureFlagsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: loadSettings,
        throwOnError: true,
    });

    const flags = [
        {
            key: 'feature_attachments_enabled',
            label: 'Attachments',
            desc: 'Allow users and agents to upload ticket attachments.',
        },
        {
            key: 'feature_dashboard_links_enabled',
            label: 'Dashboard Quick Links',
            desc: 'Show custom quick-link cards on the dashboard.',
        },
        {
            key: 'feature_external_api_enabled',
            label: 'External API',
            desc: 'Allow API-key clients to read and create tickets.',
        },
        {
            key: 'feature_webhooks_enabled',
            label: 'Webhooks',
            desc: 'Send outbound event webhooks to configured endpoints.',
        },
    ];

    const toggleMutation = useMutation({
        mutationFn: async (payload: Record<string, string>) => updateSettings(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Feature flag updated' });
        },
        onError: (error: Error) => toast({ title: 'Failed to update feature flag', description: error.message, variant: 'destructive' }),
    });

    return (
        <Card className="mt-4 border-0 shadow-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Feature Flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {flags.map((flag) => {
                    const enabled = settings?.[flag.key] !== 'false';
                    return (
                        <div key={flag.key} className="flex items-center justify-between p-4 rounded-lg border">
                            <div className="space-y-1 pr-4">
                                <p className="font-medium">{flag.label}</p>
                                <p className="text-sm text-muted-foreground">{flag.desc}</p>
                            </div>
                            <Switch
                                checked={enabled}
                                onCheckedChange={(checked) => toggleMutation.mutate({ [flag.key]: String(checked) })}
                                disabled={toggleMutation.isPending}
                            />
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}

function ApiClientsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [selectedScopes, setSelectedScopes] = useState<string[]>(['tickets:read']);
    const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
    const [allowAllQueues, setAllowAllQueues] = useState(false);
    const [latestApiKey, setLatestApiKey] = useState('');

    const { data: clients } = useQuery({
        queryKey: ['api-clients'],
        queryFn: async () => {
            const res = await fetch('/api/api-clients');
            if (!res.ok) throw new Error('Failed to load API clients');
            return res.json();
        },
    });

    const { data: queues } = useQuery({
        queryKey: ['queues'],
        queryFn: async () => {
            const res = await fetch('/api/queues');
            if (!res.ok) throw new Error('Failed to load departments');
            return res.json();
        },
    });

    const createClient = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/api-clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    scopes: selectedScopes,
                    allowedQueueIds: allowAllQueues ? [] : selectedQueueIds,
                    allowAllQueues,
                    isActive: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['api-clients'] });
            setLatestApiKey(data.apiKey);
            setName('');
            setSelectedScopes(['tickets:read']);
            setSelectedQueueIds([]);
            setAllowAllQueues(false);
            toast({ title: 'API client created' });
        },
        onError: (err: Error) => toast({ title: 'Failed to create API client', description: err.message, variant: 'destructive' }),
    });

    const updateClient = useMutation({
        mutationFn: async (payload: Record<string, unknown>) => {
            const res = await fetch('/api/api-clients', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['api-clients'] });
            if (data.apiKey) {
                setLatestApiKey(data.apiKey);
                toast({ title: 'API key rotated' });
            } else {
                toast({ title: 'API client updated' });
            }
        },
        onError: (err: Error) => toast({ title: 'Failed to update API client', description: err.message, variant: 'destructive' }),
    });

    const deleteClient = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/api-clients?id=${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['api-clients'] });
            toast({ title: 'API client deleted' });
        },
        onError: (err: Error) => toast({ title: 'Failed to delete API client', description: err.message, variant: 'destructive' }),
    });

    const toggleScope = (scope: string) => {
        setSelectedScopes((current) =>
            current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]
        );
    };

    const toggleQueue = (queueId: string) => {
        setSelectedQueueIds((current) =>
            current.includes(queueId) ? current.filter((item) => item !== queueId) : [...current, queueId]
        );
    };

    return (
        <div className="space-y-6">
            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Shield className="h-4 w-4" /> API Clients
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Client Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ERP bridge" />
                    </div>
                    <div className="space-y-2">
                        <Label>Scopes</Label>
                        <div className="flex gap-2 flex-wrap">
                            {['tickets:read', 'tickets:write'].map((scope) => {
                                const selected = selectedScopes.includes(scope);
                                return (
                                    <Button key={scope} type="button" variant={selected ? 'default' : 'outline'} size="sm" onClick={() => toggleScope(scope)}>
                                        {scope}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Department Access</Label>
                        <p className="text-xs text-muted-foreground">Default deny: an empty selection grants access to no departments.</p>
                        <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                            <Switch checked={allowAllQueues} onCheckedChange={(checked) => { setAllowAllQueues(checked); if (checked) setSelectedQueueIds([]); }} />
                            Explicitly allow all departments
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {(queues ?? []).map((queue: any) => {
                                const selected = selectedQueueIds.includes(queue.id);
                                return (
                                    <Button key={queue.id} type="button" variant={selected ? 'default' : 'outline'} size="sm" disabled={allowAllQueues} onClick={() => toggleQueue(queue.id)}>
                                        {queue.name}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                    <Button onClick={() => createClient.mutate()} disabled={!name.trim() || selectedScopes.length === 0}>
                        Create API Client
                    </Button>
                    {latestApiKey ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3">
                            <p className="text-sm font-medium">Copy this API key now. It is only shown once.</p>
                            <code className="block mt-2 text-xs break-all">{latestApiKey}</code>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-base">Existing Clients</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {(clients ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No API clients created yet.</p>
                    ) : (
                        (clients ?? []).map((client: any) => (
                            <div key={client.id} className="rounded-lg border p-4 space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="font-medium">{client.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Created {new Date(client.createdAt).toLocaleString()}
                                            {client.lastUsedAt ? ` · Last used ${new Date(client.lastUsedAt).toLocaleString()}` : ' · Never used'}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={client.isActive}
                                        onCheckedChange={(checked) => updateClient.mutate({ id: client.id, isActive: checked })}
                                    />
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    {(client.scopes ?? []).map((scope: string) => (
                                        <Badge key={scope} variant="outline">{scope}</Badge>
                                    ))}
                                    {client.allowAllQueues ? (
                                        <Badge variant="outline">All departments (explicit)</Badge>
                                    ) : (client.allowedQueueIds ?? []).length === 0 ? (
                                        <Badge variant="outline">No departments</Badge>
                                    ) : (
                                        client.allowedQueueIds.map((queueId: string) => (
                                            <Badge key={queueId} variant="outline">{(queues ?? []).find((queue: any) => queue.id === queueId)?.name ?? queueId}</Badge>
                                        ))
                                    )}
                                </div>
                                <div className="space-y-2 rounded-md border p-3">
                                    <p className="text-xs font-medium">Department policy</p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button type="button" size="sm" variant={client.allowAllQueues ? 'default' : 'outline'} onClick={() => updateClient.mutate({ id: client.id, allowAllQueues: !client.allowAllQueues, allowedQueueIds: [] })}>All departments</Button>
                                        {(queues ?? []).map((queue: any) => {
                                            const selected = !client.allowAllQueues && (client.allowedQueueIds ?? []).includes(queue.id);
                                            return <Button key={queue.id} type="button" size="sm" variant={selected ? 'default' : 'outline'} onClick={() => {
                                                const current = client.allowAllQueues ? [] : (client.allowedQueueIds ?? []);
                                                const allowedQueueIds = selected ? current.filter((id: string) => id !== queue.id) : [...current, queue.id];
                                                updateClient.mutate({ id: client.id, allowAllQueues: false, allowedQueueIds });
                                            }}>{queue.name}</Button>;
                                        })}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={() => updateClient.mutate({ id: client.id, rotateKey: true })}>
                                        Rotate Key
                                    </Button>
                                    <ConfirmDestructiveAction
                                        title="Delete API client?"
                                        description={<>The client <strong>{client.name}</strong> will lose API access immediately. This cannot be undone.</>}
                                        pending={deleteClient.isPending}
                                        onConfirm={() => deleteClient.mutate(client.id)}
                                        trigger={<Button type="button" variant="destructive" size="sm">Delete</Button>}
                                    />
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

const WEBHOOK_EVENTS = [
    'ticket.created', 'ticket.resolved', 'ticket.assignment_added',
    'ticket.assignment_removed', 'ticket.assignments_replaced',
];

function WebhooksTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [events, setEvents] = useState<string[]>(['ticket.created']);
    const [latestSecret, setLatestSecret] = useState('');
    const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);

    const webhooksQuery = useQuery({
        queryKey: ['webhooks'],
        queryFn: async () => {
            const response = await fetch('/api/webhooks');
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to load webhooks');
            return payload;
        },
    });
    const deliveriesQuery = useQuery({
        queryKey: ['webhook-deliveries', selectedWebhookId],
        enabled: Boolean(selectedWebhookId),
        queryFn: async () => {
            const response = await fetch(`/api/webhooks/${selectedWebhookId}/deliveries`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to load delivery history');
            return payload;
        },
    });

    const createWebhook = useMutation({
        mutationFn: async () => {
            const response = await fetch('/api/webhooks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, url, events, isActive: true }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to create webhook');
            return payload;
        },
        onSuccess: (payload) => {
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
            setLatestSecret(payload.signingSecret);
            setName(''); setUrl(''); setEvents(['ticket.created']);
            toast({ title: 'Webhook created' });
        },
        onError: (error: Error) => toast({ title: 'Webhook creation failed', description: error.message, variant: 'destructive' }),
    });

    const updateWebhook = useMutation({
        mutationFn: async (changes: Record<string, unknown>) => {
            const response = await fetch('/api/webhooks', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to update webhook');
            return payload;
        },
        onSuccess: (payload) => {
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
            if (payload.signingSecret) setLatestSecret(payload.signingSecret);
            toast({ title: payload.signingSecret ? 'Signing secret rotated' : 'Webhook updated' });
        },
        onError: (error: Error) => toast({ title: 'Webhook update failed', description: error.message, variant: 'destructive' }),
    });

    const disableWebhook = useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Failed to disable webhook');
            return payload;
        },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['webhooks'] }); toast({ title: 'Webhook disabled; history retained' }); },
        onError: (error: Error) => toast({ title: 'Webhook disable failed', description: error.message, variant: 'destructive' }),
    });

    const deliveryAction = useMutation({
        mutationFn: async ({ webhookId, action, deliveryId }: { webhookId: string; action: 'test' | 'retry'; deliveryId?: string }) => {
            const response = await fetch(`/api/webhooks/${webhookId}/deliveries`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(deliveryId ? { deliveryId } : {}) }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Delivery action failed');
            return payload;
        },
        onSuccess: () => {
            setTimeout(() => queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', selectedWebhookId] }), 500);
            toast({ title: 'Webhook delivery queued' });
        },
        onError: (error: Error) => toast({ title: 'Delivery action failed', description: error.message, variant: 'destructive' }),
    });

    const toggleEvent = (event: string) => setEvents((current) => current.includes(event)
        ? current.filter((candidate) => candidate !== event)
        : [...current, event]);

    return (
        <div className="space-y-6">
            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Webhook className="h-4 w-4" /> Add Webhook</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="webhook-name">Name</Label><Input id="webhook-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Incident automation" /></div>
                    <div className="space-y-2"><Label htmlFor="webhook-url">HTTPS destination</Label><Input id="webhook-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://automation.example.com/compdesk" /></div>
                    <div className="space-y-2"><Label>Events</Label><div className="flex flex-wrap gap-2">{WEBHOOK_EVENTS.map((event) => <Button key={event} type="button" size="sm" variant={events.includes(event) ? 'default' : 'outline'} aria-pressed={events.includes(event)} onClick={() => toggleEvent(event)}>{event}</Button>)}</div></div>
                    <p className="text-xs text-muted-foreground">Destinations must resolve only to public addresses. Deliveries use a timestamped HMAC signature, reject redirects, and retry with bounded exponential backoff.</p>
                    <Button onClick={() => createWebhook.mutate()} disabled={!name.trim() || !url.trim() || events.length === 0 || createWebhook.isPending}>{createWebhook.isPending ? 'Creating…' : 'Create Webhook'}</Button>
                    {latestSecret ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:bg-amber-950/30"><p className="text-sm font-medium">Copy this signing secret now. It is shown only once.</p><code className="mt-2 block break-all text-xs">{latestSecret}</code><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => { void navigator.clipboard.writeText(latestSecret); toast({ title: 'Signing secret copied' }); }}>Copy secret</Button></div> : null}
                </CardContent>
            </Card>

            {webhooksQuery.isError ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{webhooksQuery.error instanceof Error ? webhooksQuery.error.message : 'Failed to load webhooks'} <Button type="button" size="sm" variant="outline" onClick={() => webhooksQuery.refetch()}>Retry</Button></div> : null}
            {(webhooksQuery.data ?? []).map((webhook: any) => (
                <Card key={webhook.id} className="border-0 shadow-sm"><CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{webhook.name}</p><p className="break-all text-xs text-muted-foreground">{webhook.url}</p></div><Switch checked={webhook.isActive} onCheckedChange={(checked) => updateWebhook.mutate({ id: webhook.id, isActive: checked })} /></div>
                    <div className="flex flex-wrap gap-2">{webhook.events.map((event: string) => <Badge key={event} variant="outline">{event}</Badge>)}{webhook.secretNeedsEncryption ? <Badge variant="destructive">Secret migration required</Badge> : null}{webhook.failureCount ? <Badge variant="destructive">{webhook.failureCount} consecutive failures</Badge> : null}</div>
                    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setSelectedWebhookId(webhook.id); deliveryAction.mutate({ webhookId: webhook.id, action: 'test' }); }} disabled={!webhook.isActive}>Send Test</Button><Button type="button" size="sm" variant="outline" onClick={() => setSelectedWebhookId(selectedWebhookId === webhook.id ? null : webhook.id)}>Delivery History</Button><Button type="button" size="sm" variant="outline" onClick={() => updateWebhook.mutate({ id: webhook.id, rotateSecret: true })}>Rotate Secret</Button>{webhook.secretNeedsEncryption ? <Button type="button" size="sm" variant="outline" onClick={() => updateWebhook.mutate({ id: webhook.id, encryptExistingSecret: true })}>Encrypt Existing Secret</Button> : null}<ConfirmDestructiveAction title="Disable webhook?" description={<>Delivery history for <strong>{webhook.name}</strong> will be retained.</>} pending={disableWebhook.isPending} onConfirm={() => disableWebhook.mutate(webhook.id)} trigger={<Button type="button" size="sm" variant="destructive">Disable</Button>} /></div>
                    {selectedWebhookId === webhook.id ? <div className="space-y-2 border-t pt-3"><p className="text-sm font-medium">Recent deliveries</p>{deliveriesQuery.isLoading ? <p className="text-xs text-muted-foreground">Loading delivery history…</p> : (deliveriesQuery.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No deliveries yet.</p> : (deliveriesQuery.data ?? []).map((delivery: any) => <div key={delivery.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"><Badge variant={delivery.status === 'DELIVERED' ? 'default' : delivery.status === 'FAILED' ? 'destructive' : 'outline'}>{delivery.status}</Badge><span>{delivery.event}</span><span>Attempts: {delivery.attemptCount}</span>{delivery.responseStatus ? <span>HTTP {delivery.responseStatus}</span> : null}{delivery.errorStage ? <span>{delivery.errorStage}</span> : null}{delivery.status === 'FAILED' ? <Button type="button" size="sm" variant="outline" onClick={() => deliveryAction.mutate({ webhookId: webhook.id, action: 'retry', deliveryId: delivery.id })}>Retry</Button> : null}</div>)}</div> : null}
                </CardContent></Card>
            ))}
        </div>
    );
}
export default function AdminSettingsPage() {
    return (
        <div className="space-y-6">
            <PageHeader icon={Settings} title="Settings" description="Application configuration" />

            <Tabs defaultValue="branding">
                <TabsList className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="branding" className="gap-1 min-w-max"><Palette className="h-3.5 w-3.5" /> Branding</TabsTrigger>
                    <TabsTrigger value="smtp" className="gap-1 min-w-max"><Mail className="h-3.5 w-3.5" /> SMTP</TabsTrigger>
                    <TabsTrigger value="emails" className="gap-1 min-w-max"><Send className="h-3.5 w-3.5" /> Email Notifications</TabsTrigger>
                    <TabsTrigger value="entra" className="gap-1 min-w-max"><Shield className="h-3.5 w-3.5" /> Entra ID</TabsTrigger>
                    <TabsTrigger value="links" className="gap-1 min-w-max"><LinkIcon className="h-3.5 w-3.5" /> Quick Links</TabsTrigger>
                    <TabsTrigger value="security" className="gap-1 min-w-max"><Lock className="h-3.5 w-3.5" /> Security</TabsTrigger>
                    <TabsTrigger value="features" className="gap-1 min-w-max"><Settings className="h-3.5 w-3.5" /> Features</TabsTrigger>
                    <TabsTrigger value="api" className="gap-1 min-w-max"><Shield className="h-3.5 w-3.5" /> API Clients</TabsTrigger>
                    <TabsTrigger value="webhooks" className="gap-1 min-w-max"><Webhook className="h-3.5 w-3.5" /> Webhooks</TabsTrigger>
                </TabsList>
                <TabsContent value="branding"><BrandingSettings /></TabsContent>
                <TabsContent value="smtp"><SmtpSettingsTab /></TabsContent>
                <TabsContent value="emails"><EmailTogglesTab /></TabsContent>
                <TabsContent value="entra"><EntraSettingsTab /></TabsContent>
                <TabsContent value="links"><DashboardLinksTab /></TabsContent>
                <TabsContent value="security"><SecuritySettingsTab /></TabsContent>
                <TabsContent value="features"><FeatureFlagsTab /></TabsContent>
                <TabsContent value="api"><ApiClientsTab /></TabsContent>
                <TabsContent value="webhooks"><WebhooksTab /></TabsContent>
            </Tabs>
        </div>
    );
}
