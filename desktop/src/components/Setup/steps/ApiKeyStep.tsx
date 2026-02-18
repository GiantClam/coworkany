/**
 * ApiKeyStep — Step 2 of Setup Wizard
 *
 * Lets users configure their LLM provider API key.
 * Supports Anthropic and OpenRouter, with validation.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import styles from '../SetupWizard.module.css';

interface ApiKeyStepProps {
    onConfigured: (provider: string, apiKey: string) => void;
}

export function ApiKeyStep({ onConfigured }: ApiKeyStepProps) {
    const { t } = useTranslation();
    const [provider, setProvider] = useState<'anthropic' | 'openrouter'>('anthropic');
    const [apiKey, setApiKey] = useState('');
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState<{ ok: boolean; msg: string } | null>(null);

    const handleValidate = async () => {
        if (!apiKey.trim()) return;
        setIsValidating(true);
        setValidationResult(null);

        try {
            const input = provider === 'anthropic'
                ? { provider: 'anthropic', anthropic: { apiKey: apiKey.trim() } }
                : { provider: 'openrouter', openrouter: { apiKey: apiKey.trim() } };

            const result = await invoke<{ success: boolean; payload?: { error?: string } }>(
                'validate_llm_settings',
                { input }
            );

            if (result.success) {
                setValidationResult({ ok: true, msg: t('setup.apiKeyVerified') });
                onConfigured(provider, apiKey.trim());
            } else {
                setValidationResult({ ok: false, msg: result.payload?.error || t('setup.verificationFailed') });
            }
        } catch (err) {
            setValidationResult({
                ok: false,
                msg: err instanceof Error ? err.message : t('setup.connectionError'),
            });
        } finally {
            setIsValidating(false);
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
                        setProvider(e.target.value as 'anthropic' | 'openrouter');
                        setValidationResult(null);
                    }}
                >
                    <option value="anthropic">{t('setup.anthropicOption')}</option>
                    <option value="openrouter">{t('setup.openRouterOption')}</option>
                </select>
            </div>

            <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                    {provider === 'anthropic' ? t('setup.anthropicApiKey') : t('setup.openRouterApiKey')}
                </label>
                <p className={styles.formHint}>
                    {provider === 'anthropic'
                        ? t('setup.anthropicHint')
                        : t('setup.openRouterHint')}
                </p>
                <input
                    type="password"
                    className={styles.formInput}
                    value={apiKey}
                    onChange={(e) => {
                        setApiKey(e.target.value);
                        setValidationResult(null);
                    }}
                    placeholder={provider === 'anthropic' ? t('setup.anthropicPlaceholder') : t('setup.openRouterPlaceholder')}
                />
            </div>

            <button
                className={styles.btnPrimary}
                onClick={handleValidate}
                disabled={!apiKey.trim() || isValidating}
                style={{ width: '100%' }}
            >
                {isValidating ? t('setup.verifying') : t('setup.verifyApiKey')}
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
