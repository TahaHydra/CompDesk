import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { copyTemplateFieldForEditing, createBlankTemplateField } from '@/lib/ticket-form/client-field-draft';
import { isFieldConditionVisible } from '@/lib/ticket-form/conditions';
import { ticketFormSubmissionValues } from '@/lib/ticket-form/client-submission';

// Exercise component handlers without a DOM; the component source is compiled
// unchanged, while hooks and network-backed providers are controlled here.
function componentHarness(file: string, queryData: unknown[] = []) {
    const state: any[] = [];
    const refs: any[] = [];
    let cursor = 0;
    let refCursor = 0;
    let queryCursor = 0;
    let mutationCursor = 0;
    const effects: Array<() => void> = [];
    const mutations: any[] = [];
    const toast = jest.fn();
    const pending = new Set<number>();
    const params = new URLSearchParams('article=article-1');
    const react = {
        createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
        use: (value: any) => value,
        useState: (initial: any) => {
            const index = cursor++;
            if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
            return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
        },
        useRef: (initial: any) => refs[refCursor] ?? (refs[refCursor++] = { current: initial }),
        useEffect: (effect: () => void) => effects.push(effect),
        useMemo: (factory: () => unknown) => factory(),
        useCallback: (callback: unknown) => callback,
    };
    // Ref indices must advance on subsequent renders as well.
    react.useRef = (initial: any) => { const index = refCursor++; return refs[index] ?? (refs[index] = { current: initial }); };
    const compiledModule = { exports: {} as any };
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const imports: Record<string, any> = {
        react,
        'next/navigation': { useSearchParams: () => params, useRouter: () => ({ push: jest.fn() }) },
        'next-auth/react': { useSession: () => ({ data: { user: { id: 'agent-1', role: 'AGENT' } } }) },
        '@tanstack/react-query': {
            useQuery: () => ({ data: queryData[queryCursor++], isLoading: false }),
            useQueryClient: () => ({ invalidateQueries: jest.fn() }),
            useMutation: (options: any) => { const index = mutationCursor++; mutations[index] = options; return { isPending: pending.has(index), mutate: jest.fn() }; },
        },
        '@/components/ui/use-toast': { useToast: () => ({ toast }) },
        '@/components/providers/language-provider': { useLanguage: () => ({ language: 'en', t: (text: string) => text }) },
        '@/lib/help-center': {
            HELP_ICON_KEYS: [],
            helpContentLanguages: (value: any, language: string) => [value.titleEn ? 'en' : null, value.titleFr ? 'fr' : null].filter(Boolean).length ? [value.titleEn ? 'en' : null, value.titleFr ? 'fr' : null].filter(Boolean) : [language],
            localizedHelpTitle: (value: any) => value.titleEn || value.titleFr,
        },
        '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
        '@/lib/ticket-display': { formatTicketValue: (value: string) => value, getPriorityBadgeClass: () => '', getStatusBadgeClass: () => '' },
        '@/lib/ticket-content': { parseTicketContent: () => [] },
        '@/lib/ticket-form/client-field-draft': { copyTemplateFieldForEditing, createBlankTemplateField },
        '@/lib/ticket-form/conditions': { isFieldConditionVisible },
        '@/lib/ticket-form/client-submission': { ticketFormSubmissionValues },
    };
    const requireModule = (name: string) => imports[name] ?? new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) });
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: requireModule, React: react, crypto: { randomUUID: () => 'draft-1' }, console });
    return {
        toast, mutations, pending, params,
        render: (exportName = 'default', props: any = {}) => {
            cursor = refCursor = queryCursor = mutationCursor = 0;
            effects.length = 0;
            const tree = compiledModule.exports[exportName](props);
            return tree;
        },
        effects: () => effects.forEach((effect) => effect()),
    };
}

function find(tree: any, predicate: (node: any) => boolean): any {
    if (tree == null || typeof tree !== 'object') return undefined;
    if (predicate(tree)) return tree;
    for (const child of Array.isArray(tree) ? tree : tree.props?.children ?? []) {
        const found = find(child, predicate);
        if (found) return found;
    }
}

test('closing a deep-linked help article consumes the link instead of reopening the editor', () => {
    const article = { id: 'article-1', collectionId: 'collection-1', collection: { titleEn: 'Help' } };
    const harness = componentHarness('src/components/admin/help-center-manager.tsx', [[], [article]]);
    harness.render('HelpCenterManager'); harness.effects();
    let tree = harness.render('HelpCenterManager');
    const dialog = find(tree, (node) => typeof node.type === 'function' && node.type.name === 'ArticleDialog');
    expect(dialog.props.open).toBe(true);
    dialog.props.onOpenChange(false);
    harness.render('HelpCenterManager'); harness.effects();
    tree = harness.render('HelpCenterManager');
    expect(find(tree, (node) => typeof node.type === 'function' && node.type.name === 'ArticleDialog').props.open).toBe(false);
});

