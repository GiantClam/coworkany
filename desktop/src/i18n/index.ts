/**
 * i18n Initialization
 *
 * Configures react-i18next with English and Chinese translations.
 * Language preference is persisted via the shared config store so
 * Tauri dev and packaged builds resolve the same language.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';
import { getConfig, saveConfig } from '../lib/configStore';

const LANG_STORAGE_KEY = 'coworkany-lang';
const LANG_CONFIG_KEY = 'language';
const DEFAULT_LANGUAGE = 'en';

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        zh: { translation: zh },
    },
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
});

function getLegacyLanguagePreference(): string | null {
    try {
        return localStorage.getItem(LANG_STORAGE_KEY);
    } catch {
        return null;
    }
}

async function resolveInitialLanguage(): Promise<string> {
    const stored = await getConfig<string>(LANG_CONFIG_KEY);
    if (stored) {
        return stored;
    }

    const legacy = getLegacyLanguagePreference();
    if (legacy) {
        await saveConfig(LANG_CONFIG_KEY, legacy);
        try {
            localStorage.removeItem(LANG_STORAGE_KEY);
        } catch {
            // Ignore localStorage cleanup failures.
        }
        return legacy;
    }

    return DEFAULT_LANGUAGE;
}

/** Hydrate language preference before rendering the app */
export async function hydrateLanguagePreference(): Promise<void> {
    const language = await resolveInitialLanguage();
    await i18n.changeLanguage(language);
}

/** Change language and persist to the shared config store */
export function changeLanguage(lang: string) {
    void saveConfig(LANG_CONFIG_KEY, lang);
    void i18n.changeLanguage(lang);
}

/** Get current language */
export function getCurrentLanguage(): string {
    return i18n.language || DEFAULT_LANGUAGE;
}

export default i18n;
