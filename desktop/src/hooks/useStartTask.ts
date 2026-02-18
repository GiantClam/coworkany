/**
 * Start Task Hook
 *
 * Provides a hook for starting new agent tasks via Tauri IPC.
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTaskEventStore } from '../stores/useTaskEventStore';

// ============================================================================
// Types
// ============================================================================

export interface StartTaskInput {
    title: string;
    userQuery: string;
    workspacePath: string;
    activeFile?: string;
    config?: StartTaskConfig;
}

export interface StartTaskConfig {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
}

export interface StartTaskResult {
    success: boolean;
    taskId: string;
    error?: string;
}

export interface CancelTaskInput {
    taskId: string;
    reason?: string;
}

export interface CancelTaskResult {
    success: boolean;
    taskId: string;
    error?: string;
}

// ============================================================================
// Start Task Hook
// ============================================================================

export function useStartTask() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);

    const startTask = useCallback(
        async (input: StartTaskInput): Promise<StartTaskResult | null> => {
            setIsLoading(true);
            setError(null);

            try {
                const result = await invoke<StartTaskResult>('start_task', { input });

                if (result.success) {
                    setActiveTask(result.taskId);
                } else if (result.error) {
                    setError(result.error);
                }

                return result;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                setError(errorMessage);
                console.error('[useStartTask] Error:', e);
                return null;
            } finally {
                setIsLoading(false);
            }
        },
        [setActiveTask]
    );

    return {
        startTask,
        isLoading,
        error,
    };
}

// ============================================================================
// Cancel Task Hook
// ============================================================================

export function useCancelTask() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cancelTask = useCallback(
        async (input: CancelTaskInput): Promise<CancelTaskResult | null> => {
            setIsLoading(true);
            setError(null);

            try {
                const result = await invoke<CancelTaskResult>('cancel_task', { input });

                if (!result.success && result.error) {
                    setError(result.error);
                }

                return result;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                setError(errorMessage);
                console.error('[useCancelTask] Error:', e);
                return null;
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    return {
        cancelTask,
        isLoading,
        error,
    };
}

// ============================================================================
// Sidecar Control Hooks
// ============================================================================

export function useSpawnSidecar() {
    const [isLoading, setIsLoading] = useState(false);

    const spawn = useCallback(async () => {
        setIsLoading(true);
        try {
            await invoke('spawn_sidecar');
        } catch (e) {
            console.error('[useSpawnSidecar] Error:', e);
            throw e;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { spawn, isLoading };
}

export function useShutdownSidecar() {
    const shutdown = useCallback(async () => {
        try {
            await invoke('shutdown_sidecar');
        } catch (e) {
            console.error('[useShutdownSidecar] Error:', e);
            throw e;
        }
    }, []);

    return { shutdown };
}
