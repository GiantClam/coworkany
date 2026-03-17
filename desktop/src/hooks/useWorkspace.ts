import { useEffect } from 'react';
import { useWorkspaceStore, Workspace } from '../stores/useWorkspaceStore';

export type { Workspace };

interface UseWorkspaceOptions {
    autoLoad?: boolean;
}

let initialWorkspaceAutoloadStarted = false;

export function useWorkspace(options: UseWorkspaceOptions = {}) {
    const { autoLoad = true } = options;
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace);
    const isLoading = useWorkspaceStore((state) => state.isLoading);
    const error = useWorkspaceStore((state) => state.error);
    const hasLoaded = useWorkspaceStore((state) => state.hasLoaded);
    const loadWorkspaces = useWorkspaceStore((state) => state.loadWorkspaces);
    const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
    const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace);
    const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
    const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
    const syncWorkspace = useWorkspaceStore((state) => state.syncWorkspace);

    // Auto-load once at store level to avoid N components issuing the same IPC call.
    useEffect(() => {
        if (!autoLoad || hasLoaded || isLoading || initialWorkspaceAutoloadStarted) {
            return;
        }
        initialWorkspaceAutoloadStarted = true;
        void loadWorkspaces()
            .then(() => {
                if (!useWorkspaceStore.getState().hasLoaded) {
                    initialWorkspaceAutoloadStarted = false;
                }
            })
            .catch(() => {
                initialWorkspaceAutoloadStarted = false;
            });
    }, [autoLoad, hasLoaded, isLoading, loadWorkspaces]);

    return {
        workspaces,
        activeWorkspace,
        isLoading,
        error,
        hasLoaded,
        loadWorkspaces,
        createWorkspace,
        updateWorkspace,
        deleteWorkspace,
        selectWorkspace,
        syncWorkspace,
    };
}
