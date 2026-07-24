'use client';

import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {

    return (
        <div className="mx-auto flex min-h-[45vh] max-w-xl items-center justify-center">
            <div className="w-full rounded-xl border bg-card p-8 text-center shadow-sm">
                <AlertTriangle className="mx-auto h-9 w-9 text-destructive" />
                <h1 className="mt-4 text-xl font-semibold">This page could not be loaded</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Try the page again. If the problem continues, share this reference with support:
                    {' '}<span className="font-mono">{error.digest ?? 'no-reference'}</span>.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <Button asChild variant="outline"><Link href="/dashboard">Return to dashboard</Link></Button>
                    <Button onClick={reset}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
                </div>
            </div>
        </div>
    );
}
