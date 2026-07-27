/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import type { BrandingAssetField, BrandingConfig } from '@/lib/branding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

const ASSETS: Array<{ field: BrandingAssetField; label: string; help: string }> = [
    { field: 'mainLogoUrl', label: 'Main logo', help: 'Default full-size logo' },
    { field: 'compactLogoUrl', label: 'Compact logo / icon', help: 'Collapsed sidebar and small surfaces' },
    { field: 'lightLogoUrl', label: 'Light-mode logo', help: 'Optional light-theme override' },
    { field: 'darkLogoUrl', label: 'Dark-mode logo', help: 'Optional dark-theme override' },
    { field: 'faviconUrl', label: 'Favicon', help: 'Browser tab icon; ICO or square image recommended' },
    { field: 'loginBackgroundImageUrl', label: 'Login background', help: 'Optional full-page background image' },
];

async function responseJson<T>(response: Response): Promise<T> {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data as T;
}

export function BrandingSettings() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [form, setForm] = useState<BrandingConfig | null>(null);
    const [uploading, setUploading] = useState<BrandingAssetField | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const query = useQuery<BrandingConfig>({
        queryKey: ['branding', 'admin'],
        queryFn: async () => responseJson(await fetch('/api/branding/admin', { cache: 'no-store' })),
    });
    useEffect(() => { if (query.data && !isDirty) setForm(query.data); }, [isDirty, query.data]);

    const saveMutation = useMutation({
        mutationFn: async () => responseJson<BrandingConfig>(await fetch('/api/branding/admin', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        })),
        onSuccess: (branding) => {
            setForm(branding);
            setIsDirty(false);
            queryClient.setQueryData(['branding', 'admin'], branding);
            toast({ title: 'Branding saved', description: 'Reloading the application shell with the new theme.' });
            window.setTimeout(() => window.location.reload(), 350);
        },
        onError: (error: Error) => toast({ title: 'Branding could not be saved', description: error.message, variant: 'destructive' }),
    });
    const resetMutation = useMutation({
        mutationFn: async () => responseJson<BrandingConfig>(await fetch('/api/branding/admin', { method: 'DELETE' })),
        onSuccess: (branding) => {
            setForm(branding);
            setIsDirty(false);
            queryClient.setQueryData(['branding', 'admin'], branding);
            toast({ title: 'Default branding restored' });
            window.setTimeout(() => window.location.reload(), 350);
        },
        onError: (error: Error) => toast({ title: 'Branding reset failed', description: error.message, variant: 'destructive' }),
    });

    const update = <K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) => {
        setIsDirty(true);
        setForm((current) => current ? { ...current, [key]: value } : current);
    };
    const uploadAsset = async (field: BrandingAssetField, file: File) => {
        setUploading(field);
        try {
            const body = new FormData();
            body.set('field', field); body.set('file', file);
            const result = await responseJson<{ url: string; branding: BrandingConfig }>(await fetch('/api/branding/assets', { method: 'POST', body }));
            setForm((current) => current ? { ...current, [field]: result.url } : result.branding);
            queryClient.setQueryData(['branding', 'admin'], result.branding);
            toast({ title: 'Brand asset uploaded', description: 'The asset is saved immediately. Save branding to apply any other unsaved changes.' });
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
            queryClient.setQueryData(['branding', 'admin'], result.branding);
        } catch (error) {
            toast({ title: 'Asset reset failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
        } finally {
            setUploading(null);
        }
    };

    if (query.isLoading || !form) return <Card className="mt-4"><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading branding configuration…</CardContent></Card>;
    if (query.isError) return <Card className="mt-4"><CardContent className="py-12 text-center text-sm text-destructive">Branding configuration could not be loaded.</CardContent></Card>;

    return (
        <div className="mt-4 space-y-6">
            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle>Brand identity</CardTitle><CardDescription>Names and descriptions used in metadata, navigation, login, and messages.</CardDescription></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    <TextSetting label="Application name" value={form.applicationName} onChange={(value) => update('applicationName', value)} />
                    <TextSetting label="Short application name" value={form.shortApplicationName} onChange={(value) => update('shortApplicationName', value)} />
                    <TextSetting label="Subtitle / tagline" value={form.subtitle} onChange={(value) => update('subtitle', value)} />
                    <TextSetting label="Support email" type="email" value={form.supportEmail} onChange={(value) => update('supportEmail', value)} />
                    <div className="space-y-2 md:col-span-2"><Label htmlFor="branding-description">Helpdesk description</Label><Textarea id="branding-description" value={form.description} onChange={(event) => update('description', event.target.value)} /></div>
                    <div className="space-y-2 md:col-span-2"><Label htmlFor="branding-footer">Footer text</Label><Input id="branding-footer" value={form.footerText} onChange={(event) => update('footerText', event.target.value)} /></div>
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle>Theme colors</CardTitle><CardDescription>Applied globally through CSS variables in both light and dark themes.</CardDescription></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <ColorSetting label="Primary color" value={form.primaryColor} onChange={(value) => update('primaryColor', value)} />
                    <ColorSetting label="Accent color" value={form.accentColor} onChange={(value) => update('accentColor', value)} />
                    <div className="rounded-xl border p-5 sm:col-span-2" style={{ background: `linear-gradient(135deg, ${form.primaryColor}, ${form.accentColor})` }}>
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
                                    {url ? <Button type="button" variant="ghost" size="sm" disabled={uploading !== null} onClick={() => void resetAsset(asset.field)}><Trash2 className="mr-2 h-4 w-4" /> Reset</Button> : null}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle>Login page</CardTitle><CardDescription>Choose the copy and sign-in methods visible before authentication.</CardDescription></CardHeader>
                <CardContent className="space-y-5">
                    <TextSetting label="Login heading" value={form.loginHeading} onChange={(value) => update('loginHeading', value)} />
                    <div className="space-y-2"><Label htmlFor="login-description">Login description</Label><Textarea id="login-description" value={form.loginDescription} onChange={(event) => update('loginDescription', event.target.value)} /></div>
                    <ToggleSetting label="Show local email/password login" description="The server also enforces this switch." checked={form.showLocalLogin} onChange={(checked) => update('showLocalLogin', checked)} />
                    <ToggleSetting label="Show Microsoft login" description="The button appears only when Entra credentials are configured; the server enforces this switch." checked={form.showMicrosoftLogin} onChange={(checked) => update('showMicrosoftLogin', checked)} />
                    <TextSetting label="Microsoft button text" value={form.microsoftButtonText} onChange={(value) => update('microsoftButtonText', value)} />
                    <ToggleSetting label="Show demo account information" description="Keep this disabled in production." checked={form.showDemoAccounts} onChange={(checked) => update('showDemoAccounts', checked)} />
                    {form.showDemoAccounts ? <div className="space-y-2"><Label htmlFor="demo-info">Demo account information</Label><Textarea id="demo-info" value={form.demoAccountInfo} onChange={(event) => update('demoAccountInfo', event.target.value)} placeholder="Demo credentials shown verbatim on the login page" /></div> : null}
                </CardContent>
            </Card>

            <div className="flex flex-wrap justify-end gap-3">
                <Button type="button" variant="outline" disabled={resetMutation.isPending} onClick={() => { if (window.confirm('Reset all branding and remove uploaded brand assets?')) resetMutation.mutate(); }}><RotateCcw className="mr-2 h-4 w-4" /> Reset all defaults</Button>
                <Button type="button" disabled={saveMutation.isPending || uploading !== null} onClick={() => saveMutation.mutate()}><Save className="mr-2 h-4 w-4" /> Save branding</Button>
            </div>
        </div>
    );
}

function TextSetting({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
    const id = `branding-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function ColorSetting({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    const id = `branding-${label.toLowerCase().replace(/\s+/g, '-')}`;
    return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="flex gap-2"><Input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-16 p-1" /><Input value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} hex value`} /></div></div>;
}

function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return <div className="flex items-center justify-between gap-5 rounded-lg border p-4"><div><p className="font-medium">{label}</p><p className="text-sm text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>;
}