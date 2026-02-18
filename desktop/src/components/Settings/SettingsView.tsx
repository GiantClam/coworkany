/**
 * SettingsView Component
 *
 * Main settings interface using child components and useSettings hook.
 * Uses global toast notifications for save/error feedback.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DirectivesEditor } from './DirectivesEditor';
import { ProfileEditor } from './components/ProfileEditor';
import { ProfileList } from './components/ProfileList';
import { SearchSettings } from './components/SearchSettings';
import { ShortcutSettings } from './components/ShortcutSettings';
import { useSettings } from './hooks/useSettings';
import { toast } from '../Common/ToastProvider';
import { useThemeStore } from '../../stores/themeStore';
import { changeLanguage } from '../../i18n';
import type { ThemeMode } from '../../types/ui';
import { getFeatureFlag, setFeatureFlag } from '../../lib/uiPreferences';
import styles from './SettingsView.module.css';

import '../../styles/variables.css';

export function SettingsView() {
    const { t } = useTranslation();
    const {
        config,
        loading,
        error,
        saved,
        isValidating,
        validationMsg,
        searchSettings,
        searchSaved,
        refresh,
        validateAndAddProfile,
        switchProfile,
        deleteProfile,
        saveSearchSettings,
        updateMaxHistoryMessages,
    } = useSettings();

    // Show toast on save/error state changes
    const prevError = useRef(error);
    const prevSaved = useRef(saved);

    useEffect(() => {
        if (error && error !== prevError.current) {
            toast.error(t('settings.settingsError'), error);
        }
        prevError.current = error;
    }, [error]);

    useEffect(() => {
        if (saved && !prevSaved.current) {
            toast.success(t('settings.settingsSaved'));
        }
        prevSaved.current = saved;
    }, [saved]);

    useEffect(() => {
        if (searchSaved) {
            toast.success(t('settings.searchSettingsSaved'));
        }
    }, [searchSaved]);

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerContent}>
                    <h2>{t('settings.title')}</h2>
                    <p>{t('settings.subtitle')}</p>
                </div>
                <button className={styles.refreshBtn} onClick={() => void refresh()} disabled={loading}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 4v6h-6"></path>
                        <path d="M1 20v-6h6"></path>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    {t('settings.reload')}
                </button>
            </div>

            {/* Appearance */}
            <AppearanceSection />

            {/* Directives Editor */}
            <div className={styles.section}>
                <DirectivesEditor />
            </div>

            {/* Profile Management Grid */}
            <div className={styles.grid}>
                <ProfileEditor
                    onSave={validateAndAddProfile}
                    isValidating={isValidating}
                    validationMsg={validationMsg}
                />

                <ProfileList
                    config={config}
                    onSwitch={switchProfile}
                    onDelete={deleteProfile}
                    onUpdateMaxHistory={updateMaxHistoryMessages}
                />
            </div>

            {/* Keyboard Shortcuts */}
            <ShortcutSettings />

            {/* Search Settings */}
            <SearchSettings
                settings={searchSettings}
                onSave={saveSearchSettings}
                saved={searchSaved}
            />

            {/* Footer */}
            <div className={styles.footer}>
                {t('settings.footerNote')}
            </div>
        </div>
    );
}

// ============================================================================
// Appearance Section — Theme switcher
// ============================================================================

const themeOptionKeys: { value: ThemeMode; labelKey: string; icon: string }[] = [
    { value: 'light', labelKey: 'settings.light', icon: '\u2600' },
    { value: 'dark', labelKey: 'settings.dark', icon: '\u263E' },
    { value: 'auto', labelKey: 'settings.system', icon: '\u2699' },
];

const languageOptions: { value: string; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
];

function AppearanceSection() {
    const { t, i18n } = useTranslation();
    const { mode, setMode } = useThemeStore();
    const [newShellEnabled, setNewShellEnabled] = useState(true);

    useEffect(() => {
        let mounted = true;
        void getFeatureFlag('newShellEnabled', true)
            .then((enabled) => {
                if (mounted) {
                    setNewShellEnabled(enabled);
                }
            })
            .catch(() => {
                if (mounted) {
                    setNewShellEnabled(true);
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    const toggleShell = () => {
        setNewShellEnabled((prev) => {
            const next = !prev;
            void setFeatureFlag('newShellEnabled', next);
            return next;
        });
    };

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>
                <h3>{t('settings.appearance')}</h3>
                <p>{t('settings.chooseTheme')}</p>
            </div>
            <div className={styles.optionGroup}>
                {themeOptionKeys.map((opt) => (
                    <button
                        key={opt.value}
                        className={styles.optionBtn}
                        aria-pressed={mode === opt.value}
                        onClick={() => setMode(opt.value)}
                    >
                        <span>{opt.icon}</span>
                        {t(opt.labelKey)}
                    </button>
                ))}
            </div>

            <div className={styles.subsection}>
                <div className={styles.sectionHeader}>
                    <h3>{t('settings.language')}</h3>
                    <p>{t('settings.chooseLanguage')}</p>
                </div>
                <div className={styles.optionGroup}>
                    {languageOptions.map((opt) => (
                        <button
                            key={opt.value}
                            className={styles.optionBtn}
                            aria-pressed={i18n.language === opt.value}
                            onClick={() => changeLanguage(opt.value)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.subsection}>
                <div className={styles.sectionHeader}>
                    <h3>{t('settings.newShellTitle')}</h3>
                    <p>{t('settings.newShellHint')}</p>
                </div>
                <button
                    className={styles.toggleBtn}
                    aria-pressed={newShellEnabled}
                    onClick={toggleShell}
                >
                    {newShellEnabled ? t('settings.disableNewShell') : t('settings.enableNewShell')}
                </button>
            </div>
        </div>
    );
}
