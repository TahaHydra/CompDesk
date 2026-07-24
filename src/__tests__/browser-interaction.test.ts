import {
    ACTIVE_INTERACTION_LAYER_SELECTOR,
    installInteractionLockGuard,
    releaseStaleInteractionLock,
} from '@/lib/browser-interaction';

function createDocument(pointerEvents: string, activeLayer: unknown = null) {
    const document = {
        body: {
            style: {
                pointerEvents,
                removeProperty: jest.fn(),
            },
        },
        querySelector: jest.fn(() => activeLayer),
    };
    document.body.style.removeProperty.mockImplementation((property: string) => {
        if (property === 'pointer-events') document.body.style.pointerEvents = '';
    });
    return document;
}

describe('releaseStaleInteractionLock', () => {
    it('clears a stale body pointer lock when no interaction layer is open', () => {
        const document = createDocument('none');

        expect(releaseStaleInteractionLock(document)).toBe(true);
        expect(document.querySelector).toHaveBeenCalledWith(ACTIVE_INTERACTION_LAYER_SELECTOR);
        expect(document.body.style.removeProperty).toHaveBeenCalledWith('pointer-events');
        expect(document.body.style.pointerEvents).toBe('');
    });

    it('preserves the lock while a real modal interaction layer is open', () => {
        const document = createDocument('none', {});

        expect(releaseStaleInteractionLock(document)).toBe(false);
        expect(document.body.style.removeProperty).not.toHaveBeenCalled();
        expect(document.body.style.pointerEvents).toBe('none');
    });

    it('does nothing when the body is already interactive', () => {
        const document = createDocument('');

        expect(releaseStaleInteractionLock(document)).toBe(false);
        expect(document.querySelector).not.toHaveBeenCalled();
        expect(document.body.style.removeProperty).not.toHaveBeenCalled();
    });
});

function createWindow(pointerEvents: string, activeLayer: unknown = null) {
    const document = createDocument(pointerEvents, activeLayer);
    let observerCallback: (() => void) | null = null;
    const rafCallbacks: Array<() => void> = [];
    const listeners: Record<string, Array<() => void>> = {};

    const win = {
        document,
        requestAnimationFrame: jest.fn((cb: () => void) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length; // non-zero handle
        }),
        cancelAnimationFrame: jest.fn(),
        addEventListener: jest.fn((type: string, listener: () => void) => {
            (listeners[type] ??= []).push(listener);
        }),
        removeEventListener: jest.fn((type: string, listener: () => void) => {
            listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
        }),
        MutationObserver: jest.fn((cb: () => void) => {
            observerCallback = cb;
            return { observe: jest.fn(), disconnect: jest.fn() };
        }),
    };

    return {
        win: win as unknown as Window & typeof globalThis,
        document,
        flushFrames: () => {
            const pending = rafCallbacks.splice(0);
            pending.forEach((cb) => cb());
        },
        emitMutation: () => observerCallback?.(),
        emit: (type: string) => (listeners[type] ?? []).forEach((l) => l()),
        listeners,
    };
}

describe('installInteractionLockGuard', () => {
    it('clears a lock that is already stuck when the guard mounts', () => {
        const { win, document, flushFrames } = createWindow('none');

        installInteractionLockGuard(win);
        flushFrames();

        expect(document.body.style.removeProperty).toHaveBeenCalledWith('pointer-events');
        expect(document.body.style.pointerEvents).toBe('');
    });

    it('recovers when a lock leaks after mount', () => {
        const { win, document, flushFrames, emitMutation } = createWindow('');

        installInteractionLockGuard(win);
        flushFrames(); // nothing to clear yet
        expect(document.body.style.removeProperty).not.toHaveBeenCalled();

        // A modal leaks the lock, then a style mutation is observed.
        document.body.style.pointerEvents = 'none';
        emitMutation();
        flushFrames();

        expect(document.body.style.removeProperty).toHaveBeenCalledWith('pointer-events');
    });

    it('leaves the lock in place while a modal layer is genuinely open', () => {
        const { win, document, flushFrames, emitMutation } = createWindow('none', {});

        installInteractionLockGuard(win);
        emitMutation();
        flushFrames();

        expect(document.body.style.removeProperty).not.toHaveBeenCalled();
        expect(document.body.style.pointerEvents).toBe('none');
    });

    it('coalesces a burst of mutations into a single scheduled check', () => {
        const { win, emitMutation } = createWindow('none');

        installInteractionLockGuard(win); // schedules once at mount
        emitMutation();
        emitMutation();
        emitMutation();

        // Mount + burst collapse to a single pending frame.
        expect(win.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it('detaches its listeners on cleanup', () => {
        const { win } = createWindow('');

        const cleanup = installInteractionLockGuard(win);
        cleanup();

        expect(win.removeEventListener).toHaveBeenCalledWith('pageshow', expect.any(Function));
        expect(win.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    });
});