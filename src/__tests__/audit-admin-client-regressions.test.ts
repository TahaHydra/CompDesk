import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function harness(file: string, values: any[] = [], initialUrl = '') {
    const state: any[] = [], refs: any[] = [], dependencies: any[][] = [];
    let cursor = 0, refCursor = 0, effectCursor = 0, queryCursor = 0, mutationCursor = 0;
    let effects: Array<() => void> = [];
    const params = new URLSearchParams(initialUrl), queries: any[] = [], mutations: any[] = [], queryErrors: any[] = [];
    const replace = jest.fn(), invalidateQueries = jest.fn(), fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const react = {
        createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
        useState: (initial: any) => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], (value: any) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useRef: (initial: any) => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: initial }); },
        useEffect: (effect: () => void, deps: any[]) => { const i = effectCursor++; if (!dependencies[i] || deps.some((value, index) => value !== dependencies[i][index])) { dependencies[i] = deps; effects.push(effect); } },
        useMemo: (factory: () => unknown) => factory(), useDeferredValue: (value: any) => value,
    };
    const router = { replace, push: jest.fn(), refresh: jest.fn() };
    const imports: Record<string, any> = {
        react, 'next/navigation': { useSearchParams: () => params, useParams: () => ({ slug: 'guide' }), useRouter: () => router },
        'next-auth/react': { useSession: () => ({ data: { user: { id: 'admin-1', role: 'SUPER_ADMIN' } } }) },
        '@tanstack/react-query': { useQuery: (options: any) => { const i = queryCursor++; queries[i] = options; return { data: values[i], isLoading: false, error: queryErrors[i], isError: Boolean(queryErrors[i]), refetch: jest.fn() }; }, useMutation: (options: any) => { mutations[mutationCursor++] = options; options.mutateSpy = jest.fn(); return { mutate: options.mutateSpy, isPending: false }; }, useQueryClient: () => ({ invalidateQueries }) },
        '@/components/ui/use-toast': { useToast: () => ({ toast: jest.fn() }) },
        '@/components/providers/language-provider': { useLanguage: () => ({ language: 'fr', t: (text: string) => text, setLanguage: jest.fn() }) },
        '@/components/providers/branding-provider': { useBranding: () => ({ shortApplicationName: 'CompDesk' }) },
        '@/components/help/markdown-article': { extractHelpHeadings: () => [], MarkdownArticle: 'MarkdownArticle' },
        '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
        '@/lib/i18n': { LANGUAGE_LABELS: { en: 'English', fr: 'French' } },
        '@/lib/help-center': { HELP_ICON_KEYS: [], helpContentLanguages: () => ['en'], localizedHelpTitle: () => 'Help' },
    };
    const compiledModule = { exports: {} as any };
    const code = ts.transpileModule(fs.readFileSync(path.join(process.cwd(), file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: (name: string) => imports[name] ?? new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) }), React: react, URLSearchParams, Error, fetch: fetchMock, localStorage: { getItem: () => null, setItem: jest.fn() }, window: { setTimeout: (callback: () => void) => { effects.push(callback); }, clearTimeout: jest.fn() }, console });
    const render = (exportName = 'default', props = {}) => { cursor = refCursor = effectCursor = queryCursor = mutationCursor = 0; return compiledModule.exports[exportName](props); };
    const settle = () => { for (let i = 0; i < 4; i++) { render(); const pending = effects; effects = []; pending.forEach((effect) => effect()); } return render(); };
    return { render, settle, params, queries, mutations, queryErrors, replace, invalidateQueries, fetchMock };
}
function find(tree: any, predicate: (node: any) => boolean): any {
    if (!tree || typeof tree !== 'object') return;
    if (predicate(tree)) return tree;
    for (const child of Array.isArray(tree) ? tree : tree.props?.children ?? []) { const found = find(child, predicate); if (found) return found; }
}

