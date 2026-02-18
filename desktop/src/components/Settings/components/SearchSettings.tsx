/**
 * SearchSettings Component
 *
 * Configuration for web search providers
 */

import { useTranslation } from 'react-i18next';
import type { SearchSettings as SearchSettingsType } from '../../../types';
import styles from '../SettingsView.module.css';

interface SearchSettingsProps {
    settings: SearchSettingsType;
    onSave: (settings: SearchSettingsType) => Promise<void>;
    saved: boolean;
}

export function SearchSettings({ settings, onSave, saved }: SearchSettingsProps) {
    const { t } = useTranslation();

    const handleSave = (newSettings: SearchSettingsType) => {
        void onSave(newSettings);
    };

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>
                <div>
                    <h3>{t('settings.webSearchSettings')}</h3>
                    <p>
                        {t('settings.searchDescription')}
                    </p>
                </div>
                {saved && (
                    <span className={styles.savedIndicator}>
                        ✓ {t('settings.saved')}
                    </span>
                )}
            </div>

            <div className={styles.searchGrid}>
                <div className={styles.searchFieldGroup}>
                    <Field label={t('settings.searchProvider')}>
                        <select
                            className={styles.inputField}
                            value={settings.provider ?? 'searxng'}
                            onChange={(e) => {
                                const provider = e.target.value as SearchSettingsType['provider'];
                                handleSave({ ...settings, provider });
                            }}
                        >
                            <option value="serper">{t('settings.serperOption')}</option>
                            <option value="tavily">{t('settings.tavilyOption')}</option>
                            <option value="brave">{t('settings.braveOption')}</option>
                            <option value="searxng">{t('settings.searxngOption')}</option>
                        </select>
                    </Field>

                    {settings.provider === 'searxng' && (
                        <Field label={t('settings.searxngUrl')}>
                            <input
                                className={styles.inputField}
                                type="text"
                                value={settings.searxngUrl ?? ''}
                                onChange={(e) => handleSave({ ...settings, searxngUrl: e.target.value || undefined })}
                                placeholder={t('settings.searxngPlaceholder')}
                            />
                        </Field>
                    )}
                </div>

                <div className={styles.searchFieldGroup}>
                    <Field label={t('settings.serperApiKey')}>
                        <input
                            className={styles.inputField}
                            type="password"
                            value={settings.serperApiKey ?? ''}
                            onChange={(e) => handleSave({ ...settings, serperApiKey: e.target.value || undefined })}
                            placeholder={t('settings.serperPlaceholder')}
                        />
                        <a href="https://serper.dev" target="_blank" rel="noopener noreferrer" className={styles.link}>
                            {t('settings.getSerperKey')}
                        </a>
                    </Field>

                    <Field label={t('settings.tavilyApiKey')}>
                        <input
                            className={styles.inputField}
                            type="password"
                            value={settings.tavilyApiKey ?? ''}
                            onChange={(e) => handleSave({ ...settings, tavilyApiKey: e.target.value || undefined })}
                            placeholder={t('settings.tavilyPlaceholder')}
                        />
                        <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className={styles.link}>
                            {t('settings.getTavilyKey')}
                        </a>
                    </Field>

                    <Field label={t('settings.braveApiKey')}>
                        <input
                            className={styles.inputField}
                            type="password"
                            value={settings.braveApiKey ?? ''}
                            onChange={(e) => handleSave({ ...settings, braveApiKey: e.target.value || undefined })}
                            placeholder={t('settings.bravePlaceholder')}
                        />
                        <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer" className={styles.link}>
                            {t('settings.getBraveKey')}
                        </a>
                    </Field>
                </div>
            </div>

            <div className={styles.infoBox}>
                {t('settings.providerFallback')}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className={styles.field}>
            <div className={styles.label}>{label}</div>
            {children}
        </div>
    );
}
