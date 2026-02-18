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
}

export interface SendTaskMessageResult {
    success: boolean;
    taskId: string;
    error?: string;
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
                if (!result.success && result.error) {
                    setError(result.error);
                }
                return result;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                setError(errorMessage);
                console.error('[useSendTaskMessage] Error:', e);
                return null;
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
