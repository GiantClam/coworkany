import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/tauri';

// ============================================================================
// Types
// ============================================================================

export interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    lastUsedAt?: string;
    defaultSkills: string[];
    defaultToolpacks: string[];
}

interface IpcResult {
    success: boolean;
    payload: any;
}

interface WorkspaceState {
    workspaces: Workspace[];
    activeWorkspace: Workspace | null;
    isLoading: boolean;
    error: string | null;

    // Actions
    loadWorkspaces: () => Promise<Workspace[]>;
    createWorkspace: (name: string, path: string) => Promise<Workspace | null>;
    updateWorkspace: (id: string, updates: { name?: string; path?: string }) => Promise<boolean>;
    deleteWorkspace: (id: string) => Promise<boolean>;
    selectWorkspace: (workspace: Workspace | null) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
    workspaces: [],
    activeWorkspace: null,
    isLoading: false,
    error: null,

    loadWorkspaces: async () => {
        if (!isTauri()) {
            console.debug('[loadWorkspaces] Skipped — not running inside Tauri');
            return [];
        }
        set({ isLoading: true, error: null });
        try {
            const result = await invoke<IpcResult>('list_workspaces');
            if (result.success && result.payload) {
                const data = typeof result.payload === 'string'
                    ? JSON.parse(result.payload)
                    : result.payload;

                // PAYLOAD FIX: Access data.payload.workspaces
                const list = data.payload?.workspaces || [];
                set({ workspaces: list });

                // Restore active workspace if explicit, or default to first
                const currentActive = get().activeWorkspace;
                if (!currentActive && list.length > 0) {
                    // Check localStorage
                    const savedId = localStorage.getItem('activeWorkspaceId');
                    if (savedId) {
                        const saved = list.find((w: Workspace) => w.id === savedId);
                        if (saved) set({ activeWorkspace: saved });
                        else set({ activeWorkspace: list[0] });
                    } else {
                        set({ activeWorkspace: list[0] });
                    }
                } else if (currentActive) {
                    // Update current active object with fresh data
                    const fresh = list.find((w: Workspace) => w.id === currentActive.id);
                    if (fresh) set({ activeWorkspace: fresh });
                }

                return list;
            }
            return [];
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            set({ error: message });
            console.error('[loadWorkspaces] Error:', err);
            return [];
        } finally {
            set({ isLoading: false });
        }
    },

    createWorkspace: async (name: string, path: string) => {
        if (!isTauri()) return null;
        set({ isLoading: true, error: null });
        try {
            const result = await invoke<IpcResult>('create_workspace', {
                input: { name, path },
            });
            if (result.success && result.payload) {
                const data = typeof result.payload === 'string'
                    ? JSON.parse(result.payload)
                    : result.payload;

                // PAYLOAD FIX: Access data.payload.workspace
                const newWorkspace = data.payload?.workspace;
                if (newWorkspace) {
                    set((state) => ({
                        workspaces: [...state.workspaces, newWorkspace],
                        activeWorkspace: newWorkspace, // Auto-select new workspace
                    }));

                    // Save to localStorage
                    localStorage.setItem('activeWorkspaceId', newWorkspace.id);

                    return newWorkspace;
                }
                console.error('[createWorkspace] Invalid payload, missing workspace data:', data);
                return null;
            }
            return null;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            set({ error: message });
            console.error('[createWorkspace] Error:', err);
            return null;
        } finally {
            set({ isLoading: false });
        }
    },

    updateWorkspace: async (id: string, updates: { name?: string; path?: string }) => {
        if (!isTauri()) return false;
        set({ isLoading: true, error: null });
        try {
            const result = await invoke<IpcResult>('update_workspace', {
                input: { id, updates },
            });

            // PAYLOAD FIX: Check logic
            if (result.success && result.payload) {
                const data = typeof result.payload === 'string'
                    ? JSON.parse(result.payload)
                    : result.payload;

                if (data.payload?.success) {
                    set((state) => {
                        const updatedWorkspaces = state.workspaces.map((w) =>
                            w.id === id ? { ...w, ...updates } : w
                        );
                        const updatedActive = state.activeWorkspace?.id === id
                            ? { ...state.activeWorkspace, ...updates }
                            : state.activeWorkspace;
                        return { workspaces: updatedWorkspaces, activeWorkspace: updatedActive };
                    });
                    return true;
                }
            }
            return false;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            set({ error: message });
            console.error('[updateWorkspace] Error:', err);
            return false;
        } finally {
            set({ isLoading: false });
        }
    },

    deleteWorkspace: async (id: string) => {
        if (!isTauri()) return false;
        set({ isLoading: true, error: null });
        try {
            const result = await invoke<IpcResult>('delete_workspace', { input: { id } });

            // PAYLOAD FIX: Check logic
            if (result.success && result.payload) {
                const data = typeof result.payload === 'string'
                    ? JSON.parse(result.payload)
                    : result.payload;

                if (data.payload?.success) {
                    set((state) => {
                        const newWorkspaces = state.workspaces.filter((w) => w.id !== id);
                        let newActive = state.activeWorkspace;
                        if (newActive?.id === id) {
                            newActive = newWorkspaces.length > 0 ? newWorkspaces[0] : null;
                            if (newActive) {
                                localStorage.setItem('activeWorkspaceId', newActive.id);
                            } else {
                                localStorage.removeItem('activeWorkspaceId');
                            }
                        }
                        return { workspaces: newWorkspaces, activeWorkspace: newActive };
                    });
                    return true;
                }
            }
            return false;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            set({ error: message });
            console.error('[deleteWorkspace] Error:', err);
            return false;
        } finally {
            set({ isLoading: false });
        }
    },

    selectWorkspace: (workspace: Workspace | null) => {
        set({ activeWorkspace: workspace });
        if (workspace) {
            localStorage.setItem('activeWorkspaceId', workspace.id);
        } else {
            localStorage.removeItem('activeWorkspaceId');
        }
    }
}));
