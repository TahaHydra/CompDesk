export type SettingsMap = Record<string, string>;

export async function loadSettings(): Promise<SettingsMap> {
    const response = await fetch('/api/settings');
    const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
    if (!response.ok) throw new Error(payload.error || 'Failed to load settings');
    return payload;
}

export async function updateSettings(data: Record<string, string>): Promise<{ success: boolean; restartRequired?: boolean; warning?: string }> {
    const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const payload = await response.json().catch(() => ({ error: 'The server returned an invalid response' }));
    if (!response.ok) throw new Error(payload.error || 'Failed to update settings');
    return payload;
}

/** Reads a PEM file chosen in the browser; the server validates the content. */
export async function readPemFile(file: File | undefined): Promise<string | null> {
    if (!file) return null;
    if (file.size > 64 * 1024) throw new Error('PEM files must be 64 KB or smaller.');
    return file.text();
}