test.each(['tickets', 'queue'])('%s preserves page deep links and follows incoming filter navigation', (page) => {
    const h = harness(`src/app/(dashboard)/${page}/page.tsx`, page === 'tickets' ? [[], [], [], { tickets: [], pagination: { page: 3, pages: 5, total: 50 } }] : [[{ id: 'department-1' }], { tickets: [] }], 'page=3&status=OPEN');
    h.settle();
    expect(h.replace.mock.calls.every(([url]) => new URL(url, 'http://localhost').searchParams.get('page') === '3')).toBe(true);
    h.params.set('status', 'CLOSED'); h.params.set('page', '2'); h.settle();
    const query = h.queries.find((q) => q.queryKey[0] === (page === 'tickets' ? 'tickets' : 'queue-tickets'));
    expect(JSON.stringify(query.queryKey)).toContain('CLOSED');
    expect(JSON.stringify(query.queryKey)).not.toContain('OPEN');
    h.replace.mockClear();
    const nextUrl = page === 'tickets' ? 'view=my&status=CLOSED&page=2' : 'status=CLOSED&page=2';
    h.params.forEach((_, key) => h.params.delete(key));
    for (const [key, value] of new URLSearchParams(nextUrl)) h.params.set(key, value);
    h.settle(); h.replace.mockClear(); h.settle();
    expect(h.replace).not.toHaveBeenCalled();
    const tree = h.render();
    find(tree, (node) => node.type === 'Select' && node.props.value === 'CLOSED').props.onValueChange('NEW');
    h.settle();
    expect(new URL(h.replace.mock.calls.at(-1)![0], 'http://localhost').searchParams.get('page')).toBeNull();
});

test('user assignment editor submits agent membership IDs only and displays inactive removals', () => {
    const h = harness('src/app/(dashboard)/admin/users/page.tsx', [[{ id: 'staff', name: 'Staff', role: 'ADMIN', isActive: true, queueMemberships: [{ queueId: 'admin-dept', role: 'admin' }, { queueId: 'agent-dept', role: 'agent' }] }], [{ id: 'admin-dept', name: 'Management', isActive: true }, { id: 'agent-dept', name: 'Archived', isActive: false }]]);
    const tree = h.render();
    const admin = find(tree, (node) => node.type === 'DropdownMenuCheckboxItem' && node.props.children.includes('Management'));
    const archived = find(tree, (node) => node.type === 'DropdownMenuCheckboxItem' && node.props.children.includes('Archived'));
    expect(admin.props.checked).toBe(false);
    expect(archived.props.checked).toBe(true);
    expect(h.queries[1].queryKey).not.toEqual(['queues']);
});

test.each(['departments', 'categories'])('%s explicitly serializes a cleared description', async (page) => {
    const h = harness(`src/app/(dashboard)/admin/${page}/page.tsx`, [[], [], []]);
    h.render();
    await h.mutations[0].mutationFn();
    expect(JSON.parse(h.fetchMock.mock.calls[0][1].body).description).toBe('');
});

test('help edits and deletions invalidate previously visited article detail caches', async () => {
    const h = harness('src/components/admin/help-center-manager.tsx', [[], []]);
    h.render('HelpCenterManager');
    await h.mutations[0].onSuccess();
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['help-article'] });
});

test.each([['src/app/(dashboard)/help/page.tsx', undefined], ['src/app/(dashboard)/help/[slug]/page.tsx', undefined]])('localized queries include effective language: %s', (file) => {
    const h = harness(file, file.includes('[slug]') ? [undefined] : [[], []]);
    h.render();
    expect(h.queries.every((q) => q.queryKey.includes('fr'))).toBe(true);
});

test('dashboard card drilldowns include NEW and exclude completed urgent tickets', () => {
    const h = harness('src/app/(dashboard)/dashboard/page.tsx', [{ stats: { total: 2, open: 1, pending: 0, resolved: 1, urgent: 1 }, recentTickets: [], customLinks: [], ticketView: 'all' }]);
    const tree = h.render();
    expect(find(tree, (node) => node.props?.href?.includes('status=NEW,OPEN'))).toBeDefined();
    expect(find(tree, (node) => node.props?.href?.includes('priority=URGENT') && node.props.href.includes('status=NEW,OPEN,PENDING_USER,PENDING_AGENT'))).toBeDefined();
});


test.each(['src/app/(dashboard)/admin/users/page.tsx', 'src/app/(dashboard)/admin/departments/page.tsx', 'src/app/(dashboard)/admin/categories/page.tsx', 'src/app/(dashboard)/help/page.tsx'])('malformed success lists are rejected by %s', async (file) => {
    const h = harness(file, [[], [], []]); h.render();
    h.fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: 'invalid array' }) });
    await expect(h.queries[0].queryFn()).rejects.toThrow();
});