test('an empty help center guides the administrator directly into collection creation', () => {
    const harness = componentHarness('src/components/admin/help-center-manager.tsx', [[], []]);
    let tree = harness.render('HelpCenterManager');
    const create = find(tree, (node) => node.type === 'Button' && node.props.children?.includes?.('Create collection'));
    expect(create).toBeDefined();
    create.props.onClick();
    tree = harness.render('HelpCenterManager');
    expect(find(tree, (node) => typeof node.type === 'function' && node.type.name === 'CollectionDialog').props.open).toBe(true);
});

test('editing single-language help content can add the second translation', () => {
    const collection = { id: 'collection-1', slug: 'accounts', titleEn: 'Accounts', titleFr: '', descriptionEn: '', descriptionFr: '', icon: 'book', sortOrder: 0, isPublished: true, _count: { articles: 0 } };
    const harness = componentHarness('src/components/admin/help-center-manager.tsx', [[collection], []]);
    let tree = harness.render('HelpCenterManager');
    find(tree, (node) => node.type === 'Button' && node.props.children?.includes?.('Edit')).props.onClick();
    tree = harness.render('HelpCenterManager');
    let dialog = find(tree, (node) => typeof node.type === 'function' && node.type.name === 'CollectionDialog');
    expect(dialog.props.languages).toEqual(['en']);
    expect(fs.readFileSync(path.join(process.cwd(), 'src/components/admin/help-center-manager.tsx'), 'utf8')).toContain('Add French translation');
    dialog.props.setLanguages(['en', 'fr']);
    tree = harness.render('HelpCenterManager');
    dialog = find(tree, (node) => typeof node.type === 'function' && node.type.name === 'CollectionDialog');
    expect(dialog.props.languages).toEqual(['en', 'fr']);
});

test('a visible agent-only form field cannot be edited by a requester', () => {
    const field = { ...createBlankTemplateField(10), id: 'field-1', fieldKey: 'staff_code', label: 'Staff code', required: true, visibleTo: ['USER', 'AGENT'], editableBy: ['AGENT'] };
    const harness = componentHarness('src/components/ticket-form/dynamic-ticket-form.tsx');
    const tree = harness.render('DynamicTicketForm', { fields: [field], values: { staff_code: 'reference' }, role: 'USER', onChange() {} });
    expect(find(tree, (node) => node.type === 'Input' && node.props.value === 'reference').props.disabled).toBe(true);
});

test.each([
    ['DROPDOWN', 'Textarea', 'First\n', 'First\nSecond'],
    ['FILE', 'Input', 'image/png,', 'image/png,application/pdf'],
])('template %s input retains delimiters while typing', (type, inputType, first, second) => {
    const field = { ...createBlankTemplateField(10), id: 'field-1', fieldKey: 'custom', label: 'Custom', type, options: ['First'], validationRules: { allowedFileTypes: ['image/png'] } };
    const template = { id: 'template-1', name: 'Support', fields: [field] };
    const harness = componentHarness('src/components/admin/template-editor.tsx');
    const props = { template, open: true, onOpenChange() {}, onSaved() {} };
    harness.render('TemplateEditor', props); harness.effects();
    let tree = harness.render('TemplateEditor', props);
    find(tree, (node) => node.props?.['aria-label'] === 'Edit Custom').props.onClick();
    tree = harness.render('TemplateEditor', props);
    const initial = type === 'FILE' ? 'image/png' : 'First';
    find(tree, (node) => node.type === inputType && node.props.value === initial).props.onChange({ target: { value: first } });
    tree = harness.render('TemplateEditor', props);
    const input = find(tree, (node) => node.type === inputType && node.props.value === first);
    expect(input).toBeDefined();
    input.props.onChange({ target: { value: second } });
    tree = harness.render('TemplateEditor', props);
    expect(find(tree, (node) => node.type === inputType && node.props.value === second)).toBeDefined();
    find(tree, (node) => node.type === 'Button' && node.props.children.includes('Apply changes')).props.onClick();
    tree = harness.render('TemplateEditor', props);
    const preview = find(tree, (node) => node.type === 'DynamicTicketForm');
    expect(type === 'FILE' ? preview.props.fields[0].validationRules.allowedFileTypes : preview.props.fields[0].options)
        .toEqual(type === 'FILE' ? ['image/png', 'application/pdf'] : ['First', 'Second']);
});

test('reply failures surface an error and a pending send protects the draft', () => {
    const harness = componentHarness('src/app/(dashboard)/tickets/[id]/page.tsx', [{ id: 'ticket-1', status: 'OPEN', priority: 'NORMAL', assignments: [], timeline: [], attachments: [] }, [], []]);
    let tree = harness.render('default', { params: { id: 'ticket-1' } });
    const addComment = harness.mutations[2];
    expect(typeof addComment.onError).toBe('function');
    addComment.onError(new Error('Offline'));
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Offline' }));
    harness.pending.add(2);
    tree = harness.render('default', { params: { id: 'ticket-1' } });
    expect(find(tree, (node) => node.type === 'Textarea' && node.props.onPaste).props.disabled).toBe(true);
});
