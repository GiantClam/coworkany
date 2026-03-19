import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import styles from './SettingsView.module.css';

interface Directive {
    id: string;
    name: string;
    content: string;
    enabled: boolean;
    priority: number;
    trigger?: string;
}

type IpcResult = {
    success: boolean;
    payload?: {
        payload?: Record<string, unknown>;
    };
};

function extractPayload(result: IpcResult): Record<string, unknown> {
    const payload = result.payload?.payload;
    return payload && typeof payload === 'object'
        ? payload
        : {};
}

const emptyDirectiveDraft = {
    name: '',
    content: '',
    enabled: true,
    priority: 0,
    trigger: '',
};

const PlusIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

export const DirectivesEditor: React.FC = () => {
    const { t } = useTranslation();
    const [directives, setDirectives] = useState<Directive[]>([]);
    const [draft, setDraft] = useState(emptyDirectiveDraft);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void loadDirectives();
    }, []);

    const loadDirectives = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('list_directives');
            const payload = extractPayload(result);
            setDirectives(Array.isArray(payload.directives) ? (payload.directives as Directive[]) : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load directives');
        } finally {
            setLoading(false);
        }
    };

    const updateLocalDirective = (id: string, updates: Partial<Directive>) => {
        setDirectives((prev) => prev.map((directive) =>
            directive.id === id ? { ...directive, ...updates } : directive
        ));
    };

    const saveDirective = async (directive: Directive) => {
        setLoading(true);
        setError(null);
        try {
            await invoke<IpcResult>('upsert_directive', {
                input: {
                    directive: {
                        ...directive,
                        trigger: directive.trigger?.trim() || undefined,
                    },
                },
            });
            await loadDirectives();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save directive');
        } finally {
            setLoading(false);
        }
    };

    const toggleDirective = async (directive: Directive) => {
        updateLocalDirective(directive.id, { enabled: !directive.enabled });
        await saveDirective({
            ...directive,
            enabled: !directive.enabled,
        });
    };

    const removeDirective = async (id: string) => {
        setLoading(true);
        setError(null);
        try {
            await invoke<IpcResult>('remove_directive', {
                input: {
                    directiveId: id,
                },
            });
            await loadDirectives();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove directive');
        } finally {
            setLoading(false);
        }
    };

    const addDirective = async () => {
        if (!draft.name.trim() || !draft.content.trim()) {
            return;
        }

        await saveDirective({
            id: crypto.randomUUID(),
            name: draft.name.trim(),
            content: draft.content.trim(),
            enabled: draft.enabled,
            priority: draft.priority,
            trigger: draft.trigger.trim() || undefined,
        });
        setDraft(emptyDirectiveDraft);
    };

    return (
        <div>
            <div className={styles.sectionHeader}>
                <div>
                    <h3>{t('settings.personalizedDirectives')}</h3>
                    <p>{t('settings.directivesHint')}</p>
                </div>
            </div>

            <div className={styles.stack}>
                {directives.map((directive) => (
                    <div key={directive.id} className={styles.directiveCard}>
                        <div className={styles.directiveEditorTop}>
                            <div className={styles.directiveBadgeRow}>
                                <span className={styles.priorityBadge}>P{directive.priority}</span>
                                <button
                                    type="button"
                                    className={`${styles.toggleInline} ${directive.enabled ? styles.toggleInlineActive : ''}`}
                                    aria-pressed={directive.enabled}
                                    onClick={() => void toggleDirective(directive)}
                                    disabled={loading}
                                >
                                    {directive.enabled ? t('common.on') : t('common.off')}
                                </button>
                            </div>

                            <div className={styles.directiveActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryAction}
                                    onClick={() => void removeDirective(directive.id)}
                                    disabled={loading}
                                >
                                    {t('common.remove')}
                                </button>
                                <button
                                    type="button"
                                    className={styles.verifyButton}
                                    onClick={() => void saveDirective(directive)}
                                    disabled={loading}
                                >
                                    {t('common.save')}
                                </button>
                            </div>
                        </div>

                        <div className={styles.directiveFields}>
                            <div className={styles.field}>
                                <div className={styles.label}>{t('settings.directiveName', { defaultValue: 'Name' })}</div>
                                <input
                                    className={styles.inputField}
                                    value={directive.name}
                                    onChange={(event) => updateLocalDirective(directive.id, { name: event.target.value })}
                                    disabled={loading}
                                />
                            </div>
                            <div className={styles.field}>
                                <div className={styles.label}>{t('settings.directiveContent', { defaultValue: 'Instruction' })}</div>
                                <textarea
                                    className={`${styles.inputField} ${styles.textareaField}`}
                                    value={directive.content}
                                    onChange={(event) => updateLocalDirective(directive.id, { content: event.target.value })}
                                    disabled={loading}
                                    rows={4}
                                />
                            </div>
                            <div className={styles.field}>
                                <div className={styles.label}>{t('settings.directiveTrigger', { defaultValue: 'Trigger Regex' })}</div>
                                <input
                                    className={styles.inputField}
                                    value={directive.trigger ?? ''}
                                    onChange={(event) => updateLocalDirective(directive.id, { trigger: event.target.value })}
                                    disabled={loading}
                                    placeholder={t('settings.directiveTriggerPlaceholder', { defaultValue: 'Optional' })}
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className={styles.directiveCard} style={{ marginTop: 12 }}>
                <div className={styles.directiveEditorTop}>
                    <div className={styles.directiveBadgeRow}>
                        <span className={styles.priorityBadge}>P{draft.priority}</span>
                    </div>

                    <button
                        type="button"
                        className={styles.verifyButton}
                        onClick={() => void addDirective()}
                        disabled={loading || !draft.name.trim() || !draft.content.trim()}
                    >
                        <PlusIcon />
                        <span>{t('settings.addNewDirective')}</span>
                    </button>
                </div>

                <div className={styles.directiveFields}>
                    <div className={styles.field}>
                        <div className={styles.label}>{t('settings.directiveName', { defaultValue: 'Name' })}</div>
                        <input
                            className={styles.inputField}
                            value={draft.name}
                            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                            disabled={loading}
                            placeholder={t('settings.directiveNamePlaceholder', { defaultValue: 'Directive name' })}
                        />
                    </div>
                    <div className={styles.field}>
                        <div className={styles.label}>{t('settings.directiveContent', { defaultValue: 'Instruction' })}</div>
                        <textarea
                            className={`${styles.inputField} ${styles.textareaField}`}
                            value={draft.content}
                            onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
                            disabled={loading}
                            rows={4}
                            placeholder={t('settings.directiveContentPlaceholder', { defaultValue: 'Directive content' })}
                        />
                    </div>
                    <div className={styles.field}>
                        <div className={styles.label}>{t('settings.directiveTrigger', { defaultValue: 'Trigger Regex' })}</div>
                        <input
                            className={styles.inputField}
                            value={draft.trigger}
                            onChange={(event) => setDraft((prev) => ({ ...prev, trigger: event.target.value }))}
                            disabled={loading}
                            placeholder={t('settings.directiveTriggerPlaceholder', { defaultValue: 'Optional' })}
                        />
                    </div>
                </div>
            </div>

            {error && (
                <p style={{ color: 'var(--status-error)', marginTop: 12 }}>{error}</p>
            )}
        </div>
    );
};
