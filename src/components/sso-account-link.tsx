'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { SsoProviderLogo } from '@/components/sso-provider-logo';
import { SSO_PRESETS, type RuntimeSsoProviderId, type SsoProviderOption } from '@/lib/sso-presets';

export function SsoAccountLink({ provider, providerId, linked, migration }: { provider: SsoProviderOption; providerId: RuntimeSsoProviderId; linked: boolean; migration: boolean }) {
    const { language } = useLanguage();
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const french = language === 'fr';
    const label = SSO_PRESETS[provider].label;
    const description = migration
        ? (french
            ? `Votre organisation passe à ${label}. Associez votre compte ${label} maintenant pour continuer à vous connecter après la bascule.`
            : `Your organisation is moving sign-in to ${label}. Link your ${label} account now so you can keep signing in after the switch.`)
        : (french
            ? `Associez votre compte ${label} depuis cette session authentifiée pour activer la connexion ${label} au même compte CompDesk.`
            : `Link your ${label} account from this authenticated session to sign in to the same CompDesk account with ${label}.`);
    return <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{description}</p>
        {linked ? <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />{french ? `Compte ${label} associé.` : `${label} account linked.`}</p> : null}
        <Button variant="outline" className="gap-2" disabled={pending} onClick={async () => {
            setPending(true); setFailed(false);
            try { await signIn(providerId, { redirectTo: '/profile' }); }
            catch { setFailed(true); setPending(false); }
        }}><SsoProviderLogo provider={provider} className="h-4 w-4" />{linked
            ? (french ? `Tester la connexion ${label}` : `Test ${label} sign-in`)
            : (french ? `Associer mon compte ${label}` : `Link my ${label} account`)}</Button>
        {failed && <p role="alert" className="text-sm text-destructive">{french ? `Connexion ${label} indisponible. Réessayez.` : `${label} sign-in unavailable. Try again.`}</p>}
    </div>;
}
