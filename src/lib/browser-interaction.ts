export const ACTIVE_INTERACTION_LAYER_SELECTOR = [
    '[role="dialog"][data-state="open"]',
    '[role="alertdialog"][data-state="open"]',
    '[role="menu"][data-state="open"]',
    '[role="listbox"][data-state="open"]',
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