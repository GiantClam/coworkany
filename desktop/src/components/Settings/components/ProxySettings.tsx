import { useTranslation } from 'react-i18next';
import type { ProxySettings as ProxySettingsType } from '../../../types';
import styles from '../SettingsView.module.css';

const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890';

interface ProxySettingsProps {
    settings: ProxySettingsType;
    onSave: (settings: ProxySettingsType) => Promise<void>;
    saved: boolean;
}

const CheckIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

export function ProxySettings({ settings, onSave, saved }: ProxySettingsProps) {
    const { t } = useTranslation();
    const enabled = settings.enabled === true;

    const handleSave = (next: ProxySettingsType) => {
        void onSave(next);
    };

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>
                <div>
                    <h3>{t('settings.proxySettings')}</h3>
                    <p>{t('settings.proxyDescription')}</p>
                </div>
                {saved && (
                    <span className={styles.savedIndicator}>
                        <span className={styles.savedIndicatorIcon}>
                            <CheckIcon />
                        </span>
                        {t('settings.saved')}
                    </span>
                )}
            </div>

            <div className={styles.field}>
                <div className={styles.label}>{t('settings.proxyEnabled')}</div>
                <div className={styles.optionGroup}>
                    <button
                        type="button"
                        className={styles.optionBtn}
                        aria-pressed={enabled}
                        onClick={() => handleSave({
                            ...settings,
                            enabled: true,
                            url: settings.url?.trim() || DEFAULT_PROXY_URL,
                        })}
                    >
                        {t('common.on')}
                    </button>
                    <button
                        type="button"
                        className={styles.optionBtn}
                        aria-pressed={!enabled}
                        onClick={() => handleSave({ ...settings, enabled: false })}
                    >
                        {t('common.off')}
                    </button>
                </div>
            </div>

            <div className={styles.searchGrid}>
                <Field label={t('settings.proxyUrl')}>
                    <input
                        className={styles.inputField}
                        type="text"
                        value={settings.url ?? ''}
                        onChange={(event) => handleSave({ ...settings, url: event.target.value || undefined })}
                        placeholder={DEFAULT_PROXY_URL}
                        disabled={!enabled}
                    />
                </Field>

                <Field label={t('settings.proxyBypass')}>
                    <input
                        className={styles.inputField}
                        type="text"
                        value={settings.bypass ?? ''}
                        onChange={(event) => handleSave({ ...settings, bypass: event.target.value || undefined })}
                        placeholder={t('settings.proxyBypassPlaceholder')}
                    />
                </Field>
            </div>

            <div className={styles.infoBox}>{t('settings.proxyHint')}</div>
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
