'use client';

import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Suspense } from 'react';

function AuthErrorContent() {
    const searchParams = useSearchParams();
    const error = searchParams.get('error');

    const errorMessages: Record<string, string> = {
        Configuration: 'There is a problem with the server configuration.',
        AccessDenied: 'You do not have permission to sign in.',
        Verification: 'The verification link has expired or has already been used.',
        Default: 'An authentication error occurred. Please try again.',
    };

    return (
        <Card className="w-full max-w-md mx-4 border-0 shadow-2xl">
            <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                    <div className="rounded-full bg-red-100 p-4">
                        <AlertTriangle className="h-8 w-8 text-red-600" />
                    </div>
                </div>
                <CardTitle className="text-2xl">Authentication Error</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
                <p className="text-muted-foreground">{errorMessages[error ?? 'Default'] ?? errorMessages.Default}</p>
                <Button asChild className="w-full"><Link href="/auth/signin">Try Again</Link></Button>
            </CardContent>
        </Card>
    );
}

export default function AuthErrorPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-red-50 to-orange-50">
            <Suspense fallback={
                <div className="rounded-full bg-red-50 p-8 animate-pulse">
                    <AlertTriangle className="h-12 w-12 text-red-300" />
                </div>
            }>
                <AuthErrorContent />
            </Suspense>
        </div>
    );
}
