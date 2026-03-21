/**
 * useTimelineItems Hook
 *
 * Transforms TaskSession events into TimelineItems for display.
 * Uses incremental caching so streaming updates do not rebuild the full timeline.
 */

import { useMemo, useRef } from 'react';
import type { TaskSession, TimelineItemType } from '../../../../types';

export interface TimelineItemsResult {
    items: TimelineItemType[];
    hiddenEventCount: number;
}

type TimelineCache = {
    taskId: string;
    maxRecentEvents?: number;
    firstEventId: string | null;
    sourceEventCount: number;
    sessionStatus: TaskSession['status'];
    items: TimelineItemType[];
    toolIndex: Map<string, number>;
    effectIndex: Map<string, number>;
    patchIndex: Map<string, number>;
    currentDraftIndex: number | null;
    taskUpdateCardIndex: number | null;
};

function createEmptyCache(
    taskId: string,
    maxRecentEvents: number | undefined,
    firstEventId: string | null,
    sessionStatus: TaskSession['status']
): TimelineCache {
    return {
        taskId,
        maxRecentEvents,
        firstEventId,
        sourceEventCount: 0,
        sessionStatus,
        items: [],
        toolIndex: new Map(),
        effectIndex: new Map(),
        patchIndex: new Map(),
        currentDraftIndex: null,
        taskUpdateCardIndex: null,
    };
}

function upsertItem(cache: TimelineCache, index: number, item: TimelineItemType): void {
    cache.items[index] = item;
}

function appendItem(cache: TimelineCache, item: TimelineItemType): number {
    const nextIndex = cache.items.length;
    cache.items.push(item);
    return nextIndex;
}

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeLines(values: unknown[]): string[] {
    const lines = values
        .map((value) => normalizeText(value))
        .filter((line) => line.length > 0);
    return Array.from(new Set(lines));
}

function appendSystemEvent(cache: TimelineCache, event: TaskSession['events'][number], content: string): void {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
        return;
    }

    const lastItem = cache.items.at(-1);
    if (lastItem?.type === 'system_event' && lastItem.content.trim() === normalizedContent) {
        return;
    }

    appendItem(cache, {
        type: 'system_event',
        id: event.id,
        content: normalizedContent,
        timestamp: event.timestamp,
    });
}

function upsertTaskUpdateCard(
    cache: TimelineCache,
    event: TaskSession['events'][number],
    card: {
        subtitle?: string;
        sections: Array<{ label: string; lines: string[] }>;
    }
): void {
    const subtitle = normalizeText(card.subtitle);
    const sections = card.sections
        .map((section) => ({
            label: normalizeText(section.label),
            lines: normalizeLines(section.lines),
        }))
        .filter((section) => section.label.length > 0);

    if (!subtitle && sections.length === 0) {
        return;
    }

    let cardIndex = cache.taskUpdateCardIndex;
    let existingItem = cardIndex !== null ? cache.items[cardIndex] : undefined;
    if (!existingItem || existingItem.type !== 'task_card') {
        cardIndex = appendItem(cache, {
            type: 'task_card',
            id: `task-update-${cache.taskId}`,
            title: 'Task update',
            subtitle: undefined,
            sections: [],
            timestamp: event.timestamp,
        });
        cache.taskUpdateCardIndex = cardIndex;
        existingItem = cache.items[cardIndex];
    }

    if (!existingItem || existingItem.type !== 'task_card') {
        return;
    }
    if (cardIndex === null) {
        return;
    }

    const nextSections = [...existingItem.sections];
    for (const section of sections) {
        const index = nextSections.findIndex((entry) => entry.label.toLowerCase() === section.label.toLowerCase());
        if (section.lines.length === 0) {
            if (index >= 0) {
                nextSections.splice(index, 1);
            }
            continue;
        }
        if (index >= 0) {
            nextSections[index] = {
                label: section.label,
                lines: section.lines,
            };
            continue;
        }
        nextSections.push({
            label: section.label,
            lines: section.lines,
        });
    }

    upsertItem(cache, cardIndex, {
        ...existingItem,
        subtitle: subtitle || existingItem.subtitle,
        sections: nextSections,
        timestamp: event.timestamp,
    });
}

