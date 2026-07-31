/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ImageIcon, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import type { BrandingAssetField, BrandingConfig, PublicBranding } from '@/lib/branding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDestructiveAction } from '@/components/ui/confirm-destructive-action';
import { brandingConfigSchema } from '@/lib/branding-schema';
import {
    getBrandingApiFieldErrors,
    getBrandingFieldErrors,
    mergeSavedPublicBranding,
    prepareBrandingForSave,
    type BrandingFieldErrors,
} from '@/lib/branding-form';

const ASSETS: Array<{ field: BrandingAssetField; label: string; help: string }> = [
    { field: 'mainLogoUrl', label: 'Main logo', help: 'Default full-size logo' },
    { field: 'compactLogoUrl', label: 'Compact logo / icon', help: 'Collapsed sidebar and small surfaces' },
    { field: 'lightLogoUrl', label: 'Light-mode logo', help: 'Optional light-theme override' },
    { field: 'darkLogoUrl', label: 'Dark-mode logo', help: 'Optional dark-theme override' },
    { field: 'faviconUrl', label: 'Favicon', help: 'Browser tab icon; ICO or square image recommended' },
    { field: 'loginBackgroundImageUrl', label: 'Login background', help: 'Optional full-page background image' },
];

class BrandingRequestError extends Error {
    constructor(message: string, readonly fieldErrors: BrandingFieldErrors = {}) {
        super(message);
        this.name = 'BrandingRequestError';
    }
}

async function responseJson<T>(response: Response): Promise<T> {
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message = data && typeof data === 'object' && !Array.isArray(data)
            && typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error
            : `Request failed with status ${response.status}`;
        throw new BrandingRequestError(message, getBrandingApiFieldErrors(data));
    }
    return data as T;
}

