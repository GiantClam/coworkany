/**
 * Configuration Store
 *
 * Wraps Tauri Store plugin for persistent key-value storage.
 * Provides typed helpers for API keys, settings, and first-run detection.
 *
 * In non-Tauri environments (dev browser), falls back to localStorage.
 * In Tauri runtime, never fall back to origin-bound localStorage because that
 * would reintroduce dev/release divergence.
 */

import { isTauri } from './tauri';
import type { VoiceProviderMode, VoiceSettings } from '../types';

// ============================================================================
// Tauri Store abstraction
// ============================================================================

interface StoreBackend {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    save(): Promise<void>;
}

let _store: StoreBackend | null = null;

function createMemoryBackend(): StoreBackend {
    const memory = new Map<string, unknown>();
    return {
        get: async <T>(key: string) => (memory.has(key) ? (memory.get(key) as T) : null),
        set: async (key: string, value: unknown) => {
            memory.set(key, value);
        },
        delete: async (key: string) => {
            memory.delete(key);
        },
        save: async () => { /* noop for in-memory */ },
    };
}

async function getStore(): Promise<StoreBackend> {
    if (_store) return _store;

    try {
        const { load } = await import('@tauri-apps/plugin-store');
        const tauriStore = await load('settings.json', { defaults: {}, autoSave: true });
        _store = {
            get: async <T>(key: string) => {
                const val = await tauriStore.get<T>(key);
                return val ?? null;
            },
            set: async (key: string, value: unknown) => {
                await tauriStore.set(key, value);
            },
            delete: async (key: string) => {
                await tauriStore.delete(key);
            },
            save: async () => {
                await tauriStore.save();
            },
        };
    } catch (e) {
        if (isTauri()) {
            console.warn('[configStore] Failed to initialize Tauri Store, falling back to in-memory backend for this session', e);
            _store = createMemoryBackend();
        } else {
            _store = createLocalStorageBackend();
        }
    }

    if (!_store) {
        _store = createLocalStorageBackend();
    }

    return _store;
}

function createLocalStorageBackend(): StoreBackend {
    const prefix = 'coworkany:';
    return {
        get: async <T>(key: string) => {
            const raw = localStorage.getItem(prefix + key);
            if (raw === null) return null;
            try { return JSON.parse(raw) as T; } catch { return null; }
        },
        set: async (key: string, value: unknown) => {
            localStorage.setItem(prefix + key, JSON.stringify(value));
        },
        delete: async (key: string) => {
            localStorage.removeItem(prefix + key);
        },
        save: async () => { /* noop for localStorage */ },
    };
}

function getLegacyLocalStorageValue<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(`coworkany:${key}`);
        if (raw === null) {
            return null;
        }
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function clearLegacyLocalStorageValue(key: string): void {
    try {
        localStorage.removeItem(`coworkany:${key}`);
    } catch {
        // Ignore cleanup failures.
    }
}

// ============================================================================
// Public API
// ============================================================================

/** Get a typed value from the store */
export async function getConfig<T>(key: string): Promise<T | null> {
    const store = await getStore();
    const value = await store.get<T>(key);
    if (value !== null) {
        return value;
    }

    if (isTauri()) {
        const legacy = getLegacyLocalStorageValue<T>(key);
        if (legacy !== null) {
            await store.set(key, legacy);
            clearLegacyLocalStorageValue(key);
            return legacy;
        }
    }

    return null;
}

/** Set a value in the store */
export async function saveConfig(key: string, value: unknown): Promise<void> {
    const store = await getStore();
    await store.set(key, value);
}

/** Delete a key from the store */
export async function deleteConfig(key: string): Promise<void> {
    const store = await getStore();
    await store.delete(key);
}

// ============================================================================
// API Key helpers
// ============================================================================

/** Get API key for a specific provider */
export async function getApiKey(provider: string): Promise<string | null> {
    return getConfig<string>(`apiKeys.${provider}`);
}

/** Save API key for a specific provider */
export async function setApiKey(provider: string, key: string): Promise<void> {
    return saveConfig(`apiKeys.${provider}`, key);
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

export interface ShortcutConfig {
    toggleWindow: string;
    newTask: string;
    openSettings: string;
    commandPalette: string;
    showShortcuts: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
    providerMode: 'auto',
};

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
    toggleWindow: 'Alt+Space',
    newTask: 'Ctrl+N',
    openSettings: 'Ctrl+,',
    commandPalette: 'Ctrl+K',
    showShortcuts: 'Ctrl+/',
};

/** Get the current shortcut configuration */
export async function getShortcuts(): Promise<ShortcutConfig> {
    const stored = await getConfig<ShortcutConfig>('shortcuts');
    return { ...DEFAULT_SHORTCUTS, ...stored };
}

/** Save the shortcut configuration */
export async function saveShortcuts(shortcuts: ShortcutConfig): Promise<void> {
    return saveConfig('shortcuts', shortcuts);
}

// ============================================================================
// Voice Settings
// ============================================================================

/** Get the current voice provider preference */
export async function getVoiceSettings(): Promise<VoiceSettings> {
    const stored = await getConfig<VoiceSettings>('voice');
    const providerMode = stored?.providerMode;
    return {
        providerMode: providerMode === 'system' || providerMode === 'custom' ? providerMode : 'auto',
    };
}

/** Save the current voice provider preference */
export async function saveVoiceSettings(settings: VoiceSettings): Promise<void> {
    const providerMode: VoiceProviderMode =
        settings.providerMode === 'system' || settings.providerMode === 'custom'
            ? settings.providerMode
            : 'auto';
    await saveConfig('voice', { providerMode });
}

// ============================================================================
// First-run detection
// ============================================================================

/** Check if this is the first time the app is launched */
export async function isFirstRun(): Promise<boolean> {
    const completed = await getConfig<boolean>('setupCompleted');
    return !completed;
}

/** Mark the setup wizard as completed */
export async function markSetupCompleted(): Promise<void> {
    return saveConfig('setupCompleted', true);
}
