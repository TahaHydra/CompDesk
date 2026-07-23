'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { BrandLogo } from '@/components/branding/brand-logo';
import { useBranding } from '@/components/providers/branding-provider';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

function MicrosoftMark() {
    return (
        <svg className="h-5 w-5" viewBox="0 0 21 21" fill="currentColor" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" /><rect x="11" y="1" width="9" height="9" />
            <rect x="1" y="11" width="9" height="9" /><rect x="11" y="11" width="9" height="9" />
        </svg>
    );
}

function SignInForm() {
    const branding = useBranding();
    const searchParams = useSearchParams();
    const authError = searchParams.get('error');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [localError, setLocalError] = useState('');
    const microsoftVisible = branding.showMicrosoftLogin && branding.microsoftLoginConfigured;
    const showDivider = microsoftVisible && branding.showLocalLogin;

    const handleCredentials = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setLocalError('');
        const result = await signIn('credentials', { email, password, redirect: false });
        if (result?.error || !result?.ok) {
            setLocalError('Invalid email or password');
            setLoading(false);
            return;
        }
        window.location.href = '/dashboard';
    };

    return (
        <Card className="relative z-10 mx-4 w-full max-w-md border-0 bg-card/90 shadow-2xl backdrop-blur-sm">
            <CardHeader className="pb-2 text-center">
                <div className="mb-4 flex justify-center">
                    <BrandLogo className="h-16 w-16 rounded-2xl shadow-lg shadow-primary/30" />
                </div>
                <CardTitle className="text-3xl font-bold gradient-text">{branding.loginHeading}</CardTitle>
                <CardDescription className="mt-2 text-base">{branding.loginDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
                {microsoftVisible ? (
                    <Button
                        onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/dashboard' })}
                        className="h-12 w-full gap-3 text-base shadow-lg shadow-primary/25"
                    >
                        <MicrosoftMark />
                        {branding.microsoftButtonText}
                        <ArrowRight className="ml-auto h-4 w-4" />
                    </Button>
                ) : null}

                {showDivider ? (
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><Separator className="w-full" /></div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-3 text-muted-foreground">or sign in with email</span>
                        </div>
                    </div>
                ) : null}

                {branding.showLocalLogin ? (
                    <form onSubmit={handleCredentials} className="space-y-4">
                        {(authError || localError) ? (
                            <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive">
                                {localError || `Authentication failed. Please try again or contact ${branding.supportEmail || 'support'}.`}
                            </div>
                        ) : null}
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 pl-9" required />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input id="password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 pl-9" required />
                            </div>
                        </div>
                        <Button type="submit" variant={microsoftVisible ? 'outline' : 'default'} className="h-11 w-full text-base" disabled={loading || !email || !password}>
                            {loading ? <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-current" aria-label="Signing in" /> : 'Sign In'}
                        </Button>
                    </form>
                ) : null}

                {!branding.showLocalLogin && !microsoftVisible ? (
                    <div role="alert" className="rounded-lg border p-4 text-center text-sm text-muted-foreground">
                        No sign-in method is currently available. {branding.supportEmail ? <a className="text-primary underline" href={`mailto:${branding.supportEmail}`}>Contact support</a> : 'Contact an administrator.'}
                    </div>
                ) : null}

                {branding.showDemoAccounts && branding.demoAccountInfo ? (
                    <div className="rounded-lg bg-muted/50 p-3">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Demo accounts</p>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{branding.demoAccountInfo}</p>
                    </div>
                ) : null}

                {(branding.footerText || branding.supportEmail) ? (
                    <p className="text-center text-xs text-muted-foreground">
                        {branding.footerText}
                        {branding.footerText && branding.supportEmail ? ' · ' : ''}
                        {branding.supportEmail ? <a className="hover:text-primary" href={`mailto:${branding.supportEmail}`}>{branding.supportEmail}</a> : null}
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}

export default function SignInPage() {
    return (
        <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-primary/5 to-accent dark:from-slate-950 dark:via-primary/10 dark:to-slate-950 bg-[image:var(--brand-login-background-image)] bg-cover bg-center">
            <div className="absolute inset-0 bg-background/35 backdrop-blur-[1px]" />
            <div className="absolute right-5 top-5 z-20"><ThemeToggle /></div>
            <Suspense fallback={<div className="z-10 flex h-32 w-32 items-center justify-center rounded-2xl bg-card shadow-xl"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div>}>
                <SignInForm />
            </Suspense>
        </div>
    );
}