import { create } from 'zustand';
import type { CanonicalStreamEvent } from '../../../sidecar/src/protocol';
import {
    applyCanonicalStreamEvent,
    createEmptyCanonicalTaskStreamState,
    type CanonicalTaskStreamState,
} from '../bridges/canonicalTaskStream';

interface CanonicalTaskStreamStoreState {
    sessions: Map<string, CanonicalTaskStreamState>;
    addEvent: (event: CanonicalStreamEvent) => void;
    addEvents: (events: CanonicalStreamEvent[]) => void;
    getSession: (taskId: string) => CanonicalTaskStreamState | undefined;
    reset: () => void;
}

export const useCanonicalTaskStreamStore = create<CanonicalTaskStreamStoreState>((set, get) => ({
    sessions: new Map(),

    addEvent: (event) => {
        set((state) => {
            const sessions = new Map(state.sessions);
            const taskId = event.payload.taskId;
            const current = sessions.get(taskId) ?? createEmptyCanonicalTaskStreamState(taskId);
            sessions.set(taskId, applyCanonicalStreamEvent(current, event));
            return { sessions };
        });
    },

    addEvents: (events) => {
        if (events.length === 0) {
            return;
        }

        set((state) => {
            const sessions = new Map(state.sessions);
            for (const event of events) {
                const taskId = event.payload.taskId;
                const current = sessions.get(taskId) ?? createEmptyCanonicalTaskStreamState(taskId);
                sessions.set(taskId, applyCanonicalStreamEvent(current, event));
            }
            return { sessions };
        });
    },

    getSession: (taskId) => get().sessions.get(taskId),

    reset: () => set({ sessions: new Map() }),
}));
