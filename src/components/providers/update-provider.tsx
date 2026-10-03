'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canInspectUpdates, dismissalKey, type UpdateState } from '@/lib/updates';

export async function requestUpdateState(force = false): Promise<UpdateState> {
    const response = await fetch('/api/updates', { method: force ? 'POST' : 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Update check unavailable');
    return response.json();
}

function useUpdateController(role: string, userId: string, version: string) {
    const queryClient = useQueryClient();
    const enabled = canInspectUpdates(role);
    const queryKey = ['compdesk-updates', userId];
    const query = useQuery({
        queryKey, queryFn: () => requestUpdateState(), enabled,
        staleTime: 60 * 60 * 1000, refetchInterval: 60 * 60 * 1000, retry: false,
    });
    const refresh = useMutation({
        mutationFn: () => requestUpdateState(true),
        onSuccess: (state) => queryClient.setQueryData(queryKey, state),
    });
    const [open, setOpen] = useState(false);
    const [dismissal, setDismissal] = useState<{ userId: string; version: string | null }>({ userId, version: null });
    const key = dismissalKey(userId);
    useEffect(() => {
        if (!enabled) return;
        const load = () => {
            let value: string | null = null;
            try { value = localStorage.getItem(key); } catch { /* Storage may be disabled. */ }
            setDismissal({ userId, version: value });
        };
        load();
        const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) load(); };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, [key, userId, enabled]);

    const state: UpdateState = query.data ?? {
        installed: version, automatic: true, manifest: null, lastChecked: null,
        checkStatus: query.isError ? 'unavailable' : 'not_checked', stale: false, refreshLimited: false,
    };
    const storeDismissal = (value: string | null) => {
        if (!enabled) return;
        setDismissal({ userId, version: value });
        try {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch { /* In-memory collapse still works when browser storage is blocked. */ }
    };
    return {
        role, userId, state, open: open && enabled, setOpen,
        dismissed: dismissal.userId === userId ? dismissal.version : null,
        dismiss: () => storeDismissal(state.manifest?.latest ?? null), restore: () => storeDismissal(null),
        refresh: () => { if (enabled) refresh.mutate(); },
        busy: query.isFetching || refresh.isPending,
        loaded: Boolean(query.data),
        refreshError: refresh.isError,
    };
}

const UpdateContext = createContext<ReturnType<typeof useUpdateController> | null>(null);

export function UpdateProvider({ role, userId, version, children }: { role: string; userId: string; version: string; children: React.ReactNode }) {
    const value = useUpdateController(role, userId, version);
    return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdates() {
    const context = useContext(UpdateContext);
    if (!context) throw new Error('useUpdates must be used within UpdateProvider');
    return context;
}
