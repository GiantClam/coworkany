import { createHash } from 'crypto';
import * as path from 'path';
import type { RequestContext } from '@mastra/core/request-context';
import {
    LocalFilesystem,
    LocalSandbox,
    WORKSPACE_TOOLS,
    Workspace,
    type WorkspaceToolsConfig,
} from '@mastra/core/workspace';

type WorkspaceCacheEntry = {
    workspace: Workspace;
    initialized: Promise<void>;
};

const workspaceCache = new Map<string, WorkspaceCacheEntry>();

function readFlag(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (typeof value !== 'string') {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no') {
        return false;
    }
    return fallback;
}

function readTimeoutMs(name: string, fallback: number): number {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    if (parsed < 1_000) {
        return 1_000;
    }
    if (parsed > 300_000) {
        return 300_000;
    }
    return parsed;
}

export function resolveWorkspacePathFromRequestContext(requestContext?: RequestContext<unknown>): string {
    const fromContext = requestContext?.get('workspacePath');
    if (typeof fromContext === 'string' && fromContext.trim().length > 0) {
        return path.resolve(fromContext);
    }
    return path.resolve(process.cwd());
}

function createWorkspaceToolsPolicy(): WorkspaceToolsConfig {
    const requireApproval = readFlag('COWORKANY_WORKSPACE_REQUIRE_APPROVAL', true);
    const requireReadBeforeWrite = readFlag('COWORKANY_WORKSPACE_REQUIRE_READ_BEFORE_WRITE', true);

    return {
        enabled: true,
        requireApproval: false,
        [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
            enabled: true,
            requireApproval,
            requireReadBeforeWrite,
        },
        [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
            enabled: true,
            requireApproval,
            requireReadBeforeWrite,
        },
        [WORKSPACE_TOOLS.FILESYSTEM.AST_EDIT]: {
            enabled: true,
            requireApproval,
            requireReadBeforeWrite,
        },
        [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
            enabled: true,
            requireApproval,
        },
        [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: {
            enabled: true,
            requireApproval,
        },
        [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
            enabled: true,
            requireApproval,
        },
    };
}

function buildWorkspaceId(workspacePath: string): string {
    const hash = createHash('sha1').update(workspacePath).digest('hex').slice(0, 12);
    return `coworkany-ws-${hash}`;
}

function createWorkspaceEntry(workspacePath: string): WorkspaceCacheEntry {
    const sandboxEnabled = readFlag('COWORKANY_ENABLE_WORKSPACE_SANDBOX', true);
    const timeout = readTimeoutMs('COWORKANY_WORKSPACE_SANDBOX_TIMEOUT_MS', 60_000);
    const workspace = new Workspace({
        id: buildWorkspaceId(workspacePath),
        name: `CoworkAny Workspace (${path.basename(workspacePath) || 'root'})`,
        filesystem: new LocalFilesystem({
            basePath: workspacePath,
            contained: true,
        }),
        sandbox: sandboxEnabled
            ? new LocalSandbox({
                workingDirectory: workspacePath,
                timeout,
            })
            : undefined,
        tools: createWorkspaceToolsPolicy(),
    });
    const initialized = workspace.init().catch((error) => {
        workspaceCache.delete(workspacePath);
        throw error;
    });
    return {
        workspace,
        initialized,
    };
}

export function getWorkspacePolicySnapshot(): {
    enabled: boolean;
    tools: WorkspaceToolsConfig;
} {
    return {
        enabled: readFlag('COWORKANY_ENABLE_WORKSPACE_TOOLS', true),
        tools: createWorkspaceToolsPolicy(),
    };
}

export async function getWorkspaceForRequestContext(
    requestContext?: RequestContext<unknown>,
): Promise<Workspace | undefined> {
    if (!readFlag('COWORKANY_ENABLE_WORKSPACE_TOOLS', true)) {
        return undefined;
    }
    const workspacePath = resolveWorkspacePathFromRequestContext(requestContext);
    let entry = workspaceCache.get(workspacePath);
    if (!entry) {
        entry = createWorkspaceEntry(workspacePath);
        workspaceCache.set(workspacePath, entry);
    }
    try {
        await entry.initialized;
        return entry.workspace;
    } catch (error) {
        console.warn('[Mastra workspace] init failed, workspace tools disabled for this run:', error);
        return undefined;
    }
}

export async function destroyWorkspaceRuntime(): Promise<void> {
    const entries = Array.from(workspaceCache.values());
    workspaceCache.clear();
    await Promise.allSettled(entries.map(async (entry) => {
        try {
            await entry.initialized;
        } catch {
            // ignore
        }
        await entry.workspace.destroy();
    }));
}
