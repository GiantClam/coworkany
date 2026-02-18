import { useEffect, useRef } from 'react';
import { useWorkspaceStore, Workspace } from '../stores/useWorkspaceStore';

export type { Workspace };

export function useWorkspace() {
    const store = useWorkspaceStore();

    const loadedRef = useRef(false);

    // Auto-load on mount if empty (singleton behavior)
    useEffect(() => {
        // Only load if empty and we haven't tried loading yet in this instance
        if (store.workspaces.length === 0 && !store.isLoading && !loadedRef.current) {
            console.log('[useWorkspace] Auto-loading workspaces...');
            loadedRef.current = true;
            store.loadWorkspaces();
        }
    }, [store.workspaces.length, store.isLoading, store.loadWorkspaces]);

    return store;
}
