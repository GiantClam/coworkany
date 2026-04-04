/**
 * Task Event Store
 *
 * Zustand store wrapping the TaskEventStore for React integration.
 * Receives events from Tauri and updates UI state reactively.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../lib/tauri';
import type {
    TaskStatus,
    TaskEvent,
    PlanStep,
    ToolCall,
    Effect,
    Patch,
    ChatMessage,
    AuditEvent,
    IpcResponse,
    TaskSession,
} from '../../types';

import { applyTaskEvent } from './reducers/taskReducer';
import { applyChatEvent } from './reducers/chatReducer';
import { applyToolEvent } from './reducers/toolReducer';
import { applyEffectEvent } from './reducers/effectReducer';
import { applyPatchEvent } from './reducers/patchReducer';
import { applySkillRecommendationEvent } from './reducers/skillRecommendationReducer';
import { schedulePersist, type SessionsSnapshot } from './persistence';

// Re-export types for backward compatibility
export type {
    TaskStatus,
    TaskEvent,
    PlanStep,
    ToolCall,
    Effect,
    Patch,
    ChatMessage,
    AuditEvent,
    IpcResponse,
    TaskSession,
};

// ============================================================================
// Store State
// ============================================================================

interface TaskEventStoreState {
    sessions: Map<string, TaskSession>;
    activeTaskId: string | null;
    sidecarConnected: boolean;
    pendingResponses: Map<string, IpcResponse>;
    auditEvents: AuditEvent[];

    // Actions
    addEvent: (event: TaskEvent) => void;
    addEvents: (events: TaskEvent[]) => void;
    addAuditEvent: (event: AuditEvent) => void;
    getSession: (taskId: string) => TaskSession | undefined;
    setActiveTask: (taskId: string | null) => void;
    deleteSession: (taskId: string) => void;
    createDraftSession: (seed?: Pick<TaskSession, 'title' | 'workspacePath'>) => string;
    ensureSession: (taskId: string, seed?: Partial<TaskSession>, makeActive?: boolean) => void;
    promoteDraftSession: (
        draftTaskId: string,
        nextTaskId: string,
        seed?: Pick<TaskSession, 'title' | 'workspacePath' | 'status'>
    ) => void;
    setSidecarConnected: (connected: boolean) => void;
    handleIpcResponse: (response: IpcResponse) => void;
    reset: () => void;
    hydrate: (snapshot: SessionsSnapshot) => void;
}

const sessionEventIds = new Map<string, Set<string>>();

// ============================================================================
// Create Empty Session
// ============================================================================

function createEmptySession(taskId: string): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId,
        status: 'idle',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now,
    };
}

function normalizeTaskId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function createSyntheticEventId(taskId: string, eventType: string): string {
    const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `sidecar-${taskId}-${eventType.toLowerCase()}-${randomPart}`;
}

function normalizeEventPayload(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function createInterruptedFailureState(): NonNullable<TaskSession['failure']> {
    return {
        error: 'Task interrupted by app restart',
        errorCode: 'INTERRUPTED',
        recoverable: true,
        suggestion: 'Resume the task to continue from the saved context.',
    };
}

function deriveLatestUserFacingTitle(session: TaskSession): string | undefined {
    const latestUserMessage = [...session.messages]
        .reverse()
        .find((message) => {
            const normalized = message.content.trim();
            return (
                message.role === 'user' &&
                normalized.length > 0 &&
                !normalized.startsWith('[RESUME_REQUESTED]')
            );
        });

    if (!latestUserMessage) {
        return session.title;
    }

    const normalized = latestUserMessage.content.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) {
        return session.title;
    }

    if (session.messages.filter((message) => message.role === 'user' && message.content.trim().length > 0).length <= 1) {
        return session.title || normalized;
    }

    return normalized.length > 80 ? `${normalized.slice(0, 79)}…` : normalized;
}

function getOrCreateEventIdSet(taskId: string, session?: TaskSession): Set<string> {
    const existing = sessionEventIds.get(taskId);
    if (existing) {
        return existing;
    }

    const next = new Set(session?.events.map((event) => event.id) ?? []);
    sessionEventIds.set(taskId, next);
    return next;
}

function hasSeenEvent(taskId: string, eventId: string, session?: TaskSession): boolean {
    return getOrCreateEventIdSet(taskId, session).has(eventId);
}

function rememberEvent(taskId: string, eventId: string, session?: TaskSession): void {
    getOrCreateEventIdSet(taskId, session).add(eventId);
}

function deleteEventIndex(taskId: string): void {
    sessionEventIds.delete(taskId);
}

const TRANSIENT_EVENT_TYPES = new Set<TaskEvent['type']>([
    'TEXT_DELTA',
    'TOKEN_USAGE',
]);

const HIGH_PRIORITY_PERSIST_EVENT_TYPES = new Set<TaskEvent['type']>([
    'TASK_FINISHED',
    'TASK_FAILED',
    'TASK_SUSPENDED',
    'TASK_RESEARCH_UPDATED',
    'TASK_CONTRACT_REOPENED',
    'TASK_PLAN_READY',
    'TASK_CHECKPOINT_REACHED',
    'TASK_USER_ACTION_REQUIRED',
    'TASK_CLARIFICATION_REQUIRED',
    'TASK_HISTORY_CLEARED',
    'EFFECT_APPROVED',
    'EFFECT_DENIED',
    'PATCH_APPLIED',
    'PATCH_REJECTED',
]);

function shouldPersistEvent(event: TaskEvent): boolean {
    return !TRANSIENT_EVENT_TYPES.has(event.type);
}

function getPersistDelayMs(event: TaskEvent): number {
    return HIGH_PRIORITY_PERSIST_EVENT_TYPES.has(event.type) ? 180 : 1200;
}

function pickMostRecentTaskId(sessions: Map<string, TaskSession>): string | null {
    let latestTaskId: string | null = null;
    let latestTimestamp = -Infinity;

    for (const [taskId, session] of sessions.entries()) {
        const rawTimestamp = new Date(session.updatedAt || session.createdAt || '').getTime();
        const timestamp = Number.isNaN(rawTimestamp) ? 0 : rawTimestamp;
        if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
            latestTaskId = taskId;
        }
    }

    return latestTaskId;
}

function isKnownTaskMode(value: unknown): value is NonNullable<TaskSession['taskMode']> {
    return value === 'chat'
        || value === 'immediate_task'
        || value === 'scheduled_task'
        || value === 'scheduled_multi_task';
}

function inferTaskModeFromRoutedEnvelope(value: unknown): TaskSession['taskMode'] {
    if (typeof value !== 'string') {
        return undefined;
    }
    const matched = value.match(/^\s*__route_(chat|task)__\b/iu);
    const mode = matched?.[1]?.toLowerCase();
    if (mode === 'chat') {
        return 'chat';
    }
    if (mode === 'task') {
        return 'immediate_task';
    }
    return undefined;
}

function inferTaskModeFromSession(session: TaskSession): TaskSession['taskMode'] {
    if (isKnownTaskMode(session.taskMode)) {
        return session.taskMode;
    }

    if (typeof session.title === 'string' && session.title.trim().startsWith('[Scheduled]')) {
        return 'scheduled_task';
    }

    for (const event of session.events) {
        if (event.type === 'TASK_PLAN_READY') {
            const mode = (event.payload as Record<string, unknown> | undefined)?.mode;
            if (isKnownTaskMode(mode)) {
                return mode;
            }
        }
        if (event.type === 'TASK_STARTED') {
            const context = ((event.payload as Record<string, unknown> | undefined)?.context as Record<string, unknown> | undefined);
            if (context?.scheduled === true) {
                return 'scheduled_task';
            }
            const mode = context?.mode;
            if (isKnownTaskMode(mode)) {
                return mode;
            }
            const routeMode = inferTaskModeFromRoutedEnvelope(context?.userQuery)
                ?? inferTaskModeFromRoutedEnvelope((event.payload as Record<string, unknown> | undefined)?.description);
            if (routeMode) {
                return routeMode;
            }
        }
        if (event.type === 'TASK_FINISHED') {
            const finishReason = (event.payload as Record<string, unknown> | undefined)?.finishReason;
            if (finishReason === 'scheduled') {
                return 'scheduled_task';
            }
        }
    }

    return undefined;
}

function isTerminalTaskStatus(status: TaskStatus | undefined): status is 'finished' | 'failed' | 'suspended' {
    return status === 'finished' || status === 'failed' || status === 'suspended';
}

function resolveSessionStatus(
    existingStatus: TaskStatus | undefined,
    incomingStatus: TaskStatus | undefined,
    fallback: TaskStatus
): TaskStatus {
    if (isTerminalTaskStatus(existingStatus) && incomingStatus === 'running') {
        return existingStatus;
    }
    return incomingStatus ?? existingStatus ?? fallback;
}

function mergeTaskEvents(
    primary: TaskEvent[] | undefined,
    secondary: TaskEvent[] | undefined
): TaskEvent[] {
    const merged = [...(primary ?? []), ...(secondary ?? [])];
    if (merged.length <= 1) {
        return merged;
    }

    const deduped = new Map<string, TaskEvent>();
    for (const event of merged) {
        if (!deduped.has(event.id)) {
            deduped.set(event.id, event);
        }
    }

    return [...deduped.values()].sort((left, right) => {
        if (left.sequence !== right.sequence) {
            return left.sequence - right.sequence;
        }
        const leftTime = Date.parse(left.timestamp);
        const rightTime = Date.parse(right.timestamp);
        if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
            return leftTime - rightTime;
        }
        return left.id.localeCompare(right.id);
    });
}

function mergeMessages(
    primary: TaskSession['messages'] | undefined,
    secondary: TaskSession['messages'] | undefined
): TaskSession['messages'] {
    const merged = [...(primary ?? []), ...(secondary ?? [])];
    if (merged.length <= 1) {
        return merged;
    }

    const deduped = new Map<string, TaskSession['messages'][number]>();
    for (const message of merged) {
        if (!deduped.has(message.id)) {
            deduped.set(message.id, message);
        }
    }
    return [...deduped.values()];
}

function normalizeComparableContent(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function extractConfirmedUserContent(event: TaskEvent): string | null {
    const payload = normalizeEventPayload(event.payload);
    if (event.type === 'CHAT_MESSAGE') {
        if (payload.role !== 'user' || payload.__localEcho === true) {
            return null;
        }
        const content = typeof payload.content === 'string' ? payload.content : '';
        const normalized = normalizeComparableContent(content);
        return normalized.length > 0 ? normalized : null;
    }

    if (event.type === 'TASK_STARTED') {
        const context = normalizeEventPayload(payload.context);
        const displayText = typeof context.displayText === 'string' ? context.displayText : '';
        const normalizedDisplay = normalizeComparableContent(displayText);
        if (normalizedDisplay.length > 0) {
            return normalizedDisplay;
        }

        const userQuery = typeof context.userQuery === 'string' ? context.userQuery : '';
        const routedMatch = userQuery.match(/^\s*__route_(?:chat|task)__\s*(?:\n+|[\t ]+)([\s\S]*)$/iu);
        const legacyMatch = userQuery.match(/^\s*(?:原始任务|original task)[:：]\s*(.+?)(?:\n|$)/iu);
        const extracted = routedMatch?.[1] ?? legacyMatch?.[1] ?? userQuery;
        const normalized = normalizeComparableContent(extracted);
        return normalized.length > 0 ? normalized : null;
    }

    return null;
}

function pruneConfirmedLocalUserEcho(
    session: TaskSession,
    confirmedContent: string | null,
): { session: TaskSession; removedEventIds: string[] } {
    if (!confirmedContent) {
        return { session, removedEventIds: [] };
    }

    const removedEventIds = session.events
        .filter((entry) => {
            if (entry.type !== 'CHAT_MESSAGE') {
                return false;
            }
            const payload = normalizeEventPayload(entry.payload);
            if (payload.role !== 'user' || payload.__localEcho !== true) {
                return false;
            }
            const content = typeof payload.content === 'string' ? payload.content : '';
            return normalizeComparableContent(content) === confirmedContent;
        })
        .map((entry) => entry.id);

    if (removedEventIds.length === 0) {
        return { session, removedEventIds: [] };
    }

    const removed = new Set(removedEventIds);
    return {
        session: {
            ...session,
            events: session.events.filter((entry) => !removed.has(entry.id)),
            messages: session.messages.filter((entry) => !removed.has(entry.id)),
        },
        removedEventIds,
    };
}

function persistStateSnapshot(
    sessions: Map<string, TaskSession>,
    activeTaskId: string | null,
    delayMs?: number
): void {
    schedulePersist({
        sessions: Array.from(sessions.values()),
        activeTaskId,
    }, delayMs === undefined ? undefined : { delayMs });
}

// ============================================================================
// Event Reducer (Orchestrates all reducers)
// ============================================================================

function applyEvent(session: TaskSession, event: TaskEvent): TaskSession {
    // Add event to session and update timestamp
    let updated: TaskSession = {
        ...session,
        events: [...session.events, event],
        updatedAt: new Date().toISOString(),
    };

    // Route to specific reducers
    updated = applyTaskEvent(updated, event);
    updated = applyChatEvent(updated, event);
    updated = applyToolEvent(updated, event);
    updated = applyEffectEvent(updated, event);
    updated = applyPatchEvent(updated, event);
    updated = applySkillRecommendationEvent(updated, event);

    // Handle TOKEN_USAGE events - accumulate into session
    if (event.type === 'TOKEN_USAGE') {
        const payload = event.payload as {
            inputTokens?: number;
            outputTokens?: number;
            modelId?: string;
            provider?: string;
        };
        const prevUsage = updated.tokenUsage ?? { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
        const inputTokens = prevUsage.inputTokens + (payload.inputTokens || 0);
        const outputTokens = prevUsage.outputTokens + (payload.outputTokens || 0);

        // Estimate cost based on model
        const cost = estimateTokenCost(payload.modelId, inputTokens, outputTokens);

        updated = {
            ...updated,
            tokenUsage: { inputTokens, outputTokens, estimatedCost: cost },
        };
    }

    return updated;
}

function applyEventsBatch(
    sessionsInput: Map<string, TaskSession>,
    activeTaskId: string | null,
    events: TaskEvent[]
): { sessions: Map<string, TaskSession>; changed: boolean } {
    const sessions = new Map(sessionsInput);
    let changed = false;
    let persistDelayMs: number | undefined;
    let needsPersist = false;

    for (const event of events) {
        const taskId = normalizeTaskId(event.taskId);
        if (!taskId) {
            console.warn('[TaskEventStore] Ignored task event without a valid taskId:', event);
            continue;
        }

        const existing = sessions.get(taskId) ?? createEmptySession(taskId);
        const normalizedEvent: TaskEvent = {
            ...event,
            taskId,
            id: typeof event.id === 'string' && event.id.trim().length > 0
                ? event.id
                : createSyntheticEventId(taskId, String(event.type ?? 'task_event')),
            timestamp: typeof event.timestamp === 'string' && event.timestamp.trim().length > 0
                ? event.timestamp
                : new Date().toISOString(),
            sequence: typeof event.sequence === 'number' && Number.isFinite(event.sequence) && event.sequence > 0
                ? Math.trunc(event.sequence)
                : (existing.events.at(-1)?.sequence ?? 0) + 1,
            payload: normalizeEventPayload(event.payload),
        };
        if (hasSeenEvent(taskId, normalizedEvent.id, existing)) {
            continue;
        }

        const confirmedUserContent = extractConfirmedUserContent(normalizedEvent);
        const pruned = pruneConfirmedLocalUserEcho(existing, confirmedUserContent);
        if (pruned.removedEventIds.length > 0) {
            const eventIdSet = getOrCreateEventIdSet(taskId, pruned.session);
            for (const removedId of pruned.removedEventIds) {
                eventIdSet.delete(removedId);
            }
        }

        const updated = applyEvent(pruned.session, normalizedEvent);
        sessions.set(taskId, updated);
        if (normalizedEvent.type === 'TASK_HISTORY_CLEARED') {
            sessionEventIds.set(taskId, new Set(updated.events.map((entry) => entry.id)));
        } else {
            rememberEvent(taskId, normalizedEvent.id, updated);
        }
        changed = true;

        if (shouldPersistEvent(normalizedEvent)) {
            const nextDelayMs = getPersistDelayMs(normalizedEvent);
            persistDelayMs = persistDelayMs === undefined ? nextDelayMs : Math.min(persistDelayMs, nextDelayMs);
            needsPersist = true;
        }
    }

    if (changed && needsPersist) {
        persistStateSnapshot(sessions, activeTaskId, persistDelayMs);
    }

    return { sessions, changed };
}

// ============================================================================
// Token Cost Estimation
// ============================================================================

const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 3 / 1e6, output: 15 / 1e6 },
    'claude-3-5-sonnet-20241022': { input: 3 / 1e6, output: 15 / 1e6 },
    'claude-sonnet-4-5': { input: 3 / 1e6, output: 15 / 1e6 },
    'claude-3-7-sonnet': { input: 3 / 1e6, output: 15 / 1e6 },
    'gpt-4o': { input: 2.5 / 1e6, output: 10 / 1e6 },
    'gpt-4o-mini': { input: 0.15 / 1e6, output: 0.6 / 1e6 },
    'gpt-4-turbo': { input: 10 / 1e6, output: 30 / 1e6 },
};

function estimateTokenCost(modelId: string | undefined, inputTokens: number, outputTokens: number): number {
    if (!modelId) return 0;
    // Find matching pricing (partial match)
    const pricing = Object.entries(TOKEN_PRICING).find(([key]) => modelId.includes(key));
    if (!pricing) return 0;
    const [, rates] = pricing;
    return inputTokens * rates.input + outputTokens * rates.output;
}

// ============================================================================
// Store
// ============================================================================

export const useTaskEventStore = create<TaskEventStoreState>()(
    subscribeWithSelector((set, get) => ({
        sessions: new Map(),
        activeTaskId: null,
        sidecarConnected: false,
        pendingResponses: new Map(),
        auditEvents: [],

        addEvent: (event: TaskEvent) => {
            set((state) => {
                const result = applyEventsBatch(state.sessions, state.activeTaskId, [event]);
                if (!result.changed) {
                    return { sessions: state.sessions };
                }
                return { sessions: result.sessions };
            });
        },

        addEvents: (events: TaskEvent[]) => {
            if (events.length === 0) {
                return;
            }

            set((state) => {
                const result = applyEventsBatch(state.sessions, state.activeTaskId, events);
                if (!result.changed) {
                    return { sessions: state.sessions };
                }
                return { sessions: result.sessions };
            });
        },

        addAuditEvent: (event: AuditEvent) => {
            set((state) => ({
                auditEvents: [...state.auditEvents, event],
            }));
        },

        getSession: (taskId: string) => {
            return get().sessions.get(taskId);
        },

        setActiveTask: (taskId: string | null) => {
            set((state) => {
                persistStateSnapshot(state.sessions, taskId);
                return { activeTaskId: taskId };
            });
        },

        deleteSession: (taskId: string) => {
            const normalizedTaskId = normalizeTaskId(taskId);
            if (!normalizedTaskId) {
                return;
            }

            set((state) => {
                if (!state.sessions.has(normalizedTaskId)) {
                    return { sessions: state.sessions, activeTaskId: state.activeTaskId };
                }

                const sessions = new Map(state.sessions);
                sessions.delete(normalizedTaskId);
                deleteEventIndex(normalizedTaskId);

                const activeTaskId = state.activeTaskId === normalizedTaskId
                    ? pickMostRecentTaskId(sessions)
                    : state.activeTaskId;
                persistStateSnapshot(sessions, activeTaskId);

                return {
                    sessions,
                    activeTaskId,
                };
            });
        },

        createDraftSession: (seed) => {
            const taskId = `draft-${crypto.randomUUID()}`;
            const now = new Date().toISOString();
            set((state) => {
                const sessions = new Map(state.sessions);
                sessions.set(taskId, {
                    ...createEmptySession(taskId),
                    isDraft: true,
                    title: seed?.title,
                    workspacePath: seed?.workspacePath,
                    createdAt: now,
                    updatedAt: now,
                });
                getOrCreateEventIdSet(taskId);
                persistStateSnapshot(sessions, taskId);
                return {
                    sessions,
                    activeTaskId: taskId,
                };
            });
            return taskId;
        },

        ensureSession: (taskId, seed, makeActive = false) => {
            set((state) => {
                const existing = state.sessions.get(taskId);
                const now = new Date().toISOString();
                const session: TaskSession = existing
                    ? {
                        ...existing,
                        ...seed,
                        taskId,
                        isDraft: seed?.isDraft ?? existing.isDraft,
                        status: resolveSessionStatus(existing.status, seed?.status, existing.status),
                        updatedAt: seed?.updatedAt ?? now,
                    }
                    : {
                        ...createEmptySession(taskId),
                        ...seed,
                        taskId,
                        updatedAt: seed?.updatedAt ?? now,
                        createdAt: seed?.createdAt ?? now,
                    };

                const sessions = new Map(state.sessions);
                sessions.set(taskId, session);
                getOrCreateEventIdSet(taskId, session);
                const activeTaskId = makeActive ? taskId : state.activeTaskId;
                persistStateSnapshot(sessions, activeTaskId);
                return { sessions, activeTaskId };
            });
        },

        promoteDraftSession: (draftTaskId, nextTaskId, seed) => {
            set((state) => {
                const sessions = new Map(state.sessions);
                const draft = sessions.get(draftTaskId);
                const existing = sessions.get(nextTaskId);
                const now = new Date().toISOString();
                const promotedBase = existing ?? draft ?? createEmptySession(nextTaskId);
                const promoted: TaskSession = {
                    ...promotedBase,
                    taskId: nextTaskId,
                    isDraft: false,
                    status: resolveSessionStatus(promotedBase.status, seed?.status, 'running'),
                    title: seed?.title ?? existing?.title ?? draft?.title,
                    workspacePath: seed?.workspacePath ?? existing?.workspacePath ?? draft?.workspacePath,
                    events: mergeTaskEvents(existing?.events, draft?.events),
                    messages: mergeMessages(existing?.messages, draft?.messages),
                    updatedAt: now,
                    createdAt: draft?.createdAt ?? existing?.createdAt ?? now,
                };

                if (draftTaskId !== nextTaskId) {
                    sessions.delete(draftTaskId);
                    deleteEventIndex(draftTaskId);
                }
                sessions.set(nextTaskId, promoted);
                getOrCreateEventIdSet(nextTaskId, promoted);
                persistStateSnapshot(sessions, nextTaskId);
                return {
                    sessions,
                    activeTaskId: nextTaskId,
                };
            });
        },

        setSidecarConnected: (connected: boolean) => {
            set({ sidecarConnected: connected });
        },

        handleIpcResponse: (response: IpcResponse) => {
            set((state) => {
                const pendingResponses = new Map(state.pendingResponses);
                pendingResponses.set(response.commandId, response);

                // Convert response to TaskEvent for active session if applicable
                if (response.type === 'request_effect_response') {
                    const payload = response.payload as Record<string, unknown>;
                    const effectResponse = payload.response as Record<string, unknown>;
                    const approved = effectResponse?.approved as boolean;
                    const denialReason = effectResponse?.denialReason as string | undefined;
                    const requestId = effectResponse?.requestId as string | undefined;
                    const effectType = typeof payload.effectType === 'string'
                        ? payload.effectType
                        : 'unknown';
                    const explicitTaskId = typeof payload.taskId === 'string' && payload.taskId.trim().length > 0
                        ? payload.taskId
                        : undefined;
                    const taskId = explicitTaskId ?? state.activeTaskId ?? 'global';
                    const existingSession = state.sessions.get(taskId);
                    if (existingSession || explicitTaskId) {
                        const effectEvent: TaskEvent = {
                            id: response.commandId,
                            taskId,
                            timestamp: response.timestamp,
                            sequence: (existingSession?.events.length ?? 0) + 1,
                            type: approved ? 'EFFECT_APPROVED' : 'EFFECT_DENIED',
                            payload: { response: effectResponse },
                        };
                        if (hasSeenEvent(taskId, effectEvent.id, existingSession)) {
                            return { pendingResponses };
                        }

                        const sessions = new Map(state.sessions);
                        const baseSession = existingSession ?? createEmptySession(taskId);
                        let updated = applyEvent(baseSession, effectEvent);
                        sessions.set(taskId, updated);

                        rememberEvent(taskId, effectEvent.id, updated);

                        if (!approved && denialReason === 'awaiting_confirmation') {
                            const waitingEvent: TaskEvent = {
                                id: `${response.commandId}-awaiting-confirmation`,
                                taskId,
                                timestamp: response.timestamp,
                                sequence: updated.events.length + 1,
                                type: 'TASK_USER_ACTION_REQUIRED',
                                payload: {
                                    actionId: requestId ?? response.commandId,
                                    title: 'Grant required access',
                                    kind: 'manual_step',
                                    description: `Awaiting permission to continue (${effectType}).`,
                                    riskTier: 'high',
                                    executionPolicy: 'hard_block',
                                    blocking: true,
                                    questions: [
                                        'Please approve or deny the pending permission prompt to continue.',
                                    ],
                                    instructions: [
                                        requestId
                                            ? `Permission request id: ${requestId}`
                                            : 'Permission request is pending.',
                                    ],
                                },
                            };
                            if (!hasSeenEvent(taskId, waitingEvent.id, updated)) {
                                updated = applyEvent(updated, waitingEvent);
                                sessions.set(taskId, updated);
                                rememberEvent(taskId, waitingEvent.id, updated);
                            }
                        }

                        persistStateSnapshot(sessions, state.activeTaskId, 180);
                        return { sessions, pendingResponses };
                    }
                }

                if (response.type === 'apply_patch_response') {
                    const payload = response.payload as Record<string, unknown>;
                    const success = payload.success as boolean;
                    const taskId = state.activeTaskId ?? 'global';
                    const session = state.sessions.get(taskId);
                    if (session) {
                        const event: TaskEvent = {
                            id: response.commandId,
                            taskId,
                            timestamp: response.timestamp,
                            sequence: session.events.length + 1,
                            type: success ? 'PATCH_APPLIED' : 'PATCH_REJECTED',
                            payload: {
                                patchId: payload.patchId,
                                filePath: payload.filePath,
                                reason: payload.error,
                            },
                        };
                        if (hasSeenEvent(taskId, event.id, session)) {
                            return { pendingResponses };
                        }
                        const sessions = new Map(state.sessions);
                        const updated = applyEvent(session, event);
                        sessions.set(taskId, updated);
                        rememberEvent(taskId, event.id, updated);
                        persistStateSnapshot(sessions, state.activeTaskId, 180);
                        return { sessions, pendingResponses };
                    }
                }

                return { pendingResponses };
            });
        },

        reset: () => {
            sessionEventIds.clear();
            set({
                sessions: new Map(),
                activeTaskId: null,
                pendingResponses: new Map(),
                auditEvents: [],
            });
            schedulePersist({ sessions: [], activeTaskId: null });
        },

        hydrate: (snapshot: SessionsSnapshot) => {
            sessionEventIds.clear();
            const map = new Map<string, TaskSession>();
            let droppedSessions = 0;
            let normalizedSessions = 0;
            for (const session of snapshot.sessions) {
                const taskId = normalizeTaskId(session?.taskId);
                if (!taskId) {
                    droppedSessions += 1;
                    console.warn('[TaskEventStore] Dropped persisted session without a valid taskId:', session);
                    continue;
                }

                const normalizedSession = { ...session, taskId };
                // Fix stale 'running' status from previous sessions
                // When app restarts, any 'running' task is actually interrupted/failed
                const cleanedSession = normalizedSession.status === 'running' && !normalizedSession.suspension
                    ? {
                        ...normalizedSession,
                        status: 'failed' as TaskStatus,
                        summary: 'Task interrupted by app restart. Resume the task to continue from the saved context.',
                        failure: normalizedSession.failure ?? createInterruptedFailureState(),
                    }
                    : normalizedSession;
                if (cleanedSession !== normalizedSession) {
                    normalizedSessions += 1;
                }
                map.set(cleanedSession.taskId, {
                    ...cleanedSession,
                    taskMode: inferTaskModeFromSession(cleanedSession),
                    title: deriveLatestUserFacingTitle(cleanedSession),
                });
                getOrCreateEventIdSet(cleanedSession.taskId, cleanedSession);
            }
            const snapshotActiveTaskId = normalizeTaskId(snapshot.activeTaskId) ?? null;
            let activeTaskId = snapshotActiveTaskId;
            if (activeTaskId && !map.has(activeTaskId)) {
                activeTaskId = null;
            }
            if (!activeTaskId && map.size > 0) {
                const sorted = [...map.values()].sort(
                    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                );
                activeTaskId = sorted[0]?.taskId ?? null;
            }
            set({
                sessions: map,
                activeTaskId,
            });

            const activeTaskWasAdjusted = activeTaskId !== snapshotActiveTaskId;
            if (droppedSessions > 0 || normalizedSessions > 0 || activeTaskWasAdjusted) {
                persistStateSnapshot(map, activeTaskId, 180);
            }
        },
    }))
);

// ============================================================================
// Selectors
// ============================================================================

export const useActiveSession = () => {
    return useTaskEventStore((state) => {
        if (!state.activeTaskId) return undefined;
        return state.sessions.get(state.activeTaskId);
    });
};

export const useSidecarConnected = () => {
    return useTaskEventStore((state) => state.sidecarConnected);
};

export async function hydrateSessions(): Promise<void> {
    if (!isTauri()) {
        console.debug('[TaskEventStore] Skipped hydration — not running inside Tauri');
        return;
    }
    try {
        const result = await invoke<{ payload?: SessionsSnapshot }>('load_sessions');
        const snapshot = result?.payload;
        if (snapshot) {
            useTaskEventStore.getState().hydrate({
                sessions: snapshot.sessions ?? [],
                activeTaskId: snapshot.activeTaskId ?? null,
            });
        }
    } catch (error) {
        console.warn('[TaskEventStore] Failed to load sessions:', error);
    }
}
