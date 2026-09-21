/** Reports success only after the browser confirms the copy. */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Permission denial can still permit a user-initiated legacy copy.
    }

    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
    const previousFocus = document.activeElement as HTMLElement | null;
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    // Keep focus inside an open modal's focus trap (e.g. generated passwords).
    const container = previousFocus?.closest('[role="dialog"], [role="alertdialog"]') ?? document.body;
    try {
        container.appendChild(input);
        input.focus();
        input.select();
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        input.remove();
        previousFocus?.focus();
    }
}
