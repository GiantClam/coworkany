/**
 * Timeline Component
 *
 * Main timeline interface for displaying chat history
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Timeline.module.css';
import type {
    EffectRequestItem,
    PatchItem,
    SystemEventItem,
    TaskSession,
    TaskCardItem,
} from '../../../types';
import { useTimelineItems } from './hooks/useTimelineItems';
import { MessageBubble } from './components/MessageBubble';
import { TaskCardMessage } from './components/TaskCardMessage';
import { ToolCard } from './components/ToolCard';
import { IS_STARTUP_BASELINE } from '../../../lib/startupProfile';
import { getPendingTaskStatus } from './pendingTaskStatus';

// ============================================================================
// Main Timeline Component
// ============================================================================

function formatSystemBubbleContent(item: SystemEventItem): string {
    return item.content;
}

function toEffectTaskCardItem(item: EffectRequestItem): TaskCardItem {
    const decision = item.approved === undefined ? 'Pending' : (item.approved ? 'Approved' : 'Denied');
    return {
        type: 'task_card',
        id: `${item.id}-effect-card`,
        title: `Effect request · ${item.effectType}`,
        subtitle: `Risk level: ${item.risk}`,
        sections: [
            {
                label: 'Decision',
                lines: [decision],
            },
        ],
        timestamp: item.timestamp,
    };
}

function toPatchTaskCardItem(item: PatchItem): TaskCardItem {
    const statusLabel = item.status === 'applied'
        ? 'Applied'
        : item.status === 'rejected'
            ? 'Rejected'
            : 'Proposed';
    return {
        type: 'task_card',
        id: `${item.id}-patch-card`,
        title: 'Patch update',
        subtitle: item.filePath || 'Unknown file',
        sections: [
            {
                label: 'Status',
                lines: [statusLabel],
            },
        ],
        timestamp: item.timestamp,
    };
}

function isTaskCardEmpty(item: TaskCardItem): boolean {
    return !item.subtitle && item.sections.every((section) => section.lines.length === 0);
}

interface TimelineProps {
    session: TaskSession;
    showResumeCard?: boolean;
    resumeCardTitle?: string;
    resumeCardSuggestion?: string;
    resumeCardActionLabel?: string;
    resumeCardActionDisabled?: boolean;
    onResumeCardAction?: () => void;
}

const TimelineComponent: React.FC<TimelineProps> = ({
    session,
    showResumeCard = false,
    resumeCardTitle,
    resumeCardSuggestion,
    resumeCardActionLabel,
    resumeCardActionDisabled = false,
    onResumeCardAction,
}) => {
    const { t } = useTranslation();
    const [showFullHistory, setShowFullHistory] = React.useState(false);
    const shouldCollapseHistory = !IS_STARTUP_BASELINE && !showFullHistory && session.events.length > 320;
    const { items, hiddenEventCount } = useTimelineItems(session, shouldCollapseHistory ? 320 : undefined);
    const pendingStatus = React.useMemo(() => getPendingTaskStatus(session), [session]);
    const pendingLabel = React.useMemo(() => {
        switch (pendingStatus?.phase) {
            case 'waiting_for_model':
                return t('chat.pendingWaitingForModel');
            case 'running_tool':
                return t('chat.pendingUsingTool', { tool: pendingStatus.toolName ?? t('chat.genericTool') });
            case 'retrying':
                return t('chat.pendingRetrying');
            default:
                return '';
        }
    }, [pendingStatus, t]);
    const endRef = React.useRef<HTMLDivElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [userScrolled, setUserScrolled] = React.useState(false);
    const scrollTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        setShowFullHistory(false);
    }, [session.taskId]);

    // Detect if user manually scrolled up
    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
            setUserScrolled(!isAtBottom);
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // Auto-scroll to bottom with debounce - only if user hasn't scrolled up
    React.useEffect(() => {
        if (userScrolled) return;

        // Clear previous timeout
        if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
        }

        // Debounce scroll - wait 100ms after last update
        scrollTimeoutRef.current = setTimeout(() => {
            endRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 100);

        return () => {
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, [items.length, userScrolled]);

    // Reset userScrolled when new message starts (items.length changes)
    React.useEffect(() => {
        setUserScrolled(false);
    }, [items.length]);

    return (
        <div className={styles.timeline} ref={containerRef}>
            {hiddenEventCount > 0 && (
                <button
                    type="button"
                    onClick={() => setShowFullHistory(true)}
                    style={{
                        alignSelf: 'center',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-panel)',
                        color: 'var(--text-secondary)',
                        borderRadius: '999px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        cursor: 'pointer',
                    }}
                >
                    Show earlier activity ({hiddenEventCount} hidden events)
                </button>
            )}
            {items.map((item) => {
                switch (item.type) {
                    case 'user_message':
                        return <MessageBubble key={item.id} item={item} isUser={true} />;
                    case 'assistant_message':
                        return <MessageBubble key={item.id} item={item} isUser={false} />;
                    case 'tool_call':
                        return <ToolCard key={item.id} item={item} />;
                    case 'system_event':
                        return (
                            <MessageBubble
                                key={item.id}
                                item={{
                                    id: item.id,
                                    content: formatSystemBubbleContent(item),
                                }}
                                isUser={false}
                                tone="system"
                            />
                        );
                    case 'effect_request':
                        return <TaskCardMessage key={item.id} item={toEffectTaskCardItem(item)} />;
                    case 'patch':
                        return <TaskCardMessage key={item.id} item={toPatchTaskCardItem(item)} />;
                    case 'task_card':
                        if (isTaskCardEmpty(item)) {
                            return null;
                        }
                        return <TaskCardMessage key={item.id} item={item} />;
                    default:
                        return null;
                }
            })}
            {showResumeCard && onResumeCardAction ? (
                <TaskCardMessage
                    key={`resume-${session.taskId}`}
                    item={{
                        type: 'task_card',
                        id: `resume-${session.taskId}`,
                        title: resumeCardTitle || 'Task interrupted',
                        subtitle: resumeCardSuggestion || 'Resume the task to continue from the saved context.',
                        sections: [],
                        timestamp: session.updatedAt,
                    }}
                    action={{
                        label: resumeCardActionLabel || 'Continue task',
                        onClick: onResumeCardAction,
                        disabled: resumeCardActionDisabled,
                    }}
                />
            ) : null}
            {pendingLabel && (
                <MessageBubble
                    key={`pending-${session.taskId}-${pendingStatus?.phase ?? 'unknown'}`}
                    item={{
                        id: `pending-${session.taskId}`,
                        content: pendingLabel,
                    }}
                    isUser={false}
                    tone="status"
                />
            )}
            <div ref={endRef} />
        </div>
    );
};

export const Timeline = React.memo(TimelineComponent, (prevProps, nextProps) => (
    prevProps.session === nextProps.session
    && prevProps.showResumeCard === nextProps.showResumeCard
    && prevProps.resumeCardTitle === nextProps.resumeCardTitle
    && prevProps.resumeCardSuggestion === nextProps.resumeCardSuggestion
    && prevProps.resumeCardActionLabel === nextProps.resumeCardActionLabel
    && prevProps.resumeCardActionDisabled === nextProps.resumeCardActionDisabled
    && prevProps.onResumeCardAction === nextProps.onResumeCardAction
));

Timeline.displayName = 'Timeline';
