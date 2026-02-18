/**
 * Theme Store — manages light/dark/auto theme mode
 *
 * - Persists to localStorage via Zustand persist middleware
 * - Listens to system prefers-color-scheme for 'auto' mode
 * - Sets `data-theme` attribute on <html> element
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '../types/ui';

interface ThemeState {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
}

/** Resolve 'auto' to actual light/dark based on system preference */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
    if (mode === 'auto') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
}

/** Apply theme to DOM */
function applyTheme(mode: ThemeMode) {
    const resolved = resolveTheme(mode);
    document.documentElement.dataset.theme = resolved;
}

export const useThemeStore = create<ThemeState>()(
    persist(
        (set) => ({
            mode: 'auto' as ThemeMode,
            setMode: (mode: ThemeMode) => {
                set({ mode });
                applyTheme(mode);
            },
        }),
        { name: 'coworkany-theme' }
    )
);

/** Initialize theme on app startup — call once from main.tsx */
export function initializeTheme() {
    const { mode } = useThemeStore.getState();
    applyTheme(mode);

    // Listen for system theme changes when in 'auto' mode
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', () => {
        const current = useThemeStore.getState().mode;
        if (current === 'auto') {
            applyTheme('auto');
        }
    });
}
