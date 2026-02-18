import { getConfig, saveConfig } from './configStore';

const UI_PREFERENCES_KEY = 'uiPreferences';
const UI_SCHEMA_VERSION = 1;

export interface FeatureFlags {
    newShellEnabled: boolean;
}

export interface UiPreferences {
    version: number;
    featureFlags: FeatureFlags;
}

const DEFAULT_UI_PREFERENCES: UiPreferences = {
    version: UI_SCHEMA_VERSION,
    featureFlags: {
        newShellEnabled: true,
    },
};

function normalizeUiPreferences(raw: unknown): UiPreferences {
    const fallback = DEFAULT_UI_PREFERENCES;

    if (!raw || typeof raw !== 'object') {
        return fallback;
    }

    const candidate = raw as Partial<UiPreferences> & {
        newShellEnabled?: boolean;
    };

    // Backward-compatible migration for legacy shape: { newShellEnabled: boolean }
    if (typeof candidate.newShellEnabled === 'boolean') {
        return {
            version: UI_SCHEMA_VERSION,
            featureFlags: {
                newShellEnabled: candidate.newShellEnabled,
            },
        };
    }

    const candidateFeatureFlags = (candidate.featureFlags ?? {}) as Partial<FeatureFlags>;
    const normalized: UiPreferences = {
        version: UI_SCHEMA_VERSION,
        featureFlags: {
            newShellEnabled:
                typeof candidateFeatureFlags.newShellEnabled === 'boolean'
                    ? candidateFeatureFlags.newShellEnabled
                    : fallback.featureFlags.newShellEnabled,
        },
    };

    return normalized;
}

export async function getUiPreferences(): Promise<UiPreferences> {
    const stored = await getConfig<unknown>(UI_PREFERENCES_KEY);
    const normalized = normalizeUiPreferences(stored);

    // Persist migrated/normalized data once to keep future reads simple.
    await saveConfig(UI_PREFERENCES_KEY, normalized);
    return normalized;
}

export async function saveUiPreferences(next: UiPreferences): Promise<void> {
    const normalized = normalizeUiPreferences(next);
    await saveConfig(UI_PREFERENCES_KEY, normalized);
}

export async function getFeatureFlag<K extends keyof FeatureFlags>(
    key: K,
    fallback: FeatureFlags[K]
): Promise<FeatureFlags[K]> {
    const preferences = await getUiPreferences();
    return preferences.featureFlags[key] ?? fallback;
}

export async function setFeatureFlag<K extends keyof FeatureFlags>(
    key: K,
    value: FeatureFlags[K]
): Promise<void> {
    const current = await getUiPreferences();
    const next: UiPreferences = {
        ...current,
        featureFlags: {
            ...current.featureFlags,
            [key]: value,
        },
    };
    await saveUiPreferences(next);
}
