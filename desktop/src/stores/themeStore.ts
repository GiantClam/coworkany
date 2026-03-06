/**
 * Theme Store - manages light/dark/auto theme mode
 *
 * In Tauri runtime, persists to the shared config store so tauri dev and
 * packaged builds resolve the same theme. In plain browser mode, configStore
 * falls back to localStorage.
 */

import { create } from 'zustand';
import type { ThemeMode } from '../types/ui';
import { getConfig, saveConfig } from '../lib/configStore';

interface ThemeState {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
}

const THEME_CONFIG_KEY = 'themeMode';
const LEGACY_THEME_STORAGE_KEY = 'coworkany-theme';

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

function isThemeMode(value: unknown): value is ThemeMode {
    return value === 'light' || value === 'dark' || value === 'auto';
}

function getLegacyThemeMode(): ThemeMode | null {
    try {
        const raw = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as { state?: { mode?: unknown } } | string;
        if (typeof parsed === 'string' && isThemeMode(parsed)) {
            return parsed;
        }

        if (parsed && typeof parsed === 'object' && isThemeMode(parsed.state?.mode)) {
            return parsed.state.mode;
        }
    } catch {
        // Ignore malformed legacy payloads.
    }

    return null;
}

async function resolveInitialThemeMode(): Promise<ThemeMode> {
    const stored = await getConfig<ThemeMode>(THEME_CONFIG_KEY);
    if (isThemeMode(stored)) {
        return stored;
    }

    const legacy = getLegacyThemeMode();
    if (legacy) {
        await saveConfig(THEME_CONFIG_KEY, legacy);
        try {
            localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
        } catch {
            // Ignore localStorage cleanup failures.
        }
        return legacy;
    }

    return 'auto';
}

export const useThemeStore = create<ThemeState>((set) => ({
    mode: 'auto',
    setMode: (mode: ThemeMode) => {
        set({ mode });
        applyTheme(mode);
        void saveConfig(THEME_CONFIG_KEY, mode);
    },
}));

/** Initialize theme on app startup - call before rendering */
export async function initializeTheme(): Promise<void> {
    const mode = await resolveInitialThemeMode();
    useThemeStore.setState({ mode });
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
