/**
 * Timeline Component
 *
 * Main timeline interface for displaying chat history
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Timeline.module.css';
import type {
    AssistantTurnItem,
    TimelineItemType,
    TaskSession,
} from '../../../types';
import { useTimelineItems } from './hooks/useTimelineItems';
import { MessageBubble } from './components/MessageBubble';
import { AssistantTurnBlock } from './components/AssistantTurnBlock';
import { getPendingTaskStatus } from './pendingTaskStatus';
import { useCanonicalTaskStreamStore } from '../../../stores/useCanonicalTaskStreamStore';
import { buildTimelineTurnRoundViewModel } from './viewModels/turnRounds';

// ============================================================================
// Main Timeline Component
// ============================================================================

interface TimelineProps {
    session: TaskSession;
    onTaskCollaborationSubmit?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void;
}

export function buildDisplayItemsWithPendingState(
    visibleItems: TimelineItemType[],
    pendingLabel: string,
    session: Pick<TaskSession, 'taskId' | 'updatedAt'>,
): TimelineItemType[] {
    if (!pendingLabel) {
        return visibleItems;
    }

    const lastVisibleItem = visibleItems[visibleItems.length - 1];
    if (lastVisibleItem?.type === 'assistant_turn') {
        return visibleItems;
    }

    const pendingTurn: AssistantTurnItem = {
        type: 'assistant_turn',
        id: `pending-turn-${session.taskId}`,
        timestamp: session.updatedAt,
        lead: '',
        steps: [],
        messages: [],
    };
    return [...visibleItems, pendingTurn];
}

const TimelineComponent: React.FC<TimelineProps> = ({
    session,
    onTaskCollaborationSubmit,
}) => {
    const { t } = useTranslation();
    const canonicalMessages = useCanonicalTaskStreamStore((state) => state.sessions.get(session.taskId)?.messages);
    const latestVisibleMessageCount = 10;
    const [showFullHistory, setShowFullHistory] = React.useState(false);
    const { items: timelineItems } = useTimelineItems(session, undefined, canonicalMessages);
    const hiddenMessageCount = Math.max(timelineItems.length - latestVisibleMessageCount, 0);
    const visibleItems = showFullHistory || hiddenMessageCount === 0
        ? timelineItems
        : timelineItems.slice(-latestVisibleMessageCount);
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
    const displayItems = React.useMemo<TimelineItemType[]>(
        () => buildDisplayItemsWithPendingState(visibleItems, pendingLabel, session),
        [pendingLabel, session, visibleItems],
    );
    const turnRoundViewModel = React.useMemo(
        () => buildTimelineTurnRoundViewModel(displayItems),
        [displayItems],
    );
    const lastAssistantTurnId = React.useMemo(() => {
        for (let index = displayItems.length - 1; index >= 0; index -= 1) {
            const item = displayItems[index];
            if (item?.type === 'assistant_turn') {
                return item.id;
            }
        }
        return null;
    }, [displayItems]);
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
    }, [visibleItems.length, userScrolled]);

    // Reset userScrolled when new message starts (items.length changes)
    React.useEffect(() => {
        setUserScrolled(false);
    }, [visibleItems.length]);

    const renderTimelineRound = React.useCallback((index: number): React.ReactNode => {
        const round = turnRoundViewModel.rounds[index];
        if (!round) {
            return null;
        }

        const parts: React.ReactNode[] = [];
        if (round.userMessage) {
            parts.push(
                <MessageBubble
                    key={`${round.id}-user`}
                    item={round.userMessage}
                    isUser={true}
                />
            );
        }
        if (round.assistantTurn) {
            parts.push(
                <div key={`${round.id}-assistant`} className={styles.assistantThread}>
                    <AssistantTurnBlock
                        item={round.assistantTurn}
                        pendingLabel={round.assistantTurn.id === lastAssistantTurnId ? pendingLabel : undefined}
                        onTaskCollaborationSubmit={onTaskCollaborationSubmit}
                    />
                </div>
            );
        }

        if (parts.length === 0) {
            return null;
        }

        return (
            <React.Fragment key={round.id}>
                {parts}
            </React.Fragment>
        );
    }, [lastAssistantTurnId, onTaskCollaborationSubmit, pendingLabel, turnRoundViewModel.rounds]);

    return (
        <div className={styles.timeline} ref={containerRef}>
            {hiddenMessageCount > 0 && (
                <button
                    type="button"
                    onClick={() => setShowFullHistory((prev) => !prev)}
                    className={styles.historyToggle}
                >
                    {showFullHistory
                        ? t('chat.collapseEarlierMessages')
                        : t('chat.showEarlierMessages', { count: hiddenMessageCount })}
                </button>
            )}
            {turnRoundViewModel.rounds.map((_, index) => renderTimelineRound(index))}
            <div ref={endRef} />
        </div>
    );
};

export const Timeline = React.memo(TimelineComponent, (prevProps, nextProps) => (
    prevProps.session === nextProps.session
    && prevProps.onTaskCollaborationSubmit === nextProps.onTaskCollaborationSubmit
));

Timeline.displayName = 'Timeline';
