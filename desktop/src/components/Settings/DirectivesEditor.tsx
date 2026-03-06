import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SettingsView.module.css';

interface Directive {
    id: string;
    name: string;
    content: string;
    enabled: boolean;
    priority: number;
}

const PlusIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

export const DirectivesEditor: React.FC = () => {
    const { t } = useTranslation();
    const [directives, setDirectives] = useState<Directive[]>([]);

    useEffect(() => {
        loadDirectives();
    }, []);

    const loadDirectives = async () => {
        setDirectives([
            { id: '1', name: 'No Any', content: 'Do not use "any"', enabled: true, priority: 1 },
            { id: '2', name: 'Concise', content: 'Be concise', enabled: false, priority: 0 },
        ]);
    };

    const toggleDirective = (id: string) => {
        setDirectives((prev) => prev.map((directive) =>
            directive.id === id ? { ...directive, enabled: !directive.enabled } : directive
        ));
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
                        <div className={styles.directiveInfo}>
                            <span className={styles.priorityBadge}>P{directive.priority}</span>
                            <div className={styles.directiveCopy}>
                                <span className={styles.directiveName}>{directive.name}</span>
                                <span className={styles.directiveContent}>{directive.content}</span>
                            </div>
                        </div>

                        <div className={styles.directiveActions}>
                            <button
                                type="button"
                                className={`${styles.toggleInline} ${directive.enabled ? styles.toggleInlineActive : ''}`}
                                aria-pressed={directive.enabled}
                                onClick={() => toggleDirective(directive.id)}
                            >
                                {directive.enabled ? t('common.on') : t('common.off')}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <button type="button" className={`${styles.verifyButton} ${styles.sectionCta}`}>
                <PlusIcon />
                <span>{t('settings.addNewDirective')}</span>
            </button>
        </div>
    );
};
