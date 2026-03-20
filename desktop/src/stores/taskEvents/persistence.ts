/**
 * Persistence Module
 *
 * Handles session persistence to backend
 */

import { invoke } from '@tauri-apps/api/core';
import type { TaskSession } from '../../types';
import { isTauri } from '../../lib/tauri';

export interface SessionsSnapshot {
    sessions: TaskSession[];
    activeTaskId: string | null;
}

export interface PersistScheduleOptions {
    delayMs?: number;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist sessions to backend
 */
async function persistSessions(snapshot: SessionsSnapshot): Promise<void> {
    if (!isTauri()) return;
    try {
        await invoke('save_sessions', { input: snapshot });
    } catch (error) {
        console.warn('[TaskEventStore] Failed to save sessions:', error);
    }
}

/**
 * Schedule persistence with debounce (1200ms)
 */
export function schedulePersist(snapshot: SessionsSnapshot, options: PersistScheduleOptions = {}): void {
    if (persistTimer) {
        clearTimeout(persistTimer);
    }

    const delayMs = options.delayMs ?? 1200;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        void persistSessions(snapshot);
    }, delayMs);
}

/**
 * Cancel scheduled persistence
 */
export function cancelScheduledPersist(): void {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
}
