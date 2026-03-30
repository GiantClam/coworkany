import { WorkspaceStore } from './workspaceStore';
type WorkspaceStoreApi = Pick<WorkspaceStore, 'list' | 'create' | 'update' | 'delete'>;
export function createWorkspaceStoreFacade(getRoot: () => string): WorkspaceStoreApi {
    let cache: { root: string; store: WorkspaceStore } | null = null;
    const getStore = (): WorkspaceStore => {
        const root = getRoot().trim();
        if (!cache || cache.root !== root) {
            cache = {
                root,
                store: new WorkspaceStore(root),
            };
        }
        return cache.store;
    };
    return {
        list: () => getStore().list(),
        create: (name, workspacePath) => getStore().create(name, workspacePath),
        update: (id, updates) => getStore().update(id, updates),
        delete: (id) => getStore().delete(id),
    };
}
