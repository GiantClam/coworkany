import React from 'react';
import styles from '../Timeline.module.css';
import type { TaskCardItem } from '../../../../types';

interface TaskCardMessageProps {
    item: TaskCardItem;
    action?: {
        label: string;
        onClick: () => void;
        disabled?: boolean;
    };
}

const TaskCardMessageComponent: React.FC<TaskCardMessageProps> = ({ item, action }) => {
    return (
        <div className={`${styles.timelineItem} ${styles.assistant}`}>
            <div className={`${styles.contentBubble} ${styles.taskCardMessage}`}>
                <div className={styles.taskCardHeader}>
                    <span className={styles.taskCardKicker}>Task update</span>
                    <strong className={styles.taskCardTitle}>{item.title}</strong>
                    {item.subtitle ? <p className={styles.taskCardSubtitle}>{item.subtitle}</p> : null}
                </div>
                {item.sections.length > 0 ? (
                    <div className={styles.taskCardSections}>
                        {item.sections.map((section) => (
                            <section key={`${item.id}-${section.label}`} className={styles.taskCardSection}>
                                <span className={styles.taskCardSectionLabel}>{section.label}</span>
                                <div className={styles.taskCardSectionLines}>
                                    {section.lines.map((line) => (
                                        <span key={`${item.id}-${section.label}-${line}`}>{line}</span>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : null}
                {action ? (
                    <div className={styles.taskCardActions}>
                        <button
                            type="button"
                            className={styles.taskCardActionButton}
                            onClick={action.onClick}
                            disabled={action.disabled}
                        >
                            {action.label}
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

const arePropsEqual = (prevProps: TaskCardMessageProps, nextProps: TaskCardMessageProps): boolean => {
    return prevProps.item.id === nextProps.item.id
        && prevProps.item.title === nextProps.item.title
        && prevProps.item.subtitle === nextProps.item.subtitle
        && JSON.stringify(prevProps.item.sections) === JSON.stringify(nextProps.item.sections)
        && prevProps.action?.label === nextProps.action?.label
        && prevProps.action?.disabled === nextProps.action?.disabled
        && prevProps.action?.onClick === nextProps.action?.onClick;
};

export const TaskCardMessage = React.memo(TaskCardMessageComponent, arePropsEqual);

TaskCardMessage.displayName = 'TaskCardMessage';
