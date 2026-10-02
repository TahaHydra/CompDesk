import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isFieldConditionVisible } from '@/lib/ticket-form/conditions';
import { ticketFormSubmissionValues } from '@/lib/ticket-form/client-submission';

function render(file: string, props: any, ticket?: any, globals = {}) {
    const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
        use: (value: any) => value, useState: (value: any) => [value, jest.fn()], useRef: (value: any) => ({ current: value }),
        useEffect: jest.fn(), useCallback: (fn: any) => fn, useMemo: (fn: any) => fn() };
    let query = 0;
    const imports: Record<string, any> = { react,
        'next-auth/react': { useSession: () => ({ data: { user: { id: 'me', role: 'SUPER_ADMIN' } } }) },
        'next/navigation': { useRouter: () => ({ push: jest.fn() }) },
        '@tanstack/react-query': { useQuery: () => ({ data: [ticket, [], []][query++], isLoading: false }), useMutation: () => ({ mutate: jest.fn() }), useQueryClient: () => ({ invalidateQueries: jest.fn() }) },
        '@/components/ui/use-toast': { useToast: () => ({ toast: jest.fn() }) },
        '@/components/providers/language-provider': { useLanguage: () => ({ language: 'en', t: (key: string) => key }) },
        '@/lib/utils': { cn: (...parts: any[]) => parts.filter(Boolean).join(' ') },
        '@/lib/ticket-content': { parseTicketContent: (value: string) => [{ kind: 'text', value }] },
        '@/lib/ticket-display': { formatTicketValue: (value: string) => value, getStatusBadgeClass: () => '', getPriorityBadgeClass: () => '' },
        '@/lib/ticket-form/conditions': { isFieldConditionVisible },
        '@/lib/ticket-form/client-submission': { ticketFormSubmissionValues },
    };
    const compiledModule = { exports: {} as any };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: (key: string) => imports[key] ?? new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) }), React: react, ...globals });
    return ticket ? compiledModule.exports.default(props) : compiledModule.exports.DynamicTicketForm(props);
}
function nodes(tree: any): any[] {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    if (tree === null || tree === undefined || typeof tree === 'boolean') return [];
    return typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [typeof tree === 'string' ? tree.trim() : tree];
}
const field = (overrides: any) => ({ id: 'f', fieldKey: 'f', label: 'Request', type: 'TEXT', editableBy: ['USER'], visibleTo: ['USER'], options: [], width: 6, ...overrides });
test('helper text follows controls and checkboxes have one accessible label', () => {
    const tree = render('src/components/ticket-form/dynamic-ticket-form.tsx', { fields: [field({ helpText: 'Long guidance' }), field({ id: 'check', fieldKey: 'check', type: 'CHECKBOX', label: 'Sensitive' })], role: 'USER', values: {}, onChange: jest.fn() });
    const flat = nodes(tree);
    expect(flat.indexOf(flat.find((n) => n.type === 'Input'))).toBeLessThan(flat.indexOf('Long guidance'));
    expect(flat.filter((n) => n === 'Sensitive')).toHaveLength(1);
    expect(flat.find((n) => n.type === 'input' && n.props.type === 'checkbox').props['aria-describedby']).toBeUndefined();
});

test('a later upload failure preserves earlier successful files and retry appends without duplicates', async () => {
    const onChange = jest.fn();
    const fetchMock = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ url: '/one', filename: 'one' }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Failed' }) });
    const props = { fields: [field({ type: 'FILE' })], role: 'USER', values: {}, onChange };
    const flat = nodes(render('src/components/ticket-form/dynamic-ticket-form.tsx', props, undefined, { fetch: fetchMock, FormData: class { append() {} } }));
    flat.find((n) => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{ name: 'one' }, { name: 'two' }], value: 'selected' } });
    await new Promise(setImmediate);
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0][1];
    expect(saved).toMatchObject([{ url: '/one' }]);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: '/two', filename: 'two' }) });
    const retried = nodes(render('src/components/ticket-form/dynamic-ticket-form.tsx', { ...props, values: { f: saved } }, undefined, { fetch: fetchMock, FormData: class { append() {} } }));
    retried.find((n) => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{ name: 'two' }], value: 'selected' } });
    await new Promise(setImmediate);
    expect(onChange.mock.calls[1][1].map((file: any) => file.url)).toEqual(['/one', '/two']);
});
test('opening author and submitted answers precede conversation; details precede actions', () => {
    const ticket = { id: 't', requesterId: 'requester', requester: { name: 'Marie Curie' }, title: 'Access request', description: 'Opening description', status: 'NEW', priority: 'NORMAL', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z', timeline: [{ id: 'own', type: 'COMMENT', userId: 'me', user: { name: 'Me' }, content: 'Reply', createdAt: '2026-10-02T11:00:00Z' }, { id: 'other', type: 'COMMENT', userId: 'other', user: { name: 'Other' }, content: 'Answer', createdAt: '2026-10-02T11:00:00Z' }], historicalForm: { templateName: 'Access', version: 1, fields: [{ id: 'resource', fieldKey: 'resource', label: 'Resource', type: 'TEXT', builtIn: null }], values: { resource: 'Finance' } } };
    const flat = nodes(render('src/app/(dashboard)/tickets/[id]/page.tsx', { params: { id: 't' } }, ticket));
    expect(flat.indexOf('Marie Curie')).toBeLessThan(flat.indexOf('Conversation'));
    expect(flat.indexOf('Finance')).toBeLessThan(flat.indexOf('Conversation'));
    expect(flat.indexOf('Details')).toBeLessThan(flat.indexOf('Actions'));
    const entries = flat.filter((n) => n?.props?.['data-conversation-author']);
    expect(entries.map((n) => n.props['data-conversation-author'])).toEqual(['self', 'other']);
    expect(entries[0].props.className).toContain('ml-auto');
    expect(entries[1].props.className).toContain('mr-auto');
    expect(flat).toContain('Claim Ticket');
    expect(nodes(flat.find((n) => n.type === 'ConfirmDestructiveAction').props.trigger)).toContain('Withdraw');
});
