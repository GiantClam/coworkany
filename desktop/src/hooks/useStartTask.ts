/**
 * Start Task Hook
 *
 * Provides a hook for starting new agent tasks via Tauri IPC.
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTaskEventStore } from '../stores/useTaskEventStore';
import { useWorkspaceStore, type Workspace } from '../stores/useWorkspaceStore';
import type { VoiceProviderMode } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface StartTaskInput {
    title: string;
    userQuery: string;
    displayText?: string;
    workspacePath: string;
    activeFile?: string;
    config?: StartTaskConfig;
}

export interface StartTaskConfig {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    executionPath?: 'direct' | 'workflow';
    enableChatSkills?: boolean;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    voiceProviderMode?: VoiceProviderMode;
}

export interface StartTaskResult {
    success: boolean;
    taskId: string;
    workspace?: Workspace;
    error?: string;
}

interface StartTaskLocalOptions {
    draftTaskId?: string;
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
    const ensureSession = useTaskEventStore((state) => state.ensureSession);
    const promoteDraftSession = useTaskEventStore((state) => state.promoteDraftSession);
    const syncWorkspace = useWorkspaceStore((state) => state.syncWorkspace);

    const markDraftStartFailure = useCallback((draftTaskId: string | undefined, input: StartTaskInput, errorMessage: string) => {
        if (!draftTaskId) {
            return;
        }

        ensureSession(draftTaskId, {
            title: input.title,
            workspacePath: input.workspacePath,
            status: 'failed',
            isDraft: true,
            failure: {
                error: errorMessage,
                errorCode: 'START_TASK_FAILED',
                recoverable: true,
                suggestion: 'Fix the issue and retry from this draft.',
            },
        }, true);
    }, [ensureSession]);

    const startTask = useCallback(
        async (input: StartTaskInput, options?: StartTaskLocalOptions): Promise<StartTaskResult | null> => {
            setIsLoading(true);
            setError(null);

            try {
                const result = await invoke<StartTaskResult>('start_task', { input });

                if (result.success) {
                    if (options?.draftTaskId) {
                        promoteDraftSession(options.draftTaskId, result.taskId, {
                            title: input.title,
                            workspacePath: input.workspacePath,
                            status: 'running',
                        });
                    } else {
                        ensureSession(result.taskId, {
                            title: input.title,
                            workspacePath: input.workspacePath,
                            status: 'running',
                            isDraft: false,
                        }, true);
                    }
                    if (result.workspace) {
                        syncWorkspace(result.workspace);
                    }
                } else if (result.error) {
                    setError(result.error);
                    markDraftStartFailure(options?.draftTaskId, input, result.error);
                }

                return result;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                setError(errorMessage);
                markDraftStartFailure(options?.draftTaskId, input, errorMessage);
                console.error('[useStartTask] Error:', e);
                return null;
            } finally {
                setIsLoading(false);
            }
        },
        [ensureSession, markDraftStartFailure, promoteDraftSession, syncWorkspace]
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
