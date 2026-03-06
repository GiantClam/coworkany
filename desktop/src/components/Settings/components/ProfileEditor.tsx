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

const FIXED_BASE_URLS: Record<string, string> = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    aiberm: 'https://aiberm.com/v1/chat/completions',
    nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
    siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    minimax: 'https://api.minimax.chat/v1/chat/completions',
    kimi: 'https://api.moonshot.cn/v1/chat/completions',
    ollama: 'http://localhost:11434/v1/chat/completions',
};

const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-5',
    openrouter: 'anthropic/claude-sonnet-4.5',
    openai: 'gpt-4o',
    aiberm: 'claude-sonnet-4-5-20250929-thinking',
    nvidia: 'meta/llama-3.1-70b-instruct',
    siliconflow: 'Qwen/Qwen2.5-7B-Instruct',
    gemini: 'gemini-2.0-flash',
    qwen: 'qwen-plus',
    minimax: 'MiniMax-Text-01',
    kimi: 'moonshot-v1-8k',
    ollama: 'llama3',
};

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

const PROVIDER_OPTIONS = [
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'aiberm', label: 'Aiberm' },
    { value: 'nvidia', label: 'NVIDIA NIM' },
    { value: 'siliconflow', label: 'SiliconFlow' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'qwen', label: 'Qwen' },
    { value: 'minimax', label: 'MiniMax' },
    { value: 'kimi', label: 'Kimi' },
    { value: 'ollama', label: 'Ollama (Local)' },
    { value: 'custom', label: 'Custom' },
] as const;

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
    const isOpenAICompatiblePreset = OPENAI_COMPATIBLE_PRESET_PROVIDERS.has(editProvider);

    const handleProviderChange = (nextProvider: string) => {
        setEditProvider(nextProvider);
        if (OPENAI_COMPATIBLE_PRESET_PROVIDERS.has(nextProvider)) {
            setEditOpenAI((prev) => ({
                ...prev,
                baseUrl: FIXED_BASE_URLS[nextProvider],
            }));
        }
    };

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
            provider: editProvider as LlmProfile['provider'],
            anthropic: editProvider === 'anthropic' ? editAnthropic : undefined,
            openrouter: editProvider === 'openrouter' ? editOpenRouter : undefined,
            openai: isOpenAICompatiblePreset
                ? {
                    ...editOpenAI,
                    baseUrl: editOpenAI.baseUrl || FIXED_BASE_URLS[editProvider],
                }
                : undefined,
            ollama: editProvider === 'ollama' ? editOllama : undefined,
            custom: editProvider === 'custom' ? editCustom : undefined,
            verified: true,
        };

        await onSave(newProfile);
    };

    const setModelValue = (value: string) => {
        if (editProvider === 'anthropic') setEditAnthropic((prev) => ({ ...prev, model: value }));
        else if (editProvider === 'openrouter') setEditOpenRouter((prev) => ({ ...prev, model: value }));
        else if (isOpenAICompatiblePreset) setEditOpenAI((prev) => ({ ...prev, model: value }));
        else if (editProvider === 'ollama') setEditOllama((prev) => ({ ...prev, model: value }));
        else setEditCustom((prev) => ({ ...prev, model: value }));
    };

    const apiKeyValue = editProvider === 'anthropic'
        ? editAnthropic.apiKey
        : editProvider === 'openrouter'
            ? editOpenRouter.apiKey
            : isOpenAICompatiblePreset
                ? editOpenAI.apiKey
                : editCustom.apiKey;

    const modelValue = editProvider === 'anthropic'
        ? (editAnthropic.model ?? '')
        : editProvider === 'openrouter'
            ? (editOpenRouter.model ?? '')
            : isOpenAICompatiblePreset
                ? (editOpenAI.model ?? '')
                : editProvider === 'ollama'
                    ? (editOllama.model ?? '')
                    : (editCustom.model ?? '');

    const modelPlaceholder = editProvider === 'openrouter'
        ? t('settings.modelPlaceholderOpenRouter')
        : isOpenAICompatiblePreset
            ? (DEFAULT_MODELS[editProvider] ?? t('settings.modelPlaceholderOpenAI'))
            : editProvider === 'ollama'
                ? t('settings.modelPlaceholderOllama')
                : t('settings.modelPlaceholderAnthropic');

    return (
        <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('settings.addEditProfile')}</h3>
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
                        onChange={(e) => handleProviderChange(e.target.value)}
                    >
                        {PROVIDER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.value === 'anthropic'
                                    ? t('settings.anthropicClaude')
                                    : option.value === 'openrouter'
                                        ? t('settings.openRouter')
                                        : option.value === 'openai'
                                            ? t('settings.openAI')
                                            : option.value === 'ollama'
                                                ? t('settings.ollama')
                                                : option.value === 'custom'
                                                    ? t('settings.custom')
                                                    : option.label}
                            </option>
                        ))}
                    </select>
                </Field>

                {editProvider === 'custom' && (
                    <Field label={t('settings.apiFormat')}>
                        <select
                            className={styles.inputField}
                            value={editCustom.apiFormat ?? 'openai'}
                            onChange={(e) => setEditCustom((prev) => ({ ...prev, apiFormat: e.target.value as any }))}
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
                    ) : isOpenAICompatiblePreset ? (
                        <input
                            className={styles.inputField}
                            type="text"
                            value={editOpenAI.baseUrl ?? FIXED_BASE_URLS[editProvider]}
                            onChange={(e) => setEditOpenAI(prev => ({ ...prev, baseUrl: e.target.value }))}
                            placeholder={FIXED_BASE_URLS[editProvider]}
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
                            value={apiKeyValue ?? ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (editProvider === 'anthropic') setEditAnthropic(p => ({ ...p, apiKey: val }));
                                else if (editProvider === 'openrouter') setEditOpenRouter(p => ({ ...p, apiKey: val }));
                                else if (isOpenAICompatiblePreset) setEditOpenAI(p => ({ ...p, apiKey: val }));
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
                            onChange={(e) => setEditOllama((prev) => ({ ...prev, model: e.target.value }))}
                        >
                            {ollamaModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            className={styles.inputField}
                            type="text"
                            value={modelValue}
                            onChange={(e) => setModelValue(e.target.value)}
                            placeholder={modelPlaceholder}
                        />
                    )}
                    {isOllamaProvider && (
                        <button
                            type="button"
                            className={`${styles.verifyButton} ${styles.subFieldAction}`}
                            onClick={handleDetectOllamaModels}
                            disabled={detectingModels}
                        >
                            {detectingModels ? t('settings.detectingModels') : t('settings.detectModels')}
                        </button>
                    )}
                    {isOllamaProvider && ollamaModels.length > 0 && (
                        <div className={styles.fieldMeta}>
                            {t('settings.modelsDetected', { count: ollamaModels.length })}
                        </div>
                    )}
                    {isOllamaProvider && ollamaModels.length === 0 && detectingModels === false && (
                        <div className={styles.fieldMeta}>
                            {t('settings.ollamaNotRunning')}
                        </div>
                    )}
                </Field>

                <button
                    type="button"
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