test('dashboard failed read shows an actionable error instead of zero-count cards', () => {
    const h = harness('src/app/(dashboard)/dashboard/page.tsx'); h.queryErrors[0] = new Error('Offline');
    const tree = h.render(); expect(find(tree, (node) => node.props?.role === 'alert')).toBeDefined();
    expect(find(tree, (node) => node.type === 'Button' && node.props.children.includes('Try again'))).toBeDefined();
    expect(find(tree, (node) => node.props?.href?.includes('status=NEW,OPEN'))).toBeUndefined();
});

test('help detail keeps cached content alongside a refresh error', () => {
    const h = harness('src/app/(dashboard)/help/[slug]/page.tsx', [{ id: 'article', title: 'Guide', content: 'Instructions', collection: { title: 'Help', articles: [] } }]);
    h.queryErrors[0] = new Error('Offline');
    const tree = h.render(); expect(find(tree, (node) => node.props?.role === 'alert')).toBeDefined();
    expect(find(tree, (node) => node.type === 'MarkdownArticle' && node.props.content === 'Instructions')).toBeDefined();
});

test('dual memberships submit deduplicated agent assignments and allow archived removal', () => {
    const h = harness('src/app/(dashboard)/admin/users/page.tsx', [[{ id: 'staff', name: 'Staff', role: 'ADMIN', isActive: true, queueMemberships: [{ queueId: 'dual', role: 'admin' }, { queueId: 'dual', role: 'agent' }, { queueId: 'archive', role: 'agent' }] }], [{ id: 'dual', name: 'Dual', isActive: true }, { id: 'archive', name: 'Archive', isActive: false }]]);
    const tree = h.render();
    find(tree, (node) => node.type === 'DropdownMenuCheckboxItem' && node.props.children.includes('Archive')).props.onCheckedChange(false);
    expect(h.mutations[1].mutateSpy).toHaveBeenCalledWith({ userId: 'staff', queueIds: ['dual'] });
});

test('saving language invalidates localized list and article caches', async () => {
    const h = harness('src/components/profile-language-preference.tsx');
    const tree = h.render('LanguagePreference', { initialLanguage: 'en' });
    h.fetchMock.mockResolvedValue({ ok: true, json: async () => ({ preferredLanguage: 'en' }) });
    await find(tree, (node) => node.type === 'Button').props.onClick();
    for (const key of ['help-collections', 'help-articles', 'help-article']) expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: [key] });
});


test.each(['tickets','queue'])('%s rejects malformed ticket list responses', async (page) => {
    const h = harness('src/app/(dashboard)/'+page+'/page.tsx', page === 'tickets' ? [[], [], [], { tickets: [] }] : [[{ id: 'department' }], { tickets: [] }]);
    h.render(); h.fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tickets: {} }) });
    const query = h.queries.find((q) => q.queryKey[0] === (page === 'tickets' ? 'tickets' : 'queue-tickets'));
    await expect(query.queryFn()).rejects.toThrow();
});


test.each(['departments','categories'])('%s edits clear an existing saved description', async (page) => {
    const record = { id: 'item', name: 'Item', description: 'Previously saved', isActive: true, members: [], queueId: 'dept', queue: { id: 'dept', name: 'Department' }, _count: { tickets: 0, categories: 0 } };
    const h = harness('src/app/(dashboard)/admin/'+page+'/page.tsx', [[record], page === 'categories' ? [{ id: 'dept', name: 'Department' }] : [], []]);
    let tree = h.render();
    find(tree, (node) => node.type === 'Button' && node.props.children.includes('Edit')).props.onClick();
    tree = h.render();
    find(tree, (node) => node.type === 'Textarea' && node.props.value === 'Previously saved').props.onChange({ target: { value: '' } });
    h.render(); await h.mutations[0].mutationFn();
    const [, request] = h.fetchMock.mock.calls[0];
    expect(request.method).toBe('PATCH'); expect(JSON.parse(request.body)).toMatchObject({ id: 'item', description: '' });
});


test('a deleted help article hides its old cached body after the server returns 404', async () => {
    const h = harness('src/app/(dashboard)/help/[slug]/page.tsx', [{ id: 'article', title: 'Guide', content: 'Old deleted instructions', collection: { title: 'Help', articles: [] } }]);
    h.render(); h.fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Article not found' }) });
    try { await h.queries[0].queryFn(); } catch (error) { h.queryErrors[0] = error; }
    const tree = h.render();
    expect(find(tree, (node) => node.type === 'MarkdownArticle')).toBeUndefined();
    expect(find(tree, (node) => node.type === 'Button' && node.props.children.includes('Try again'))).toBeDefined();
});
