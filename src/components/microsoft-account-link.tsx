'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';

export function MicrosoftAccountLink() {
    const { language } = useLanguage();
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const french = language === 'fr';
    return <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{french
            ? 'Associez votre compte Microsoft depuis cette session authentifiée pour activer la connexion Microsoft au même compte CompDesk.'
            : 'Link your Microsoft account from this authenticated session to sign in to the same CompDesk account with Microsoft.'}</p>
        <Button variant="outline" disabled={pending} onClick={async () => {
            setPending(true); setFailed(false);
            try { await signIn('microsoft-entra-id', { redirectTo: '/profile' }); }
            catch { setFailed(true); setPending(false); }
        }}>{french ? 'Associer mon compte Microsoft' : 'Link my Microsoft account'}</Button>
        {failed && <p role="alert" className="text-sm text-destructive">{french ? 'Connexion Microsoft indisponible. Réessayez.' : 'Microsoft sign-in unavailable. Try again.'}</p>}
    </div>;
}
