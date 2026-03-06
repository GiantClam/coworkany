import { useEffect, useRef } from 'react';
import { useWorkspaceStore, Workspace } from '../stores/useWorkspaceStore';

export type { Workspace };

interface UseWorkspaceOptions {
    autoLoad?: boolean;
}

export function useWorkspace(options: UseWorkspaceOptions = {}) {
    const { autoLoad = true } = options;
    const store = useWorkspaceStore();

    const loadedRef = useRef(false);

    // Auto-load on mount if empty (singleton behavior)
    useEffect(() => {
        if (!autoLoad) {
            return;
        }
        // Only load if empty and we haven't tried loading yet in this instance
        if (store.workspaces.length === 0 && !store.isLoading && !loadedRef.current) {
            console.log('[useWorkspace] Auto-loading workspaces...');
            loadedRef.current = true;
            void store.loadWorkspaces().then((items) => {
                if (items.length === 0 && useWorkspaceStore.getState().error) {
                    loadedRef.current = false;
                }
            });
        }
    }, [autoLoad, store.workspaces.length, store.isLoading, store.loadWorkspaces]);

    return store;
}
