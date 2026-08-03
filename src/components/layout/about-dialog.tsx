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
                        {link.label}
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                </li>
            ))}
        </ul>
    );
}

export function AboutDialog({
    open,
    onOpenChange,
    version,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    version: string;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
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
                            <DialogTitle>CompDesk</DialogTitle>
                            <p className="text-xs text-muted-foreground">Version {version}</p>
                        </div>
                    </div>
                    <DialogDescription>
                        A lightweight, privacy-first, self-hosted ticketing and help desk platform.
                    </DialogDescription>
                </DialogHeader>

                <dl className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">Developed by</dt>
                        <dd className="font-medium">Taha Laachari</dd>
                    </div>
                    <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">Project</dt>
                        <dd className="font-medium">An xHydra open-source project</dd>
                    </div>
                    <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">License</dt>
                        <dd className="font-medium">MIT</dd>
                    </div>
                </dl>

                <Separator />
                <ExternalLinkList links={PROJECT_LINKS} />

                <Separator />
                <ExternalLinkList links={RESOURCE_LINKS} />
            </DialogContent>
        </Dialog>
    );
}