export function BrandingSettings() {
    const { toast } = useToast();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [form, setForm] = useState<BrandingConfig | null>(null);
    const [uploading, setUploading] = useState<BrandingAssetField | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [serverFieldErrors, setServerFieldErrors] = useState<BrandingFieldErrors>({});
    const query = useQuery<BrandingConfig>({
        queryKey: ['branding', 'admin'],
        queryFn: async () => responseJson(await fetch('/api/branding/admin', { cache: 'no-store' })),
    });
    const publicBrandingQuery = useQuery<PublicBranding>({
        queryKey: ['branding', 'public'],
        queryFn: async () => responseJson(await fetch('/api/branding', { cache: 'no-store' })),
    });
    useEffect(() => { if (query.data && !isDirty) setForm(query.data); }, [isDirty, query.data]);

    const updateBrandingCaches = (branding: BrandingConfig) => {
        queryClient.setQueryData(['branding', 'admin'], branding);
        queryClient.setQueryData<PublicBranding>(
            ['branding', 'public'],
            (current) => mergeSavedPublicBranding(branding, current)
        );
        void queryClient.invalidateQueries({ queryKey: ['branding', 'public'] });
    };

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!form) throw new BrandingRequestError('Branding configuration is not loaded');
            const prepared = prepareBrandingForSave(form);
            const parsed = brandingConfigSchema.safeParse(prepared);
            if (!parsed.success) {
                throw new BrandingRequestError('Review the highlighted branding fields', getBrandingFieldErrors(prepared));
            }
            return responseJson<BrandingConfig>(await fetch('/api/branding/admin', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed.data),
            }));
        },
        onSuccess: (branding) => {
            setForm(branding);
            setIsDirty(false);
            setServerFieldErrors({});
            updateBrandingCaches(branding);
            toast({ title: 'Branding saved', description: 'The application shell and sign-in page have been refreshed.' });
            router.refresh();
        },
        onError: (error: Error) => {
            setServerFieldErrors(error instanceof BrandingRequestError ? error.fieldErrors : {});
            toast({ title: 'Branding could not be saved', description: error.message, variant: 'destructive' });
        },
    });
    const resetMutation = useMutation({
        mutationFn: async () => responseJson<BrandingConfig>(await fetch('/api/branding/admin', { method: 'DELETE' })),
        onSuccess: (branding) => {
            setForm(branding);
            setIsDirty(false);
            setServerFieldErrors({});
            updateBrandingCaches(branding);
            toast({ title: 'Default branding restored' });
            router.refresh();
        },
        onError: (error: Error) => toast({ title: 'Branding reset failed', description: error.message, variant: 'destructive' }),
    });

    const update = <K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) => {
        setIsDirty(true);
        setServerFieldErrors((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });
        setForm((current) => current ? { ...current, [key]: value } : current);
    };
    const uploadAsset = async (field: BrandingAssetField, file: File) => {
        setUploading(field);
        try {
            const body = new FormData();
            body.set('field', field); body.set('file', file);
            const result = await responseJson<{ url: string; branding: BrandingConfig }>(await fetch('/api/branding/assets', { method: 'POST', body }));
            setForm((current) => current ? { ...current, [field]: result.url } : result.branding);
            updateBrandingCaches(result.branding);
            toast({ title: 'Brand asset uploaded', description: 'The asset is saved immediately. Save branding to apply any other unsaved changes.' });
            router.refresh();
        } catch (error) {
            toast({ title: 'Asset upload failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
        } finally {
            setUploading(null);
        }
    };
    const resetAsset = async (field: BrandingAssetField) => {
        setUploading(field);
        try {
            const result = await responseJson<{ branding: BrandingConfig }>(await fetch(`/api/branding/assets?field=${field}`, { method: 'DELETE' }));
            setForm((current) => current ? { ...current, [field]: '' } : result.branding);
            updateBrandingCaches(result.branding);
            router.refresh();
        } catch (error) {
            toast({ title: 'Asset reset failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
        } finally {
            setUploading(null);
        }
    };

    if (query.isError) {
        const message = query.error instanceof Error ? query.error.message : 'Branding configuration could not be loaded.';
        return (
            <Card className="mt-4">
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                    <p className="text-sm font-medium text-destructive">Branding configuration could not be loaded.</p>
                    <p className="max-w-xl text-sm text-muted-foreground">{message}</p>
                    <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
                        {query.isFetching ? 'Retrying…' : 'Retry'}
                    </Button>
                </CardContent>
            </Card>
        );
    }
    if (query.isLoading || !form) return <Card className="mt-4"><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading branding configuration…</CardContent></Card>;

    const preparedForm = prepareBrandingForSave(form);
    const clientFieldErrors = getBrandingFieldErrors(preparedForm);
    const fieldErrors = { ...clientFieldErrors, ...serverFieldErrors };
    const hasFieldErrors = Object.keys(fieldErrors).length > 0;
    const demoInformationMissing = form.showDemoAccounts && !form.demoAccountInfo.trim();
    const microsoftLoginConfigured = publicBrandingQuery.data?.microsoftLoginConfigured === true;
    const savePending = saveMutation.isPending || resetMutation.isPending || uploading !== null;
    const colorPattern = /^#[0-9a-fA-F]{6}$/;
    const previewPrimary = colorPattern.test(form.primaryColor) ? form.primaryColor : '#4f46e5';
    const previewAccent = colorPattern.test(form.accentColor) ? form.accentColor : '#8b5cf6';

    return (
        <div className="mt-4 space-y-6">
            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle>Brand identity</CardTitle><CardDescription>Names and descriptions used in metadata, navigation, login, and messages.</CardDescription></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    <TextSetting label="Application name" value={form.applicationName} error={fieldErrors.applicationName} onChange={(value) => update('applicationName', value)} />
                    <TextSetting label="Short application name" value={form.shortApplicationName} error={fieldErrors.shortApplicationName} onChange={(value) => update('shortApplicationName', value)} />
                    <TextSetting label="Subtitle / tagline" value={form.subtitle} error={fieldErrors.subtitle} onChange={(value) => update('subtitle', value)} />
                    <TextSetting label="Support email" type="email" value={form.supportEmail} error={fieldErrors.supportEmail} onChange={(value) => update('supportEmail', value)} />
                    <div className="space-y-2 md:col-span-2"><Label htmlFor="branding-description">Helpdesk description</Label><Textarea id="branding-description" value={form.description} aria-invalid={Boolean(fieldErrors.description)} onChange={(event) => update('description', event.target.value)} /><FieldError message={fieldErrors.description} /></div>
                    <div className="space-y-2 md:col-span-2"><Label htmlFor="branding-footer">Footer text</Label><Input id="branding-footer" value={form.footerText} aria-invalid={Boolean(fieldErrors.footerText)} onChange={(event) => update('footerText', event.target.value)} /><FieldError message={fieldErrors.footerText} /></div>
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle>Theme colors</CardTitle><CardDescription>Applied globally through CSS variables in both light and dark themes.</CardDescription></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <ColorSetting label="Primary color" value={form.primaryColor} error={fieldErrors.primaryColor} onChange={(value) => update('primaryColor', value)} />
                    <ColorSetting label="Accent color" value={form.accentColor} error={fieldErrors.accentColor} onChange={(value) => update('accentColor', value)} />
                    <div className="rounded-xl border p-5 sm:col-span-2" style={{ background: `linear-gradient(135deg, ${previewPrimary}, ${previewAccent})` }}>
                        <p className="font-display text-xl font-bold text-white">{form.applicationName}</p><p className="text-sm text-white/80">Live color preview</p>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle>Brand assets</CardTitle><CardDescription>PNG, JPEG, WebP, GIF, or ICO only; maximum 5 MB. SVG is rejected for safety.</CardDescription></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    {ASSETS.map((asset) => {
                        const url = form[asset.field];
                        return (
                            <div key={asset.field} className="rounded-xl border p-4">
                                <div className="mb-3 flex min-h-24 items-center justify-center rounded-lg bg-muted/50 p-3">
                                    {url ? <img src={url} alt={`${asset.label} preview`} className="max-h-24 max-w-full object-contain" /> : <ImageIcon className="h-9 w-9 text-muted-foreground/40" />}
                                </div>
                                <Label htmlFor={`asset-${asset.field}`}>{asset.label}</Label>
                                <p className="mb-3 text-xs text-muted-foreground">{asset.help}</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={uploading !== null}
                                        onClick={() => document.getElementById(`asset-${asset.field}`)?.click()}
                                    >
                                        <Upload className="mr-2 h-4 w-4" /> {uploading === asset.field ? 'Uploading…' : 'Upload'}
                                    </Button>
                                    <input id={`asset-${asset.field}`} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAsset(asset.field, file); event.target.value = ''; }} />
                                    {url ? <ConfirmDestructiveAction title={`Reset ${asset.label.toLowerCase()}?`} description="The uploaded image will be permanently removed and the default asset will be used." confirmLabel="Yes, reset" pendingLabel="Resetting…" pending={uploading === asset.field} disabled={uploading !== null} onConfirm={() => void resetAsset(asset.field)} trigger={<Button type="button" variant="ghost" size="sm"><Trash2 className="mr-2 h-4 w-4" /> Reset</Button>} /> : null}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle>Login page</CardTitle><CardDescription>Choose the copy and sign-in methods visible before authentication.</CardDescription></CardHeader>
                <CardContent className="space-y-5">
                    <TextSetting label="Login heading" value={form.loginHeading} error={fieldErrors.loginHeading} onChange={(value) => update('loginHeading', value)} />
                    <div className="space-y-2"><Label htmlFor="login-description">Login description</Label><Textarea id="login-description" value={form.loginDescription} aria-invalid={Boolean(fieldErrors.loginDescription)} onChange={(event) => update('loginDescription', event.target.value)} /><FieldError message={fieldErrors.loginDescription} /></div>
                    <ToggleSetting label="Show local email/password login" description="The server also enforces this switch." checked={form.showLocalLogin} onChange={(checked) => update('showLocalLogin', checked)} />
                    <ToggleSetting label="Show Microsoft login" description="The button appears only when Entra credentials are configured; the server enforces this switch." checked={form.showMicrosoftLogin} onChange={(checked) => update('showMicrosoftLogin', checked)} />
                    {form.showMicrosoftLogin ? (
                        <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${microsoftLoginConfigured ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'}`}>
                            {microsoftLoginConfigured ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                            <p>{microsoftLoginConfigured
                                ? 'Microsoft sign-in is active in the running application.'
                                : 'The toggle is enabled, but the running application does not have all three Entra values. Complete Client ID, Client Secret, and Tenant ID in the Entra ID tab, then restart the application.'}</p>
                        </div>
                    ) : null}
                    <TextSetting label="Microsoft button text" value={form.microsoftButtonText} error={fieldErrors.microsoftButtonText} onChange={(value) => update('microsoftButtonText', value)} />
                    <ToggleSetting label="Show demo account information" description="Keep this disabled in production." checked={form.showDemoAccounts} onChange={(checked) => update('showDemoAccounts', checked)} />
                    {form.showDemoAccounts ? <div className="space-y-2"><Label htmlFor="demo-info">Demo account information</Label><Textarea id="demo-info" value={form.demoAccountInfo} aria-invalid={Boolean(fieldErrors.demoAccountInfo)} onChange={(event) => update('demoAccountInfo', event.target.value)} placeholder="Demo instructions shown verbatim on the login page" /><FieldError message={fieldErrors.demoAccountInfo} /></div> : null}
                    {demoInformationMissing ? (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <p>The demo toggle is enabled, but there is no information to display. Saving will keep the demo section hidden until safe instructions are provided.</p>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <div className="flex flex-wrap justify-end gap-3">
                <ConfirmDestructiveAction title="Reset all branding?" description="All branding values will return to their defaults and every uploaded brand asset will be permanently removed." confirmLabel="Yes, reset all" pendingLabel="Resetting…" pending={resetMutation.isPending} disabled={saveMutation.isPending || uploading !== null} onConfirm={() => resetMutation.mutate()} trigger={<Button type="button" variant="outline"><RotateCcw className="mr-2 h-4 w-4" /> Reset all defaults</Button>} />
                <Button type="button" disabled={savePending || hasFieldErrors} onClick={() => saveMutation.mutate()}><Save className="mr-2 h-4 w-4" /> {saveMutation.isPending ? 'Saving…' : 'Save branding'}</Button>
            </div>
        </div>
    );
}

function FieldError({ message }: { message?: string }) {
    return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

function TextSetting({ label, value, error, onChange, type = 'text' }: { label: string; value: string; error?: string; onChange: (value: string) => void; type?: string }) {
    const id = `branding-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} /><FieldError message={error} /></div>;
}

function ColorSetting({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (value: string) => void }) {
    const id = `branding-${label.toLowerCase().replace(/\s+/g, '-')}`;
    const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
    return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="flex gap-2"><Input id={id} type="color" value={pickerValue} onChange={(event) => onChange(event.target.value)} className="h-10 w-16 p-1" /><Input value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} aria-label={`${label} hex value`} placeholder="#RRGGBB" /></div><FieldError message={error} /></div>;
}

function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return <div className="flex items-center justify-between gap-5 rounded-lg border p-4"><div><p className="font-medium">{label}</p><p className="text-sm text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>;
}
