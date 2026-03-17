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
    runtimeStatus: {
        skillhubReady: boolean;
        ragReady: boolean;
        browserReady: boolean;
    };
}

export function CompleteStep({ provider, apiKeyConfigured, runtimeStatus }: CompleteStepProps) {
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
                            ? provider
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
                <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>
                        {t('setup.marketplaceReady', 'Marketplace')}
                    </span>
                    <span className={styles.summaryValue}>
                        {runtimeStatus.skillhubReady
                            ? t('setup.configuredVerified')
                            : t('setup.configureLater')}
                    </span>
                </div>
                <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>
                        {t('setup.memoryReady', 'Local memory')}
                    </span>
                    <span className={styles.summaryValue}>
                        {runtimeStatus.ragReady
                            ? t('setup.configuredVerified')
                            : t('setup.configureLater')}
                    </span>
                </div>
                <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>
                        {t('setup.browserModeReady', 'Browser smart mode')}
                    </span>
                    <span className={styles.summaryValue}>
                        {runtimeStatus.browserReady
                            ? t('setup.configuredVerified')
                            : t('setup.configureLater')}
                    </span>
                </div>
            </div>
        </div>
    );
}
