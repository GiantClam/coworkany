/**
 * SystemBadge Component
 *
 * Displays system event badge
 */

import React from 'react';
import styles from '../Timeline.module.css';
import type { SkillConfigCardData, SystemEventAction } from '../../../../types';
import { SkillCredentialCard } from '../../../Skills/SkillCredentialCard';

interface SystemBadgeProps {
    content: string;
    actions?: SystemEventAction[];
    skillConfigCard?: SkillConfigCardData;
    onAction?: (action: SystemEventAction) => void;
}

const SystemBadgeComponent: React.FC<SystemBadgeProps> = ({ content, actions, skillConfigCard, onAction }) => (
    <div className={`${styles.timelineItem} ${styles.system}`}>
        <div className={styles.systemPanel}>
            <div className={styles.systemBadge}>
                <span className={styles.systemBadgeLabel}>System</span>
                <div className={styles.systemBadgeContent}>{content}</div>
            </div>
            {skillConfigCard && (
                <div className={styles.systemSkillConfigCard}>
                    <SkillCredentialCard
                        skillId={skillConfigCard.skillId}
                        skillName={skillConfigCard.skillName}
                        requiredEnv={skillConfigCard.requiredEnv}
                        source={skillConfigCard.source}
                        showLifecycleHint={true}
                    />
                </div>
            )}
            {actions && actions.length > 0 && onAction && (
                <div className={styles.systemActions}>
                    {actions.map((action) => (
                        <button
                            key={action.id}
                            type="button"
                            className={action.primary ? styles.systemActionPrimary : styles.systemActionSecondary}
                            onClick={() => onAction(action)}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    </div>
);

// Only re-render when content changes
export const SystemBadge = React.memo(SystemBadgeComponent);

SystemBadge.displayName = 'SystemBadge';
