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
import { Settings, Mail, Shield, Send, Save, AlertTriangle, CheckCircle2, Link as LinkIcon, Plus, X, Lock, Palette, Upload, Loader2 } from 'lucide-react';
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

    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: loadSettings,
        throwOnError: true,
    });

    const [smtp, setSmtp] = useState({
        smtp_host: '', smtp_port: '587', smtp_user: '', smtp_password: '', smtp_from: '', smtp_secure: 'false',
    });
    const smtpPasswordConfigured = settings?.smtp_password_configured === 'true';
    const hasUnsavedChanges = Boolean(settings) && (
        smtp.smtp_password.length > 0
        || smtp.smtp_host !== (settings?.smtp_host ?? '')
        || smtp.smtp_port !== (settings?.smtp_port ?? '587')
        || smtp.smtp_user !== (settings?.smtp_user ?? '')
        || smtp.smtp_from !== (settings?.smtp_from ?? '')
        || smtp.smtp_secure !== (settings?.smtp_secure ?? 'false')
    );

    useEffect(() => {
        if (settings) {
            setSmtp((prev) => ({
                smtp_host: settings.smtp_host ?? prev.smtp_host,
                smtp_port: settings.smtp_port ?? prev.smtp_port,
                smtp_user: settings.smtp_user ?? prev.smtp_user,
                smtp_password: settings.smtp_password ?? prev.smtp_password,
                smtp_from: settings.smtp_from ?? prev.smtp_from,
                smtp_secure: settings.smtp_secure ?? prev.smtp_secure,
            }));
        }
    }, [settings]);

    const saveMutation = useMutation({
        mutationFn: async () => updateSettings(smtp),
        onSuccess: () => {
            setSmtp((current) => ({ ...current, smtp_password: '' }));
            void queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'SMTP settings saved' });
        },
        onError: (error: Error) => toast({ title: 'Failed to save SMTP settings', description: error.message, variant: 'destructive' }),
    });

    const testMutation = useMutation({
        mutationFn: async () => {
            await updateSettings(smtp);
            const response = await fetch('/api/settings/test-email', { method: 'POST' });
            const data = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
            if (!response.ok) throw new Error(`Settings were saved, but the delivery test failed. ${data.error || 'Unknown SMTP error'}`);
            return data;
        },
        onSuccess: (data) => {
            setSmtp((current) => ({ ...current, smtp_password: '' }));
            void queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Test email sent', description: data.message });
        },
        onError: (err: Error) => toast({ title: 'SMTP test failed', description: err.message, variant: 'destructive' }),
    });

    return (
        <div className="space-y-6">
            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Mail className="h-4 w-4" /> SMTP Configuration
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>SMTP Host</Label>
                            <Input placeholder="smtp.office365.com" value={smtp.smtp_host}
                                onChange={(e) => setSmtp({ ...smtp, smtp_host: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Port</Label>
                            <Input placeholder="587" value={smtp.smtp_port}
                                onChange={(e) => setSmtp({ ...smtp, smtp_port: e.target.value })} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Username / Email</Label>
                            <Input placeholder="noreply@example.com" value={smtp.smtp_user}
                                onChange={(e) => setSmtp({ ...smtp, smtp_user: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input
                                type="password"
                                placeholder={smtpPasswordConfigured ? 'Saved password configured. Enter a new one to replace it.' : '••••••••'}
                                value={smtp.smtp_password}
                                onChange={(e) => setSmtp({ ...smtp, smtp_password: e.target.value })} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>From Address</Label>
                            <Input placeholder="noreply@example.com" value={smtp.smtp_from}
                                onChange={(e) => setSmtp({ ...smtp, smtp_from: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Secure (TLS)</Label>
                            <Select value={smtp.smtp_secure} onValueChange={(v) => setSmtp({ ...smtp, smtp_secure: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="false">STARTTLS (port 587)</SelectItem>
                                    <SelectItem value="true">SSL/TLS (port 465)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">Use STARTTLS with port 587 unless your provider explicitly requires implicit TLS on port 465.</p>
                        </div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                        <p>This test opens a real SMTP connection and sends a message to the signed-in administrator. It saves the fields above first, so the values you see are the values being tested.</p>
                        <p className="mt-1">Password: {smtpPasswordConfigured ? 'configured' : 'missing'}{hasUnsavedChanges ? ' · Unsaved changes' : ''}</p>
                    </div>
                    <div className="flex flex-wrap gap-3 pt-2">
                        <Button onClick={() => saveMutation.mutate()} disabled={!settings || saveMutation.isPending || testMutation.isPending} className="gap-2">
                            <Save className="h-4 w-4" /> {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
                        </Button>
                        <Button variant="outline" onClick={() => testMutation.mutate()} disabled={!settings || testMutation.isPending || saveMutation.isPending} className="gap-2">
                            <Send className="h-4 w-4" /> {testMutation.isPending ? 'Saving and sending...' : 'Save & Send Test Email'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
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
        const current = settings?.[key] !== 'false'; // default true
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
                    const enabled = settings?.[t.key] !== 'false';
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
                                disabled={saveMutation.isPending}
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
                        <Label>Client ID</Label>
                        <Input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={entra.azure_ad_client_id}
                            onChange={(e) => setEntra({ ...entra, azure_ad_client_id: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label>Client Secret</Label>
                        <Input
                            type="password"
                            placeholder={entraSecretConfigured ? 'Saved secret configured. Enter a new one to replace it.' : '••••••••'}
                            value={entra.azure_ad_client_secret}
                            onChange={(e) => setEntra({ ...entra, azure_ad_client_secret: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label>Tenant ID</Label>
                        <Input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={entra.azure_ad_tenant_id}
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
                    </div>
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
                        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Icon (optional)</Label><div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border bg-card">{link.iconUrl ? <Image src={link.iconUrl} alt="" width={32} height={32} className="h-8 w-8 object-contain" unoptimized /> : <LinkIcon className="h-4 w-4 text-muted-foreground" />}</div><label className="inline-flex h-9 cursor-pointer items-center rounded-md border bg-background px-3 text-xs font-medium">{uploadingIndex === index ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,.ico" className="sr-only" disabled={uploadingIndex !== null} onChange={(event) => uploadIcon(index, event.target.files?.[0])} /></label>{link.iconUrl ? <Button type="button" variant="ghost" size="icon" onClick={() => updateCommon(index, { iconUrl: '' })}><X className="h-4 w-4" /></Button> : null}</div></div>
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
                    allowedQueueIds: selectedQueueIds,
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
                        <Label>Department Restriction</Label>
                        <p className="text-xs text-muted-foreground">Leave empty to allow all departments.</p>
                        <div className="flex gap-2 flex-wrap">
                            {(queues ?? []).map((queue: any) => {
                                const selected = selectedQueueIds.includes(queue.id);
                                return (
                                    <Button key={queue.id} type="button" variant={selected ? 'default' : 'outline'} size="sm" onClick={() => toggleQueue(queue.id)}>
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
                                    {(client.allowedQueueIds ?? []).length === 0 ? (
                                        <Badge variant="outline">All departments</Badge>
                                    ) : (
                                        client.allowedQueueIds.map((queueId: string) => (
                                            <Badge key={queueId} variant="outline">{queueId}</Badge>
                                        ))
                                    )}
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
                </TabsList>
                <TabsContent value="branding"><BrandingSettings /></TabsContent>
                <TabsContent value="smtp"><SmtpSettingsTab /></TabsContent>
                <TabsContent value="emails"><EmailTogglesTab /></TabsContent>
                <TabsContent value="entra"><EntraSettingsTab /></TabsContent>
                <TabsContent value="links"><DashboardLinksTab /></TabsContent>
                <TabsContent value="security"><SecuritySettingsTab /></TabsContent>
                <TabsContent value="features"><FeatureFlagsTab /></TabsContent>
                <TabsContent value="api"><ApiClientsTab /></TabsContent>
            </Tabs>
        </div>
    );
}
