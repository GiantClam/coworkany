/**
 * Tauri Events Hook
 *
 * Subscribes to Tauri events from the Rust backend and updates the store.
 * Should be called once at the app root level.
 */

import { useCallback, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTaskEventStore, type TaskEvent, type IpcResponse, type AuditEvent, hydrateSessions } from '../stores/useTaskEventStore';
import { useCanonicalTaskStreamStore } from '../stores/useCanonicalTaskStreamStore';
import { isTauri } from '../lib/tauri';
import {
    useVoicePlaybackStore,
    getDefaultVoicePlaybackState,
    type VoicePlaybackState,
} from '../stores/useVoicePlaybackStore';
import type { CanonicalStreamEvent } from '../../../sidecar/src/protocol';

// ============================================================================
// Event Listener Hook
// ============================================================================

/**
 * Subscribe to Tauri task events.
 * Call this in your app root component.
 */
export function useTauriEvents() {
    const addEvents = useTaskEventStore((state) => state.addEvents);
    const addCanonicalEvents = useCanonicalTaskStreamStore((state) => state.addEvents);
    const clearCanonicalSession = useCanonicalTaskStreamStore((state) => state.clearSession);
    const setSidecarConnected = useTaskEventStore((state) => state.setSidecarConnected);
    const handleIpcResponse = useTaskEventStore((state) => state.handleIpcResponse);
    const addAuditEvent = useTaskEventStore((state) => state.addAuditEvent);
    const setVoicePlaybackState = useVoicePlaybackStore((state) => state.setState);
    const pendingTaskEventsRef = useRef<TaskEvent[]>([]);
    const flushFrameRef = useRef<number | null>(null);

    const flushTaskEvents = useCallback(() => {
        flushFrameRef.current = null;
        if (pendingTaskEventsRef.current.length === 0) {
            return;
        }

        const events = pendingTaskEventsRef.current;
        pendingTaskEventsRef.current = [];
        addEvents(events);
    }, [addEvents]);

    const enqueueTaskEvent = useCallback((event: TaskEvent) => {
        if (event.type === 'TASK_HISTORY_CLEARED') {
            clearCanonicalSession(event.taskId);
        }
        pendingTaskEventsRef.current.push(event);
        if (flushFrameRef.current !== null) {
            return;
        }

        flushFrameRef.current = window.requestAnimationFrame(() => {
            flushTaskEvents();
        });
    }, [clearCanonicalSession, flushTaskEvents]);

    useEffect(() => {
        let unlistenTaskEvent: UnlistenFn | undefined;
        let unlistenCanonicalStreamEvent: UnlistenFn | undefined;
        let unlistenIpcResponse: UnlistenFn | undefined;
        let unlistenSidecarDisconnected: UnlistenFn | undefined;
        let unlistenSidecarReconnected: UnlistenFn | undefined;
        let unlistenAuditEvent: UnlistenFn | undefined;
        let unlistenVoiceState: UnlistenFn | undefined;

        async function syncRuntimeState() {
            void hydrateSessions();
            void invoke<{ success?: boolean; payload?: { success?: boolean; state?: VoicePlaybackState } }>('get_voice_state')
                .then((result) => {
                    const nextState = result?.payload?.state;
                    setVoicePlaybackState(nextState ?? getDefaultVoicePlaybackState());
                })
                .catch(() => {
                    setVoicePlaybackState(getDefaultVoicePlaybackState());
                });
        }

        async function setupListeners() {
            if (!isTauri()) {
                return;
            }

            // Listen for task events from sidecar
            unlistenTaskEvent = await listen<TaskEvent>('task-event', (event) => {
                enqueueTaskEvent(event.payload);
            });

            unlistenCanonicalStreamEvent = await listen<CanonicalStreamEvent>('canonical-stream-event', (event) => {
                addCanonicalEvents([event.payload]);
            });

            // Listen for IPC responses (effect decisions, patch results)
            unlistenIpcResponse = await listen<IpcResponse>('ipc-response', (event) => {
                handleIpcResponse(event.payload);
            });

            // Listen for sidecar disconnection
            unlistenSidecarDisconnected = await listen('sidecar-disconnected', () => {
                const { sessions } = useTaskEventStore.getState();
                const now = new Date().toISOString();
                const failureEvents = [...sessions.values()]
                    .filter((session) => session.status === 'running' && !session.suspension)
                    .map((session) => ({
                        id: `sidecar-disconnected-${session.taskId}-${crypto.randomUUID()}`,
                        taskId: session.taskId,
                        sequence: (session.events.at(-1)?.sequence ?? 0) + 1,
                        type: 'TASK_FAILED' as const,
                        timestamp: now,
                        payload: {
                            error: 'Connection to the sidecar was lost before the task completed.',
                            errorCode: 'SIDECAR_DISCONNECTED',
                            recoverable: true,
                            suggestion: 'Retry after the sidecar reconnects.',
                        },
                    }));
                if (failureEvents.length > 0) {
                    addEvents(failureEvents);
                }
                setSidecarConnected(false);
            });

            unlistenSidecarReconnected = await listen('sidecar-reconnected', () => {
                setSidecarConnected(true);
                void syncRuntimeState();
            });

            // Listen for audit events from Rust
            unlistenAuditEvent = await listen<AuditEvent>('audit-event', (event) => {
                addAuditEvent(event.payload);
            });

            unlistenVoiceState = await listen<VoicePlaybackState>('voice-state', (event) => {
                setVoicePlaybackState(event.payload ?? getDefaultVoicePlaybackState());
            });

            // Mark as connected (we assume connected on setup)
            setSidecarConnected(true);

            // Hydrate persisted sessions after listeners are ready to avoid startup stalls.
            void syncRuntimeState();
        }

        setupListeners();

        return () => {
            unlistenTaskEvent?.();
            unlistenCanonicalStreamEvent?.();
            unlistenIpcResponse?.();
            unlistenSidecarDisconnected?.();
            unlistenSidecarReconnected?.();
            unlistenAuditEvent?.();
            unlistenVoiceState?.();
            if (flushFrameRef.current !== null) {
                window.cancelAnimationFrame(flushFrameRef.current);
                flushFrameRef.current = null;
            }
            flushTaskEvents();
        };
    }, [enqueueTaskEvent, flushTaskEvents, setSidecarConnected, handleIpcResponse, addAuditEvent, addCanonicalEvents, setVoicePlaybackState]);
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
