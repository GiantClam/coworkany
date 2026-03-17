/**
 * SystemBadge Component
 *
 * Displays system event badge
 */

import React from 'react';
import styles from '../Timeline.module.css';

interface SystemBadgeProps {
    content: string;
    pending?: boolean;
}

const SystemBadgeComponent: React.FC<SystemBadgeProps> = ({ content, pending = false }) => (
    <div className={`${styles.timelineItem} ${styles.system}`}>
        <span
            className={`${styles.systemBadge} ${pending ? styles.systemBadgePending : ''}`}
            role={pending ? 'status' : undefined}
            aria-live={pending ? 'polite' : undefined}
        >
            {pending && <span className={styles.systemBadgePulse} aria-hidden="true" />}
            {content}
        </span>
    </div>
);

// Only re-render when content changes
export const SystemBadge = React.memo(SystemBadgeComponent);

SystemBadge.displayName = 'SystemBadge';
