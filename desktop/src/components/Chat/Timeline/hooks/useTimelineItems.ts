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
            appendItem(cache, {
                type: 'system_event',
                id: event.id,
                content: payload.message || `API rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`,
                timestamp: event.timestamp,
            });
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
