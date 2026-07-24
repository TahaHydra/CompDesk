import {
    ACTIVE_INTERACTION_LAYER_SELECTOR,
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