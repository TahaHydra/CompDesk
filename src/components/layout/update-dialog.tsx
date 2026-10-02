'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/components/providers/language-provider';
import { useUpdates } from '@/components/providers/update-provider';
import { copyText } from '@/lib/browser-clipboard';
import { cn } from '@/lib/utils';
import { BACKUP_DOCUMENTATION, UPGRADE_DOCUMENTATION, RELEASES_URL, canInspectUpdates, compareVersions, updatePresentation, type UpdateHealth, type UpdateInstructions, type UpdateState } from '@/lib/updates';

interface FooterProps {
    role: string; version: string; state: UpdateState; dismissed: string | null; sidebarCollapsed: boolean;
    onOpen: () => void; onDismiss: () => void; onRestore: () => void;
}
interface DetailsProps {
    role: string; state: UpdateState; health: UpdateHealth | undefined; instructions: UpdateInstructions | undefined;
    busy: boolean; message: string | null; onCheck: () => void; onInstructions: () => void; onCopy: () => void;
}
export function UpdateFooter({ role, version, state, dismissed, sidebarCollapsed, onOpen, onDismiss, onRestore }: FooterProps) {
    const { t } = useLanguage();
    const presentation = updatePresentation(role, version, state.manifest, dismissed);
    const label = t(presentation.tone === 'red' ? 'Critical update' : 'Update available');
    const dot = <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', presentation.tone === 'red' ? 'bg-red-500' : 'bg-blue-500')} aria-hidden="true" />;
    return <>
        {!sidebarCollapsed && <p className="text-[11px] leading-tight text-muted-foreground">
            CompDesk v{version}
            {presentation.visible && !presentation.expanded && <button type="button" className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded focus-visible:outline focus-visible:outline-2" onClick={onRestore} aria-label={`${t('Show update notification')} — ${label}`} title={label}>{dot}</button>}
            <br />{t('Open source')} · MIT
        </p>}
        {presentation.visible && sidebarCollapsed && <button type="button" className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent" onClick={() => { onRestore(); onOpen(); }} aria-label={`${t('Show update notification')} — ${label}`} title={label}>{dot}</button>}
        {presentation.visible && presentation.expanded && !sidebarCollapsed && <div className={cn('flex items-start gap-1 rounded-md border p-2', presentation.tone === 'red' ? 'border-red-500/30 bg-red-500/5' : 'border-blue-500/30 bg-blue-500/5')}>
            <button type="button" className="min-w-0 flex-1 text-left text-xs" onClick={onOpen}>
                <span className="flex items-center gap-1.5 font-medium">{dot}{label}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">v{version} → v{state.manifest?.latest}</span>
            </button>
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={onDismiss} aria-label={t('Hide update notification')} title={t('Hide update notification')}><EyeOff className="h-3.5 w-3.5" /></button>
        </div>}
    </>;
}

export function UpdateFooterControl({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
    const updates = useUpdates();
    return <UpdateFooter role={updates.role} version={updates.state.installed} state={updates.state} dismissed={updates.dismissed} sidebarCollapsed={sidebarCollapsed} onOpen={() => updates.setOpen(true)} onDismiss={updates.dismiss} onRestore={updates.restore} />;
}

export function UpdateStatus({ state }: { state: UpdateState }) {
    const { t } = useLanguage();
    if (state.manifest && compareVersions(state.manifest.latest, state.installed) > 0) return <>{t('v{version} available', { version: state.manifest.latest })}</>;
    if (state.checkStatus === 'ok' && !state.stale && state.manifest) return <>{t('Up to date')}</>;
    return <>{t(state.checkStatus === 'unavailable' ? 'Update check unavailable' : state.checkStatus === 'not_checked' ? 'Not checked yet' : 'Last check is out of date')}</>;
}

function DocumentationLink({ href, children }: { href: string; children: React.ReactNode }) {
    return <a className="text-primary hover:underline" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

export function UpdateDetails({ role, state, health, instructions, busy, message, onCheck, onInstructions, onCopy }: DetailsProps) {
    const { t, language } = useLanguage();
    if (!canInspectUpdates(role)) return null;
    const manifest = state.manifest;
    const available = Boolean(manifest && compareVersions(manifest.latest, state.installed) > 0);
    const privileged = role === 'SUPER_ADMIN';
    const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString(language === 'fr' ? 'fr-FR' : 'en-GB') : t('Unknown');
    const healthItems: [string, boolean | null | undefined][] = [
        ['Application', health?.application], ['Database', health?.database], ['Migrations', health?.migrations], ['Storage', health?.storage],
    ];
    return <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">{t('Installed version')}</dt><dd>v{state.installed}</dd>
            <dt className="text-muted-foreground">{t('Latest version')}</dt><dd>{manifest ? `v${manifest.latest}` : t('Unknown')}</dd>
            <dt className="text-muted-foreground">{t('Released')}</dt><dd>{manifest?.published_at ? formatDistanceToNow(new Date(manifest.published_at), { addSuffix: true, locale: language === 'fr' ? fr : undefined }) : t('Unknown')}</dd>
            <dt className="text-muted-foreground">{t('Status')}</dt><dd>{available ? t(manifest?.severity === 'critical' ? 'Critical update' : 'Normal update') : <UpdateStatus state={state} />}</dd>
            <dt className="text-muted-foreground">{t('Last checked')}</dt><dd>{date(state.lastChecked)}</dd>
            {manifest?.minimum_supported && <><dt className="text-muted-foreground">{t('Minimum supported version')}</dt><dd>v{manifest.minimum_supported}</dd></>}
        </dl>
        {state.stale && <p className="text-muted-foreground" role="status">{t('Showing last known release information. Check again to refresh.')}</p>}
        {manifest?.summary && <div><h3 className="mb-1 font-medium">{t("What's new")}</h3><p className="whitespace-pre-wrap break-words text-muted-foreground">{manifest.summary}</p></div>}
        {manifest?.upgrade_notes && <div><h3 className="mb-1 font-medium">{t('Upgrade notes')}</h3><p className="whitespace-pre-wrap break-words text-muted-foreground">{manifest.upgrade_notes}</p></div>}
        <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild><a href={manifest?.release_url ?? RELEASES_URL} target="_blank" rel="noopener noreferrer">{t('View release notes')}</a></Button>
            <Button variant="outline" size="sm" onClick={onCheck} disabled={busy}>{t('Check again')}</Button>
            <Button variant="outline" size="sm" onClick={onInstructions} disabled={!privileged || busy} aria-describedby={!privileged ? 'update-privilege-reason' : undefined}>{t('Update instructions')}</Button>
        </div>
        {!privileged && <p id="update-privilege-reason" className="text-xs text-muted-foreground">{t('Super Admin privileges required')}</p>}
        {state.refreshLimited && <p role="status" className="text-xs text-muted-foreground">{t('Please wait one minute between update checks.')}</p>}
        {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
        {privileged && instructions && <div className="space-y-2 rounded-lg border p-3">
            <h3 className="font-medium">{t('Update instructions')}</h3>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>{t('Create and verify a coordinated database, files and configuration backup. Rehearse the upgrade first.')}</li>
                <li>{t('Download and review the pinned docker-compose.yml from the desired release, or update your exact image version/digest. Preserve your deployment customizations.')}</li>
                <li>{t('Run these commands on the deployment host from your Compose directory. Migrations run automatically before the application starts.')}</li>
                <li>{t('Verify readiness and test sign-in, tickets, attachments and email after deployment.')}</li>
            </ol>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs"><code>{instructions.command}</code></pre>
            <Button variant="outline" size="sm" onClick={onCopy}>{t('Copy update command')}</Button>
            <p className="text-xs text-muted-foreground">{t('For standalone Node.js or a customized deployment, follow the upgrade documentation.')}</p>
        </div>}
        <DocumentationLink href={UPGRADE_DOCUMENTATION}>{t('Open upgrade documentation')}</DocumentationLink>
        <Separator />
        <div className="space-y-2">
            <h3 className="font-medium">{t('Update & recovery')}</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t('Installed version')}</dt><dd>v{state.installed}</dd>
                <dt className="text-muted-foreground">{t('Previous known version')}</dt><dd>{t('Unknown')}</dd>
                <dt className="text-muted-foreground">{t('Database migration status')}</dt><dd>{t(health?.migrations === true ? 'Current' : 'Unknown')}</dd>
                <dt className="text-muted-foreground">{t('Last successful update')}</dt><dd>{t('Not tracked')}</dd>
                <dt className="text-muted-foreground">{t('Recovery point')}</dt><dd>{t('No managed recovery point available')}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">{t('An older image is not a recovery point. Database migrations may require restoring the coordinated database, files and configuration backup.')}</p>
            <DocumentationLink href={BACKUP_DOCUMENTATION}>{t('Backup and restore documentation')}</DocumentationLink>
        </div>
        <Separator />
        <div><h3 className="mb-2 font-medium">{t('System health')}</h3><ul className="grid grid-cols-2 gap-2 text-xs">
            {healthItems.map(([label, healthy]) => <li key={label} className="flex items-center gap-2"><span className={healthy === true ? 'text-green-600' : 'text-muted-foreground'} aria-hidden="true">{healthy === true ? '✓' : '?'}</span>{t(label)}<span className="text-muted-foreground">{t(healthy === true ? 'Ready' : healthy === false ? 'Not ready' : 'Unknown')}</span></li>)}
        </ul></div>
    </div>;
}

async function fetchUpdateDetail<T>(url: string): Promise<T> {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Update information unavailable');
    return response.json();
}

export function UpdateDialog() {
    const updates = useUpdates();
    const { t } = useLanguage();
    const [instructionsRequested, setInstructionsRequested] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const health = useQuery({
        queryKey: ['compdesk-update-health', updates.userId],
        queryFn: () => fetchUpdateDetail<UpdateHealth>('/api/updates/health'),
        enabled: updates.open, staleTime: 60_000, retry: false,
    });
    const instructions = useQuery({
        queryKey: ['compdesk-update-instructions', updates.userId],
        queryFn: () => fetchUpdateDetail<UpdateInstructions>('/api/updates/instructions'),
        enabled: updates.open && updates.role === 'SUPER_ADMIN' && instructionsRequested, retry: false,
    });
    if (!canInspectUpdates(updates.role)) return null;
    const copy = async () => {
        if (updates.role !== 'SUPER_ADMIN' || !instructions.data) return;
        setMessage(t(await copyText(instructions.data.command) ? 'Update command copied' : 'Could not copy. Select and copy the commands above.'));
    };
    return <Dialog open={updates.open} onOpenChange={(open) => { updates.setOpen(open); setMessage(null); if (!open) setInstructionsRequested(false); }}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
            <DialogHeader><DialogTitle>{t('CompDesk Update')}</DialogTitle><DialogDescription>{t('Release information and assisted updates for this installation.')}</DialogDescription></DialogHeader>
            <UpdateDetails role={updates.role} state={updates.state} health={health.data} instructions={instructions.data} busy={updates.busy || instructions.isFetching}
                message={updates.refreshError || instructions.isError ? t('Update check unavailable') : message}
                onCheck={() => { setMessage(null); updates.refresh(); void health.refetch(); }}
                onInstructions={() => { if (updates.role === 'SUPER_ADMIN') { setInstructionsRequested(true); if (instructions.isError) void instructions.refetch(); } }} onCopy={() => void copy()} />
        </DialogContent>
    </Dialog>;
}
