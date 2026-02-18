/**
 * ProfileEditor Component
 *
 * Form for adding/editing LLM provider profiles
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    LlmProfile,
    AnthropicProviderSettings,
    OpenRouterProviderSettings,
    OpenAIProviderSettings,
    OllamaProviderSettings,
    CustomProviderSettings,
    ValidationMessage,
} from '../../../types';
import styles from '../SettingsView.module.css';

// Fixed base URLs (read-only for known providers)
const FIXED_BASE_URLS: Record<string, string> = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    ollama: 'http://localhost:11434/v1/chat/completions',
};

interface ProfileEditorProps {
    onSave: (profile: LlmProfile) => Promise<void>;
    isValidating: boolean;
    validationMsg: ValidationMessage | null;
}

const ProfileEditorComponent: React.FC<ProfileEditorProps> = ({ onSave, isValidating, validationMsg }) => {
    const { t } = useTranslation();
    const [editProvider, setEditProvider] = useState<string>('anthropic');
    const [editName, setEditName] = useState<string>('');
    const [editAnthropic, setEditAnthropic] = useState<AnthropicProviderSettings>({});
    const [editOpenRouter, setEditOpenRouter] = useState<OpenRouterProviderSettings>({});
    const [editOpenAI, setEditOpenAI] = useState<OpenAIProviderSettings>({});
    const [editOllama, setEditOllama] = useState<OllamaProviderSettings>({});
    const [editCustom, setEditCustom] = useState<CustomProviderSettings>({ apiFormat: 'openai' });
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [detectingModels, setDetectingModels] = useState(false);

    const isCustomProvider = editProvider === 'custom';
    const isOllamaProvider = editProvider === 'ollama';

    const handleDetectOllamaModels = async () => {
        setDetectingModels(true);
        try {
            const baseUrl = editOllama.baseUrl || 'http://localhost:11434';
            const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
            if (res.ok) {
                const data = await res.json();
                const models = data.models?.map((m: any) => m.name) ?? [];
                setOllamaModels(models);
                if (models.length > 0 && !editOllama.model) {
                    setEditOllama(prev => ({ ...prev, model: models[0] }));
                }
            } else {
                setOllamaModels([]);
            }
        } catch {
            setOllamaModels([]);
        }
        setDetectingModels(false);
    };

    const handleSave = async () => {
        const profileId = editName.toLowerCase().replace(/\s+/g, '-') || `profile-${Date.now()}`;
        const newProfile: LlmProfile = {
            id: profileId,
            name: editName || `${editProvider.toUpperCase()} Profile`,
            provider: editProvider as any,
            anthropic: editProvider === 'anthropic' ? editAnthropic : undefined,
            openrouter: editProvider === 'openrouter' ? editOpenRouter : undefined,
            openai: editProvider === 'openai' ? editOpenAI : undefined,
            ollama: editProvider === 'ollama' ? editOllama : undefined,
            custom: editProvider === 'custom' ? editCustom : undefined,
            verified: true,
        };

        await onSave(newProfile);
    };

    return (
        <div className={styles.section}>
            <h3 style={{ marginTop: 0, fontSize: '16px', marginBottom: '20px' }}>{t('settings.addEditProfile')}</h3>
            <div className={styles.profileEditor}>
                <Field label={t('settings.profileName')}>
                    <input
                        className={styles.inputField}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder={t('settings.profileNamePlaceholder')}
                    />
                </Field>

                <Field label={t('settings.provider')}>
                    <select
                        className={styles.inputField}
                        value={editProvider}
                        onChange={(e) => setEditProvider(e.target.value)}
                    >
                        <option value="anthropic">{t('settings.anthropicClaude')}</option>
                        <option value="openrouter">{t('settings.openRouter')}</option>
                        <option value="openai">{t('settings.openAI')}</option>
                        <option value="ollama">{t('settings.ollama')}</option>
                        <option value="custom">{t('settings.custom')}</option>
                    </select>
                </Field>

                {editProvider === 'custom' && (
                    <Field label={t('settings.apiFormat')}>
                        <select
                            className={styles.inputField}
                            value={editCustom.apiFormat ?? 'openai'}
                            onChange={(e) => setEditCustom(prev => ({ ...prev, apiFormat: e.target.value as any }))}
                        >
                            <option value="anthropic">{t('settings.anthropicMessages')}</option>
                            <option value="openai">{t('settings.openaiCompatible')}</option>
                        </select>
                    </Field>
                )}

                <Field label={t('settings.baseUrl')}>
                    {isCustomProvider ? (
                        <input
                            className={styles.inputField}
                            type="text"
                            value={editCustom.baseUrl ?? ''}
                            onChange={(e) => setEditCustom(prev => ({ ...prev, baseUrl: e.target.value }))}
                            placeholder={t('settings.baseUrlPlaceholder')}
                        />
                    ) : isOllamaProvider ? (
                        <input
                            className={styles.inputField}
                            type="text"
                            value={editOllama.baseUrl ?? 'http://localhost:11434'}
                            onChange={(e) => setEditOllama(prev => ({ ...prev, baseUrl: e.target.value }))}
                            placeholder="http://localhost:11434"
                        />
                    ) : editProvider === 'openai' ? (
                        <input
                            className={styles.inputField}
                            type="text"
                            value={editOpenAI.baseUrl ?? FIXED_BASE_URLS.openai}
                            onChange={(e) => setEditOpenAI(prev => ({ ...prev, baseUrl: e.target.value }))}
                            placeholder={FIXED_BASE_URLS.openai}
                        />
                    ) : (
                        <input
                            className={styles.inputField}
                            type="text"
                            value={FIXED_BASE_URLS[editProvider] ?? ''}
                            disabled
                        />
                    )}
                </Field>

                {!isOllamaProvider && (
                    <Field label={t('settings.apiKey')}>
                        <input
                            className={styles.inputField}
                            type="password"
                            value={
                                editProvider === 'anthropic' ? editAnthropic.apiKey :
                                    editProvider === 'openrouter' ? editOpenRouter.apiKey :
                                        editProvider === 'openai' ? editOpenAI.apiKey :
                                            editCustom.apiKey
                            }
                            onChange={(e) => {
                                const val = e.target.value;
                                if (editProvider === 'anthropic') setEditAnthropic(p => ({ ...p, apiKey: val }));
                                else if (editProvider === 'openrouter') setEditOpenRouter(p => ({ ...p, apiKey: val }));
                                else if (editProvider === 'openai') setEditOpenAI(p => ({ ...p, apiKey: val }));
                                else setEditCustom(p => ({ ...p, apiKey: val }));
                            }}
                            placeholder={t('settings.apiKeyPlaceholder')}
                        />
                    </Field>
                )}

                <Field label={t('settings.modelId')}>
                    {isOllamaProvider && ollamaModels.length > 0 ? (
                        <select
                            className={styles.inputField}
                            value={editOllama.model ?? ''}
                            onChange={(e) => setEditOllama(p => ({ ...p, model: e.target.value }))}
                        >
                            {ollamaModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            className={styles.inputField}
                            type="text"
                            value={
                                editProvider === 'anthropic' ? (editAnthropic.model ?? '') :
                                    editProvider === 'openrouter' ? (editOpenRouter.model ?? '') :
                                        editProvider === 'openai' ? (editOpenAI.model ?? '') :
                                            editProvider === 'ollama' ? (editOllama.model ?? '') :
                                                (editCustom.model ?? '')
                            }
                            onChange={(e) => {
                                const val = e.target.value;
                                if (editProvider === 'anthropic') setEditAnthropic(p => ({ ...p, model: val }));
                                else if (editProvider === 'openrouter') setEditOpenRouter(p => ({ ...p, model: val }));
                                else if (editProvider === 'openai') setEditOpenAI(p => ({ ...p, model: val }));
                                else if (editProvider === 'ollama') setEditOllama(p => ({ ...p, model: val }));
                                else setEditCustom(p => ({ ...p, model: val }));
                            }}
                            placeholder={
                                editProvider === 'openrouter' ? t('settings.modelPlaceholderOpenRouter') :
                                    editProvider === 'openai' ? t('settings.modelPlaceholderOpenAI') :
                                        editProvider === 'ollama' ? t('settings.modelPlaceholderOllama') :
                                            t('settings.modelPlaceholderAnthropic')
                            }
                        />
                    )}
                    {isOllamaProvider && (
                        <button
                            className={styles.verifyButton}
                            onClick={handleDetectOllamaModels}
                            disabled={detectingModels}
                            style={{ marginTop: '8px', fontSize: '13px' }}
                        >
                            {detectingModels ? t('settings.detectingModels') : t('settings.detectModels')}
                        </button>
                    )}
                    {isOllamaProvider && ollamaModels.length > 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {t('settings.modelsDetected', { count: ollamaModels.length })}
                        </div>
                    )}
                    {isOllamaProvider && ollamaModels.length === 0 && detectingModels === false && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {t('settings.ollamaNotRunning')}
                        </div>
                    )}
                </Field>

                <button
                    className={styles.verifyButton}
                    onClick={handleSave}
                    disabled={isValidating || !editName}
                >
                    {isValidating ? t('setup.verifying') : t('settings.verifySaveProfile')}
                </button>

                {validationMsg && (
                    <div className={`${styles.validationMessage} ${validationMsg.type === 'success' ? styles.success : styles.error}`}>
                        {validationMsg.text}
                    </div>
                )}
            </div>
        </div>
    );
};

// Only re-render when validation state or message changes
// Note: onSave is assumed to be stable (wrapped in useCallback)
const arePropsEqual = (prevProps: ProfileEditorProps, nextProps: ProfileEditorProps): boolean => {
    return (
        prevProps.isValidating === nextProps.isValidating &&
        prevProps.validationMsg?.type === nextProps.validationMsg?.type &&
        prevProps.validationMsg?.text === nextProps.validationMsg?.text
    );
};

export const ProfileEditor = React.memo(ProfileEditorComponent, arePropsEqual);

ProfileEditor.displayName = 'ProfileEditor';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className={styles.field}>
            <div className={styles.label}>{label}</div>
            {children}
        </div>
    );
}
