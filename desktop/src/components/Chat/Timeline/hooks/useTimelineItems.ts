/**
 * useTimelineItems Hook
 *
 * Transforms TaskSession events into TimelineItems for display
 */

import { useMemo } from 'react';
import type { TaskSession, TimelineItemType } from '../../../../types';

export interface TimelineItemsResult {
    items: TimelineItemType[];
    hiddenEventCount: number;
}

/**
 * Process session events into timeline items
 * Handles event aggregation, streaming text, and status updates
 */
export function useTimelineItems(session: TaskSession, maxRecentEvents?: number): TimelineItemsResult {
    return useMemo(() => {
        const sourceEvents = typeof maxRecentEvents === 'number' && maxRecentEvents > 0
            ? session.events.slice(Math.max(0, session.events.length - maxRecentEvents))
            : session.events;
        const items: TimelineItemType[] = [];
        const toolMap = new Map<string, TimelineItemType & { type: 'tool_call' }>();
        const effectMap = new Map<string, TimelineItemType & { type: 'effect_request' }>();
        const patchMap = new Map<string, TimelineItemType & { type: 'patch' }>();

        let currentDraftId: string | null = null;

        for (const event of sourceEvents) {
            const payload = event.payload as any;

            switch (event.type) {
                // Chat Messages
                case 'CHAT_MESSAGE':
                case 'TASK_STARTED': // Treat initial user query as chat message
                    if (event.type === 'TASK_STARTED') {
                        const content = payload.context?.userQuery || payload.description;
                        if (content) {
                            items.push({
                                type: 'user_message',
                                id: event.id,
                                content,
                                timestamp: event.timestamp
                            });
                        }
                    } else {
                        const role = payload.role || 'system';
                        if (role === 'user') {
                            items.push({ type: 'user_message', id: event.id, content: payload.content, timestamp: event.timestamp });
                        } else if (role === 'system') {
                            items.push({ type: 'system_event', id: event.id, content: payload.content, timestamp: event.timestamp });
                        } else {
                            // Assistant message that is NOT a delta (e.g. history)
                            items.push({ type: 'assistant_message', id: event.id, content: payload.content, timestamp: event.timestamp });
                        }
                    }
                    break;

                // Streaming Text
                case 'TEXT_DELTA':
                    if (payload.role === 'thinking') continue;
                    // Simply append to the last item if it's an assistant message, or start new
                    const delta = payload.delta || '';
                    if (currentDraftId && items.length > 0 && items[items.length - 1].type === 'assistant_message') {
                        (items[items.length - 1] as any).content += delta;
                    } else {
                        currentDraftId = event.id;
                        items.push({
                            type: 'assistant_message',
                            id: event.id,
                            content: delta,
                            timestamp: event.timestamp,
                            isStreaming: true
                        });
                    }
                    break;

                // Tools
                case 'TOOL_CALLED':
                    const toolItem: TimelineItemType & { type: 'tool_call' } = {
                        type: 'tool_call',
                        id: payload.toolId || event.id,
                        toolName: payload.toolName,
                        args: payload.args,
                        status: 'running',
                        timestamp: event.timestamp
                    };
                    toolMap.set(toolItem.id, toolItem);
                    items.push(toolItem);
                    // Reset text streaming on tool call
                    currentDraftId = null;
                    break;

                case 'TOOL_RESULT':
                    // Find the tool call and update it
                    const matchingTool = toolMap.get(payload.toolId);
                    if (matchingTool) {
                        matchingTool.status = payload.success ? 'success' : 'failed';
                        matchingTool.result = payload.result || payload.error;
                    }
                    else {
                        // Fallback logic if we missed the call or toolId mismatch
                        // Usually we just ignore or try to attach to last tool
                    }
                    break;

                // Effects
                case 'EFFECT_REQUESTED':
                    const req = payload.request;
                    const effItem: TimelineItemType & { type: 'effect_request' } = {
                        type: 'effect_request',
                        id: req.id,
                        effectType: req.effectType,
                        risk: payload.riskLevel,
                        timestamp: event.timestamp
                    };
                    effectMap.set(effItem.id, effItem);
                    items.push(effItem);
                    break;

                case 'EFFECT_APPROVED':
                case 'EFFECT_DENIED':
                    const resp = payload.response;
                    const eff = effectMap.get(resp.requestId);
                    if (eff) {
                        eff.approved = event.type === 'EFFECT_APPROVED';
                    }
                    break;

                // Patches
                case 'PATCH_PROPOSED':
                    const patchItem: TimelineItemType & { type: 'patch' } = {
                        type: 'patch',
                        id: payload.patch.id,
                        filePath: payload.patch.filePath,
                        status: 'proposed',
                        timestamp: event.timestamp
                    };
                    patchMap.set(patchItem.id, patchItem);
                    items.push(patchItem);
                    break;

                case 'PATCH_APPLIED':
                case 'PATCH_REJECTED':
                    const pItem = patchMap.get(payload.patchId);
                    if (pItem) {
                        pItem.status = event.type === 'PATCH_APPLIED' ? 'applied' : 'rejected';
                    }
                    break;

                // Rate limiting
                case 'RATE_LIMITED':
                    items.push({
                        type: 'system_event',
                        id: event.id,
                        content: payload.message || `API rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`,
                        timestamp: event.timestamp,
                    });
                    break;

                case 'TASK_SUSPENDED':
                    items.push({
                        type: 'system_event',
                        id: event.id,
                        content: payload.userMessage || `Task suspended: ${payload.reason || 'waiting for user action'}`,
                        timestamp: event.timestamp,
                        actions: Array.isArray(payload.actions) ? payload.actions : undefined,
                    });
                    currentDraftId = null;
                    break;

                case 'TASK_RESUMED': {
                    const seconds = typeof payload.suspendDurationMs === 'number'
                        ? Math.max(1, Math.round(payload.suspendDurationMs / 1000))
                        : undefined;
                    const resumeReason = payload.resumeReason ? ` (${payload.resumeReason})` : '';
                    items.push({
                        type: 'system_event',
                        id: event.id,
                        content: `Task resumed${resumeReason}${seconds ? ` after ${seconds}s` : ''}.`,
                        timestamp: event.timestamp,
                    });
                    currentDraftId = null;
                    break;
                }
            }
        }
        return {
            items,
            hiddenEventCount: session.events.length - sourceEvents.length,
        };
    }, [maxRecentEvents, session.events]);
}
