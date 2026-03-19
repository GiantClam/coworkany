/**
 * SettingsView Component
 *
 * Main settings interface using child components and useSettings hook.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DirectivesEditor } from './DirectivesEditor';
import { ProfileEditor } from './components/ProfileEditor';
import { ProfileList } from './components/ProfileList';
import { SearchSettings } from './components/SearchSettings';
import { ProxySettings } from './components/ProxySettings';
import { ShortcutSettings } from './components/ShortcutSettings';
import { DependencySetupSection } from './components/DependencySetupSection';
import { useSettings } from './hooks/useSettings';
import { toast } from '../Common/ToastProvider';
import { useThemeStore } from '../../stores/themeStore';
import { changeLanguage } from '../../i18n';
import type { ThemeMode } from '../../types/ui';
import styles from './SettingsView.module.css';

import '../../styles/variables.css';

const SunIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
        <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
        <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
);

const MoonIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3c0 .28 0 .57.02.85A7 7 0 0 0 20.15 12c.28 0 .57 0 .85-.02z" />
    </svg>
);

const SystemIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <line x1="8" y1="20" x2="16" y2="20" />
        <line x1="12" y1="16" x2="12" y2="20" />
    </svg>
);

export function SettingsView() {
    const { t, i18n } = useTranslation();
    const { mode } = useThemeStore();
    const {
        config,
        loading,
        error,
        saved,
        isValidating,
        validationMsg,
        searchSettings,
        searchSaved,
        proxySettings,
        proxySaved,
        refresh,
        validateAndAddProfile,
        switchProfile,
        deleteProfile,
        saveSearchSettings,
        saveProxySettings,
        updateMaxHistoryMessages,
    } = useSettings();

    const prevError = useRef(error);
    const prevSaved = useRef(saved);

    useEffect(() => {
        if (error && error !== prevError.current) {
            toast.error(t('settings.settingsError'), error);
        }
        prevError.current = error;
    }, [error, t]);

    useEffect(() => {
        if (saved && !prevSaved.current) {
            toast.success(t('settings.settingsSaved'));
        }
        prevSaved.current = saved;
    }, [saved, t]);

    useEffect(() => {
        if (searchSaved) {
            toast.success(t('settings.searchSettingsSaved'));
        }
    }, [searchSaved, t]);

    useEffect(() => {
        if (proxySaved) {
            toast.success(t('settings.proxySettingsSaved'));
        }
    }, [proxySaved, t]);

    const activeProfile = config.profiles?.find((profile) => profile.id === config.activeProfileId)
        ?? config.profiles?.[0];
    const hasProfiles = Boolean(config.profiles?.length);
    const hasSearchCredential = Boolean(
        searchSettings.serperApiKey
        || searchSettings.tavilyApiKey
        || searchSettings.braveApiKey
        || searchSettings.searxngUrl
    );
    const searchProviderLabel = {
        serper: 'Serper',
        tavily: 'Tavily',
        brave: 'Brave',
        searxng: 'SearXNG',
    }[searchSettings.provider ?? 'searxng'];
    const themeLabelKey = {
        light: 'settings.light',
        dark: 'settings.dark',
        auto: 'settings.system',
    }[mode];
    const languageLabel = i18n.language === 'zh' ? '中文' : 'English';

    return (
        <div className={styles.container}>
            <section className={styles.heroPanel}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <span className={styles.headerKicker}>System preferences</span>
                        <h2 className={styles.pageTitle}>{t('settings.title')}</h2>
                        <p>{t('settings.subtitle')}</p>
                    </div>
                    <button type="button" className={styles.refreshBtn} onClick={() => void refresh()} disabled={loading}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M23 4v6h-6" />
                            <path d="M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        {t('settings.reload')}
                    </button>
                </div>

                <div className={styles.overviewGrid}>
                    <SummaryCard
                        eyebrow={t('settings.summaryAiEyebrow', { defaultValue: 'AI' })}
                        title={activeProfile?.name ?? t('settings.summaryAiTitle', { defaultValue: 'No active model yet' })}
                        description={activeProfile
                            ? `${activeProfile.provider}${activeProfile.verified ? ' · verified' : ''}`
                            : t('settings.summaryAiDescription', { defaultValue: 'Add your first model profile to start new tasks with the right runtime.' })}
                    />
                    <SummaryCard
                        eyebrow={t('settings.summaryConnectivityEyebrow', { defaultValue: 'Connectivity' })}
                        title={`${searchProviderLabel}${proxySettings.enabled ? ' + Proxy' : ''}`}
                        description={hasSearchCredential
                            ? t('settings.summaryConnectivityConfigured', { defaultValue: 'Search is configured. Network controls are ready when you need them.' })
                            : t('settings.summaryConnectivityPending', { defaultValue: 'Search credentials and proxy remain optional until you need heavier research workflows.' })}
                    />
                    <SummaryCard
                        eyebrow={t('settings.summaryInterfaceEyebrow', { defaultValue: 'Interface' })}
                        title={`${t(themeLabelKey)} · ${languageLabel}`}
                        description={t('settings.summaryInterfaceDescription', {
                            defaultValue: 'Appearance, language, shortcuts, and directives stay grouped on the right for quick adjustments.',
                        })}
                    />
                </div>
            </section>

            <div className={styles.contentShell}>
                <div className={styles.primaryColumn}>
                    <div className={`${styles.profileWorkspace} ${!hasProfiles ? styles.profileWorkspaceEmpty : ''}`}>
                        <ProfileEditor
                            onSave={validateAndAddProfile}
                            isValidating={isValidating}
                            validationMsg={validationMsg}
                        />

                        <div className={styles.section}>
                            <ProfileList
                                config={config}
                                onSwitch={switchProfile}
                                onDelete={deleteProfile}
                                onUpdateMaxHistory={updateMaxHistoryMessages}
                            />
                        </div>
                    </div>

                    <SearchSettings
                        settings={searchSettings}
                        onSave={saveSearchSettings}
                        saved={searchSaved}
                    />

                    <ProxySettings
                        settings={proxySettings}
                        onSave={saveProxySettings}
                        saved={proxySaved}
                    />

                    <DependencySetupSection />
                </div>

                <div className={styles.secondaryColumn}>
                    <AppearanceSection />
                    <ShortcutSettings />
                    <div className={styles.section}>
                        <DirectivesEditor />
                    </div>
                </div>
            </div>

            <div className={styles.footer}>
                {t('settings.footerNote')}
            </div>
        </div>
    );
}

const themeOptionKeys: { value: ThemeMode; labelKey: string; icon: JSX.Element }[] = [
    { value: 'light', labelKey: 'settings.light', icon: <SunIcon /> },
    { value: 'dark', labelKey: 'settings.dark', icon: <MoonIcon /> },
    { value: 'auto', labelKey: 'settings.system', icon: <SystemIcon /> },
];

const languageOptions: { value: string; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
];

function AppearanceSection() {
    const { t, i18n } = useTranslation();
    const { mode, setMode } = useThemeStore();

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>
                <div>
                    <h3>{t('settings.appearance')}</h3>
                    <p>{t('settings.chooseTheme')}</p>
                </div>
            </div>
            <div className={styles.optionGroup}>
                {themeOptionKeys.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        className={styles.optionBtn}
                        aria-pressed={mode === opt.value}
                        onClick={() => setMode(opt.value)}
                    >
                        <span className={styles.optionIcon}>{opt.icon}</span>
                        {t(opt.labelKey)}
                    </button>
                ))}
            </div>

            <div className={styles.subsection}>
                <div className={styles.sectionHeader}>
                    <div>
                        <h3>{t('settings.language')}</h3>
                        <p>{t('settings.chooseLanguage')}</p>
                    </div>
                </div>
                <div className={styles.optionGroup}>
                    {languageOptions.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            className={styles.optionBtn}
                            aria-pressed={i18n.language === opt.value}
                            onClick={() => changeLanguage(opt.value)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SummaryCard({
    eyebrow,
    title,
    description,
}: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <div className={styles.summaryCard}>
            <span className={styles.summaryEyebrow}>{eyebrow}</span>
            <strong className={styles.summaryTitle}>{title}</strong>
            <p className={styles.summaryDescription}>{description}</p>
        </div>
    );
}
