import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TemplateEditor } from '@/components/admin/template-editor';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

let randomValuesCalls = 0;
Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
        randomUUID: undefined,
        getRandomValues(array: Uint8Array) {
            randomValuesCalls += 1;
            array.forEach((_, index) => { array[index] = index; });
            return array;
        },
    },
});

assert.doesNotThrow(() => renderToStaticMarkup(<TemplateEditor
    template={null}
    open={false}
    onOpenChange={() => undefined}
    onSaved={() => undefined}
/>));
assert.equal(randomValuesCalls, 0, 'rendering TemplateEditor must not create a temporary field ID');
