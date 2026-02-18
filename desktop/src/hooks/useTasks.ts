import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface Task {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
    priority: 'critical' | 'high' | 'medium' | 'low';
    dueDate?: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
}

export interface GetTasksResult {
    success: boolean;
    tasks: Task[];
    count: number;
    error?: string;
}

export function useTasks(workspacePath: string | null) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshTasks = useCallback(async () => {
        if (!workspacePath) return;

        setIsLoading(true);
        setError(null);
        try {
            // Temporary Logic: Assuming 'get_tasks' will be implemented in Rust.
            // Rust returns GenericIpcResult { success: true, payload: { success: true, tasks: [], ... } }
            // So we need to access response.payload.tasks
            const response = await invoke<any>('get_tasks', {
                input: { workspacePath }  // Rust expects 'input' arg because we verify signature
            });

            // response matches GenericIpcResult
            if (response.success && response.payload && response.payload.success) {
                setTasks(response.payload.tasks);
            } else {
                setError(response.payload?.error || response.error || 'Unknown error');
            }
        } catch (e) {
            console.error('Failed to fetch tasks:', e);
            setError(String(e));
        } finally {
            setIsLoading(false);
        }
    }, [workspacePath]);

    // Initial fetch
    useEffect(() => {
        refreshTasks();
    }, [refreshTasks]);

    return {
        tasks,
        isLoading,
        error,
        refreshTasks
    };
}
