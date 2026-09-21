import { execFileSync } from 'node:child_process';
import { createBrowserUuid } from '@/lib/browser-uuid';
import { copyTemplateFieldForEditing, createBlankTemplateField } from '@/lib/ticket-form/client-field-draft';
import type { TicketFormFieldDefinition } from '@/lib/ticket-form/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function installCrypto(implementation: Partial<Crypto>) {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: implementation });
}

function fallbackCrypto() {
    let sequence = 0;
    const getRandomValues = jest.fn((array: Uint8Array) => {
        sequence += 1;
        array.forEach((_, index) => { array[index] = (sequence + index) & 0xff; });
        return array;
    });
    installCrypto({ randomUUID: undefined, getRandomValues } as unknown as Crypto);
    return getRandomValues;
}

afterEach(() => {
    jest.restoreAllMocks();
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
});

test('uses browser crypto.randomUUID when it is available', () => {
    const randomUUID = jest.fn(() => '123e4567-e89b-42d3-a456-426614174000' as `${string}-${string}-${string}-${string}-${string}`);
    const getRandomValues = jest.fn();
    installCrypto({ randomUUID, getRandomValues } as unknown as Crypto);

    expect(createBrowserUuid()).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(getRandomValues).not.toHaveBeenCalled();
});

test('constructs an RFC 4122 version-4 UUID when randomUUID is unavailable', () => {
    const getRandomValues = fallbackCrypto();

    const uuid = createBrowserUuid();

    expect(uuid).toMatch(UUID_PATTERN);
    expect(uuid).toBe('01020304-0506-4708-890a-0b0c0d0e0f10');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
});

test('never falls back to Math.random and fails clearly without a secure RNG', () => {
    const mathRandom = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    fallbackCrypto();
    expect(createBrowserUuid()).toMatch(UUID_PATTERN);

    installCrypto({ randomUUID: undefined, getRandomValues: undefined } as unknown as Crypto);
    let failure: unknown;
    try {
        createBrowserUuid();
    } catch (error) {
        failure = error;
    }
    const mathRandomCalls = mathRandom.mock.calls.length;
    mathRandom.mockRestore();
    expect(failure).toEqual(new Error('Secure browser random number generation is unavailable.'));
    expect(mathRandomCalls).toBe(0);
});

test('mounting TemplateEditor creates no draft ID on a LAN-HTTP-compatible crypto surface', () => {
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/template-editor-browser-smoke.tsx'], {
        cwd: process.cwd(),
        stdio: 'pipe',
    })).not.toThrow();
});

test('a new field gets exactly one unique valid ID while editing preserves an existing ID', () => {
    const getRandomValues = fallbackCrypto();

    const first = createBlankTemplateField(10);
    const second = createBlankTemplateField(20);
    expect(first.id).toMatch(UUID_PATTERN);
    expect(second.id).toMatch(UUID_PATTERN);
    expect(second.id).not.toBe(first.id);
    expect(getRandomValues).toHaveBeenCalledTimes(2);

    const existing: TicketFormFieldDefinition = { ...first, visibleTo: ['USER'], editableBy: ['USER'] };
    const editingCopy = copyTemplateFieldForEditing(existing);
    expect(editingCopy.id).toBe(existing.id);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
});
