/**
 * SystemBadge Component
 *
 * Displays system event badge
 */

import React from 'react';
import styles from '../Timeline.module.css';
import type { SystemEventAction } from '../../../../types';

interface SystemBadgeProps {
    content: string;
    actions?: SystemEventAction[];
    onAction?: (action: SystemEventAction) => void;
}

const SystemBadgeComponent: React.FC<SystemBadgeProps> = ({ content, actions, onAction }) => (
    <div className={`${styles.timelineItem} ${styles.system}`}>
        <div className={styles.systemPanel}>
            <span className={styles.systemBadge}>{content}</span>
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
