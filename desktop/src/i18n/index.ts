/**
 * i18n Initialization
 *
 * Configures react-i18next with English and Chinese translations.
 * Language preference persisted to localStorage.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

const LANG_STORAGE_KEY = 'coworkany-lang';

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        zh: { translation: zh },
    },
    lng: localStorage.getItem(LANG_STORAGE_KEY) || 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
});

/** Change language and persist to localStorage */
export function changeLanguage(lang: string) {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
    i18n.changeLanguage(lang);
}

/** Get current language */
export function getCurrentLanguage(): string {
    return i18n.language || 'en';
}

export default i18n;
