/**
 * Task Event Store
 *
 * Zustand store wrapping the TaskEventStore for React integration.
 * Receives events from Tauri and updates UI state reactively.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
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

interface TaskEventStoreState {
    sessions: Map<string, TaskSession>;
    activeTaskId: string | null;
    sidecarConnected: boolean;
    pendingResponses: Map<string, IpcResponse>;
    auditEvents: AuditEvent[];
    isHydratingSessions: boolean;

    addEvent: (event: TaskEvent) => void;
    addAuditEvent: (event: AuditEvent) => void;
    getSession: (taskId: string) => TaskSession | undefined;
    setActiveTask: (taskId: string | null) => void;
    setSidecarConnected: (connected: boolean) => void;
    handleIpcResponse: (response: IpcResponse) => void;
    reset: () => void;
    hydrate: (snapshot: SessionsSnapshot) => void;
}

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

interface SnapshotLimits {
    maxSessions: number;
    maxEventsPerSession: number;
    maxMessagesPerSession: number;
    maxToolCallsPerSession: number;
    maxEffectsPerSession: number;
    maxPatchesPerSession: number;
    maxPlanStepsPerSession: number;
}

const PERSIST_LIMITS: SnapshotLimits = {
    maxSessions: 25,
    maxEventsPerSession: 800,
    maxMessagesPerSession: 300,
    maxToolCallsPerSession: 250,
    maxEffectsPerSession: 200,
    maxPatchesPerSession: 200,
    maxPlanStepsPerSession: 200,
};

const HYDRATE_LIMITS: SnapshotLimits = {
    maxSessions: 12,
    maxEventsPerSession: 500,
    maxMessagesPerSession: 180,
    maxToolCallsPerSession: 150,
    maxEffectsPerSession: 120,
    maxPatchesPerSession: 120,
    maxPlanStepsPerSession: 120,
};

const HYDRATE_BATCH_SIZE = 2;
let hydrateBatchToken = 0;
let hydrateBatchTimeout: ReturnType<typeof setTimeout> | null = null;
let hydrateBatchIdle: number | null = null;

type IdleWindow = Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
};

function takeLast<T>(values: T[] | undefined, max: number): T[] {
    if (!Array.isArray(values) || values.length <= max) {
        return values ?? [];
    }
    return values.slice(values.length - max);
}

function takeFirst<T>(values: T[] | undefined, max: number): T[] {
    if (!Array.isArray(values) || values.length <= max) {
        return values ?? [];
    }
    return values.slice(0, max);
}

function trimSession(session: TaskSession, limits: SnapshotLimits): TaskSession {
    return {
        ...session,
        events: takeLast(session.events, limits.maxEventsPerSession),
        messages: takeLast(session.messages, limits.maxMessagesPerSession),
        toolCalls: takeLast(session.toolCalls, limits.maxToolCallsPerSession),
        effects: takeLast(session.effects, limits.maxEffectsPerSession),
        patches: takeLast(session.patches, limits.maxPatchesPerSession),
        planSteps: takeLast(session.planSteps, limits.maxPlanStepsPerSession),
    };
}

function sortByUpdatedAtDesc(a: TaskSession, b: TaskSession): number {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function trimSnapshot(snapshot: SessionsSnapshot, limits: SnapshotLimits): SessionsSnapshot {
    const sessions = takeFirst(
        [...snapshot.sessions].sort(sortByUpdatedAtDesc).map((session) => trimSession(session, limits)),
        limits.maxSessions
    );

    let activeTaskId = snapshot.activeTaskId;
    if (activeTaskId && !sessions.some((session) => session.taskId === activeTaskId)) {
        activeTaskId = sessions[0]?.taskId ?? null;
    }

    return {
        sessions,
        activeTaskId,
    };
}

function normalizeHydratedSession(session: TaskSession): TaskSession {
    if (session.status === 'running') {
        return {
            ...session,
            status: 'failed' as TaskStatus,
            summary: 'Task interrupted by app restart',
        };
    }
    return session;
}

function resolveHydratedActiveTaskId(snapshot: SessionsSnapshot): string | null {
    if (snapshot.activeTaskId) {
        return snapshot.activeTaskId;
    }
    if (snapshot.sessions.length === 0) {
        return null;
    }
    const sorted = [...snapshot.sessions].sort(sortByUpdatedAtDesc);
    return sorted[0]?.taskId ?? null;
}

function clearHydrationSchedulers() {
    hydrateBatchToken += 1;
    if (hydrateBatchTimeout) {
        clearTimeout(hydrateBatchTimeout);
        hydrateBatchTimeout = null;
    }
    if (
        hydrateBatchIdle !== null &&
        typeof window !== 'undefined' &&
        typeof (window as IdleWindow).cancelIdleCallback === 'function'
    ) {
        (window as IdleWindow).cancelIdleCallback?.(hydrateBatchIdle);
    }
    hydrateBatchIdle = null;
}

function scheduleHydrationStep(step: () => void) {
    const idleWindow = typeof window !== 'undefined' ? (window as IdleWindow) : undefined;
    if (idleWindow && typeof idleWindow.requestIdleCallback === 'function') {
        hydrateBatchIdle = idleWindow.requestIdleCallback(step, { timeout: 140 });
        return;
    }
    hydrateBatchTimeout = setTimeout(step, 16);
}

function applyEvent(session: TaskSession, event: TaskEvent): TaskSession {
    if (session.events.some((existing) => existing.id === event.id)) {
        return session;
    }

    let updated: TaskSession = {
        ...session,
        events: [...session.events, event],
        updatedAt: new Date().toISOString(),
    };

    updated = applyTaskEvent(updated, event);
    updated = applyChatEvent(updated, event);
    updated = applyToolEvent(updated, event);
    updated = applyEffectEvent(updated, event);
    updated = applyPatchEvent(updated, event);
    updated = applySkillRecommendationEvent(updated, event);

    if (event.type === 'TOKEN_USAGE') {
        const payload = event.payload as {
            inputTokens?: number;
            outputTokens?: number;
            modelId?: string;
        };
        const previousUsage = updated.tokenUsage ?? { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
        const inputTokens = previousUsage.inputTokens + (payload.inputTokens || 0);
        const outputTokens = previousUsage.outputTokens + (payload.outputTokens || 0);
        const cost = estimateTokenCost(payload.modelId, inputTokens, outputTokens);
        updated = {
            ...updated,
            tokenUsage: { inputTokens, outputTokens, estimatedCost: cost },
        };
    }

    return updated;
}

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
    const pricing = Object.entries(TOKEN_PRICING).find(([key]) => modelId.includes(key));
    if (!pricing) return 0;
    const [, rates] = pricing;
    return inputTokens * rates.input + outputTokens * rates.output;
}

export const useTaskEventStore = create<TaskEventStoreState>()(
    subscribeWithSelector((set, get) => ({
        sessions: new Map(),
        activeTaskId: null,
        sidecarConnected: false,
        pendingResponses: new Map(),
        auditEvents: [],
        isHydratingSessions: false,

        addEvent: (event: TaskEvent) => {
            set((state) => {
                const sessions = new Map(state.sessions);
                const existing = sessions.get(event.taskId) ?? createEmptySession(event.taskId);
                const updated = applyEvent(existing, event);
                sessions.set(event.taskId, updated);
                const snapshot = trimSnapshot({
                    sessions: Array.from(sessions.values()),
                    activeTaskId: state.activeTaskId,
                }, PERSIST_LIMITS);
                schedulePersist(snapshot);
                return { sessions };
            });
        },

        addAuditEvent: (event: AuditEvent) => {
            set((state) => ({
                auditEvents: [...state.auditEvents, event],
            }));
        },

        getSession: (taskId: string) => get().sessions.get(taskId),

        setActiveTask: (taskId: string | null) => {
            set((state) => {
                const snapshot = trimSnapshot({
                    sessions: Array.from(state.sessions.values()),
                    activeTaskId: taskId,
                }, PERSIST_LIMITS);
                schedulePersist(snapshot);
                return { activeTaskId: taskId };
            });
        },

        setSidecarConnected: (connected: boolean) => {
            set({ sidecarConnected: connected });
        },

        handleIpcResponse: (response: IpcResponse) => {
            set((state) => {
                const pendingResponses = new Map(state.pendingResponses);
                pendingResponses.set(response.commandId, response);

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
                        const sessions = new Map(state.sessions);
                        sessions.set(taskId, applyEvent(session, event));
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
                        const sessions = new Map(state.sessions);
                        sessions.set(taskId, applyEvent(session, event));
                        return { sessions, pendingResponses };
                    }
                }

                return { pendingResponses };
            });
        },

        reset: () => {
            clearHydrationSchedulers();
            set({
                sessions: new Map(),
                activeTaskId: null,
                pendingResponses: new Map(),
                auditEvents: [],
                isHydratingSessions: false,
            });
            schedulePersist({ sessions: [], activeTaskId: null });
        },

        hydrate: (snapshot: SessionsSnapshot) => {
            clearHydrationSchedulers();
            const map = new Map<string, TaskSession>();
            for (const rawSession of snapshot.sessions) {
                const session = normalizeHydratedSession(rawSession);
                map.set(session.taskId, session);
            }
            const activeTaskId = resolveHydratedActiveTaskId(snapshot);
            set({
                sessions: map,
                activeTaskId,
                isHydratingSessions: false,
            });
        },
    }))
);

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
    try {
        const result = await invoke<{ payload?: SessionsSnapshot }>('load_sessions');
        const snapshot = result?.payload;
        if (!snapshot) return;

        const trimmed = trimSnapshot({
            sessions: snapshot.sessions ?? [],
            activeTaskId: snapshot.activeTaskId ?? null,
        }, HYDRATE_LIMITS);

        clearHydrationSchedulers();

        const normalized = trimmed.sessions
            .sort(sortByUpdatedAtDesc)
            .map((session) => normalizeHydratedSession(session));

        if (normalized.length === 0) {
            useTaskEventStore.setState({
                sessions: new Map(),
                activeTaskId: null,
                isHydratingSessions: false,
            });
            return;
        }

        const activeTaskId = resolveHydratedActiveTaskId({
            sessions: normalized,
            activeTaskId: trimmed.activeTaskId,
        });

        const token = ++hydrateBatchToken;
        let cursor = 0;

        const firstSession = normalized[0];
        const firstMap = new Map<string, TaskSession>([[firstSession.taskId, firstSession]]);
        cursor = 1;
        useTaskEventStore.setState({
            sessions: firstMap,
            activeTaskId,
            isHydratingSessions: cursor < normalized.length,
        });

        const hydrateChunk = () => {
            if (token !== hydrateBatchToken) return;

            const chunk = normalized.slice(cursor, cursor + HYDRATE_BATCH_SIZE);
            cursor += chunk.length;

            useTaskEventStore.setState((state) => {
                const sessions = new Map(state.sessions);
                for (const session of chunk) {
                    sessions.set(session.taskId, session);
                }
                return {
                    sessions,
                    activeTaskId: state.activeTaskId ?? activeTaskId,
                    isHydratingSessions: cursor < normalized.length,
                };
            });

            if (cursor >= normalized.length) {
                hydrateBatchTimeout = null;
                hydrateBatchIdle = null;
                return;
            }
            scheduleHydrationStep(hydrateChunk);
        };

        if (cursor < normalized.length) {
            scheduleHydrationStep(hydrateChunk);
        }
    } catch (error) {
        console.warn('[TaskEventStore] Failed to load sessions:', error);
        useTaskEventStore.setState({ isHydratingSessions: false });
    }
}
