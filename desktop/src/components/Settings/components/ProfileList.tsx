/**
 * ProfileList Component
 *
 * Displays list of configured LLM profiles
 */

import { useTranslation } from 'react-i18next';
import type { LlmConfig } from '../../../types';
import styles from '../SettingsView.module.css';

interface ProfileListProps {
    config: LlmConfig;
    onSwitch: (id: string) => void;
    onDelete: (id: string) => void;
    onUpdateMaxHistory: (value: number | undefined) => void;
}

const OPENAI_COMPATIBLE_PRESET_PROVIDERS = new Set([
    'openai',
    'aiberm',
    'nvidia',
    'siliconflow',
    'gemini',
    'qwen',
    'minimax',
    'kimi',
]);

function resolveProfileModel(profile: {
    provider: string;
    anthropic?: { model?: string };
    openrouter?: { model?: string };
    openai?: { model?: string };
    custom?: { model?: string };
}) {
    if (profile.provider === 'anthropic') return profile.anthropic?.model;
    if (profile.provider === 'openrouter') return profile.openrouter?.model;
    if (OPENAI_COMPATIBLE_PRESET_PROVIDERS.has(profile.provider)) return profile.openai?.model;
    return profile.custom?.model;
}

const DeleteIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
);

export function ProfileList({ config, onSwitch, onDelete, onUpdateMaxHistory }: ProfileListProps) {
    const { t } = useTranslation();

    return (
        <div>
            <div className={styles.profileListHeader}>
                <div className={styles.profileListTopRow}>
                    <h3 className={styles.sectionTitle}>{t('settings.configuredProfiles')}</h3>

                    <Field label={t('settings.maxHistoryMessages')} compact>
                        <input
                            className={styles.inputField}
                            type="number"
                            min={1}
                            value={config.maxHistoryMessages ?? ''}
                            onChange={(e) => {
                                const value = e.target.value ? Number(e.target.value) : undefined;
                                onUpdateMaxHistory(value);
                            }}
                            placeholder={t('settings.maxHistoryPlaceholder')}
                        />
                    </Field>
                </div>

                <p className={styles.sectionIntro}>
                    {t('settings.profileListHint', {
                        defaultValue: 'The active profile is used for new tasks immediately.',
                    })}
                </p>
            </div>

            <div className={styles.profileList}>
                {config.profiles?.map(profile => {
                    const model = resolveProfileModel(profile);

                    return (
                        <div
                            key={profile.id}
                            className={`${styles.profileCard} ${config.activeProfileId === profile.id ? styles.active : ''}`}
                            onClick={() => onSwitch(profile.id)}
                        >
                            <div className={styles.profileCardTop}>
                                <div className={styles.profileCardContent}>
                                    <div className={`${styles.statusIndicator} ${profile.verified ? styles.verified : styles.unverified}`} />
                                    <div className={styles.profileInfo}>
                                        <div className={styles.profileName}>{profile.name}</div>
                                    </div>
                                </div>
                                <div className={styles.profileActions}>
                                    {config.activeProfileId === profile.id && (
                                        <span className={styles.activeBadge}>{t('settings.active')}</span>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.deleteButton}
                                        title={t('settings.deleteProfileAction')}
                                        aria-label={t('settings.deleteProfileAction')}
                                        onClick={(e) => { e.stopPropagation(); onDelete(profile.id); }}
                                    >
                                        <DeleteIcon />
                                    </button>
                                </div>
                            </div>

                            <div className={styles.profileTagRow}>
                                <span className={styles.profileProviderBadge}>{profile.provider}</span>
                                {model && (
                                    <span className={styles.profileMeta}>
                                        {model}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
                {(!config.profiles || config.profiles.length === 0) && (
                    <div className={styles.emptyState}>
                        <strong className={styles.emptyStateTitle}>{t('settings.noProfiles')}</strong>
                        <span className={styles.emptyStateHint}>
                            {t('settings.noProfilesHint', {
                                defaultValue: 'Create your first profile from the editor to the left, then choose it here as the active default.',
                            })}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

function Field({
    label,
    children,
    compact = false,
}: {
    label: string;
    children: React.ReactNode;
    compact?: boolean;
}) {
    return (
        <div className={`${styles.field} ${compact ? styles.fieldCompact : ''}`}>
            <div className={styles.label}>{label}</div>
            {children}
        </div>
    );
}
