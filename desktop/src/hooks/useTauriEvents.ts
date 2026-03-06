/**
 * Tauri Events Hook
 *
 * Subscribes to Tauri events from the Rust backend and updates the store.
 * Should be called once at the app root level.
 */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTaskEventStore, type TaskEvent, type IpcResponse, type AuditEvent, hydrateSessions } from '../stores/useTaskEventStore';
import { IS_STARTUP_BASELINE } from '../lib/startupProfile';

// ============================================================================
// Event Listener Hook
// ============================================================================

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
        let unlistenAuditEvent: UnlistenFn | undefined;
        let hydrationTimer: number | null = null;
        let hydrationIdleHandle: number | null = null;
        let setupRetryTimer: number | null = null;
        let setupAttempts = 0;

        const scheduleHydration = () => {
            const runHydration = () => {
                void hydrateSessions();
            };

            const requestIdle = (window as Window & {
                requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
            }).requestIdleCallback;

            if (typeof requestIdle === 'function' && !IS_STARTUP_BASELINE) {
                hydrationIdleHandle = requestIdle(() => runHydration(), { timeout: 3000 });
                return;
            }

            hydrationTimer = window.setTimeout(runHydration, IS_STARTUP_BASELINE ? 30 : 140);
        };

        async function setupListeners() {
            try {
                // Listen for task events from sidecar
                unlistenTaskEvent = await listen<TaskEvent>('task-event', (event) => {
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

                // Listen for audit events from Rust
                unlistenAuditEvent = await listen<AuditEvent>('audit-event', (event) => {
                    addAuditEvent(event.payload);
                });

                // Mark as connected (we assume connected on setup)
                setSidecarConnected(true);

                // Hydrate history after listeners are active and initial frame has painted.
                scheduleHydration();
            } catch (error) {
                setupAttempts += 1;
                const canRetry = setupAttempts < 12;
                console.debug('[Tauri] Event listeners unavailable in this runtime:', error);
                if (canRetry) {
                    setupRetryTimer = window.setTimeout(() => {
                        setupRetryTimer = null;
                        void setupListeners();
                    }, Math.min(120 * setupAttempts, 600));
                }
            }
        }

        void setupListeners();

        return () => {
            if (setupRetryTimer !== null) {
                window.clearTimeout(setupRetryTimer);
            }
            if (hydrationTimer !== null) {
                window.clearTimeout(hydrationTimer);
            }
            if (hydrationIdleHandle !== null && typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(hydrationIdleHandle);
            }
            unlistenTaskEvent?.();
            unlistenIpcResponse?.();
            unlistenSidecarDisconnected?.();
            unlistenAuditEvent?.();
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