function appendFinishedSummaryIfNeeded(
    cache: TimelineCache,
    event: TaskSession['events'][number],
    summary: string | undefined
): void {
    const normalizedSummary = summary?.trim();
    if (!normalizedSummary) {
        return;
    }

    if (cache.currentDraftIndex !== null) {
        return;
    }

    const lastItem = cache.items.at(-1);
    if (lastItem?.type === 'assistant_message' && lastItem.content.trim() === normalizedSummary) {
        return;
    }

    appendItem(cache, {
        type: 'assistant_message',
        id: `${event.id}-assistant`,
        content: normalizedSummary,
        timestamp: event.timestamp,
        isStreaming: false,
    });
}

function processEvent(cache: TimelineCache, event: TaskSession['events'][number]): void {
    const payload = event.payload as Record<string, any>;

    switch (event.type) {
        case 'CHAT_MESSAGE':
        case 'TASK_STARTED': {
            if (event.type === 'TASK_STARTED') {
                const content = payload.context?.userQuery || payload.description;
                if (content) {
                    appendItem(cache, {
                        type: 'user_message',
                        id: event.id,
                        content,
                        timestamp: event.timestamp,
                    });
                }
                break;
            }

            const role = payload.role || 'system';
            if (role === 'user') {
                appendItem(cache, {
                    type: 'user_message',
                    id: event.id,
                    content: payload.content,
                    timestamp: event.timestamp,
                });
                cache.currentDraftIndex = null;
            } else if (role === 'system') {
                appendItem(cache, {
                    type: 'system_event',
                    id: event.id,
                    content: payload.content,
                    timestamp: event.timestamp,
                });
            } else {
                const assistantItem: TimelineItemType = {
                    type: 'assistant_message',
                    id: event.id,
                    content: payload.content,
                    timestamp: event.timestamp,
                    isStreaming: false,
                };

                if (cache.currentDraftIndex !== null && cache.items[cache.currentDraftIndex]?.type === 'assistant_message') {
                    upsertItem(cache, cache.currentDraftIndex, assistantItem);
                } else {
                    appendItem(cache, assistantItem);
                }
                cache.currentDraftIndex = null;
            }
            break;
        }

        case 'TEXT_DELTA': {
            if (payload.role === 'thinking') {
                return;
            }

            const delta = payload.delta || '';
            if (cache.currentDraftIndex !== null && cache.items[cache.currentDraftIndex]?.type === 'assistant_message') {
                const currentItem = cache.items[cache.currentDraftIndex] as Extract<TimelineItemType, { type: 'assistant_message' }>;
                upsertItem(cache, cache.currentDraftIndex, {
                    ...currentItem,
                    content: currentItem.content + delta,
                    isStreaming: cache.sessionStatus === 'running',
                });
            } else {
                cache.currentDraftIndex = appendItem(cache, {
                    type: 'assistant_message',
                    id: event.id,
                    content: delta,
                    timestamp: event.timestamp,
                    isStreaming: cache.sessionStatus === 'running',
                });
            }
            break;
        }

        case 'TOOL_CALLED': {
            const toolItem: TimelineItemType & { type: 'tool_call' } = {
                type: 'tool_call',
                id: payload.toolId || event.id,
                toolName: payload.toolName,
                args: payload.args,
                status: 'running',
                timestamp: event.timestamp,
            };
            const index = appendItem(cache, toolItem);
            cache.toolIndex.set(toolItem.id, index);
            cache.currentDraftIndex = null;
            break;
        }

        case 'TOOL_RESULT': {
            const matchingIndex = cache.toolIndex.get(payload.toolId);
            if (matchingIndex !== undefined) {
                const currentItem = cache.items[matchingIndex];
                if (currentItem?.type === 'tool_call') {
                    upsertItem(cache, matchingIndex, {
                        ...currentItem,
                        status: payload.success ? 'success' : 'failed',
                        result: payload.result || payload.error,
                    });
                }
            }
            break;
        }

        case 'EFFECT_REQUESTED': {
            const req = payload.request;
            const effItem: TimelineItemType & { type: 'effect_request' } = {
                type: 'effect_request',
                id: req.id,
                effectType: req.effectType,
                risk: payload.riskLevel,
                timestamp: event.timestamp,
            };
            const index = appendItem(cache, effItem);
            cache.effectIndex.set(effItem.id, index);
            break;
        }

        case 'EFFECT_APPROVED':
        case 'EFFECT_DENIED': {
            const resp = payload.response;
            const effIndex = cache.effectIndex.get(resp.requestId);
            if (effIndex !== undefined) {
                const currentItem = cache.items[effIndex];
                if (currentItem?.type === 'effect_request') {
                    upsertItem(cache, effIndex, {
                        ...currentItem,
                        approved: event.type === 'EFFECT_APPROVED',
                    });
                }
            }
            break;
        }

        case 'PATCH_PROPOSED': {
            const patchItem: TimelineItemType & { type: 'patch' } = {
                type: 'patch',
                id: payload.patch.id,
                filePath: payload.patch.filePath,
                status: 'proposed',
                timestamp: event.timestamp,
            };
            const index = appendItem(cache, patchItem);
            cache.patchIndex.set(patchItem.id, index);
            break;
        }

        case 'PATCH_APPLIED':
        case 'PATCH_REJECTED': {
            const patchIndex = cache.patchIndex.get(payload.patchId);
            if (patchIndex !== undefined) {
                const currentItem = cache.items[patchIndex];
                if (currentItem?.type === 'patch') {
                    upsertItem(cache, patchIndex, {
                        ...currentItem,
                        status: event.type === 'PATCH_APPLIED' ? 'applied' : 'rejected',
                    });
                }
            }
            break;
        }

        case 'RATE_LIMITED':
            appendSystemEvent(
                cache,
                event,
                payload.message || `API rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`
            );
            break;

        case 'TASK_STATUS': {
            const status = typeof payload.status === 'string' ? payload.status : '';
            const statusLabel = status === 'running'
                ? 'Status updated: in progress'
                : status === 'finished'
                    ? 'Status updated: completed'
                    : status === 'failed'
                        ? 'Status updated: failed'
                        : status === 'idle'
                            ? 'Status updated: waiting'
                            : '';

            appendSystemEvent(cache, event, statusLabel);
            break;
        }

        case 'TASK_PLAN_READY':
            upsertTaskUpdateCard(cache, event, {
                subtitle: payload.summary || 'Coworkany prepared an execution plan.',
                sections: [
                    {
                        label: 'Plan · Deliverables',
                        lines: ((Array.isArray(payload.deliverables) ? payload.deliverables : []) as Array<Record<string, unknown>>)
                            .map((deliverable) => {
                                const title = normalizeText(deliverable.title);
                                const path = normalizeText(deliverable.path);
                                const description = normalizeText(deliverable.description);
                                if (path) return `${title || 'Deliverable'}: ${path}`;
                                if (description) return `${title || 'Deliverable'}: ${description}`;
                                return title || '';
                            }),
                    },
                    {
                        label: 'Plan · Checkpoints',
                        lines: ((Array.isArray(payload.checkpoints) ? payload.checkpoints : []) as Array<Record<string, unknown>>)
                            .map((checkpoint) => {
                                const title = normalizeText(checkpoint.title);
                                const reason = normalizeText(checkpoint.reason);
                                return reason ? `${title || 'Checkpoint'}: ${reason}` : title;
                            }),
                    },
                    {
                        label: 'Plan · User actions',
                        lines: ((Array.isArray(payload.userActionsRequired) ? payload.userActionsRequired : []) as Array<Record<string, unknown>>)
                            .map((action) => {
                                const title = normalizeText(action.title);
                                const description = normalizeText(action.description);
                                return description ? `${title || 'Action'}: ${description}` : title;
                            }),
                    },
                    {
                        label: 'Plan · Needs from you',
                        lines: ((Array.isArray(payload.missingInfo) ? payload.missingInfo : []) as Array<Record<string, unknown>>)
                            .map((entry) => {
                                const field = normalizeText(entry.field);
                                const question = normalizeText(entry.question);
                                const reason = normalizeText(entry.reason);
                                return question || reason ? `${field || 'Item'}: ${question || reason}` : field;
                            }),
                    },
                ],
            });
            break;

        case 'TASK_RESEARCH_UPDATED':
            upsertTaskUpdateCard(cache, event, {
                subtitle: payload.summary || 'Research updated.',
                sections: [
                    {
                        label: 'Research · Sources checked',
                        lines: Array.isArray(payload.sourcesChecked) ? payload.sourcesChecked : [],
                    },
                    {
                        label: 'Research · Blocking unknowns',
                        lines: Array.isArray(payload.blockingUnknowns) ? payload.blockingUnknowns : [],
                    },
                ],
            });
            break;

        case 'TASK_CONTRACT_REOPENED':
        {
            const changedFields = Array.isArray(payload.diff?.changedFields)
                ? payload.diff.changedFields.filter((field: unknown): field is string => typeof field === 'string')
                : [];
            const diff = payload.diff as Record<string, any> | undefined;
            const diffLines = [
                diff?.modeChanged
                    ? `Mode: ${normalizeText(diff.modeChanged.before)} -> ${normalizeText(diff.modeChanged.after)}`
                    : '',
                diff?.objectiveChanged
                    ? `Objective: ${normalizeText(diff.objectiveChanged.before)} -> ${normalizeText(diff.objectiveChanged.after)}`
                    : '',
                diff?.deliverablesChanged
                    ? `Deliverables: ${(Array.isArray(diff.deliverablesChanged.before) ? diff.deliverablesChanged.before.join(', ') : 'none')} -> ${(Array.isArray(diff.deliverablesChanged.after) ? diff.deliverablesChanged.after.join(', ') : 'none')}`
                    : '',
                diff?.targetsChanged
                    ? `Targets: ${(Array.isArray(diff.targetsChanged.before) ? diff.targetsChanged.before.join(', ') : 'none')} -> ${(Array.isArray(diff.targetsChanged.after) ? diff.targetsChanged.after.join(', ') : 'none')}`
                    : '',
                diff?.workflowsChanged
                    ? `Workflow: ${(Array.isArray(diff.workflowsChanged.before) ? diff.workflowsChanged.before.join(', ') : 'none')} -> ${(Array.isArray(diff.workflowsChanged.after) ? diff.workflowsChanged.after.join(', ') : 'none')}`
                    : '',
            ];
            upsertTaskUpdateCard(cache, event, {
                subtitle: payload.summary || payload.reason || 'Execution contract reopened.',
                sections: [
                    {
                        label: 'Contract · Reason',
                        lines: payload.reason ? [payload.reason] : [],
                    },
                    {
                        label: 'Contract · Changed fields',
                        lines: changedFields,
                    },
                    {
                        label: 'Contract · Diff',
                        lines: diffLines,
                    },
                ],
            });
            break;
        }

        case 'TASK_CHECKPOINT_REACHED':
            upsertTaskUpdateCard(cache, event, {
                subtitle: payload.userMessage || payload.reason || 'Checkpoint reached.',
                sections: [
                    {
                        label: 'Checkpoint · Current',
                        lines: [
                            [
                                normalizeText(payload.title),
                                normalizeText(payload.reason),
                            ].filter(Boolean).join(': '),
                        ],
                    },
                ],
            });
            break;

        case 'TASK_USER_ACTION_REQUIRED':
            upsertTaskUpdateCard(cache, event, {
                subtitle: payload.description || 'User action required.',
                sections: [
                    {
                        label: 'Action · Questions',
                        lines: Array.isArray(payload.questions) ? payload.questions : [],
                    },
                    {
                        label: 'Action · Instructions',
                        lines: Array.isArray(payload.instructions) ? payload.instructions : [],
                    },
                ],
            });
            break;

        case 'TASK_FINISHED':
            appendFinishedSummaryIfNeeded(cache, event, payload.summary);
            break;

        default:
            break;
    }
}

