import * as fs from 'fs';
import * as path from 'path';
import type { IpcCommand, IpcResponse } from '../protocol';
import type { WorkspaceStore } from '../storage/workspaceStore';

export type WorkspaceCommandDeps = {
    workspaceStore: Pick<WorkspaceStore, 'list' | 'create' | 'update' | 'delete'>;
    getResolvedAppDataRoot: () => string;
};

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function respond(commandId: string, type: string, payload: Record<string, unknown>): IpcResponse {
    return {
        commandId,
        timestamp: new Date().toISOString(),
        type,
        payload,
    } as IpcResponse;
}

export async function handleWorkspaceCommand(
    command: IpcCommand,
    deps: WorkspaceCommandDeps
): Promise<IpcResponse | null> {
    switch (command.type) {
        case 'list_workspaces': {
            return respond(command.id, 'list_workspaces_response', {
                workspaces: cloneJson(deps.workspaceStore.list()),
            });
        }

        case 'create_workspace': {
            const { name, path: requestedPath } = command.payload as { name: string; path: string };

            try {
                let finalPath = requestedPath;
                if (!finalPath || finalPath === 'default') {
                    const appDataDir = deps.getResolvedAppDataRoot();
                    const workspacesDir = appDataDir
                        ? path.join(appDataDir, 'workspaces')
                        : path.join(process.cwd(), 'workspaces');
                    fs.mkdirSync(workspacesDir, { recursive: true });

                    const safeName = (name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'workspace');
                    finalPath = path.join(workspacesDir, safeName);

                    if (fs.existsSync(finalPath)) {
                        finalPath = path.join(workspacesDir, `${safeName}_${Date.now()}`);
                    }
                }

                const workspace = deps.workspaceStore.create(name, finalPath);
                return respond(command.id, 'create_workspace_response', {
                    workspace: cloneJson(workspace),
                    success: true,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return respond(command.id, 'create_workspace_response', {
                    success: false,
                    error: message,
                });
            }
        }

        case 'update_workspace': {
            const { id, updates } = command.payload as {
                id: string;
                updates: Record<string, unknown>;
            };
            const workspace = deps.workspaceStore.update(id, updates as any);
            return respond(command.id, 'update_workspace_response', {
                success: !!workspace,
                workspace: workspace ? cloneJson(workspace) : undefined,
            });
        }

        case 'delete_workspace': {
            const { id } = command.payload as { id: string };
            const success = deps.workspaceStore.delete(id);
            return respond(command.id, 'delete_workspace_response', { success });
        }

        default:
            return null;
    }
}
