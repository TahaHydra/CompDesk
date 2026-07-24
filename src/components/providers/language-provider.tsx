'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { normalizeLanguage, translate, type AppLanguage } from '@/lib/i18n';

interface LanguageContextValue {
    language: AppLanguage;
    setLanguage: (language: AppLanguage) => void;
    t: (key: string, values?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
    initialLanguage,
    children,
}: {
    initialLanguage: AppLanguage;
    children: React.ReactNode;
}) {
    const [language, setLanguageState] = useState<AppLanguage>(normalizeLanguage(initialLanguage));
    const setLanguage = useCallback((nextLanguage: AppLanguage) => setLanguageState(normalizeLanguage(nextLanguage)), []);
    const t = useCallback(
        (key: string, values?: Record<string, string | number>) => translate(language, key, values),
        [language]
    );

    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);

    const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
    const context = useContext(LanguageContext);
    if (!context) throw new Error('useLanguage must be used within LanguageProvider');
    return context;
}