/**
 * Send Task Message Hook
 *
 * Provides a hook for sending a message to an existing task via Tauri IPC.
 */

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { StartTaskConfig } from './useStartTask';

export interface SendTaskMessageInput {
    taskId: string;
    content: string;
    config?: StartTaskConfig;
    bypassDedup?: boolean;
}

export interface SendTaskMessageResult {
    success: boolean;
    taskId: string;
    error?: string;
}

export interface ResumeInterruptedTaskInput {
    taskId: string;
    config?: StartTaskConfig;
}

export interface ResumeInterruptedTaskResult {
    success: boolean;
    taskId: string;
    error?: string;
}

function isQueuedTimeoutError(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    const normalized = errorMessage.toLowerCase();
    return normalized.includes('response timeout:')
        || normalized.includes('timed out waiting on channel');
}

export function useSendTaskMessage() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sendMessage = useCallback(
        async (input: SendTaskMessageInput): Promise<SendTaskMessageResult | null> => {
            setIsLoading(true);
            setError(null);
            try {
                const result = await invoke<SendTaskMessageResult>('send_task_message', { input });
                if (!result.success && isQueuedTimeoutError(result.error)) {
                    console.warn('[useSendTaskMessage] Timeout acknowledged as queued delivery:', result.error);
                    return {
                        success: true,
                        taskId: result.taskId || input.taskId,
                        error: undefined,
                    };
                }
                if (!result.success && result.error) {
                    setError(result.error);
                }
                return result;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                if (isQueuedTimeoutError(errorMessage)) {
                    console.warn('[useSendTaskMessage] Timeout exception treated as queued delivery:', errorMessage);
                    return {
                        success: true,
                        taskId: input.taskId,
                        error: undefined,
                    };
                }
                setError(errorMessage);
                console.error('[useSendTaskMessage] Error:', e);
                return {
                    success: false,
                    taskId: input.taskId,
                    error: errorMessage,
                };
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    return {
        sendMessage,
        isLoading,
        error,
    };
}

export function useResumeInterruptedTask() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const resumeInterruptedTask = useCallback(
        async (input: ResumeInterruptedTaskInput): Promise<ResumeInterruptedTaskResult | null> => {
            setIsLoading(true);
            setError(null);
            try {
                const result = await invoke<ResumeInterruptedTaskResult>('resume_interrupted_task', { input });
                if (!result.success && result.error) {
                    setError(result.error);
                }
                return result;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                setError(errorMessage);
                console.error('[useResumeInterruptedTask] Error:', e);
                return null;
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    return {
        resumeInterruptedTask,
        isLoading,
        error,
    };
}