function buildCache(
    session: TaskSession,
    sourceEvents: TaskSession['events'],
    maxRecentEvents?: number
): TimelineCache {
    const cache = createEmptyCache(session.taskId, maxRecentEvents, sourceEvents[0]?.id ?? null, session.status);
    for (const event of sourceEvents) {
        processEvent(cache, event);
    }
    cache.sourceEventCount = sourceEvents.length;
    return cache;
}

function finalizeStreamingState(cache: TimelineCache, sessionStatus: TaskSession['status']): TimelineCache {
    if (cache.sessionStatus === sessionStatus) {
        return cache;
    }

    const nextCache: TimelineCache = {
        ...cache,
        sessionStatus,
        items: [...cache.items],
        toolIndex: new Map(cache.toolIndex),
        effectIndex: new Map(cache.effectIndex),
        patchIndex: new Map(cache.patchIndex),
        taskUpdateCardIndex: cache.taskUpdateCardIndex,
    };

    if (nextCache.currentDraftIndex !== null) {
        const currentItem = nextCache.items[nextCache.currentDraftIndex];
        if (currentItem?.type === 'assistant_message') {
            upsertItem(nextCache, nextCache.currentDraftIndex, {
                ...currentItem,
                isStreaming: sessionStatus === 'running',
            });
        }
        if (sessionStatus !== 'running') {
            nextCache.currentDraftIndex = null;
        }
    }

    return nextCache;
}

