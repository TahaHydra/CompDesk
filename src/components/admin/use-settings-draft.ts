'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { changedValues, syncDraft, type Draft } from '@/lib/settings-draft';
import type { SettingsMap } from '@/lib/settings-client';

/** Editing state for one Settings card; see settings-draft.ts for the merge rules. */
export function useSettingsDraft(settings: SettingsMap | undefined, keys: readonly string[], allowEmpty?: ReadonlySet<string>) {
    const [draft, setDraft] = useState<Draft>({});
    const dirty = useRef(new Set<string>());
    const keyList = keys.join('|');

    useEffect(() => {
        if (settings) setDraft((current) => syncDraft(current, dirty.current, settings, keyList.split('|')));
    }, [settings, keyList]);

    const set = useCallback((key: string, value: string) => {
        dirty.current.add(key);
        setDraft((current) => ({ ...current, [key]: value }));
    }, []);

    /** Call after a successful save, before the settings query refetches. */
    const markSaved = useCallback((savedKeys: readonly string[]) => {
        for (const key of savedKeys) dirty.current.delete(key);
    }, []);

    const changes = () => (settings ? changedValues(draft, dirty.current, settings, allowEmpty) : {});
    return { draft, set, markSaved, changes };
}
