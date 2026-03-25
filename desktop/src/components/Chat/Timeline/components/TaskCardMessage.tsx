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
        value?: string;
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

type SectionBucket = 'thinking' | 'execution' | 'result' | 'other';

type SectionView = {
    id: string;
    label: string;
    lines: string[];
    bucket: SectionBucket;
    shortLabel: string;
};

type ResultTab = {
    id: string;
    label: string;
    lines: string[];
};

type LaneKey = 'thinking' | 'execution';
type LaneStatus = 'completed' | 'active' | 'failed' | 'pending';

type LaneView = {
    key: LaneKey;
    title: string;
    sections: SectionView[];
    status: LaneStatus;
    summary: string;
};

function sectionBucketFromLabel(label: string): SectionBucket {
    const head = label.split('·')[0]?.trim().toLowerCase();
    if (head === 'plan' || head === 'research' || head === 'contract') {
        return 'thinking';
    }
    if (head === 'process' || head === 'action' || head === 'checkpoint' || head === 'task') {
        return 'execution';
    }
    if (head === 'result') {
        return 'result';
    }
    return 'other';
}

function sectionShortLabel(label: string): string {
    const parts = label.split('·').map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
        return label;
    }
    return parts.slice(1).join(' · ');
}

function slugifyLabel(input: string): string {
    const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'tab';
}

