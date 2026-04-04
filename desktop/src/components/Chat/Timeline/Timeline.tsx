/**
 * Timeline Component
 *
 * Main timeline interface for displaying chat history
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import styles from './Timeline.module.css';
import type {
    AssistantTurnItem,
    TimelineItemType,
    TaskSession,
    UserMessageItem,
} from '../../../types';
import { useTimelineItems } from './hooks/useTimelineItems';
import { getPendingTaskStatus } from './pendingTaskStatus';
import { useCanonicalTaskStreamStore } from '../../../stores/useCanonicalTaskStreamStore';
import { buildTimelineTurnRoundViewModel } from './viewModels/turnRounds';
import { isTauri } from '../../../lib/tauri';
import {
    invokeConfirmEffectCommand,
    invokeDenyEffectCommand,
} from '../../../lib/effectApprovalCommands';

// ============================================================================
// Main Timeline Component
// ============================================================================

const LazyAssistantUiRuntimeBridge = React.lazy(async () => {
    const module = await import('../assistantUi/AssistantUiRuntimeBridge');
    return { default: module.AssistantUiRuntimeBridge };
});

const LazyAssistantUiThreadView = React.lazy(async () => {
    const module = await import('../assistantUi/AssistantUiThreadView');
    return { default: module.AssistantUiThreadView };
});

interface TimelineProps {
    session: TaskSession;
    optimisticUserEntry?: {
        id: string;
        content: string;
        timestamp: string;
    } | null;
    onTaskCollaborationSubmit?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void;
}

export interface AssistantUiApprovalDecisionInput {
    requestId: string;
    decision: 'approve' | 'deny' | 'modify_approve';
    note?: string;
}

interface ResolveAssistantUiApprovalDecisionParams {
    input: AssistantUiApprovalDecisionInput;
    taskId: string;
    isTauriRuntime: boolean;
    invokeCommand: typeof invoke;
    onTaskCollaborationSubmit?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void | Promise<void>;
}

export async function resolveAssistantUiApprovalDecision({
    input,
    taskId,
    isTauriRuntime,
    invokeCommand,
    onTaskCollaborationSubmit,
}: ResolveAssistantUiApprovalDecisionParams): Promise<'skipped' | 'approved' | 'denied' | 'modify_forwarded'> {
    if (!isTauriRuntime) {
        return 'skipped';
    }

    if (input.decision === 'approve') {
        await invokeConfirmEffectCommand(invokeCommand, {
            requestId: input.requestId,
            remember: false,
        });
        return 'approved';
    }

    const note = typeof input.note === 'string' ? input.note.trim() : '';
    await invokeDenyEffectCommand(invokeCommand, {
        requestId: input.requestId,
        reason: note,
    });

    if (input.decision === 'modify_approve' && note && onTaskCollaborationSubmit) {
        await onTaskCollaborationSubmit({
            taskId,
            cardId: input.requestId,
            value: `请按以下修改重新执行：${note}`,
        });
        return 'modify_forwarded';
    }

    return 'denied';
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

function normalizeComparableText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

export function appendOptimisticUserEntry(
    items: TimelineItemType[],
    optimisticUserEntry?: TimelineProps['optimisticUserEntry']
): TimelineItemType[] {
    if (!optimisticUserEntry) {
        return items;
    }

    const content = optimisticUserEntry.content.trim();
    if (!content) {
        return items;
    }

    const normalizedOptimisticContent = normalizeComparableText(content);
    const hasEquivalentUserMessage = items.some((item) => (
        item.type === 'user_message'
        && normalizeComparableText(item.content) === normalizedOptimisticContent
    ));

    if (hasEquivalentUserMessage) {
        return items;
    }

    const optimisticItem: UserMessageItem = {
        type: 'user_message',
        id: optimisticUserEntry.id,
        content,
        timestamp: optimisticUserEntry.timestamp,
    };

    return [...items, optimisticItem];
}

export function buildAssistantUiDisplayItems(
    timelineItems: TimelineItemType[],
    optimisticUserEntry: TimelineProps['optimisticUserEntry'] | undefined,
    pendingLabel: string,
    session: Pick<TaskSession, 'taskId' | 'updatedAt'>,
): { items: TimelineItemType[]; resolvedPendingLabel: string } {
    const itemsWithOptimistic = appendOptimisticUserEntry(timelineItems, optimisticUserEntry);
    const resolvedPendingLabel = resolveAssistantUiPendingLabel(itemsWithOptimistic, pendingLabel);
    const items = buildDisplayItemsWithPendingState(
        itemsWithOptimistic,
        resolvedPendingLabel,
        session,
    );
    return {
        items,
        resolvedPendingLabel,
    };
}

function hasRenderableAssistantNarrative(turn: AssistantTurnItem): boolean {
    const hasMessageText = (turn.lead?.trim().length ?? 0) > 0
        || turn.messages.some((line) => line.trim().length > 0)
        || (turn.systemEvents?.some((line) => line.trim().length > 0) ?? false);
    if (hasMessageText) {
        return true;
    }

    const result = turn.taskCard?.result;
    if ((result?.summary?.trim().length ?? 0) > 0) {
        return true;
    }
    if ((result?.error?.trim().length ?? 0) > 0) {
        return true;
    }
    if ((result?.suggestion?.trim().length ?? 0) > 0) {
        return true;
    }

    return turn.taskCard?.sections.some((section) => section.lines.some((line) => line.trim().length > 0)) ?? false;
}

export function resolveAssistantUiPendingLabel(
    visibleItems: TimelineItemType[],
    pendingLabel: string,
): string {
    if (!pendingLabel) {
        return '';
    }

    const lastItem = visibleItems[visibleItems.length - 1];
    if (lastItem?.type === 'assistant_turn') {
        return hasRenderableAssistantNarrative(lastItem) ? '' : pendingLabel;
    }

    return pendingLabel;
}

const TimelineComponent: React.FC<TimelineProps> = ({
    session,
    optimisticUserEntry,
    onTaskCollaborationSubmit,
}) => {
    const { t } = useTranslation();
    const canonicalMessages = useCanonicalTaskStreamStore((state) => state.sessions.get(session.taskId)?.messages);
    const { items: timelineItems } = useTimelineItems(session, undefined, canonicalMessages);
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
    const { items: displayItems, resolvedPendingLabel } = React.useMemo(
        () => buildAssistantUiDisplayItems(
            timelineItems,
            optimisticUserEntry,
            pendingLabel,
            session,
        ),
        [optimisticUserEntry, pendingLabel, session, timelineItems],
    );
    const turnRoundViewModel = React.useMemo(
        () => buildTimelineTurnRoundViewModel(displayItems),
        [displayItems],
    );
    const handleAssistantUiApprovalDecision = React.useCallback(async (input: AssistantUiApprovalDecisionInput) => {
        try {
            await resolveAssistantUiApprovalDecision({
                input,
                taskId: session.taskId,
                isTauriRuntime: isTauri(),
                invokeCommand: invoke,
                onTaskCollaborationSubmit,
            });
        } catch (error) {
            console.error('[Timeline] Failed to resolve approval action', error);
        }
    }, [onTaskCollaborationSubmit, session.taskId]);
    const runtimeFallback = (
        <div className={styles.assistantUiLoadingShell} aria-hidden="true">
            <div className={styles.assistantUiLoadingRail}>
                <span className={styles.assistantUiLoadingDot} />
                <span className={styles.assistantUiLoadingLine} />
            </div>
            <div className={styles.assistantUiLoadingCard} />
            <div className={styles.assistantUiLoadingCard} />
        </div>
    );

    return (
        <React.Suspense fallback={runtimeFallback}>
            <LazyAssistantUiRuntimeBridge
                sessionId={session.taskId}
                rounds={turnRoundViewModel.rounds}
                pendingLabel={resolvedPendingLabel}
                pendingStatus={pendingStatus}
                isRunning={Boolean(pendingStatus)}
            >
                <LazyAssistantUiThreadView onApprovalDecision={handleAssistantUiApprovalDecision} />
            </LazyAssistantUiRuntimeBridge>
        </React.Suspense>
    );
};

export const Timeline = React.memo(TimelineComponent, (prevProps, nextProps) => (
    prevProps.session === nextProps.session
    && prevProps.optimisticUserEntry?.id === nextProps.optimisticUserEntry?.id
    && prevProps.optimisticUserEntry?.content === nextProps.optimisticUserEntry?.content
    && prevProps.optimisticUserEntry?.timestamp === nextProps.optimisticUserEntry?.timestamp
    && prevProps.onTaskCollaborationSubmit === nextProps.onTaskCollaborationSubmit
));

Timeline.displayName = 'Timeline';
