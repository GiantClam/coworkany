/**
 * SetupWizard — 3-step onboarding for new users
 *
 * Flow: Welcome -> API Key Config -> Complete
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
import styles from './SetupWizard.module.css';

interface SetupWizardProps {
    onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
    const { t } = useTranslation();
    const [step, setStep] = useState(0); // 0=Welcome, 1=ApiKey, 2=Complete
    const [configuredProvider, setConfiguredProvider] = useState<string | null>(null);
    const [apiKeyConfigured, setApiKeyConfigured] = useState(false);

    const totalSteps = 3;

    const handleApiKeyConfigured = useCallback(async (provider: string, apiKey: string) => {
        setConfiguredProvider(provider);
        setApiKeyConfigured(true);

        // Save the profile to backend
        try {
            const profileId = crypto.randomUUID();
            const profile: Record<string, unknown> = {
                id: profileId,
                name: `${provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'} (Setup)`,
                provider,
            };

            if (provider === 'anthropic') {
                profile.anthropic = { apiKey };
            } else {
                profile.openrouter = { apiKey };
            }

            const config = {
                provider,
                profiles: [profile],
                activeProfileId: profileId,
            };

            await invoke('save_llm_settings', { input: config });

            // Dual-write to store
            try {
                await saveConfig('llmConfig', config);
            } catch { /* best effort */ }

            toast.success(t('setup.apiKeySaved'), t('setup.apiKeySavedDesc'));
        } catch (err) {
            console.error('[SetupWizard] Failed to save profile:', err);
            toast.error(t('setup.saveFailed'), t('setup.saveFailedDesc'));
        }
    }, []);

    const handleFinish = useCallback(async () => {
        try {
            await markSetupCompleted();
        } catch (e) {
            console.warn('[SetupWizard] Failed to mark setup completed:', e);
        }
        onComplete();
    }, [onComplete]);

    const canGoNext = () => {
        if (step === 1) return true; // Can always go next (skip or configured)
        return true;
    };

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
        <div className={styles.backdrop}>
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
                    {step === 1 && <ApiKeyStep onConfigured={handleApiKeyConfigured} />}
                    {step === 2 && (
                        <CompleteStep
                            provider={configuredProvider}
                            apiKeyConfigured={apiKeyConfigured}
                        />
                    )}
                </div>

                {/* Footer navigation */}
                <div className={styles.footer}>
                    {step === 1 && !apiKeyConfigured && (
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
