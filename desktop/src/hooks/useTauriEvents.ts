/**
 * Tauri Events Hook
 *
 * Subscribes to Tauri events from the Rust backend and updates the store.
 * Should be called once at the app root level.
 */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTaskEventStore, type TaskEvent, type IpcResponse, type AuditEvent, hydrateSessions } from '../stores/useTaskEventStore';
import { isTauri } from '../lib/tauri';
import { toast } from '../components/Common/ToastProvider';

// ============================================================================
// Event Listener Hook
// ============================================================================

type MirrorToastLevel = 'success' | 'error' | 'warning' | 'info';

type BackgroundTaskMirrorInfo = {
    toastLevel: MirrorToastLevel;
    toastTitle: string;
    toastDescription: string;
    sessionMessage: string;
};

type RecoverableTaskHint = {
    taskId: string;
    workspacePath: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERABLE_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

function stripThinkingBlock(summary: string): string {
    return summary.replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ').trim();
}

function normalizeScheduledTaskSummary(summary: string): string {
    const withoutThinking = stripThinkingBlock(summary);
    return withoutThinking.replace(/\s+/g, ' ').trim();
}

function summarizeForToast(message: string, maxLength = 220): string {
    if (message.length <= maxLength) {
        return message;
    }
    return `${message.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function resolveMirrorTargetTaskId(event: TaskEvent): string | null {
    const state = useTaskEventStore.getState();
    const { activeTaskId, lastForegroundTaskId, sessions } = state;

    const directActiveTarget = activeTaskId &&
        activeTaskId !== event.taskId &&
        !activeTaskId.startsWith('scheduled_') &&
        sessions.has(activeTaskId)
        ? activeTaskId
        : null;
    if (directActiveTarget) {
        return directActiveTarget;
    }

    const rememberedForegroundTarget = lastForegroundTaskId &&
        lastForegroundTaskId !== event.taskId &&
        !lastForegroundTaskId.startsWith('scheduled_') &&
        sessions.has(lastForegroundTaskId)
        ? lastForegroundTaskId
        : null;
    if (rememberedForegroundTarget) {
        return rememberedForegroundTarget;
    }

    const fallback = [...sessions.values()]
        .filter((session) => session.taskId !== event.taskId && !session.taskId.startsWith('scheduled_'))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    return fallback?.taskId ?? null;
}

function mirrorMessageIntoActiveSession(event: TaskEvent, message: string, suffix: string): void {
    const state = useTaskEventStore.getState();
    const targetTaskId = resolveMirrorTargetTaskId(event);

    if (!targetTaskId) {
        return;
    }

    const activeSession = state.sessions.get(targetTaskId);

    state.addEvent({
        id: `${event.id}:${suffix}`,
        taskId: targetTaskId,
        timestamp: event.timestamp,
        sequence: (activeSession?.events.length ?? 0) + 1,
        type: 'CHAT_MESSAGE',
        payload: {
            role: 'system',
            content: message,
        },
    });
}

function mirrorReminderIntoActiveSession(event: TaskEvent, message: string): void {
    mirrorMessageIntoActiveSession(event, `[Reminder] ${message}`, 'reminder');
}

export function buildScheduledTaskMirrorInfo(event: TaskEvent): BackgroundTaskMirrorInfo | null {
    if (!event.taskId.startsWith('scheduled_')) {
        return null;
    }

    const payload = event.payload as Record<string, unknown>;

    if (
        event.type === 'TASK_FINISHED' &&
        typeof payload.summary === 'string' &&
        payload.summary.trim().length > 0 &&
        !payload.summary.startsWith('[Reminder] ')
    ) {
        const normalizedSummary = normalizeScheduledTaskSummary(payload.summary);
        const summary = normalizedSummary.length > 0 ? normalizedSummary : payload.summary.trim();
        return {
            toastLevel: 'success',
            toastTitle: 'Scheduled task completed',
            toastDescription: summarizeForToast(summary),
            sessionMessage: `[Scheduled Task Completed] ${summary}`,
        };
    }

    if (event.type === 'TASK_FAILED' && typeof payload.error === 'string' && payload.error.trim().length > 0) {
        const error = payload.error.trim();
        const suggestion = typeof payload.suggestion === 'string' && payload.suggestion.trim().length > 0
            ? `\n${payload.suggestion.trim()}`
            : '';
        return {
            toastLevel: 'error',
            toastTitle: 'Scheduled task failed',
            toastDescription: error,
            sessionMessage: `[Scheduled Task Failed] ${error}${suggestion}`,
        };
    }

    return null;
}

export function mirrorBackgroundTaskIntoActiveSession(event: TaskEvent, message: string): void {
    mirrorMessageIntoActiveSession(event, message, 'background-task');
}

function dispatchFrontendSkillsUpdated(): void {
    window.dispatchEvent(new Event('coworkany:skills-updated'));
}

function shouldRefreshSkillsFromToolResult(event: TaskEvent): boolean {
    if (event.type !== 'TOOL_RESULT') {
        return false;
    }

    const payload = event.payload as Record<string, unknown>;
    if (payload.name !== 'resolve_skill_request') {
        return false;
    }

    const rawResult = payload.result;
    if (typeof rawResult !== 'string' || rawResult.length === 0) {
        return false;
    }

    try {
        const parsed = JSON.parse(rawResult) as { resolution?: string; skill?: { name?: string } };
        return parsed.resolution === 'installed_from_market' && typeof parsed.skill?.name === 'string';
    } catch {
        return false;
    }
}

function isRecoverableSessionSummary(summary: string | undefined): boolean {
    if (!summary) {
        return false;
    }
    return /interrupted|MODEL_STREAM_ERROR|TASK_TERMINAL_TIMEOUT|Task stalled without producing a terminal result/i.test(summary);
}

function isFreshRecoverableSession(updatedAt: string | undefined): boolean {
    if (!updatedAt) {
        return false;
    }
    const timestamp = new Date(updatedAt).getTime();
    return Number.isFinite(timestamp) && (Date.now() - timestamp) <= RECOVERABLE_SESSION_MAX_AGE_MS;
}

export function buildRecoverableTaskHints(reason: 'startup' | 'reconnect'): RecoverableTaskHint[] {
    const state = useTaskEventStore.getState();
    const sessions = Array.from(state.sessions.values())
        .filter((session) => UUID_PATTERN.test(session.taskId))
        .filter((session) => typeof session.workspacePath === 'string' && session.workspacePath.length > 0)
        .filter((session) => isFreshRecoverableSession(session.updatedAt));

    if (reason === 'reconnect') {
        return sessions
            .filter((session) => session.status === 'running')
            .map((session) => ({
                taskId: session.taskId,
                workspacePath: session.workspacePath!,
            }));
    }

    const preferredTaskIds = [state.activeTaskId, state.lastForegroundTaskId]
        .filter((taskId): taskId is string => typeof taskId === 'string' && UUID_PATTERN.test(taskId));
    const preferredTaskSet = new Set(preferredTaskIds);
    const preferredTasks = sessions
        .filter((session) => preferredTaskSet.has(session.taskId))
        .filter((session) => session.status === 'running' || (session.status === 'failed' && isRecoverableSessionSummary(session.summary)));

    const fallback = preferredTasks.length > 0
        ? preferredTasks
        : sessions
            .filter((session) => session.status === 'failed' && isRecoverableSessionSummary(session.summary))
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 1);

    return fallback
        .map((session) => ({
            taskId: session.taskId,
            workspacePath: session.workspacePath!,
        }));
}

/**
 * Subscribe to Tauri task events.
 * Call this in your app root component.
 */
export function useTauriEvents() {
    const addEvent = useTaskEventStore((state) => state.addEvent);
    const setSidecarConnected = useTaskEventStore((state) => state.setSidecarConnected);
    const handleIpcResponse = useTaskEventStore((state) => state.handleIpcResponse);
    const addAuditEvent = useTaskEventStore((state) => state.addAuditEvent);

    useEffect(() => {
        let unlistenTaskEvent: UnlistenFn | undefined;
        let unlistenIpcResponse: UnlistenFn | undefined;
        let unlistenSidecarDisconnected: UnlistenFn | undefined;
        let unlistenSidecarReconnected: UnlistenFn | undefined;
        let unlistenAuditEvent: UnlistenFn | undefined;

        function resumeRecoverableTasks(reason: 'startup' | 'reconnect'): void {
            const tasks = buildRecoverableTaskHints(reason);
            const input = tasks.length > 0
                ? {
                    taskIds: tasks.map((task) => task.taskId),
                    tasks,
                }
                : undefined;
            void invoke('resume_recoverable_tasks', input ? { input } : undefined).catch((error) => {
                console.warn(`[Tauri] Failed to resume recoverable tasks after ${reason}:`, error);
            });
        }

        async function setupListeners() {
            if (!isTauri()) {
                console.debug('[Tauri] Not running inside Tauri WebView — event listeners skipped');
                return;
            }

            // Listen for task events from sidecar
            unlistenTaskEvent = await listen<TaskEvent>('task-event', (event) => {
                const payload = event.payload.payload as Record<string, unknown>;
                if (
                    event.payload.type === 'TASK_FINISHED' &&
                    typeof payload.summary === 'string' &&
                    payload.summary.startsWith('[Reminder] ')
                ) {
                    const reminderMessage = payload.summary.slice('[Reminder] '.length);
                    toast.info('Reminder', reminderMessage);
                    mirrorReminderIntoActiveSession(event.payload, reminderMessage);
                    console.info('[Reminder] Routed reminder to toast and active session mirror:', reminderMessage);
                }
                const scheduledMirror = buildScheduledTaskMirrorInfo(event.payload);
                if (scheduledMirror) {
                    toast[scheduledMirror.toastLevel](scheduledMirror.toastTitle, scheduledMirror.toastDescription);
                    mirrorBackgroundTaskIntoActiveSession(event.payload, scheduledMirror.sessionMessage);
                    console.info('[ScheduledTask] Routed scheduled task outcome to toast and active session mirror:', scheduledMirror.sessionMessage);
                }
                if (shouldRefreshSkillsFromToolResult(event.payload)) {
                    dispatchFrontendSkillsUpdated();
                }
                addEvent(event.payload);
            });

            // Listen for IPC responses (effect decisions, patch results)
            unlistenIpcResponse = await listen<IpcResponse>('ipc-response', (event) => {
                handleIpcResponse(event.payload);
            });

            // Listen for sidecar disconnection
            unlistenSidecarDisconnected = await listen('sidecar-disconnected', () => {
                console.warn('[Tauri] Sidecar disconnected');
                setSidecarConnected(false);
            });

            unlistenSidecarReconnected = await listen('sidecar-reconnected', () => {
                console.info('[Tauri] Sidecar reconnected');
                setSidecarConnected(true);
                resumeRecoverableTasks('reconnect');
            });

            // Listen for audit events from Rust
            unlistenAuditEvent = await listen<AuditEvent>('audit-event', (event) => {
                addAuditEvent(event.payload);
            });

              // Mark as connected (we assume connected on setup)
              setSidecarConnected(true);

              // Hydrate persisted sessions after listeners are ready to avoid startup stalls.
            void hydrateSessions().finally(() => {
                resumeRecoverableTasks('startup');
            });

              console.log('[Tauri] Event listeners registered');
          }

        setupListeners();

        return () => {
            unlistenTaskEvent?.();
            unlistenIpcResponse?.();
            unlistenSidecarDisconnected?.();
            unlistenSidecarReconnected?.();
            unlistenAuditEvent?.();
            console.log('[Tauri] Event listeners cleaned up');
        };
    }, [addEvent, setSidecarConnected, handleIpcResponse, addAuditEvent]);
}

// ============================================================================
// Status Hook
// ============================================================================

/**
 * Get the current sidecar connection status
 */
export function useSidecarStatus() {
    return useTaskEventStore((state) => state.sidecarConnected);
}
