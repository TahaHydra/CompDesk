'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Settings, Mail, Shield, Send, Save, AlertTriangle, CheckCircle2, Link as LinkIcon, Plus, X, Lock } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect } from 'react';

type SettingsMap = Record<string, string>;

function SmtpSettingsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: async () => { const res = await fetch('/api/settings'); return res.json(); },
    });

    const [smtp, setSmtp] = useState({
        smtp_host: '', smtp_port: '587', smtp_user: '', smtp_password: '', smtp_from: '', smtp_secure: 'false',
    });

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
        mutationFn: async () => {
            const res = await fetch('/api/settings', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(smtp),
            });
            if (!res.ok) throw new Error('Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'SMTP settings saved' });
        },
        onError: () => toast({ title: 'Failed to save', variant: 'destructive' }),
    });

    const testMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/settings/test-email', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            return data;
        },
        onSuccess: (data) => toast({ title: '✅ Test email sent!', description: data.message }),
        onError: (err: Error) => toast({ title: 'Test failed', description: err.message, variant: 'destructive' }),
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
                    <div className="grid grid-cols-2 gap-4">
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
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Username / Email</Label>
                            <Input placeholder="noreply@exco.fr" value={smtp.smtp_user}
                                onChange={(e) => setSmtp({ ...smtp, smtp_user: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input type="password" placeholder="••••••••" value={smtp.smtp_password}
                                onChange={(e) => setSmtp({ ...smtp, smtp_password: e.target.value })} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>From Address</Label>
                            <Input placeholder="noreply@exco.fr" value={smtp.smtp_from}
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
                        </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
                            <Save className="h-4 w-4" /> Save Settings
                        </Button>
                        <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="gap-2">
                            <Send className="h-4 w-4" /> {testMutation.isPending ? 'Sending...' : 'Send Test Email'}
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
        queryFn: async () => { const res = await fetch('/api/settings'); return res.json(); },
    });

    const toggles = [
        { key: 'email_on_ticket_created', label: 'Ticket Created', desc: 'Notify requester and watchers when a ticket is created' },
        { key: 'email_on_ticket_assigned', label: 'Ticket Assigned', desc: 'Notify the agent when a ticket is assigned to them' },
        { key: 'email_on_ticket_updated', label: 'Status Changed', desc: 'Notify requester when ticket status changes' },
        { key: 'email_on_new_comment', label: 'New Comment', desc: 'Notify watchers when a new comment is added' },
    ];

    const saveMutation = useMutation({
        mutationFn: async (data: Record<string, string>) => {
            const res = await fetch('/api/settings', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Email preferences saved' });
        },
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
        queryFn: async () => { const res = await fetch('/api/settings'); return res.json(); },
    });

    const [entra, setEntra] = useState({
        azure_ad_client_id: '', azure_ad_client_secret: '', azure_ad_tenant_id: '',
    });

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
        mutationFn: async () => {
            const res = await fetch('/api/settings', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(entra),
            });
            if (!res.ok) throw new Error('Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Entra ID settings saved' });
        },
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
                            Settings saved here will override environment variables.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label>Client ID</Label>
                        <Input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={entra.azure_ad_client_id}
                            onChange={(e) => setEntra({ ...entra, azure_ad_client_id: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label>Client Secret</Label>
                        <Input type="password" placeholder="••••••••" value={entra.azure_ad_client_secret}
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
                    <CardTitle className="text-base">Security Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-green-600" /><span>CSP Headers: Active</span></div>
                    <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-green-600" /><span>HSTS: Active</span></div>
                    <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-green-600" /><span>Rate Limiting: Active</span></div>
                    <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-green-600" /><span>XSS Protection: Active</span></div>
                </CardContent>
            </Card>
        </div>
    );
}

function DashboardLinksTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: async () => { const res = await fetch('/api/settings'); return res.json(); },
    });

    const [links, setLinks] = useState<{ title: string, url: string }[]>([]);

    useEffect(() => {
        if (settings?.dashboard_links) {
            try {
                setLinks(JSON.parse(settings.dashboard_links));
            } catch {
                setLinks([]);
            }
        }
    }, [settings]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            // Normalize URLs — prepend https:// if no protocol is specified
            const normalizedLinks = links.map(link => ({
                ...link,
                url: link.url && !/^https?:\/\//i.test(link.url) ? `https://${link.url}` : link.url,
            }));
            const res = await fetch('/api/settings', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboard_links: JSON.stringify(normalizedLinks) }),
            });
            if (!res.ok) throw new Error('Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Dashboard links saved' });
        },
    });

    const addLink = () => setLinks([...links, { title: '', url: '' }]);
    const removeLink = (index: number) => setLinks(links.filter((_, i) => i !== index));
    const updateLink = (index: number, field: 'title' | 'url', val: string) => {
        const newLinks = [...links];
        newLinks[index][field] = val;
        setLinks(newLinks);
    };

    return (
        <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                    <LinkIcon className="h-4 w-4" /> Custom Dashboard Links
                </CardTitle>
                <Button variant="outline" size="sm" onClick={addLink} className="gap-1 h-8">
                    <Plus className="h-3.5 w-3.5" /> Add Link
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 mb-4 flex items-start gap-2">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                        These links will appear as clickable cards on the main dashboard for all users. Useful for pointing to external resources like SharePoint, HR tools, or Intranet pages.
                    </p>
                </div>

                {links.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                        No custom links added yet.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {links.map((link, i) => (
                            <div key={i} className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border">
                                <div className="flex-1 space-y-1">
                                    <Label className="text-xs text-muted-foreground">Title</Label>
                                    <Input placeholder="e.g. Leave Request Form" value={link.title} onChange={(e) => updateLink(i, 'title', e.target.value)} />
                                </div>
                                <div className="flex-[2] space-y-1">
                                    <Label className="text-xs text-muted-foreground">URL</Label>
                                    <Input placeholder="https://..." value={link.url} onChange={(e) => updateLink(i, 'url', e.target.value)} />
                                </div>
                                <Button variant="ghost" size="icon" className="mt-5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeLink(i)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="pt-4">
                    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
                        <Save className="h-4 w-4" /> Save Links
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function SecuritySettingsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<SettingsMap>({
        queryKey: ['settings'],
        queryFn: async () => { const res = await fetch('/api/settings'); return res.json(); },
    });

    const localEnabled = settings?.login_local_enabled !== 'false';

    const toggleMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            const res = await fetch('/api/settings', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login_local_enabled: String(enabled) }),
            });
            if (!res.ok) throw new Error('Failed');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast({ title: 'Security setting updated' });
        },
    });

    return (
        <Card className="mt-4">
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

export default function AdminSettingsPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Settings className="h-8 w-8 text-primary" /> Settings
                </h1>
                <p className="text-muted-foreground mt-1">Application configuration</p>
            </div>

            <Tabs defaultValue="smtp">
                <TabsList className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="smtp" className="gap-1 min-w-max"><Mail className="h-3.5 w-3.5" /> SMTP</TabsTrigger>
                    <TabsTrigger value="emails" className="gap-1 min-w-max"><Send className="h-3.5 w-3.5" /> Email Notifications</TabsTrigger>
                    <TabsTrigger value="entra" className="gap-1 min-w-max"><Shield className="h-3.5 w-3.5" /> Entra ID</TabsTrigger>
                    <TabsTrigger value="links" className="gap-1 min-w-max"><LinkIcon className="h-3.5 w-3.5" /> Quick Links</TabsTrigger>
                    <TabsTrigger value="security" className="gap-1 min-w-max"><Lock className="h-3.5 w-3.5" /> Security</TabsTrigger>
                </TabsList>
                <TabsContent value="smtp"><SmtpSettingsTab /></TabsContent>
                <TabsContent value="emails"><EmailTogglesTab /></TabsContent>
                <TabsContent value="entra"><EntraSettingsTab /></TabsContent>
                <TabsContent value="links"><DashboardLinksTab /></TabsContent>
                <TabsContent value="security"><SecuritySettingsTab /></TabsContent>
            </Tabs>
        </div>
    );
}
