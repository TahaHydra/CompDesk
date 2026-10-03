'use client';

import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { canInspectUpdates, type UpdateState } from '@/lib/updates';
import { useLanguage } from '@/components/providers/language-provider';
import { useUpdates } from '@/components/providers/update-provider';
import { UpdateStatus } from '@/components/layout/update-dialog';

const PROJECT_LINKS = [
    { label: 'Website', href: 'https://xhydra.fr' },
    { label: 'GitHub', href: 'https://github.com/TahaHydra' },
    { label: 'Source code', href: 'https://github.com/TahaHydra/CompDesk' },
];

const RESOURCE_LINKS = [
    { label: 'Documentation', href: 'https://github.com/TahaHydra/CompDesk#documentation' },
    { label: 'Report an issue', href: 'https://github.com/TahaHydra/CompDesk/issues/new/choose' },
    { label: 'Security policy', href: 'https://github.com/TahaHydra/CompDesk/security/policy' },
    { label: 'Release notes', href: 'https://github.com/TahaHydra/CompDesk/releases' },
];

function ExternalLinkList({ links }: { links: { label: string; href: string }[] }) {
    const { t } = useLanguage();
    return (
        <ul className="grid grid-cols-2 gap-2 text-sm">
            {links.map((link) => (
                <li key={link.href}>
                    <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                        {t(link.label)}
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                </li>
            ))}
        </ul>
    );
}

export function AboutContent({ version, role, updateState, onOpenUpdates }: { version: string; role: string; updateState: UpdateState; onOpenUpdates: () => void }) {
    const { t } = useLanguage();
    const administrator = canInspectUpdates(role);
    return <>
                <div>
                    <div className="mb-1 flex items-center gap-3">
                        <Image
                            src="/brand/xhydra-app-icon.png"
                            alt=""
                            aria-hidden="true"
                            width={40}
                            height={40}
                            className="h-10 w-10 shrink-0 rounded-lg object-contain"
                        />
                        <div>
                            <p className="font-semibold">CompDesk</p>
                            <p className="text-xs text-muted-foreground">{t('Version')} v{version}</p>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {t('A lightweight, privacy-first, self-hosted ticketing and help desk platform.')}
                    </p>
                </div>

                <dl className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">{t('Developed by')}</dt>
                        <dd className="font-medium">Taha Laachari</dd>
                    </div>
                    <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">{t('Project')}</dt>
                        <dd className="font-medium">{t('An xHydra open-source project')}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">{t('License')}</dt>
                        <dd className="font-medium">MIT</dd>
                    </div>
                    {administrator && <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">{t('Update status')}</dt>
                        <dd><button type="button" className="text-primary hover:underline" onClick={onOpenUpdates}><UpdateStatus state={updateState} /></button></dd>
                    </div>}
                </dl>

                <Separator />
                <ExternalLinkList links={PROJECT_LINKS} />

                <Separator />
                <ExternalLinkList links={RESOURCE_LINKS} />
                {administrator && <>
                    <Separator />
                    <section className="space-y-2 text-sm" aria-label={t('CompDesk services')}>
                        <h3 className="font-medium">{t('CompDesk services')}</h3>
                        <p className="text-muted-foreground">{t('Need help deploying or managing CompDesk?')}</p>
                        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {['Managed deployment', 'Hosted CompDesk', 'Maintenance & updates', 'Custom / enterprise setups'].map((item) => <li key={item}>{t(item)}</li>)}
                        </ul>
                        <p className="text-xs text-muted-foreground">{t('CompDesk remains free and open source to self-host.')}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" asChild><a href="https://xhydra.fr/compdesk" target="_blank" rel="noopener noreferrer">{t('Learn more')}</a></Button>
                            <Button variant="ghost" size="sm" asChild><a href="mailto:compdesk@xhydra.fr">{t('Contact XHydra')}</a></Button>
                        </div>
                    </section>
                </>}
    </>;
}

export function AboutDialog({ open, onOpenChange, version }: { open: boolean; onOpenChange: (open: boolean) => void; version: string }) {
    const updates = useUpdates();
    const { t } = useLanguage();
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85dvh] max-w-md overflow-y-auto">
                <DialogHeader className="sr-only"><DialogTitle>{t('About')} CompDesk</DialogTitle><DialogDescription>{t('Version')} v{version}</DialogDescription></DialogHeader>
                <AboutContent version={version} role={updates.role} updateState={updates.state} onOpenUpdates={() => { onOpenChange(false); updates.setOpen(true); }} />
            </DialogContent>
        </Dialog>
    );
}
