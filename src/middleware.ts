import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip auth routes and API routes
    if (
        pathname.startsWith('/auth') ||
        pathname.startsWith('/api') ||
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon')
    ) {
        return NextResponse.next();
    }

    // Check for auth token — Auth.js v5 uses 'authjs.session-token'
    const token =
        request.cookies.get('authjs.session-token') ??
        request.cookies.get('__Secure-authjs.session-token') ??
        request.cookies.get('next-auth.session-token') ??
        request.cookies.get('__Secure-next-auth.session-token');

    if (!token && pathname !== '/') {
        return NextResponse.redirect(new URL('/auth/signin', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
