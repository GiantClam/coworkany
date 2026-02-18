import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/tauri';

export type ViewMode = 'launcher' | 'panel' | 'dashboard';

interface UIState {
    viewMode: ViewMode;
    isTaskWindowOpen: boolean;
    isDetailWindowOpen: boolean;

    switchToLauncher: () => Promise<void>;
    expandToPanel: () => Promise<void>;
    openDashboard: () => Promise<void>;
    openSettings: () => Promise<void>;

    toggleTaskWindow: (open?: boolean) => void;
    toggleDetailWindow: (open?: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
    viewMode: 'launcher',
    isTaskWindowOpen: true, // Default open per user request (History List)
    isDetailWindowOpen: false,

    switchToLauncher: async () => {
        try {
            if (isTauri()) await invoke('set_window_state', { state: 'launcher' });
            set({ viewMode: 'launcher' });
        } catch (error) {
            console.error('Failed to switch to launcher:', error);
        }
    },

    expandToPanel: async () => {
        try {
            if (isTauri()) await invoke('set_window_state', { state: 'panel' });
            set({ viewMode: 'panel' });
        } catch (error) {
            console.error('Failed to expand to panel:', error);
        }
    },

    openDashboard: async () => {
        try {
            if (isTauri()) await invoke('set_window_state', { state: 'dashboard' });
            set({ viewMode: 'dashboard' });
        } catch (error) {
            console.error('Failed to open dashboard:', error);
        }
    },

    openSettings: async () => {
        try {
            if (isTauri()) await invoke('set_window_state', { state: 'settings' });
        } catch (error) {
            console.error('Failed to open settings:', error);
        }
    },

    toggleTaskWindow: (open) => set((state) => ({
        isTaskWindowOpen: open ?? !state.isTaskWindowOpen
    })),

    toggleDetailWindow: (open) => set((state) => ({
        isDetailWindowOpen: open ?? !state.isDetailWindowOpen
    })),
}));
