/**
 * SystemBadge Component
 *
 * Displays system event badge
 */

import React from 'react';
import styles from '../Timeline.module.css';

interface SystemBadgeProps {
    content: string;
}

const SystemBadgeComponent: React.FC<SystemBadgeProps> = ({ content }) => (
    <div className={`${styles.timelineItem} ${styles.system}`}>
        <span className={styles.systemBadge}>{content}</span>
    </div>
);

// Only re-render when content changes
export const SystemBadge = React.memo(SystemBadgeComponent);

SystemBadge.displayName = 'SystemBadge';
