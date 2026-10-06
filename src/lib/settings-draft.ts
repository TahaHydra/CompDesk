/**
 * Per-card editing state for Settings. Every card shares one server snapshot (the `settings` query),
 * so a save in one card refetches values another card may be editing. A server refresh therefore
 * updates only fields the user has not touched, and a save sends only that card's changed fields.
 */
export type Draft = Record<string, string>;

/** Server values for untouched fields; the user's text for dirty ones. */
export function syncDraft(draft: Draft, dirty: ReadonlySet<string>, server: Record<string, string | undefined>, keys: readonly string[]): Draft {
    return Object.fromEntries(keys.map((key) => [key, dirty.has(key) ? draft[key] ?? '' : server[key] ?? '']));
}

/**
 * The PATCH payload for one card: dirty fields that differ from the server. Blank values are not
 * sent (blank secrets mean "keep"), except for keys listed in `allowEmpty`. Removing optional
 * material is a separate, explicit `null` action.
 */
export function changedValues(draft: Draft, dirty: ReadonlySet<string>, server: Record<string, string | undefined>, allowEmpty: ReadonlySet<string> = new Set()): Record<string, string> {
    return Object.fromEntries([...dirty]
        .filter((key) => (draft[key] ?? '') !== (server[key] ?? ''))
        .filter((key) => allowEmpty.has(key) || (draft[key] ?? '').trim() !== '')
        .map((key) => [key, draft[key] ?? '']));
}
