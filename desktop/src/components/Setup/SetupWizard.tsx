/**
 * SetupWizard — onboarding for new users
 *
 * Flow: Welcome -> API Key Config -> Runtime Setup -> Complete
 *
 * On completion, marks setup as done in configStore so it doesn't appear again.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { markSetupCompleted, saveConfig } from '../../lib/configStore';
import { toast } from '../Common/ToastProvider';
import { WelcomeStep } from './steps/WelcomeStep';
import { ApiKeyStep } from './steps/ApiKeyStep';
import { CompleteStep } from './steps/CompleteStep';
import { RuntimeSetupStep } from './steps/RuntimeSetupStep';
import { buildSetupProfileConfig, getSetupProviderLabel, type SetupProvider } from './providerCatalog';
import styles from './SetupWizard.module.css';

interface SetupWizardProps {
    onComplete: () => void;
    topOffset?: number;
}

export function SetupWizard({ onComplete, topOffset = 0 }: SetupWizardProps) {
    const { t } = useTranslation();
    const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890';
    const [step, setStep] = useState(0); // 0=Welcome, 1=ApiKey, 2=Runtime, 3=Complete
    const [configuredProvider, setConfiguredProvider] = useState<string | null>(null);
    const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
    const [runtimeStatus, setRuntimeStatus] = useState({
        skillhubReady: false,
        ragReady: false,
        browserReady: false,
    });

    const totalSteps = 4;

    const createSetupProfileId = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `setup-profile-${Date.now()}`;
    };

    const handleApiKeyConfigured = useCallback(async (
        provider: string,
        apiKey: string,
        proxy: { enabled: boolean; url?: string; bypass?: string },
    ) => {
        try {
            const profileId = createSetupProfileId();
            const setupProvider = provider as SetupProvider;
            const config = buildSetupProfileConfig(setupProvider, apiKey, profileId) as Record<string, unknown>;
            config.proxy = proxy.enabled
                ? {
                    enabled: true,
                    url: (proxy.url?.trim() || DEFAULT_PROXY_URL),
                    bypass: proxy.bypass?.trim() || undefined,
                }
                : {
                    enabled: false,
                };

            console.info('[SetupWizard] Saving onboarding LLM profile', { provider });
            await invoke('save_llm_settings', { input: config });
            console.info('[SetupWizard] save_llm_settings completed', { provider });

            // Dual-write to store
            void saveConfig('llmConfig', config).catch(() => {
                // best effort mirror for future migration paths
            });

            setConfiguredProvider(provider);
            setApiKeyConfigured(true);
            toast.success(t('setup.apiKeySaved'), t('setup.apiKeySavedDesc'));
        } catch (err) {
            console.error('[SetupWizard] Failed to save profile:', err);
            toast.error(t('setup.saveFailed'), t('setup.saveFailedDesc'));
            return;
        }

        void (async () => {
            try {
                console.info('[SetupWizard] Preparing RAG embedding model in background');
                const warmResult = await invoke<{ success: boolean; payload?: { message?: string; error?: string } }>(
                    'prepare_rag_embedding_model'
                );
                if (warmResult.success) {
                    toast.success(
                        t('setup.ragReadyTitle', 'RAG model ready'),
                        t('setup.ragReadyDesc', 'Embedding model cached locally. Future startups will not redownload it.')
                    );
                } else {
                    toast.error(
                        t('setup.ragPrepareFailedTitle', 'RAG model download failed'),
                        warmResult.payload?.error
                            ?? t('setup.ragPrepareFailedDesc', 'Please check proxy/network in Settings and retry.')
                    );
                }
            } catch (err) {
                console.error('[SetupWizard] Failed to predownload RAG embedding model:', err);
                toast.error(
                    t('setup.ragPrepareFailedTitle', 'RAG model download failed'),
                    t('setup.ragPrepareFailedDesc', 'Please check proxy/network in Settings and retry.')
                );
            }
        })();
    }, [t]);

    const handleFinish = useCallback(async () => {
        try {
            await markSetupCompleted();
        } catch (e) {
            console.warn('[SetupWizard] Failed to mark setup completed:', e);
        }
        onComplete();
    }, [onComplete]);

    const canGoNext = () => true;

    const handleNext = () => {
        if (step < totalSteps - 1) {
            setStep(step + 1);
        }
    };

    const handleBack = () => {
        if (step > 0) {
            setStep(step - 1);
        }
    };

    return (
        <div
            className={styles.backdrop}
            style={{
                ...(topOffset > 0 ? { top: `${topOffset}px` } : {}),
                '--setup-top-offset': `${topOffset}px`,
            } as React.CSSProperties}
        >
            <div className={styles.container}>
                {/* Step indicators */}
                <div className={styles.steps}>
                    {Array.from({ length: totalSteps }, (_, i) => (
                        <div
                            key={i}
                            className={`${styles.stepDot} ${
                                i === step ? styles.stepDotActive : ''
                            } ${i < step ? styles.stepDotCompleted : ''}`}
                        />
                    ))}
                </div>

                {/* Content */}
                <div className={styles.content}>
                    {step === 0 && <WelcomeStep />}
                    {step === 1 && (
                        <ApiKeyStep
                            onConfigured={handleApiKeyConfigured}
                            onValidated={() => setStep(2)}
                        />
                    )}
                    {step === 2 && (
                        <RuntimeSetupStep
                            apiKeyConfigured={apiKeyConfigured}
                            onStatusChange={setRuntimeStatus}
                        />
                    )}
                    {step === 3 && (
                        <CompleteStep
                            provider={getSetupProviderLabel(configuredProvider)}
                            apiKeyConfigured={apiKeyConfigured}
                            runtimeStatus={runtimeStatus}
                        />
                    )}
                </div>

                {/* Footer navigation */}
                <div className={styles.footer}>
                    {((step === 1 && !apiKeyConfigured)
                        || (step === 2 && (!runtimeStatus.skillhubReady || !runtimeStatus.ragReady))) && (
                        <button className={styles.btnSkip} onClick={handleNext}>
                            {t('setup.skipForNow')}
                        </button>
                    )}

                    <div className={styles.footerRight}>
                        {step > 0 && step < totalSteps - 1 && (
                            <button className={styles.btnSecondary} onClick={handleBack}>
                                Back
                            </button>
                        )}

                        {step < totalSteps - 1 && (
                            <button
                                className={styles.btnPrimary}
                                onClick={handleNext}
                                disabled={!canGoNext()}
                            >
                                {step === 0 ? t('setup.getStarted') : t('setup.next')}
                            </button>
                        )}

                        {step === totalSteps - 1 && (
                            <button className={styles.btnPrimary} onClick={handleFinish}>
                                {t('setup.startUsing')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
