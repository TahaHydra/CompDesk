'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Copy, FlaskConical, Save, Shield, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useLanguage } from '@/components/providers/language-provider';
import { SsoProviderLogo } from '@/components/sso-provider-logo';
import { useSettingsDraft } from '@/components/admin/use-settings-draft';
import { copyText } from '@/lib/browser-clipboard';
import { loadSettings, readPemFile, updateSettings, type SettingsMap } from '@/lib/settings-client';
import { OIDC_AUTH_METHODS, parseSsoProvider, SSO_PRESETS, SSO_PROVIDER_OPTIONS, ssoAuthProviderId, type RuntimeSsoProviderId, type SsoProviderOption } from '@/lib/sso-presets';

type Slot = 'entra' | 'oidc' | 'oidc_next';
const ENTRA_FIELDS = ['azure_ad_client_id', 'azure_ad_client_secret', 'azure_ad_tenant_id'];
const OIDC_FIELDS = ['issuer', 'client_id', 'client_secret', 'client_auth_method', 'client_private_key', 'client_certificate', 'client_key_id', 'ca_certificate'];
const slotKeys = (slot: Slot) => slot === 'entra' ? ENTRA_FIELDS : OIDC_FIELDS.map((field) => `${slot}_${field}`);
const slotProviderId = (slot: Slot): RuntimeSsoProviderId => slot === 'entra' ? 'microsoft-entra-id' : slot === 'oidc' ? 'oidc' : 'oidc-next';
const providerSlot = (id: RuntimeSsoProviderId | null): Slot | null => id === 'microsoft-entra-id' ? 'entra' : id === 'oidc' ? 'oidc' : id === 'oidc-next' ? 'oidc_next' : null;
const providerLabel = (option: SsoProviderOption) => option === 'microsoft-entra-id' ? 'Microsoft Entra ID' : option === 'oidc' ? 'Generic OpenID Connect' : SSO_PRESETS[option].label;
const AUTH_METHOD_LABELS: Record<(typeof OIDC_AUTH_METHODS)[number], string> = {
    client_secret_basic: 'Client secret (HTTP Basic, recommended)',
    client_secret_post: 'Client secret (form post)',
    private_key_jwt: 'Private key JWT (certificate)',
};

interface MigrationProgress {
    provider: SsoProviderOption; migrationTarget: SsoProviderOption | null; migrationPhase: 'staging' | 'rollback' | null;
    activeProviderId: RuntimeSsoProviderId; targetProviderId: RuntimeSsoProviderId | null; targetConfigured: boolean;
    users: { active: number; linkedToActive: number; linkedToTarget: number };
    superAdmins: Array<{ id: string; name: string; email: string; hasPassword: boolean; linkedActive: boolean; linkedTarget: boolean }>;
    blockers: string[]; warnings: string[];
}

function StatusLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return <div className="flex items-center gap-2 text-sm">{ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}<span>{children}</span></div>;
}

function ProviderSelect({ id, value, onChange, disabled, exclude }: { id: string; value: SsoProviderOption; onChange: (value: SsoProviderOption) => void; disabled?: boolean; exclude?: SsoProviderOption }) {
    return <Select value={value} disabled={disabled} onValueChange={(next) => onChange(parseSsoProvider(next))}>
        <SelectTrigger id={id} className="sm:max-w-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
            {SSO_PROVIDER_OPTIONS.filter((option) => option !== exclude).map((option) => (
                <SelectItem key={option} value={option}><span className="flex items-center gap-2"><SsoProviderLogo provider={option} className="h-4 w-4" />{providerLabel(option)}</span></SelectItem>
            ))}
        </SelectContent>
    </Select>;
}

async function postJson(url: string, body: unknown) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
    return { ok: response.ok, payload };
}

/**
 * Credentials for one configuration slot. Saving sends only this card's changed fields; optional
 * material is removed with an explicit Remove action (sent as `null`).
 */
