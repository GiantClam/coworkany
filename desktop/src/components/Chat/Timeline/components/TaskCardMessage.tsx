import React from 'react';
import styles from '../Timeline.module.css';
import type { TaskCardItem } from '../../../../types';

interface TaskCardMessageProps {
    item: TaskCardItem;
    layout?: 'timeline' | 'board';
    action?: {
        label: string;
        onClick: () => void;
        disabled?: boolean;
    };
    onTaskCollaborationSubmit?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void;
    onTaskActionClick?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
    }) => void;
}

function taskStatusLabel(status: NonNullable<TaskCardItem['tasks']>[number]['status']): string {
    switch (status) {
        case 'in_progress':
            return 'In progress';
        case 'completed':
        case 'complete':
            return 'Completed';
        case 'failed':
            return 'Failed';
        case 'blocked':
            return 'Blocked';
        case 'skipped':
            return 'Skipped';
        default:
            return 'Pending';
    }
}

const TaskCardMessageComponent: React.FC<TaskCardMessageProps> = ({
    item,
    layout = 'timeline',
    action,
    onTaskCollaborationSubmit,
    onTaskActionClick,
}) => {
    const [inputValue, setInputValue] = React.useState('');

    React.useEffect(() => {
        setInputValue('');
    }, [item.id, item.collaboration?.actionId]);

    const collaboration = item.collaboration;

    const handleSubmit = React.useCallback(() => {
        const value = inputValue.trim();
        if (!value || !collaboration?.input) {
            return;
        }

        onTaskCollaborationSubmit?.({
            taskId: item.taskId,
            cardId: item.id,
            actionId: collaboration.actionId,
            value,
        });
        setInputValue('');
    }, [collaboration?.actionId, collaboration?.input, inputValue, item.id, item.taskId, onTaskCollaborationSubmit]);

    const handleActionClick = React.useCallback(() => {
        if (!collaboration?.action) {
            return;
        }
        onTaskActionClick?.({
            taskId: item.taskId,
            cardId: item.id,
            actionId: collaboration.actionId,
        });
    }, [collaboration?.action, collaboration?.actionId, item.id, item.taskId, onTaskActionClick]);

    return (
        <div className={`${styles.timelineItem} ${styles.assistant} ${layout === 'board' ? styles.taskCardBoardLayout : ''}`}>
            <div className={`${styles.contentBubble} ${styles.taskCardMessage}`}>
                <div className={styles.taskCardHeader}>
                    <span className={styles.taskCardKicker}>Task center</span>
                    <strong className={styles.taskCardTitle}>{item.title}</strong>
                    {item.subtitle ? <p className={styles.taskCardSubtitle}>{item.subtitle}</p> : null}
                    {item.status ? (
                        <span className={`${styles.taskStatusChip} ${styles[`taskStatus${item.status}`]}`}>
                            {item.status === 'running'
                                ? 'In progress'
                                : item.status === 'finished'
                                    ? 'Completed'
                                    : item.status === 'failed'
                                        ? 'Failed'
                                        : 'Waiting'}
                        </span>
                    ) : null}
                    {item.workflow ? (
                        <span className={styles.taskWorkflowLabel}>Workflow: {item.workflow}</span>
                    ) : null}
                </div>

                {item.tasks && item.tasks.length > 0 ? (
                    <section className={styles.taskCardSection}>
                        <span className={styles.taskCardSectionLabel}>Tasks</span>
                        <div className={styles.taskListInCard}>
                            {item.tasks.map((task) => (
                                <div key={`${item.id}-${task.id}`} className={styles.taskListRow}>
                                    <div className={styles.taskListTitleRow}>
                                        <span className={styles.taskListTitle}>{task.title}</span>
                                        <span className={`${styles.taskListStatus} ${styles[`taskListStatus${task.status}`]}`}>
                                            {taskStatusLabel(task.status)}
                                        </span>
                                    </div>
                                    {task.dependencies.length > 0 ? (
                                        <span className={styles.taskListDeps}>Depends on: {task.dependencies.join(', ')}</span>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}

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

                {collaboration ? (
                    <section className={styles.taskCardCollaboration}>
                        <span className={styles.taskCardSectionLabel}>Collaboration</span>
                        <div className={styles.taskCardCollaborationBody}>
                            <strong className={styles.taskCardCollaborationTitle}>{collaboration.title}</strong>
                            {collaboration.description ? (
                                <p className={styles.taskCardSubtitle}>{collaboration.description}</p>
                            ) : null}
                            {collaboration.questions.length > 0 ? (
                                <div className={styles.taskCardSectionLines}>
                                    {collaboration.questions.map((question) => (
                                        <span key={`${item.id}-q-${question}`}>{question}</span>
                                    ))}
                                </div>
                            ) : null}
                            {collaboration.instructions.length > 0 ? (
                                <div className={styles.taskCardSectionLines}>
                                    {collaboration.instructions.map((instruction) => (
                                        <span key={`${item.id}-i-${instruction}`}>{instruction}</span>
                                    ))}
                                </div>
                            ) : null}
                            {collaboration.input ? (
                                <div className={styles.taskCardInputRow}>
                                    <input
                                        type="text"
                                        value={inputValue}
                                        onChange={(event) => setInputValue(event.target.value)}
                                        placeholder={collaboration.input.placeholder || 'Type your response'}
                                        className={styles.taskCardInput}
                                    />
                                    <button
                                        type="button"
                                        className={styles.taskCardActionButton}
                                        onClick={handleSubmit}
                                        disabled={inputValue.trim().length === 0}
                                    >
                                        {collaboration.input.submitLabel || 'Submit'}
                                    </button>
                                </div>
                            ) : null}
                            {collaboration.action ? (
                                <div className={styles.taskCardActions}>
                                    <button
                                        type="button"
                                        className={styles.taskCardActionButton}
                                        onClick={handleActionClick}
                                    >
                                        {collaboration.action.label}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </section>
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
        && prevProps.layout === nextProps.layout
        && prevProps.item.status === nextProps.item.status
        && prevProps.item.workflow === nextProps.item.workflow
        && JSON.stringify(prevProps.item.tasks) === JSON.stringify(nextProps.item.tasks)
        && JSON.stringify(prevProps.item.sections) === JSON.stringify(nextProps.item.sections)
        && JSON.stringify(prevProps.item.collaboration) === JSON.stringify(nextProps.item.collaboration)
        && prevProps.action?.label === nextProps.action?.label
        && prevProps.action?.disabled === nextProps.action?.disabled
        && prevProps.action?.onClick === nextProps.action?.onClick
        && prevProps.onTaskCollaborationSubmit === nextProps.onTaskCollaborationSubmit
        && prevProps.onTaskActionClick === nextProps.onTaskActionClick;
};

export const TaskCardMessage = React.memo(TaskCardMessageComponent, arePropsEqual);

TaskCardMessage.displayName = 'TaskCardMessage';