export function buildTimelineItems(
    session: TaskSession,
    maxRecentEvents?: number
): TimelineItemsResult {
    const sourceEvents = typeof maxRecentEvents === 'number' && maxRecentEvents > 0
        ? session.events.slice(Math.max(0, session.events.length - maxRecentEvents))
        : session.events;
    const cache = finalizeStreamingState(
        buildCache(session, sourceEvents, maxRecentEvents),
        session.status
    );

    return {
        items: cache.items,
        hiddenEventCount: session.events.length - sourceEvents.length,
    };
}

/**
 * Process session events into timeline items
 * Handles event aggregation, streaming text, and status updates
 */
export function useTimelineItems(session: TaskSession, maxRecentEvents?: number): TimelineItemsResult {
    const cacheRef = useRef<TimelineCache | null>(null);

    return useMemo(() => {
        const sourceEvents = typeof maxRecentEvents === 'number' && maxRecentEvents > 0
            ? session.events.slice(Math.max(0, session.events.length - maxRecentEvents))
            : session.events;

        const firstEventId = sourceEvents[0]?.id ?? null;
        const previousCache = cacheRef.current;
        const shouldRebuild =
            !previousCache ||
            previousCache.taskId !== session.taskId ||
            previousCache.maxRecentEvents !== maxRecentEvents ||
            previousCache.firstEventId !== firstEventId ||
            previousCache.sourceEventCount > sourceEvents.length;

        let nextCache = shouldRebuild
            ? buildCache(session, sourceEvents, maxRecentEvents)
            : finalizeStreamingState(previousCache, session.status);

        if (!shouldRebuild && nextCache.sourceEventCount < sourceEvents.length) {
            nextCache = {
                ...nextCache,
                items: [...nextCache.items],
                toolIndex: new Map(nextCache.toolIndex),
                effectIndex: new Map(nextCache.effectIndex),
                patchIndex: new Map(nextCache.patchIndex),
            };
            for (let index = nextCache.sourceEventCount; index < sourceEvents.length; index += 1) {
                processEvent(nextCache, sourceEvents[index]);
            }
            nextCache.sourceEventCount = sourceEvents.length;
        }

        cacheRef.current = nextCache;

        return {
            items: nextCache.items,
            hiddenEventCount: session.events.length - sourceEvents.length,
        };
    }, [maxRecentEvents, session.events, session.status, session.taskId]);
}
