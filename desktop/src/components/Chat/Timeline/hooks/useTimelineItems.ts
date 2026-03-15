/**
 * useTimelineItems Hook
 *
 * Transforms TaskSession events into TimelineItems for display
 */

import { useMemo } from 'react';
import type { TaskSession, TimelineItemType } from '../../../../types';
import { buildSkillConfigPromptFromToolResult } from '../../../../lib/skillConfigPrompts';

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
        return buildTimelineItems(session, maxRecentEvents);
    }, [maxRecentEvents, session.events]);
}

export function buildTimelineItems(session: TaskSession, maxRecentEvents?: number): TimelineItemsResult {
    const sourceEvents = typeof maxRecentEvents === 'number' && maxRecentEvents > 0
        ? session.events.slice(Math.max(0, session.events.length - maxRecentEvents))
        : session.events;
    const items: TimelineItemType[] = [];
    const toolMap = new Map<string, TimelineItemType & { type: 'tool_call' }>();
    const effectMap = new Map<string, TimelineItemType & { type: 'effect_request' }>();
    const patchMap = new Map<string, TimelineItemType & { type: 'patch' }>();
    const emittedSkillConfigCards = new Set<string>();
    const serializeArgs = (value: unknown): string => {
        try {
            return JSON.stringify(value ?? null);
        } catch {
            return String(value);
        }
    };

        let currentDraftId: string | null = null;
        const finalizeCurrentDraft = () => {
            if (!currentDraftId || items.length === 0) {
                currentDraftId = null;
                return;
            }

            const lastItem = items[items.length - 1];
            if (lastItem.type === 'assistant_message' && lastItem.id === currentDraftId) {
                (lastItem as TimelineItemType & { type: 'assistant_message' }).isStreaming = false;
            }

            currentDraftId = null;
        };

        for (const event of sourceEvents) {
            const payload = event.payload as any;

            switch (event.type) {
                // Chat Messages
                case 'CHAT_MESSAGE':
                case 'TASK_STARTED': // Treat initial user query as chat message
                    finalizeCurrentDraft();
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
                            const skillConfigCard = payload.skillConfigCard as any;
                            if (skillConfigCard?.skillId) {
                                if (emittedSkillConfigCards.has(skillConfigCard.skillId)) {
                                    break;
                                }
                                emittedSkillConfigCards.add(skillConfigCard.skillId);
                            }
                            items.push({
                                type: 'system_event',
                                id: event.id,
                                content: payload.content,
                                timestamp: event.timestamp,
                                skillConfigCard,
                            });
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
                    finalizeCurrentDraft();
                    {
                        const toolName = payload.toolName || payload.name;
                        const toolArgs = payload.args || payload.input;
                        const toolId = payload.toolId || payload.id || event.id;
                        const lastItem = items[items.length - 1];
                        const canMerge =
                            lastItem?.type === 'tool_call' &&
                            lastItem.toolName === toolName &&
                            serializeArgs(lastItem.args) === serializeArgs(toolArgs);

                        if (canMerge) {
                            const mergedItem = lastItem as TimelineItemType & { type: 'tool_call' };
                            mergedItem.repeatCount = (mergedItem.repeatCount ?? 1) + 1;
                            mergedItem.status = 'running';
                            mergedItem.timestamp = event.timestamp;
                            toolMap.set(toolId, mergedItem);
                            break;
                        }

                        const toolItem: TimelineItemType & { type: 'tool_call' } = {
                            type: 'tool_call',
                            id: toolId,
                            toolName,
                            args: toolArgs,
                            status: 'running',
                            timestamp: event.timestamp,
                            repeatCount: 1,
                        };
                        toolMap.set(toolId, toolItem);
                        items.push(toolItem);
                    }
                    break;

                case 'TOOL_RESULT':
                    // Find the tool call and update it
                    const matchingTool = toolMap.get(payload.toolId || payload.toolUseId);
                    if (matchingTool) {
                        const success = typeof payload.success === 'boolean'
                            ? payload.success
                            : !payload.isError;
                        matchingTool.status = success ? 'success' : 'failed';
                        matchingTool.result = payload.result || payload.error;
                        matchingTool.timestamp = event.timestamp;
                    }
                    else {
                        // Fallback logic if we missed the call or toolId mismatch
                        // Usually we just ignore or try to attach to last tool
                    }
                    {
                        const skillConfigCard = buildSkillConfigPromptFromToolResult(payload.result);
                        if (skillConfigCard && !emittedSkillConfigCards.has(skillConfigCard.skillId)) {
                            emittedSkillConfigCards.add(skillConfigCard.skillId);
                            items.push({
                                type: 'system_event',
                                id: `${event.id}:skill-config`,
                                content: `Configure ${skillConfigCard.skillName} to continue.`,
                                timestamp: event.timestamp,
                                skillConfigCard,
                            });
                        }
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
                    finalizeCurrentDraft();
                    items.push({
                        type: 'system_event',
                        id: event.id,
                        content: payload.message || `API rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`,
                        timestamp: event.timestamp,
                    });
                    break;

                case 'TASK_SUSPENDED':
                    finalizeCurrentDraft();
                    if (payload.skillConfigCard?.skillId) {
                        if (emittedSkillConfigCards.has(payload.skillConfigCard.skillId)) {
                            break;
                        }
                        emittedSkillConfigCards.add(payload.skillConfigCard.skillId);
                    }
                    items.push({
                        type: 'system_event',
                        id: event.id,
                        content: payload.userMessage || `Task suspended: ${payload.reason || 'waiting for user action'}`,
                        timestamp: event.timestamp,
                        actions: Array.isArray(payload.actions) ? payload.actions : undefined,
                        skillConfigCard: payload.skillConfigCard as any,
                    });
                    break;

                case 'TASK_RESUMED': {
                    finalizeCurrentDraft();
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
                    break;
                }

                case 'TASK_FINISHED':
                case 'TASK_FAILED':
                    finalizeCurrentDraft();
                    break;

                case 'TASK_STATUS':
                    if (payload.status && payload.status !== 'running') {
                        finalizeCurrentDraft();
                    }
                    break;
            }
        }

        finalizeCurrentDraft();

    return {
        items,
        hiddenEventCount: session.events.length - sourceEvents.length,
    };
}
