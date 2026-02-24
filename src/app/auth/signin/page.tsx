'use client';

import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Shield, ArrowRight, Mail, Lock } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ThemeToggle } from '@/components/layout/theme-toggle';

import { Suspense } from 'react';

function SignInForm() {
    const searchParams = useSearchParams();
    const error = searchParams.get('error');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [localError, setLocalError] = useState('');

    const handleCredentials = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setLocalError('');

        const result = await signIn('credentials', {
            email,
            password,
            redirect: false,
        });

        if (result?.error || !result?.ok) {
            setLocalError('Invalid email or password');
            setLoading(false);
        } else {
            // Force redirect — result.url from credentials can be unreliable
            window.location.href = '/dashboard';
        }
    };

    return (
        <Card className="w-full max-w-md mx-4 border-0 shadow-2xl backdrop-blur-sm bg-card/90 relative z-10">
            <CardHeader className="text-center pb-2">
                <div className="flex justify-center mb-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30">
                        <Shield className="h-8 w-8 text-white" />
                    </div>
                </div>
                <CardTitle className="text-3xl font-bold">
                    <span className="gradient-text">CompDesk</span>
                </CardTitle>
                <CardDescription className="text-base mt-2">
                    Sign in to your helpdesk portal
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
                {/* Microsoft SSO */}
                <Button
                    onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/dashboard' })}
                    className="w-full h-12 text-base gap-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/25 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/30"
                >
                    <svg className="h-5 w-5" viewBox="0 0 21 21" fill="currentColor">
                        <rect x="1" y="1" width="9" height="9" />
                        <rect x="11" y="1" width="9" height="9" />
                        <rect x="1" y="11" width="9" height="9" />
                        <rect x="11" y="11" width="9" height="9" />
                    </svg>
                    Sign in with Microsoft
                    <ArrowRight className="h-4 w-4 ml-auto" />
                </Button>

                {/* Divider */}
                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <Separator className="w-full" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-3 text-muted-foreground">or sign in with email</span>
                    </div>
                </div>

                {/* Local Credentials form */}
                <form onSubmit={handleCredentials} className="space-y-4">
                    {(error || localError) && (
                        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive text-center">
                            {localError || 'Authentication failed. Please try again.'}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="email"
                                type="email"
                                placeholder="admin@example.invalid"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="pl-9 h-11"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="pl-9 h-11"
                                required
                            />
                        </div>
                    </div>

                    <Button
                        type="submit"
                        variant="outline"
                        className="w-full h-11 text-base"
                        disabled={loading || !email || !password}
                    >
                        {loading ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                        ) : (
                            'Sign In'
                        )}
                    </Button>
                </form>

                {/* Demo accounts hint */}
                <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Demo Accounts</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono">admin@example.invalid</span>
                        <span>Super Admin</span>
                        <span className="font-mono">agent1@example.invalid</span>
                        <span>Agent</span>
                        <span className="font-mono">user1@example.invalid</span>
                        <span>End User</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Password: <span className="font-mono">Password123!</span></p>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                    By signing in, you agree to our Terms of Service
                </p>
            </CardContent>
        </Card>
    );
}

export default function SignInPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-50 dark:from-slate-950 dark:via-indigo-950/30 dark:to-purple-950/20">
            <div className="absolute right-5 top-5 z-20">
                <ThemeToggle />
            </div>

            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-indigo-400/20 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-purple-400/20 blur-3xl" />
            </div>

            <Suspense fallback={
                <div className="z-10 flex h-32 w-32 items-center justify-center rounded-2xl bg-card shadow-xl">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
            }>
                <SignInForm />
            </Suspense>
        </div>
    );
}
