import crypto from 'crypto';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { auth } from '@/lib/auth';
import logger from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SAFE_ERRORS: Record<string, string> = {
    Configuration: 'Sign-in is temporarily unavailable because the authentication service could not be reached or configured safely.',
    AccessDenied: 'The account is not permitted to sign in.',
    Verification: 'The verification request is no longer valid.',
    Default: 'Authentication could not be completed. Please try again or contact an administrator.',
};
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CORRELATION = /^[0-9a-f-]{36}$/i;

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ error?: string; correlationId?: string }> }) {
    const params = await searchParams;
    const session = await auth();
    const errorCode = params.error && SAFE_CODE.test(params.error) ? params.error : 'Default';
    const correlationId = params.correlationId && CORRELATION.test(params.correlationId) ? params.correlationId : crypto.randomUUID();
    const superAdmin = session?.user?.role === 'SUPER_ADMIN';
    logger.warn('Authentication error page displayed', { correlationId, errorCode });

    return <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-red-50 to-orange-50"><Card className="mx-4 w-full max-w-md border-0 shadow-2xl"><CardHeader className="text-center"><div className="mb-4 flex justify-center"><div className="rounded-full bg-red-100 p-4"><AlertTriangle className="h-8 w-8 text-red-600" /></div></div><CardTitle className="text-2xl">Authentication Error</CardTitle></CardHeader><CardContent className="space-y-4 text-center"><p className="text-muted-foreground">{SAFE_ERRORS[errorCode] ?? SAFE_ERRORS.Default}</p><p className="break-all text-xs text-muted-foreground">Correlation ID: {correlationId}</p>{superAdmin ? <div className="rounded-lg border bg-muted/40 p-3 text-left text-xs"><p>Administrator detail: Auth.js error code <strong>{errorCode}</strong>.</p><p className="mt-1">Use Settings → Entra ID → Diagnose Running Entra Configuration for metadata-stage details. Full sanitized context remains in server logs under the same correlation ID.</p></div> : null}<Button asChild className="w-full"><Link href="/auth/signin">Try Again</Link></Button></CardContent></Card></div>;
}