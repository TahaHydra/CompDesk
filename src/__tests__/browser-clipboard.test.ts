import { copyText } from '@/lib/browser-clipboard';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
    for (const [name, descriptor] of [['navigator', originalNavigator], ['document', originalDocument]] as const) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
    }
});

function install(navigator: unknown, document?: unknown) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
}

test('does not report clipboard success until the asynchronous write completes', async () => {
    let complete!: () => void;
    const write = new Promise<void>((resolve) => { complete = resolve; });
    let copied = false;
    install({ clipboard: { writeText: () => write } });
    const result = copyText('secret').then((value) => { copied = value; });
    await Promise.resolve();
    expect(copied).toBe(false);
    complete();
    await result;
    expect(copied).toBe(true);
});

test('uses an input inside the active dialog when the async clipboard is absent on HTTP', async () => {
    let attached = false;
    let selected = false;
    let restored = false;
    const textarea = { value: '', style: {}, setAttribute() {}, focus() {}, select() { selected = true; }, remove() { attached = false; } };
    const dialog = { appendChild(node: unknown) { expect(node).toBe(textarea); attached = true; } };
    install({}, {
        activeElement: { closest: () => dialog, focus() { restored = true; } },
        createElement: () => textarea,
        execCommand: (command: string) => command === 'copy' && attached && selected && textarea.value === 'secret',
    });
    expect(await copyText('secret')).toBe(true);
    expect(attached).toBe(false);
    expect(restored).toBe(true);
});

test('returns failure when clipboard permission is denied and no legacy copy exists', async () => {
    install({ clipboard: { writeText: async () => { throw new Error('Denied'); } } });
    expect(await copyText('secret')).toBe(false);
});

test('does not claim success if the browser rejects the legacy copy operation', async () => {
    const remove = jest.fn();
    install({}, {
        body: { appendChild() {} },
        createElement: () => ({ value: '', style: {}, setAttribute() {}, focus() {}, select() {}, remove }),
        execCommand: () => false,
    });
    expect(await copyText('secret')).toBe(false);
    expect(remove).toHaveBeenCalled();
});
