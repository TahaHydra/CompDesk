import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/app/(dashboard)/tickets/new/page.tsx', 'utf8') + '\nexport { hasMeaningfulValues, compatibleValues };';
const compiledModule = { exports: {} as any };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, { exports: compiledModule.exports, module: compiledModule, require: () => new Proxy({}, { get: (_, key) => String(key) }) });
const { hasMeaningfulValues, compatibleValues } = compiledModule.exports;
test('untouched configured defaults do not prompt, but changed answers do', () => {
    const fields = [{ fieldKey: 'priority', defaultValue: 'NORMAL' }];
    expect(hasMeaningfulValues({ priority: 'NORMAL' }, fields)).toBe(false);
    expect(hasMeaningfulValues({ priority: 'URGENT' }, fields)).toBe(true);
    expect(hasMeaningfulValues({ details: 'Actual request' }, fields)).toBe(true);
});
test('routing keeps compatible answers but removes obsolete select options', () => {
    const previous = [{ fieldKey: 'type', type: 'DROPDOWN' }, { fieldKey: 'tags', type: 'MULTISELECT' }, { fieldKey: 'summary', type: 'TEXT' }];
    const next = previous.map((field) => ({ ...field, options: ['allowed'] }));
    expect(compatibleValues({ type: 'obsolete', tags: ['allowed', 'obsolete'], summary: 'Preserved' }, previous, next)).toEqual({ tags: ['allowed'], summary: 'Preserved' });
    expect(compatibleValues({ type: 'obsolete', tags: ['old'] }, previous, next.map((field) => ({ ...field, options: [] })))).toEqual({ tags: [] });
});