function laneStatusLabel(status: LaneStatus): string {
    switch (status) {
        case 'completed':
            return 'Completed';
        case 'active':
            return 'In progress';
        case 'failed':
            return 'Failed';
        case 'pending':
        default:
            return 'Waiting';
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
    const sectionViews = React.useMemo<SectionView[]>(
        () => item.sections.map((section) => ({
            id: `${item.id}-${slugifyLabel(section.label)}`,
            label: section.label,
            lines: section.lines,
            bucket: sectionBucketFromLabel(section.label),
            shortLabel: sectionShortLabel(section.label),
        })),
        [item.id, item.sections]
    );
    const thinkingSections = React.useMemo(
        () => sectionViews.filter((section) => section.bucket === 'thinking'),
        [sectionViews]
    );
    const executionSections = React.useMemo(
        () => sectionViews.filter((section) => section.bucket === 'execution' || section.bucket === 'other'),
        [sectionViews]
    );
    const laneViews = React.useMemo<LaneView[]>(() => {
        const summarizeLane = (sections: SectionView[]): string => {
            const updateCount = sections.reduce((total, section) => total + section.lines.length, 0);
            if (updateCount === 0) {
                return 'No updates yet';
            }
            const latestLine = sections.at(-1)?.lines.at(-1) ?? '';
            const compactLatest = latestLine.length > 92 ? `${latestLine.slice(0, 91)}…` : latestLine;
            return `${updateCount} updates · ${compactLatest || 'latest update recorded'}`;
        };

        const thinkingStatus: LaneStatus = thinkingSections.length === 0
            ? 'pending'
            : executionSections.length > 0 || item.status === 'finished' || item.status === 'failed'
                ? 'completed'
                : 'active';

        const executionStatus: LaneStatus = item.status === 'failed'
            ? 'failed'
            : item.status === 'finished'
                ? 'completed'
                : executionSections.length > 0 || item.status === 'running'
                    ? 'active'
                    : 'pending';

        return [
            {
                key: 'thinking',
                title: 'Thinking',
                sections: thinkingSections,
                status: thinkingStatus,
                summary: summarizeLane(thinkingSections),
            },
            {
                key: 'execution',
                title: 'Execution',
                sections: executionSections,
                status: executionStatus,
                summary: summarizeLane(executionSections),
            },
        ];
    }, [executionSections, item.status, thinkingSections]);
    const resultTabs = React.useMemo<ResultTab[]>(() => {
        const tabs: ResultTab[] = [];
        const existingKeys = new Set<string>();
        const addTab = (id: string, label: string, lines: Array<string | undefined>) => {
            const normalizedLines = lines.map((line) => (line || '').trim()).filter((line) => line.length > 0);
            if (normalizedLines.length === 0 || existingKeys.has(id)) {
                return;
            }
            tabs.push({ id, label, lines: normalizedLines });
            existingKeys.add(id);
        };

        for (const section of sectionViews.filter((entry) => entry.bucket === 'result')) {
            const id = slugifyLabel(section.shortLabel || section.label);
            addTab(id, section.shortLabel || section.label, section.lines);
        }

        addTab('summary', 'Summary', [item.result?.summary]);
        addTab('artifacts', 'Artifacts', item.result?.artifacts ?? []);
        addTab('files', 'Files Changed', item.result?.files ?? []);
        addTab('error', 'Error', [item.result?.error, item.result?.suggestion]);
        return tabs;
    }, [item.result?.artifacts, item.result?.error, item.result?.files, item.result?.summary, item.result?.suggestion, sectionViews]);
    const [activeResultTabId, setActiveResultTabId] = React.useState<string>('');
    const [collapsedLaneByKey, setCollapsedLaneByKey] = React.useState<Record<LaneKey, boolean>>({
        thinking: false,
        execution: false,
    });

    React.useEffect(() => {
        setInputValue('');
    }, [item.id, item.collaboration?.actionId]);
    React.useEffect(() => {
        setCollapsedLaneByKey({
            thinking: executionSections.length > 0,
            execution: false,
        });
    }, [item.id, executionSections.length]);
    React.useEffect(() => {
        const firstTab = resultTabs[0]?.id ?? '';
        if (!activeResultTabId || !resultTabs.some((tab) => tab.id === activeResultTabId)) {
            setActiveResultTabId(firstTab);
        }
    }, [activeResultTabId, resultTabs]);

    const collaboration = item.collaboration;
    const activeResultTab = React.useMemo(
        () => resultTabs.find((tab) => tab.id === activeResultTabId) ?? resultTabs[0],
        [activeResultTabId, resultTabs]
    );
    const isSimplifiedTaskCenterCard = layout === 'timeline' && item.id.startsWith('task-center-');

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

    const handleChoiceClick = React.useCallback((value: string) => {
        onTaskActionClick?.({
            taskId: item.taskId,
            cardId: item.id,
            actionId: collaboration?.actionId,
            value,
        });
    }, [collaboration?.actionId, item.id, item.taskId, onTaskActionClick]);

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

                {!isSimplifiedTaskCenterCard && (thinkingSections.length > 0 || executionSections.length > 0) ? (
                    <div className={styles.taskCardSections}>
                        {laneViews.map((lane, laneIndex) => {
                            if (lane.sections.length === 0 && lane.status === 'pending') {
                                return null;
                            }
                            const collapsed = collapsedLaneByKey[lane.key];
                            const laneClassName = lane.key === 'thinking'
                                ? styles.taskCardThinkingLane
                                : styles.taskCardExecutionLane;
                            return (
                                <section key={`${item.id}-${lane.key}`} className={`${styles.taskCardLane} ${laneClassName}`}>
                                    <div className={styles.taskTimelineNode}>
                                        <span
                                            className={`${styles.taskTimelineNodeDot} ${styles[`taskTimelineNodeDot${lane.status}`]}`}
                                            aria-hidden
                                        />
                                        {laneIndex < laneViews.length - 1 ? <span className={styles.taskTimelineNodeLine} aria-hidden /> : null}
                                    </div>
                                    <div className={styles.taskCardLaneBody}>
                                        <button
                                            type="button"
                                            className={styles.taskCardLaneHeaderButton}
                                            onClick={() => setCollapsedLaneByKey((prev) => ({ ...prev, [lane.key]: !prev[lane.key] }))}
                                        >
                                            <div className={styles.taskCardLaneHeader}>
                                                <span className={styles.taskCardLaneTitle}>{lane.title}</span>
                                                <span className={`${styles.taskCardLaneStatusChip} ${styles[`taskCardLaneStatus${lane.status}`]}`}>
                                                    {laneStatusLabel(lane.status)}
                                                </span>
                                            </div>
                                            <span className={styles.taskCardLaneSummary}>{lane.summary}</span>
                                            <span className={styles.taskCardLaneChevron}>{collapsed ? '▸' : '▾'}</span>
                                        </button>
                                        {!collapsed ? (
                                            <div className={styles.taskCardLaneSections}>
                                                {lane.sections.map((section) => (
                                                    <section key={section.id} className={styles.taskCardSection}>
                                                        <span className={styles.taskCardSectionLabel}>{section.shortLabel}</span>
                                                        <div className={styles.taskCardSectionLines}>
                                                            {section.lines.map((line) => (
                                                                <span key={`${section.id}-${line}`}>{line}</span>
                                                            ))}
                                                        </div>
                                                    </section>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                ) : null}

                {!isSimplifiedTaskCenterCard && resultTabs.length > 0 && activeResultTab ? (
                    <section className={styles.taskCardResultTabsSection}>
                        <div className={styles.taskCardTabs} role="tablist" aria-label="Task result tabs">
                            {resultTabs.map((tab) => {
                                const active = tab.id === activeResultTab.id;
                                return (
                                    <button
                                        key={`${item.id}-tab-${tab.id}`}
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        className={`${styles.taskCardTabButton} ${active ? styles.activeTaskCardTabButton : ''}`}
                                        onClick={() => setActiveResultTabId(tab.id)}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                        <div className={styles.taskCardTabPanel} role="tabpanel">
                            {activeResultTab.lines.map((line) => (
                                <span key={`${item.id}-${activeResultTab.id}-${line}`}>{line}</span>
                            ))}
                        </div>
                    </section>
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
                            {collaboration.choices && collaboration.choices.length > 0 ? (
                                <div className={styles.taskCardActions}>
                                    {collaboration.choices.map((choice) => (
                                        <button
                                            key={`${item.id}-${choice.value}`}
                                            type="button"
                                            className={styles.taskCardActionButton}
                                            onClick={() => handleChoiceClick(choice.value)}
                                        >
                                            {choice.label}
                                        </button>
                                    ))}
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
