/**
 * WelcomeStep — First step of the Setup Wizard
 *
 * Introduces CoworkAny and its core capabilities.
 */

import { useTranslation } from 'react-i18next';
import styles from '../SetupWizard.module.css';

export function WelcomeStep() {
    const { t } = useTranslation();

    return (
        <div>
            <h1 className={styles.welcomeTitle}>{t('setup.welcomeTitle')}</h1>
            <p className={styles.welcomeSubtitle}>
                {t('setup.welcomeSubtitle')}
            </p>
            <ul className={styles.featureList}>
                <li className={styles.featureItem}>
                    <span className={styles.featureIcon}>&#x1F916;</span>
                    <span>{t('setup.feature1')}</span>
                </li>
                <li className={styles.featureItem}>
                    <span className={styles.featureIcon}>&#x1F50D;</span>
                    <span>{t('setup.feature2')}</span>
                </li>
                <li className={styles.featureItem}>
                    <span className={styles.featureIcon}>&#x1F4A1;</span>
                    <span>{t('setup.feature3')}</span>
                </li>
                <li className={styles.featureItem}>
                    <span className={styles.featureIcon}>&#x1F512;</span>
                    <span>{t('setup.feature4')}</span>
                </li>
            </ul>
        </div>
    );
}
