/**
 * Tauri Events Hook
 *
 * Subscribes to Tauri events from the Rust backend and updates the store.
 * Should be called once at the app root level.
 */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTaskEventStore, type TaskEvent, type IpcResponse, type AuditEvent, hydrateSessions } from '../stores/useTaskEventStore';
import { isTauri } from '../lib/tauri';

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

        async function setupListeners() {
            if (!isTauri()) {
                console.debug('[Tauri] Not running inside Tauri WebView — event listeners skipped');
                return;
            }
            await hydrateSessions();
            // Listen for task events from sidecar
            unlistenTaskEvent = await listen<TaskEvent>('task-event', (event) => {
                console.log('[Tauri] Received task-event:', event.payload);
                addEvent(event.payload);
            });

            // Listen for IPC responses (effect decisions, patch results)
            unlistenIpcResponse = await listen<IpcResponse>('ipc-response', (event) => {
                console.log('[Tauri] Received ipc-response:', event.payload);
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

            console.log('[Tauri] Event listeners registered');
        }

        setupListeners();

        return () => {
            unlistenTaskEvent?.();
            unlistenIpcResponse?.();
            unlistenSidecarDisconnected?.();
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
