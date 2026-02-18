/**
 * Clear Task History Hook
 *
 * Provides a hook for clearing a task's conversation history via Tauri IPC.
 */

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface ClearTaskHistoryInput {
    taskId: string;
}

export interface ClearTaskHistoryResult {
    success: boolean;
    taskId: string;
    error?: string;
}

export function useClearTaskHistory() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clearHistory = useCallback(
        async (input: ClearTaskHistoryInput): Promise<ClearTaskHistoryResult | null> => {
            setIsLoading(true);
            setError(null);
            try {
                const result = await invoke<ClearTaskHistoryResult>('clear_task_history', { input });
                if (!result.success && result.error) {
                    setError(result.error);
                }
                return result;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                setError(errorMessage);
                console.error('[useClearTaskHistory] Error:', e);
                return null;
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    return {
        clearHistory,
        isLoading,
        error,
    };
}
