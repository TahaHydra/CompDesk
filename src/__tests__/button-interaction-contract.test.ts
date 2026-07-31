import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ui/button.tsx'),
    'utf8'
);

describe('shared button interaction contract', () => {
    it('does not move controls under the pointer', () => {
        expect(source).not.toContain('active:scale');
        expect(source).not.toContain('transition-all');
    });

    it('does not silently discard rapid legitimate clicks', () => {
        expect(source).not.toContain('lastClickRef');
        expect(source).not.toContain('disableClickGuard');
        expect(source).not.toContain('Date.now()');
        expect(source).not.toContain('event.preventDefault()');
    });
});
const appShellSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/layout/app-shell.tsx'),
    'utf8'
);

describe('sidebar navigation interaction contract', () => {
    it('uses browser-native anchors for primary and administration navigation', () => {
        const navLinkStart = appShellSource.indexOf('const NavLink =');
        const navLinkEnd = appShellSource.indexOf('return (', navLinkStart);
        const navLinkSource = appShellSource.slice(navLinkStart, navLinkEnd);
        expect(navLinkSource).toContain('<a');
        expect(navLinkSource).toContain('href={item.href}');
        expect(navLinkSource).toContain("aria-current={active ? 'page' : undefined}");
        expect(navLinkSource).not.toContain('<Link');
        expect(navLinkSource).not.toContain('preventDefault');
    });
});

describe('sign out interaction contract', () => {
    it('sends signout straight to the sign-in page in a single redirect', () => {
        expect(appShellSource).toContain("signOut({ callbackUrl: '/auth/signin' })");
    });

    it('installs the self-healing pointer-events lock guard', () => {
        expect(appShellSource).toContain('installInteractionLockGuard(window)');
    });
});

describe('session refresh does not loop the shell', () => {
    // next-auth v5's `update` is re-created whenever the session/loading state
    // changes. Depending on it in an effect that also calls it produces an
    // infinite refetch/re-render loop that freezes every control a few seconds
    // after load. The shell must not wire the session updater that way.
    it('does not alias or invoke the next-auth session updater', () => {
        expect(appShellSource).not.toContain('update: refreshSession');
        expect(appShellSource).not.toContain('refreshSession()');
    });

    it('closes the mobile drawer on route change without a session dependency', () => {
        const marker = 'setMobileOpen(false);';
        const start = appShellSource.indexOf(marker);
        expect(start).not.toBe(-1);
        const effectEnd = appShellSource.indexOf('}, [', start);
        const deps = appShellSource.slice(effectEnd, appShellSource.indexOf(']', effectEnd) + 1);
        expect(deps).toContain('[pathname]');
        expect(deps).not.toContain('refreshSession');
    });
});
