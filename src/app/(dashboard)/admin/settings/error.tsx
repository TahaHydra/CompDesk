'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const message = error.message && error.message !== 'An error occurred in the Server Components render.'
        ? error.message
        : 'The settings service did not return a usable response.';
    return (
        <div role="alert" className="mx-auto max-w-xl rounded-xl border border-destructive/30 bg-card p-8 text-center shadow-sm">
            <AlertTriangle className="mx-auto h-9 w-9 text-destructive" />
            <h1 className="mt-4 text-xl font-semibold">Settings could not be loaded</h1>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
            <Button type="button" className="mt-6" onClick={reset}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
        </div>
    );
}