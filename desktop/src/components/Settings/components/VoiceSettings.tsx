import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_VOICE_SETTINGS,
    getVoiceSettings,
    saveVoiceSettings,
} from '../../../lib/configStore';
import type { VoiceProviderMode } from '../../../types';
import { toast } from '../../Common/ToastProvider';
import styles from '../SettingsView.module.css';

const AutoIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
    </svg>
);

const SystemIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <line x1="8" y1="20" x2="16" y2="20" />
        <line x1="12" y1="16" x2="12" y2="20" />
    </svg>
);

const CustomIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 3 1.9 3.9L18 9l-3 2.9.7 4.1L12 14l-3.7 2 .7-4.1L6 9l4.1-2.1L12 3Z" />
    </svg>
);

const VOICE_OPTIONS: Array<{ value: VoiceProviderMode; labelKey: string; descriptionKey: string; icon: JSX.Element }> = [
    {
        value: 'auto',
        labelKey: 'settings.voiceModeAuto',
        descriptionKey: 'settings.voiceModeAutoHint',
        icon: <AutoIcon />,
    },
    {
        value: 'system',
        labelKey: 'settings.voiceModeSystem',
        descriptionKey: 'settings.voiceModeSystemHint',
        icon: <SystemIcon />,
    },
    {
        value: 'custom',
        labelKey: 'settings.voiceModeCustom',
        descriptionKey: 'settings.voiceModeCustomHint',
        icon: <CustomIcon />,
    },
];

export function VoiceSettings() {
    const { t } = useTranslation();
    const [providerMode, setProviderMode] = useState<VoiceProviderMode>(DEFAULT_VOICE_SETTINGS.providerMode);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void getVoiceSettings().then((settings) => {
            setProviderMode(settings.providerMode);
            setLoaded(true);
        });
    }, []);

    const handleSelect = useCallback(async (nextMode: VoiceProviderMode) => {
        if (nextMode === providerMode || saving) {
            return;
        }

        setProviderMode(nextMode);
        setSaving(true);
        try {
            await saveVoiceSettings({ providerMode: nextMode });
            toast.success(t('settings.settingsSaved'));
        } catch (error) {
            setProviderMode(providerMode);
            toast.error(
                t('settings.settingsError'),
                error instanceof Error ? error.message : String(error),
            );
        } finally {
            setSaving(false);
        }
    }, [providerMode, saving, t]);

    if (!loaded) {
        return null;
    }

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>
                <div>
                    <h3>{t('settings.voiceProviders')}</h3>
                    <p>{t('settings.voiceProvidersHint')}</p>
                </div>
            </div>

            <div className={styles.stack}>
                <div className={styles.optionGroup}>
                    {VOICE_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className={styles.optionBtn}
                            aria-pressed={providerMode === option.value}
                            onClick={() => void handleSelect(option.value)}
                            disabled={saving}
                        >
                            <span className={styles.optionIcon}>{option.icon}</span>
                            {t(option.labelKey)}
                        </button>
                    ))}
                </div>

                <div className={styles.shortcutRow}>
                    <div className={styles.shortcutInfo}>
                        <div className={styles.shortcutCopy}>
                            <span className={styles.shortcutLabel}>{t(`settings.voiceMode${providerMode.charAt(0).toUpperCase()}${providerMode.slice(1)}`)}</span>
                            <span className={styles.shortcutHint}>
                                {t(VOICE_OPTIONS.find((option) => option.value === providerMode)?.descriptionKey ?? 'settings.voiceModeAutoHint')}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
