'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
    theme: Theme;
    resolvedTheme: 'light' | 'dark';
    setTheme: (theme: Theme) => void;
}

const THEME_STORAGE_KEY = 'compdesk-theme';
const LEGACY_THEME_STORAGE_KEY = 'excodesk-theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(theme: Theme) {
    const root = document.documentElement;
    const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

    const setTheme = useCallback((nextTheme: Theme) => {
        setThemeState(nextTheme);
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        applyThemeClass(nextTheme);
        setResolvedTheme(nextTheme === 'system' ? getSystemTheme() : nextTheme);
    }, []);

    useEffect(() => {
        const storedTheme = (localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) as Theme | null;
        const initialTheme = storedTheme ?? 'system';
        if (!localStorage.getItem(THEME_STORAGE_KEY) && storedTheme) localStorage.setItem(THEME_STORAGE_KEY, storedTheme);
        setThemeState(initialTheme);
        applyThemeClass(initialTheme);
        setResolvedTheme(initialTheme === 'system' ? getSystemTheme() : initialTheme);
    }, []);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            if (theme === 'system') {
                applyThemeClass('system');
                setResolvedTheme(getSystemTheme());
            }
        };

        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, [theme]);

    const value = useMemo(
        () => ({
            theme,
            resolvedTheme,
            setTheme,
        }),
        [theme, resolvedTheme, setTheme]
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

