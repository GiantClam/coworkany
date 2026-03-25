import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { deleteConfig, saveConfig } from '../lib/configStore';

// ============================================================================
// Types
// ============================================================================

export interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    lastUsedAt?: string;
    autoNamed?: boolean;
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
    hasLoaded: boolean;

    loadWorkspaces: (force?: boolean) => Promise<Workspace[]>;
    createWorkspace: (name?: string, path?: string) => Promise<Workspace | null>;
    updateWorkspace: (id: string, updates: { name?: string; path?: string; autoNamed?: boolean }) => Promise<boolean>;
    deleteWorkspace: (id: string) => Promise<boolean>;
    selectWorkspace: (workspace: Workspace | null) => void;
    syncWorkspace: (workspace: Workspace) => void;
}

let workspaceLoadPromise: Promise<Workspace[]> | null = null;

function toPayload(result: IpcResult): any {
    return typeof result.payload === 'string'
        ? JSON.parse(result.payload)
        : result.payload;
}

function unwrapPayload(payload: any): any {
    let cursor = payload;
    for (let i = 0; i < 3; i += 1) {
        if (cursor && typeof cursor === 'object' && 'payload' in cursor) {
            cursor = (cursor as { payload: unknown }).payload;
            continue;
        }
        break;
    }
    return cursor;
}

function extractWorkspaces(payload: any): Workspace[] {
    const unwrapped = unwrapPayload(payload);
    const candidates = [
        payload?.workspaces,
        payload?.payload?.workspaces,
        unwrapped?.workspaces,
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate as Workspace[];
        }
    }

    return [];
}

function extractWorkspace(payload: any): Workspace | undefined {
    const unwrapped = unwrapPayload(payload);
    const candidates = [
        payload?.workspace,
        payload?.payload?.workspace,
        unwrapped?.workspace,
        unwrapped,
    ];

    for (const candidate of candidates) {
        if (
            candidate &&
            typeof candidate === 'object' &&
            typeof candidate.id === 'string' &&
            typeof candidate.path === 'string'
        ) {
            return candidate as Workspace;
        }
    }

    return undefined;
}

function extractSuccess(payload: any): boolean {
    const unwrapped = unwrapPayload(payload);
    const values = [
        payload?.success,
        payload?.payload?.success,
        unwrapped?.success,
    ];

    return values.some((value) => value === true);
}

function resolveActiveWorkspace(
    list: Workspace[],
    currentActive: Workspace | null,
): Workspace | null {
    if (currentActive) {
        const fresh = list.find((workspace) => workspace.id === currentActive.id);
        if (fresh) return fresh;
    }
    return null;
}

// ============================================================================
// Store
// ============================================================================

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
    workspaces: [],
    activeWorkspace: null,
    isLoading: false,
    error: null,
    hasLoaded: false,

    loadWorkspaces: async (force = false) => {
        const state = get();
        if (!force && state.hasLoaded) {
            return state.workspaces;
        }

        if (workspaceLoadPromise) {
            return workspaceLoadPromise;
        }

        workspaceLoadPromise = (async () => {
            set({ isLoading: true, error: null });

            try {
                const result = await invoke<IpcResult>('list_workspaces');
                if (!result.success) {
                    set({ isLoading: false });
                    return get().workspaces;
                }

                const data = result.payload ? toPayload(result) : {};
                const list = extractWorkspaces(data);
                const activeWorkspace = resolveActiveWorkspace(list, get().activeWorkspace);

                if (activeWorkspace) {
                    await saveConfig('activeWorkspaceId', activeWorkspace.id);
                } else {
                    await deleteConfig('activeWorkspaceId');
                }

                set({
                    activeWorkspace,
                    workspaces: list,
                    isLoading: false,
                    error: null,
                    hasLoaded: true,
                });
                return list;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                set({ error: message, isLoading: false });
                console.error('[loadWorkspaces] Error:', err);
                return [];
            } finally {
                workspaceLoadPromise = null;
            }
        })();

        return workspaceLoadPromise;
    },

    createWorkspace: async (name = '', path = '') => {
        set({ isLoading: true, error: null });
        try {
            const result = await invoke<IpcResult>('create_workspace', {
                input: { name, path },
            });
            if (result.success && result.payload) {
                const data = toPayload(result);
                const newWorkspace = extractWorkspace(data);
                if (newWorkspace) {
                    set((state) => ({
                        workspaces: [...state.workspaces, newWorkspace],
                        activeWorkspace: newWorkspace,
                        hasLoaded: true,
                    }));
                    await saveConfig('activeWorkspaceId', newWorkspace.id);
                    return newWorkspace;
                }
                console.error('[createWorkspace] Invalid payload, missing workspace data:', data);
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

    updateWorkspace: async (id: string, updates: { name?: string; path?: string; autoNamed?: boolean }) => {
        set({ isLoading: true, error: null });
        try {
            const result = await invoke<IpcResult>('update_workspace', {
                input: { id, updates },
            });
            if (result.success && result.payload) {
                const data = toPayload(result);
                if (extractSuccess(data)) {
                    set((state) => {
                        const updatedWorkspaces = state.workspaces.map((workspace) =>
                            workspace.id === id ? { ...workspace, ...updates } : workspace
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
        set({ isLoading: true, error: null });
        try {
            const result = await invoke<IpcResult>('delete_workspace', { input: { id } });
            if (result.success && result.payload) {
                const data = toPayload(result);
                if (extractSuccess(data)) {
                    set((state) => {
                        const newWorkspaces = state.workspaces.filter((workspace) => workspace.id !== id);
                        let newActiveWorkspace = state.activeWorkspace;
                        if (newActiveWorkspace?.id === id) {
                            newActiveWorkspace = null;
                            void deleteConfig('activeWorkspaceId');
                        }
                        return {
                            workspaces: newWorkspaces,
                            activeWorkspace: newActiveWorkspace,
                            hasLoaded: true,
                        };
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
        set({ activeWorkspace: workspace, hasLoaded: true });
        if (workspace) {
            void saveConfig('activeWorkspaceId', workspace.id);
        } else {
            void deleteConfig('activeWorkspaceId');
        }
    },

    syncWorkspace: (workspace: Workspace) => {
        set((state) => {
            const existingIndex = state.workspaces.findIndex((item) => item.id === workspace.id);
            const merged = existingIndex >= 0
                ? { ...state.workspaces[existingIndex], ...workspace }
                : workspace;
            const workspaces = existingIndex >= 0
                ? state.workspaces.map((item) => (item.id === workspace.id ? merged : item))
                : [...state.workspaces, merged];

            const activeWorkspace = state.activeWorkspace?.id === workspace.id
                ? { ...state.activeWorkspace, ...workspace }
                : state.activeWorkspace;

            return { workspaces, activeWorkspace, hasLoaded: true };
        });
    },
}));