function ProviderCredentials({ slot, provider, settings, extraPayload, saveLabel, onSaved }: {
    slot: Slot; provider: SsoProviderOption; settings: SettingsMap | undefined; extraPayload?: Record<string, string>; saveLabel: string; onSaved: () => Promise<void>;
}) {
    const { toast } = useToast();
    const keys = slotKeys(slot);
    const { draft, set, markSaved, changes } = useSettingsDraft(settings, keys);
    const [test, setTest] = useState<{ success: boolean; message: string; stage?: string } | null>(null);
    const editable = settings?.sso_settings_editable !== 'false';
    const key = (field: string) => slot === 'entra' ? field : `${slot}_${field}`;
    const value = (field: string) => draft[key(field)] ?? '';
    const configured = (field: string) => settings?.[`${key(field)}_configured`] === 'true' || Boolean(settings?.[key(field)]);
    const privateKeyJwt = slot !== 'entra' && value('client_auth_method') === 'private_key_jwt';

    const save = useMutation({
        mutationFn: async () => {
            const payload = { ...extraPayload, ...changes() };
            const result = await updateSettings(payload);
            markSaved(Object.keys(payload));
            return result;
        },
        onSuccess: async (result) => { await onSaved(); toast({ title: `${SSO_PRESETS[provider].label} settings saved`, description: [result.warning, result.restartRequired ? 'Restart CompDesk to load the new provider configuration.' : 'No runtime restart is required.'].filter(Boolean).join(' '), variant: result.warning ? 'destructive' : undefined }); },
        onError: (error: Error) => toast({ title: 'Single sign-on settings could not be saved', description: error.message, variant: 'destructive' }),
    });
    const remove = useMutation({
        mutationFn: async (field: string) => updateSettings({ [key(field)]: null } as unknown as Record<string, string>),
        onSuccess: async () => { await onSaved(); toast({ title: 'Removed', description: 'Restart CompDesk for the change to take effect.' }); },
        onError: (error: Error) => toast({ title: 'Could not remove the value', description: error.message, variant: 'destructive' }),
    });
    const runTest = useMutation({
        mutationFn: async () => {
            const { payload } = await postJson('/api/settings/sso-test', { slot, values: changes() });
            setTest(payload);
            return payload;
        },
    });

    const input = (field: string, label: string, options: { secret?: boolean; placeholder?: string } = {}) => (
        <div className="space-y-2">
            <Label htmlFor={`${slot}-${field}`}>{label}</Label>
            <Input id={`${slot}-${field}`} disabled={!editable} autoComplete={options.secret ? 'new-password' : 'off'} type={options.secret ? 'password' : 'text'}
                placeholder={options.secret && configured(field) ? 'Saved secret configured. Enter a new one to replace it.' : options.placeholder}
                value={value(field)} onChange={(event) => set(key(field), event.target.value)} />
        </div>
    );
    const removeButton = (field: string, label: string) => configured(field)
        ? <Button type="button" variant="ghost" size="sm" disabled={!editable || remove.isPending} onClick={() => remove.mutate(field)}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove {label}</Button>
        : null;
    const pem = (field: string, label: string, help: string, placeholder?: string) => (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor={`${slot}-${field}`}>{label}</Label>
                <div className="flex items-center gap-1">
                    {removeButton(field, label.toLowerCase())}
                    <label className={`inline-flex h-8 items-center rounded-md border px-2 text-xs font-medium ${editable ? 'cursor-pointer' : 'opacity-50'}`}><Upload className="mr-1 h-3.5 w-3.5" />Load file
                        <input type="file" accept=".pem,.crt,.cer,.key" className="sr-only" disabled={!editable} onChange={async (event) => {
                            try { const text = await readPemFile(event.target.files?.[0]); if (text !== null) set(key(field), text); }
                            catch (error) { toast({ title: 'File not loaded', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
                            event.target.value = '';
                        }} /></label>
                </div>
            </div>
            <Textarea id={`${slot}-${field}`} rows={4} spellCheck={false} className="font-mono text-xs" disabled={!editable} placeholder={placeholder ?? '-----BEGIN CERTIFICATE-----'} value={value(field)} onChange={(event) => set(key(field), event.target.value)} />
            <p className="text-xs text-muted-foreground">{help}</p>
        </div>
    );

    if (slot === 'entra') {
        return <div className="space-y-4">
            {input('azure_ad_client_id', 'Client ID', { placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' })}
            {input('azure_ad_client_secret', 'Client Secret', { secret: true, placeholder: '••••••••' })}
            {input('azure_ad_tenant_id', 'Tenant ID', { placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' })}
            <div className="flex justify-end border-t pt-4"><Button onClick={() => save.mutate()} disabled={!settings || !editable || save.isPending} className="gap-2"><Save className="h-4 w-4" /> {saveLabel}</Button></div>
        </div>;
    }
    const summary = (field: string) => settings?.[`${slot}_${field}_summary`];
    return <div className="space-y-4">
        {input('issuer', 'Issuer URL', { placeholder: SSO_PRESETS[provider].issuerHint })}
        <p className="-mt-2 text-xs text-muted-foreground">Enter the issuer exactly as published in <code>/.well-known/openid-configuration</code>, including any trailing slash. HTTPS is required.</p>
        {input('client_id', 'Client ID')}
        {!privateKeyJwt ? <div className="space-y-1">{input('client_secret', 'Client Secret', { secret: true, placeholder: '••••••••' })}{settings?.[`${slot}_client_secret_configured`] === 'true' && value('client_auth_method') === 'private_key_jwt' ? removeButton('client_secret', 'client secret') : null}</div> : null}
        <details className="rounded-lg border p-3" open={privateKeyJwt || Boolean(settings?.[`${slot}_ca_certificate`])}>
            <summary className="cursor-pointer text-sm font-medium">Advanced: certificates and client authentication</summary>
            <div className="mt-3 space-y-4">
                {pem('ca_certificate', 'Identity provider CA certificate (optional)', summary('ca_certificate')
                    ? `Current: ${summary('ca_certificate')}. Trusted in addition to the system roots, for this provider only.`
                    : 'For an identity provider whose TLS certificate is issued by a private CA. Trusted in addition to the system roots, for this provider only.')}
                <div className="space-y-2">
                    <Label htmlFor={`${slot}-auth-method`}>Token endpoint authentication</Label>
                    <Select value={value('client_auth_method') || 'client_secret_basic'} disabled={!editable} onValueChange={(next) => set(key('client_auth_method'), next)}>
                        <SelectTrigger id={`${slot}-auth-method`}><SelectValue /></SelectTrigger>
                        <SelectContent>{OIDC_AUTH_METHODS.map((method) => <SelectItem key={method} value={method}>{AUTH_METHOD_LABELS[method]}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
                {privateKeyJwt ? <>
                    {pem('client_private_key', 'Client private key (PEM)', 'RSA (2048+), EC P-256 or EC P-384, unencrypted. Stored in the private configuration file and never returned by the API.',
                        configured('client_private_key') ? 'A private key is configured. Paste or load a new one to replace it.' : '-----BEGIN PRIVATE KEY-----')}
                    {pem('client_certificate', 'Client certificate (optional, PEM)', summary('client_certificate')
                        ? `Current: ${summary('client_certificate')}. Adds an x5t#S256 thumbprint for providers that identify keys by certificate.`
                        : 'Adds an x5t#S256 thumbprint for providers that identify keys by certificate.')}
                    <div className="space-y-1">{input('client_key_id', 'Key ID (kid, optional)')}{removeButton('client_key_id', 'key ID')}</div>
                    <p className="text-xs text-muted-foreground">Assertions use the issuer as their only audience (draft-ietf-oauth-rfc7523bis), expire after 60 seconds, and carry a unique jti.</p>
                </> : null}
            </div>
        </details>
        {test ? <div role="status" className={`rounded-lg border p-3 text-sm ${test.success ? 'border-green-300 bg-green-50 text-green-900' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>{test.message}</div> : null}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button type="button" variant="outline" className="gap-2" disabled={!settings || runTest.isPending} onClick={() => runTest.mutate()}><FlaskConical className="h-4 w-4" />{runTest.isPending ? 'Testing…' : 'Test configuration'}</Button>
            <Button className="ml-auto gap-2" onClick={() => save.mutate()} disabled={!settings || !editable || save.isPending}><Save className="h-4 w-4" /> {saveLabel}</Button>
        </div>
    </div>;
}

function CallbackUrl({ base, providerId, label }: { base: string; providerId: RuntimeSsoProviderId; label: string }) {
    const { toast } = useToast();
    const url = `${base}/api/auth/callback/${providerId}`;
    return <div className="space-y-2">
        <Label htmlFor={`callback-${providerId}`}>Redirect URI to register with {label}</Label>
        <div className="flex gap-2">
            <Input id={`callback-${providerId}`} readOnly value={url} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" aria-label="Copy redirect URI" onClick={async () => toast({ title: (await copyText(url)) ? 'Redirect URI copied' : 'Copy failed' })}><Copy className="h-4 w-4" /></Button>
        </div>
    </div>;
}

function MigrationCard({ settings, base, onChanged }: { settings: SettingsMap | undefined; base: string; onChanged: () => Promise<void> }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const progressQuery = useQuery<MigrationProgress>({ queryKey: ['sso-migration'], queryFn: async () => { const response = await fetch('/api/settings/sso-migration'); if (!response.ok) throw new Error('Migration status unavailable'); return response.json(); } });
    const progress = progressQuery.data;
    const [target, setTarget] = useState<SsoProviderOption>('oidc');
    const [prune, setPrune] = useState(false);
    const action = useMutation({
        mutationFn: async (body: Record<string, unknown>) => {
            const { ok, payload } = await postJson('/api/settings/sso-migration', body);
            if (!ok) throw new Error(payload.error || 'Migration action failed');
            return payload as MigrationProgress & { restartRequired?: boolean };
        },
        onSuccess: async (result, body) => {
            queryClient.setQueryData(['sso-migration'], result);
            await onChanged();
            toast({ title: `Migration: ${String(body.action)} completed`, description: result.restartRequired ? 'Restart CompDesk to unload the previous provider.' : undefined });
        },
        onError: (error: Error) => toast({ title: 'Migration action refused', description: error.message, variant: 'destructive' }),
    });
    if (!progress) return null;
    const targetSlot = providerSlot(progress.targetProviderId);
    const targetLabel = progress.migrationTarget ? SSO_PRESETS[progress.migrationTarget].label : '';

    return <Card className="border-0 shadow-sm">
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ArrowRightLeft className="h-4 w-4" /> SSO migration</CardTitle>
            <CardDescription>Move to a new identity provider without locking anyone out: users link the new provider while the current one keeps working, then you cut over. Accounts are never matched by email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            {!progress.migrationTarget ? <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 space-y-2"><Label htmlFor="migration-target">New provider</Label><ProviderSelect id="migration-target" value={target} onChange={setTarget} exclude={progress.provider} /></div>
                <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ action: 'start', target })}>Start migration</Button>
            </div> : <>
                <div className="flex items-center gap-2 text-sm"><SsoProviderLogo provider={progress.provider} /> {SSO_PRESETS[progress.provider].label} <ArrowRightLeft className="h-4 w-4 text-muted-foreground" /> <SsoProviderLogo provider={progress.migrationTarget} /> {targetLabel} · {progress.migrationPhase === 'staging' ? 'linking in progress' : 'cut over; rollback available'}</div>
                {progress.migrationPhase === 'staging' && targetSlot ? <>
                    <ProviderCredentials slot={targetSlot} provider={progress.migrationTarget} settings={settings} saveLabel={`Save ${targetLabel} settings`} onSaved={async () => { await onChanged(); await progressQuery.refetch(); }} />
                    <CallbackUrl base={base} providerId={slotProviderId(targetSlot)} label={targetLabel} />
                    <StatusLine ok={progress.targetConfigured}>{progress.targetConfigured ? `${targetLabel} is active for linking. Users link it from Profile.` : `${targetLabel} is not loaded yet: save its settings, then restart CompDesk.`}</StatusLine>
                </> : null}
                <div className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">Progress</p>
                    <p className="text-muted-foreground">{progress.users.linkedToTarget} of {progress.users.active} active users have linked {targetLabel}.</p>
                    <ul className="mt-2 space-y-1">
                        {progress.superAdmins.map((admin) => <li key={admin.id} className="flex items-center gap-2 text-xs">{admin.linkedTarget ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}{admin.name} ({admin.email}) · Super Admin{admin.hasPassword ? ' · local password' : ''}</li>)}
                    </ul>
                </div>
                {progress.blockers.map((blocker) => <StatusLine key={blocker} ok={false}>{blocker}</StatusLine>)}
                {progress.warnings.map((warning) => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                    {progress.migrationPhase === 'staging' ? <>
                        <Button variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ action: 'cancel' })}>Cancel migration</Button>
                        <Button className="ml-auto" disabled={action.isPending || progress.blockers.length > 0} onClick={() => action.mutate({ action: 'cutover' })}>Cut over to {targetLabel}</Button>
                    </> : <>
                        <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ action: 'rollback' })}>Roll back to {targetLabel}</Button>
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={prune} onChange={(event) => setPrune(event.target.checked)} />Also remove {targetLabel} account links</label>
                        <Button className="ml-auto" disabled={action.isPending} onClick={() => action.mutate({ action: 'finish', pruneOldBindings: prune })}>Finish migration</Button>
                    </>}
                </div>
            </>}
        </CardContent>
    </Card>;
}

export function SsoSettings() {
    const { t } = useLanguage();
    const { toast } = useToast();
    const router = useRouter();
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<SettingsMap>({ queryKey: ['settings'], queryFn: loadSettings, throwOnError: true });
    const [selected, setSelected] = useState<SsoProviderOption | null>(null);
    const [origin, setOrigin] = useState('');
    const button = useSettingsDraft(settings, ['login_sso_enabled', 'sso_button_text']);
    useEffect(() => { setOrigin(window.location.origin); }, []);

    const activeProvider = parseSsoProvider(settings?.sso_provider);
    const provider = selected ?? activeProvider;
    const activeOidcSlot: Slot = settings?.sso_oidc_slot === 'oidc-next' ? 'oidc_next' : 'oidc';
    const slot: Slot = ssoAuthProviderId(provider) === 'microsoft-entra-id' ? 'entra' : activeOidcSlot;
    const base = settings?.sso_callback_base || origin;
    const migrationInProgress = Boolean(settings?.sso_migration_target);
    const editable = settings?.sso_settings_editable !== 'false';
    const runtimeConfigured = settings?.[slot === 'entra' ? 'azure_ad_runtime_configured' : `${slot}_runtime_configured`] === 'true';
    const restartRequired = settings?.[slot === 'entra' ? 'azure_ad_restart_required' : `${slot}_restart_required`] === 'true';

    const refresh = async () => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['settings'] }), queryClient.invalidateQueries({ queryKey: ['branding'] }), queryClient.invalidateQueries({ queryKey: ['sso-migration'] })]);
        router.refresh();
    };
    const buttonMutation = useMutation({
        mutationFn: async () => {
            const payload = button.changes();
            if (Object.keys(payload).length) await updateSettings(payload);
            button.markSaved(Object.keys(payload));
        },
        onSuccess: async () => { await refresh(); toast({ title: 'Login button saved' }); },
        onError: (error: Error) => toast({ title: 'Login button could not be saved', description: error.message, variant: 'destructive' }),
    });
    const [diagnostic, setDiagnostic] = useState<{ success: boolean; correlationId: string; stage: string; message?: string; error?: string } | null>(null);
    const diagnosticMutation = useMutation({
        mutationFn: async () => {
            const { payload } = await postJson('/api/settings/entra-diagnostic', {});
            setDiagnostic(payload);
            return payload;
        },
    });

    return (
        <div className="space-y-4">
            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> Identity provider</CardTitle>
                    <CardDescription>One provider is active at a time. Microsoft Entra ID is the default; every other option uses standard OpenID Connect.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="sso-provider">Provider</Label>
                        <ProviderSelect id="sso-provider" value={provider} onChange={setSelected} disabled={migrationInProgress} />
                        {migrationInProgress ? <p className="text-xs text-muted-foreground">An SSO migration is in progress; the provider changes through the migration below.</p> : null}
                        {provider !== activeProvider ? <p className="text-xs text-amber-700 dark:text-amber-300">Currently active: {SSO_PRESETS[activeProvider].label}. A direct switch requires local login and a Super Admin with a password; existing links to {SSO_PRESETS[activeProvider].label} are kept but cannot sign in. Use SSO migration to move users without interruption.</p> : null}
                    </div>
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                            {t('Changes to single sign-on settings require an application restart to take effect.')}
                            {' '}{t(editable ? 'Changes are saved persistently. Managed Docker installations store them in the private configuration volume; restart the CompDesk container after saving.' : 'This deployment manages single sign-on through environment variables. Configure the deployment and restart CompDesk; these fields are read-only.')}
                        </p>
                    </div>
                    <ProviderCredentials key={`${slot}-${provider}`} slot={slot} provider={provider} settings={settings} saveLabel={provider === activeProvider ? `Save ${SSO_PRESETS[provider].label} settings` : `Switch to ${SSO_PRESETS[provider].label}`}
                        extraPayload={provider !== activeProvider ? { sso_provider: provider } : undefined} onSaved={async () => { setSelected(null); await refresh(); }} />
                    <CallbackUrl base={base} providerId={slotProviderId(slot)} label={SSO_PRESETS[provider].label} />
                    <StatusLine ok={runtimeConfigured && !restartRequired}>{restartRequired ? 'Saved; application restart required' : runtimeConfigured ? `${SSO_PRESETS[provider].label} is loaded in the running application` : 'Incomplete configuration'}</StatusLine>
                    {slot === 'entra' ? <div className="space-y-2">
                        <Button variant="outline" onClick={() => diagnosticMutation.mutate()} disabled={diagnosticMutation.isPending} className="gap-2"><Shield className="h-4 w-4" />{diagnosticMutation.isPending ? 'Testing running configuration…' : 'Diagnose Running Entra Configuration'}</Button>
                        {diagnostic ? <div className={`rounded-lg border p-3 text-sm ${diagnostic.success ? 'border-green-300 bg-green-50 text-green-900' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}><p>{diagnostic.message ?? diagnostic.error}</p><p className="mt-1 text-xs">Stage: {diagnostic.stage} · Correlation ID: {diagnostic.correlationId}</p></div> : null}
                    </div> : null}
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-base">Login button</CardTitle>
                    <CardDescription>Controls the single sign-on button on the sign-in page. The server enforces this switch and never allows a configuration that would lock administrators out.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-5 rounded-lg border p-4">
                        <div className="flex items-center gap-3"><SsoProviderLogo provider={activeProvider} /><div><p className="font-medium">Show {SSO_PRESETS[activeProvider].label} login</p><p className="text-sm text-muted-foreground">Appears only while the active provider is loaded in the running application.</p></div></div>
                        <Switch checked={button.draft.login_sso_enabled === 'true'} onCheckedChange={(enabled) => button.set('login_sso_enabled', String(enabled))} aria-label="Show single sign-on login" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sso-button-text">Button text</Label>
                        <Input id="sso-button-text" maxLength={80} value={button.draft.sso_button_text ?? ''} onChange={(event) => button.set('sso_button_text', event.target.value)} />
                    </div>
                    <div className="flex justify-end border-t pt-4">
                        <Button className="gap-2" onClick={() => buttonMutation.mutate()} disabled={!settings || buttonMutation.isPending || !(button.draft.sso_button_text ?? '').trim()}><Save className="h-4 w-4" /> Save login button</Button>
                    </div>
                </CardContent>
            </Card>

            <MigrationCard settings={settings} base={base} onChanged={refresh} />
        </div>
    );
}
