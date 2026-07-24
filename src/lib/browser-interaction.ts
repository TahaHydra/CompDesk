export const ACTIVE_INTERACTION_LAYER_SELECTOR = [
    '[role="dialog"][data-state="open"]',
    '[role="alertdialog"][data-state="open"]',
    '[role="menu"][data-state="open"]',
    '[role="listbox"][data-state="open"]',
    // Popper-based layers (dropdown, popover, an open select) live inside this
    // wrapper while mounted. Treating it as "active" keeps the guard below from
    // clearing a lock that a still-open modal select legitimately set.
    '[data-radix-popper-content-wrapper]',
].join(', ');

interface InteractionDocument {
    body: {
        style: {
            pointerEvents: string;
            removeProperty: (property: string) => void;
        };
    };
    querySelector: (selectors: string) => unknown;
}

/**
 * Radix modal layers temporarily disable pointer events on the document body.
 * A browser back/forward restore or a client navigation that unmounts a layer
 * mid-transition can leave that inline style behind after the layer is gone.
 */
export function releaseStaleInteractionLock(document: InteractionDocument): boolean {
    if (document.body.style.pointerEvents !== 'none') return false;
    if (document.querySelector(ACTIVE_INTERACTION_LAYER_SELECTOR)) return false;

    document.body.style.removeProperty('pointer-events');
    return true;
}

/**
 * Installs an always-on, self-healing guard for the body pointer-events lock.
 *
 * Reacting only on route changes or focus (the previous approach) leaves a
 * window where a leaked lock silently swallows every click — the "the button
 * only works on the second try" and "the sidebar is dead right after I log in"
 * reports. Observing the body's `style` attribute lets us recover on the very
 * next animation frame after the lock leaks, no matter what caused it, while
 * the active-layer check still leaves genuine open modals untouched.
 *
 * Returns a cleanup function that tears the guard down.
 */
export function installInteractionLockGuard(win: Window & typeof globalThis): () => void {
    let frame = 0;

    const runCheck = () => {
        frame = 0;
        releaseStaleInteractionLock(win.document);
    };

    // Coalesce bursts of style mutations into a single deferred check. Deferring
    // to the next frame also ensures a freshly opened modal has mounted its
    // content before we decide whether the lock is stale.
    const schedule = () => {
        if (frame) return;
        frame = win.requestAnimationFrame(runCheck);
    };

    const observer = new win.MutationObserver(schedule);
    observer.observe(win.document.body, { attributes: true, attributeFilter: ['style'] });
    // A bfcache restore or tab refocus can surface a lock that leaked while the
    // page was hidden and never emitted a style mutation we could observe.
    win.addEventListener('pageshow', schedule);
    win.addEventListener('focus', schedule);
    // Recover anything already stuck at mount time.
    schedule();

    return () => {
        if (frame) win.cancelAnimationFrame(frame);
        observer.disconnect();
        win.removeEventListener('pageshow', schedule);
        win.removeEventListener('focus', schedule);
    };
}