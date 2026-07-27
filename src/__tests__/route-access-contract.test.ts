import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

function filesBelow(directory: string, suffix: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
        const target = path.join(directory, entry);
        return statSync(target).isDirectory() ? filesBelow(target, suffix) : target.endsWith(suffix) ? [target] : [];
    });
}

function appRoute(file: string, marker: string): string {
    const relative = file.slice(file.indexOf(marker) + marker.length).replaceAll('\\', '/');
    const withoutGroups = relative.split('/').filter((segment) => !segment.startsWith('(')).join('/');
    const route = withoutGroups.replace(/(^|\/)(?:page\.tsx|route\.ts)$/, '');
    return `/${route}`.replace(/\/$/, '') || '/';
}

function routeMatches(candidate: string, available: string): boolean {
    const expected = available.split('/');
    const actual = candidate.split('/');
    return expected.length === actual.length && expected.every(
        (segment, index) => /^\[.+\]$/.test(segment) || segment === actual[index]
    );
}

describe('application route and access contracts', () => {
    const sourceRoot = path.join(process.cwd(), 'src');
    const appRoot = path.join(sourceRoot, 'app');
    const pageFiles = filesBelow(appRoot, 'page.tsx');
    const apiFiles = filesBelow(path.join(appRoot, 'api'), 'route.ts');
    const componentFiles = filesBelow(sourceRoot, '.tsx');
    const pages = pageFiles.map((file) => appRoute(file, `${path.sep}app${path.sep}`));
    const apiRoutes = apiFiles.map((file) => appRoute(file, `${path.sep}app${path.sep}`));

    it('guards administrator and Department Inbox page trees on the server', () => {
        const adminLayout = readFileSync(path.join(appRoot, '(dashboard)', 'admin', 'layout.tsx'), 'utf8');
        const queueLayout = readFileSync(path.join(appRoot, '(dashboard)', 'queue', 'layout.tsx'), 'utf8');
        expect(adminLayout).toContain('isAdminRole');
        expect(adminLayout).toContain("redirect('/dashboard')");
        expect(queueLayout).toContain('isAgentRole');
        expect(queueLayout).toContain("redirect('/tickets')");
    });

    it('reserves global administration pages and APIs for super administrators', () => {
        for (const segment of ['settings', 'users', 'logs', 'tags']) {
            const layout = readFileSync(path.join(appRoot, '(dashboard)', 'admin', segment, 'layout.tsx'), 'utf8');
            expect(layout).toContain("role !== 'SUPER_ADMIN'");
        }

        const globalRoutes = [
            'settings/route.ts',
            'settings/test-email/route.ts',
            'settings/quick-link-icons/route.ts',
            'branding/admin/route.ts',
            'branding/assets/route.ts',
            'api-clients/route.ts',
            'audit-logs/route.ts',
            'groups/route.ts',
            'tags/route.ts',
            'users/route.ts',
        ];
        for (const route of globalRoutes) {
            const source = readFileSync(path.join(appRoot, 'api', ...route.split('/')), 'utf8');
            expect(source).toContain("role !== 'SUPER_ADMIN'");
        }
    });
    it('keeps every non-public API route behind session or API-client authentication', () => {
        for (const file of apiFiles) {
            const route = appRoute(file, `${path.sep}app${path.sep}`);
            const source = readFileSync(file, 'utf8');
            if (route === '/api/auth/[...nextauth]') continue;
            if (route === '/api/branding') {
                expect(source).toContain('getPublicBranding');
                continue;
            }
            if (route.startsWith('/api/v1/')) {
                expect(source).toContain('authenticateApiRequest');
                continue;
            }
            expect(source).toMatch(/await auth\(\)/);
        }
    });

    it('scopes department-admin ticket lists and dashboards to their departments', () => {
        const ticketRoute = readFileSync(path.join(appRoot, 'api', 'tickets', 'route.ts'), 'utf8');
        const dashboardRoute = readFileSync(path.join(appRoot, 'api', 'dashboard', 'stats', 'route.ts'), 'utf8');
        const notificationRoute = readFileSync(path.join(appRoot, 'api', 'notifications', 'route.ts'), 'utf8');
        const ticketCreation = readFileSync(path.join(sourceRoot, 'lib', 'tickets', 'create-ticket.ts'), 'utf8');
        expect(ticketRoute).toContain("role === 'AGENT' || role === 'ADMIN'");
        expect(ticketRoute).toContain('buildTicketVisibilityWhere(userId, role, view, accessibleQueueIds)');
        expect(ticketRoute).toContain('getQueueInboxQueueIds(userId, role)');
        const ticketDetailRoute = readFileSync(path.join(appRoot, 'api', 'tickets', '[id]', 'route.ts'), 'utf8');
        expect(ticketDetailRoute).toContain("'status', 'queueId', 'categoryId'");
        expect(dashboardRoute).toContain("role !== 'SUPER_ADMIN'");
        expect(dashboardRoute).toContain('getQueueInboxQueueIds(userId, role)');
        expect(notificationRoute).toContain('getQueueInboxQueueIds(userId, role)');
        expect(ticketCreation).toContain('actor.role === Role.ADMIN');
    });
    it('points literal internal links at real application pages', () => {
        const missing: string[] = [];
        for (const file of componentFiles) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(/\bhref=["'](\/[^"'?#{}$]*)["']/g)) {
                const target = match[1].replace(/\/$/, '') || '/';
                if (!pages.some((page) => routeMatches(target, page))) {
                    missing.push(`${path.relative(process.cwd(), file)} -> ${target}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('points literal API requests at real handlers', () => {
        const missing: string[] = [];
        for (const file of componentFiles) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(/\bfetch\(\s*["'](\/api\/[^"'?{}$]*)/g)) {
                const target = match[1].replace(/\/$/, '');
                if (!apiRoutes.some((route) => routeMatches(target, route))) {
                    missing.push(`${path.relative(process.cwd(), file)} -> ${target}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('keeps the requested administration navigation order', () => {
        const shell = readFileSync(path.join(sourceRoot, 'components', 'layout', 'app-shell.tsx'), 'utf8');
        const departments = shell.indexOf("href: '/admin/departments'");
        const categories = shell.indexOf("href: '/admin/categories'");
        const templates = shell.indexOf("href: '/admin/templates'");
        expect(departments).toBeGreaterThan(-1);
        expect(departments).toBeLessThan(categories);
        expect(categories).toBeLessThan(templates);
    });
});
