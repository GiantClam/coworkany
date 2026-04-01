/**
 * ApiKeyStep — Step 2 of Setup Wizard
 *
 * Lets users configure their LLM provider API key.
 * Supports built-in default providers, with validation.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import styles from '../SetupWizard.module.css';
import { mapValidationErrorToUserMessage } from '../../../lib/llmValidationErrors';
import {
    buildSetupValidationInput,
    getSetupProviderPreset,
    setupProviderOptions,
    type SetupProvider,
} from '../providerCatalog';

interface ApiKeyStepProps {
    onConfigured: (
        provider: string,
        apiKey: string,
        proxy: { enabled: boolean; url?: string; bypass?: string }
    ) => Promise<void>;
    onValidated?: () => void;
}

export function ApiKeyStep({ onConfigured, onValidated }: ApiKeyStepProps) {
    const { t } = useTranslation();
    const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890';
    const [provider, setProvider] = useState<SetupProvider>('anthropic');
    const [apiKey, setApiKey] = useState('');
    const [proxyEnabled, setProxyEnabled] = useState(false);
    const [proxyUrl, setProxyUrl] = useState(DEFAULT_PROXY_URL);
    const [proxyBypass, setProxyBypass] = useState('localhost,127.0.0.1,::1');
    const [isValidating, setIsValidating] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [validationResult, setValidationResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const preset = getSetupProviderPreset(provider);

    const handleValidate = async () => {
        if (!apiKey.trim() || isValidating || isApplying) return;
        setIsValidating(true);
        setValidationResult(null);
        let handedOff = false;

        try {
            const input = buildSetupValidationInput(provider, apiKey.trim(), {
                enabled: proxyEnabled,
                url: proxyEnabled ? (proxyUrl.trim() || DEFAULT_PROXY_URL) : undefined,
                bypass: proxyEnabled ? (proxyBypass.trim() || undefined) : undefined,
            });

            const result = await invoke<{ success: boolean; payload?: { error?: string } }>(
                'validate_llm_settings',
                { input }
            );

            if (result.success) {
                setValidationResult({ ok: true, msg: t('setup.apiKeyVerified') });
                handedOff = true;
                setIsValidating(false);
                setIsApplying(true);
                onValidated?.();
                void onConfigured(provider, apiKey.trim(), {
                    enabled: proxyEnabled,
                    url: proxyEnabled ? (proxyUrl.trim() || DEFAULT_PROXY_URL) : undefined,
                    bypass: proxyEnabled ? (proxyBypass.trim() || undefined) : undefined,
                }).catch((err) => {
                    setValidationResult({
                        ok: false,
                        msg: err instanceof Error ? err.message : t('setup.saveFailedDesc'),
                    });
                }).finally(() => {
                    setIsApplying(false);
                });
            } else {
                setValidationResult({
                    ok: false,
                    msg: mapValidationErrorToUserMessage({
                        provider,
                        rawError: result.payload?.error || t('setup.verificationFailed'),
                        t,
                    }),
                });
            }
        } catch (err) {
            setValidationResult({
                ok: false,
                msg: mapValidationErrorToUserMessage({
                    provider,
                    rawError: err instanceof Error ? err.message : t('setup.connectionError'),
                    t,
                }),
            });
        } finally {
            if (!handedOff) {
                setIsValidating(false);
            }
        }
    };

    return (
        <div>
            <h2 className={styles.welcomeTitle} style={{ fontSize: 'var(--font-size-lg)' }}>
                {t('setup.configureTitle')}
            </h2>
            <p className={styles.formHint} style={{ textAlign: 'center', marginBottom: 20 }}>
                {t('setup.configureHint')}
            </p>

            <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t('setup.provider')}</label>
                <select
                    className={styles.formSelect}
                    value={provider}
                    onChange={(e) => {
                        setProvider(e.target.value as SetupProvider);
                        setValidationResult(null);
                    }}
                >
                    {setupProviderOptions.map((option) => (
                        <option key={option.provider} value={option.provider}>
                            {option.provider === 'anthropic'
                                ? t('setup.anthropicOption')
                                : option.provider === 'openrouter'
                                    ? t('setup.openRouterOption')
                                    : option.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                    {provider === 'anthropic'
                        ? t('setup.anthropicApiKey')
                        : provider === 'openrouter'
                            ? t('setup.openRouterApiKey')
                            : preset.apiKeyLabel}
                </label>
                <p className={styles.formHint}>
                    {provider === 'anthropic'
                        ? t('setup.anthropicHint')
                        : provider === 'openrouter'
                            ? t('setup.openRouterHint')
                            : preset.hint}
                </p>
                <input
                    type="password"
                    className={styles.formInput}
                    value={apiKey}
                    onChange={(e) => {
                        setApiKey(e.target.value);
                        setValidationResult(null);
                    }}
                    placeholder={provider === 'anthropic'
                        ? t('setup.anthropicPlaceholder')
                        : provider === 'openrouter'
                            ? t('setup.openRouterPlaceholder')
                            : preset.placeholder}
                />
            </div>

            <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t('settings.proxySettings')}</label>
                <p className={styles.formHint}>{t('settings.proxyHint')}</p>
                <label className={styles.checkboxLabel}>
                    <input
                        type="checkbox"
                        checked={proxyEnabled}
                        onChange={(e) => setProxyEnabled(e.target.checked)}
                    />
                    <span>{t('settings.proxyEnabled')}</span>
                </label>
                {proxyEnabled && (
                    <div className={styles.proxyGroup}>
                        <input
                            type="text"
                            className={styles.formInput}
                            value={proxyUrl}
                            onChange={(e) => setProxyUrl(e.target.value)}
                            placeholder={t('settings.proxyUrlPlaceholder')}
                        />
                        <input
                            type="text"
                            className={styles.formInput}
                            value={proxyBypass}
                            onChange={(e) => setProxyBypass(e.target.value)}
                            placeholder={t('settings.proxyBypassPlaceholder')}
                        />
                    </div>
                )}
            </div>

            <button
                className={styles.btnPrimary}
                onClick={handleValidate}
                disabled={!apiKey.trim() || isValidating || isApplying}
                style={{ width: '100%' }}
            >
                {isValidating
                    ? t('setup.verifying')
                    : isApplying
                        ? t('setup.savingConfig', 'Saving configuration...')
                        : t('setup.verifyApiKey')}
            </button>

            {validationResult && (
                <div
                    className={`${styles.validationResult} ${
                        validationResult.ok ? styles.validationSuccess : styles.validationError
                    }`}
                >
                    {validationResult.ok ? '\u2713' : '\u2717'} {validationResult.msg}
                </div>
            )}
        </div>
    );
}
