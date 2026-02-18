/**
 * CompleteStep — Final step of the Setup Wizard
 *
 * Shows a summary and lets the user start using CoworkAny.
 */

import { useTranslation } from 'react-i18next';
import styles from '../SetupWizard.module.css';

interface CompleteStepProps {
    provider: string | null;
    apiKeyConfigured: boolean;
}

export function CompleteStep({ provider, apiKeyConfigured }: CompleteStepProps) {
    const { t } = useTranslation();

    return (
        <div>
            <div className={styles.completeIcon}>{'\u2713'}</div>
            <h2 className={styles.completeTitle}>{t('setup.youreAllSet')}</h2>
            <p className={styles.completeText}>
                {t('setup.completeText')}
            </p>

            <div className={styles.summaryList}>
                <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>{t('setup.aiProvider')}</span>
                    <span className={styles.summaryValue}>
                        {apiKeyConfigured
                            ? provider === 'openrouter'
                                ? 'OpenRouter'
                                : 'Anthropic (Claude)'
                            : t('setup.notConfigured')}
                    </span>
                </div>
                <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>{t('setup.apiKey')}</span>
                    <span className={styles.summaryValue}>
                        {apiKeyConfigured ? t('setup.configuredVerified') : t('setup.configureLater')}
                    </span>
                </div>
                <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>{t('setup.theme')}</span>
                    <span className={styles.summaryValue}>
                        {t('setup.systemDefault')}
                    </span>
                </div>
            </div>
        </div>
    );
}
