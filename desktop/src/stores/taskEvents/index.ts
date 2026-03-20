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

function createInterruptedFailureState(): NonNullable<TaskSession['failure']> {
    return {
        error: 'Task interrupted by app restart',
        errorCode: 'INTERRUPTED',
        recoverable: true,
        suggestion: 'Resume the task to continue from the saved context.',
    };
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
        const existing = sessions.get(event.taskId) ?? createEmptySession(event.taskId);
        if (hasSeenEvent(event.taskId, event.id, existing)) {
            continue;
        }

        const updated = applyEvent(existing, event);
        sessions.set(event.taskId, updated);
        rememberEvent(event.taskId, event.id, updated);
        changed = true;

        if (shouldPersistEvent(event)) {
            const nextDelayMs = getPersistDelayMs(event);
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
                const now = new Date().toISOString();
                const promoted: TaskSession = {
                    ...(draft ?? createEmptySession(nextTaskId)),
                    taskId: nextTaskId,
                    isDraft: false,
                    status: seed?.status ?? 'running',
                    title: seed?.title ?? draft?.title,
                    workspacePath: seed?.workspacePath ?? draft?.workspacePath,
                    updatedAt: now,
                    createdAt: draft?.createdAt ?? now,
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
                    const taskId = state.activeTaskId ?? 'global';
                    const session = state.sessions.get(taskId);
                    if (session) {
                        const event: TaskEvent = {
                            id: response.commandId,
                            taskId,
                            timestamp: response.timestamp,
                            sequence: session.events.length + 1,
                            type: approved ? 'EFFECT_APPROVED' : 'EFFECT_DENIED',
                            payload: { response: effectResponse },
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
            for (const session of snapshot.sessions) {
                // Fix stale 'running' status from previous sessions
                // When app restarts, any 'running' task is actually interrupted/failed
                const cleanedSession = session.status === 'running' && !session.suspension
                    ? {
                        ...session,
                        status: 'failed' as TaskStatus,
                        summary: 'Task interrupted by app restart. Resume the task to continue from the saved context.',
                        failure: session.failure ?? createInterruptedFailureState(),
                    }
                    : session;
                map.set(cleanedSession.taskId, cleanedSession);
                getOrCreateEventIdSet(cleanedSession.taskId, cleanedSession);
            }
            let activeTaskId = snapshot.activeTaskId ?? null;
            if (!activeTaskId && snapshot.sessions.length > 0) {
                const sorted = [...snapshot.sessions].sort(
                    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                );
                activeTaskId = sorted[0]?.taskId ?? null;
            }
            set({
                sessions: map,
                activeTaskId,
            });
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
