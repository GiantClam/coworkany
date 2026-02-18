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

export function ProfileList({ config, onSwitch, onDelete, onUpdateMaxHistory }: ProfileListProps) {
    const { t } = useTranslation();

    return (
        <div>
            <h3 style={{ marginTop: 0, fontSize: '16px', marginBottom: '20px' }}>{t('settings.configuredProfiles')}</h3>
            <div className={styles.profileList}>
                {config.profiles?.map(profile => (
                    <div
                        key={profile.id}
                        className={`${styles.profileCard} ${config.activeProfileId === profile.id ? styles.active : ''}`}
                        onClick={() => onSwitch(profile.id)}
                    >
                        <div className={styles.profileCardContent}>
                            <div className={`${styles.statusIndicator} ${profile.verified ? styles.verified : styles.unverified}`} />
                            <div className={styles.profileInfo}>
                                <div className={styles.profileName}>{profile.name}</div>
                                <div className={styles.profileMeta}>
                                    {profile.provider} • {
                                        profile.provider === 'anthropic' ? profile.anthropic?.model :
                                            profile.provider === 'openrouter' ? profile.openrouter?.model :
                                                profile.custom?.model
                                    }
                                </div>
                            </div>
                        </div>
                        <div className={styles.profileActions}>
                            {config.activeProfileId === profile.id && (
                                <span className={styles.activeBadge}>{t('settings.active')}</span>
                            )}
                            <button
                                className={styles.deleteButton}
                                onClick={(e) => { e.stopPropagation(); onDelete(profile.id); }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                        </div>
                    </div>
                ))}
                {(!config.profiles || config.profiles.length === 0) && (
                    <div className={styles.emptyState}>
                        {t('settings.noProfiles')}
                    </div>
                )}
            </div>

            <div style={{ marginTop: 'var(--space-8)' }}>
                <Field label={t('settings.maxHistoryMessages')}>
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
