import { createHash } from 'crypto';
import * as fs from 'fs';
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

function ensureSymlinkAlias(aliasPath: string, target: string): void {
    try {
        const stat = fs.lstatSync(aliasPath);
        if (stat.isSymbolicLink()) {
            return;
        }
        return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            return;
        }
    }
    try {
        fs.symlinkSync(target, aliasPath, 'dir');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            console.warn('[Mastra workspace] failed to create path alias:', aliasPath, error);
        }
    }
}

export function ensureWorkspaceCommandPathAliases(workspacePath: string): void {
    const enableCommandPathAliasCompatibility = readFlag(
        'COWORKANY_WORKSPACE_ENABLE_COMMAND_PATH_ALIAS',
        true,
    );
    if (!enableCommandPathAliasCompatibility) {
        return;
    }
    const workspaceAliasPath = path.join(workspacePath, 'workspace');
    ensureSymlinkAlias(workspaceAliasPath, '.');

    const environmentPath = path.join(workspacePath, 'environment');
    try {
        fs.mkdirSync(environmentPath, { recursive: true });
    } catch (error) {
        console.warn('[Mastra workspace] failed to ensure environment alias directory:', environmentPath, error);
        return;
    }
    const environmentDataAliasPath = path.join(environmentPath, 'data');
    ensureSymlinkAlias(environmentDataAliasPath, '..');
}

function stripPrefixPath(absolutePath: string, absolutePrefix: string): string | null {
    const relativePath = path.relative(absolutePrefix, absolutePath);
    if (
        relativePath === ''
        || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    ) {
        return relativePath;
    }
    return null;
}

export function normalizeWorkspaceToolPath(inputPath: string, workspacePath: string): string {
    if (typeof inputPath !== 'string') {
        return inputPath;
    }

    const trimmed = inputPath.trim();
    if (trimmed.length === 0) {
        return inputPath;
    }

    const normalizedForMatch = trimmed.replace(/\\/g, '/');
    const stripRelativePrefix = (value: string): string => value.replace(/^\.\/+/, '');
    const normalizedRelative = stripRelativePrefix(normalizedForMatch);

    if (/^workspace(?:\/|$)/iu.test(normalizedRelative)) {
        const withoutPrefix = normalizedRelative.replace(/^workspace\/?/iu, '');
        return withoutPrefix.length > 0 ? withoutPrefix : '.';
    }

    if (/^environment\/data(?:\/|$)/iu.test(normalizedRelative)) {
        const withoutPrefix = normalizedRelative.replace(/^environment\/data\/?/iu, '');
        return withoutPrefix.length > 0 ? withoutPrefix : '.';
    }

    if (!path.isAbsolute(trimmed)) {
        return inputPath;
    }

    const normalizedWorkspacePath = path.resolve(workspacePath);
    const normalizedAbsolutePath = path.resolve(trimmed);
    const workspaceAliasPath = path.join(normalizedWorkspacePath, 'workspace');
    const environmentDataAliasPath = path.join(normalizedWorkspacePath, 'environment', 'data');

    const workspaceRelative = stripPrefixPath(normalizedAbsolutePath, normalizedWorkspacePath);
    if (workspaceRelative !== null) {
        return workspaceRelative.length > 0
            ? workspaceRelative.replace(/\\/g, '/')
            : '.';
    }

    const workspaceAliasRelative = stripPrefixPath(normalizedAbsolutePath, workspaceAliasPath);
    if (workspaceAliasRelative !== null) {
        return workspaceAliasRelative.length > 0
            ? workspaceAliasRelative.replace(/\\/g, '/')
            : '.';
    }

    const environmentAliasRelative = stripPrefixPath(normalizedAbsolutePath, environmentDataAliasPath);
    if (environmentAliasRelative !== null) {
        return environmentAliasRelative.length > 0
            ? environmentAliasRelative.replace(/\\/g, '/')
            : '.';
    }

    const rewriteExternalAbsolutePath = readFlag(
        'COWORKANY_WORKSPACE_REWRITE_EXTERNAL_ABSOLUTE_PATH',
        true,
    );
    if (rewriteExternalAbsolutePath) {
        const rootRelative = path.relative(path.parse(normalizedAbsolutePath).root, normalizedAbsolutePath);
        if (rootRelative.length > 0 && !rootRelative.startsWith('..')) {
            return rootRelative.replace(/\\/g, '/');
        }
    }

    return inputPath;
}

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

type WorkspacePolicyOverrides = {
    requireApproval?: boolean;
    requireReadBeforeWrite?: boolean;
};

function resolveWorkspacePolicyOverridesFromRequestContext(
    requestContext?: RequestContext<unknown>,
): WorkspacePolicyOverrides {
    const requireToolApproval = requestContext?.get('requireToolApproval');
    if (typeof requireToolApproval === 'boolean' && requireToolApproval === false) {
        return {
            requireApproval: false,
            requireReadBeforeWrite: false,
        };
    }
    return {
        requireApproval: typeof requireToolApproval === 'boolean'
            ? requireToolApproval
            : undefined,
        requireReadBeforeWrite: undefined,
    };
}

export function resolveWorkspacePathFromRequestContext(requestContext?: RequestContext<unknown>): string {
    const fromContext = requestContext?.get('workspacePath');
    if (typeof fromContext === 'string' && fromContext.trim().length > 0) {
        return path.resolve(fromContext);
    }
    return path.resolve(process.cwd());
}

function createWorkspaceToolsPolicy(overrides?: WorkspacePolicyOverrides): WorkspaceToolsConfig {
    const requireApproval = typeof overrides?.requireApproval === 'boolean'
        ? overrides.requireApproval
        : readFlag('COWORKANY_WORKSPACE_REQUIRE_APPROVAL', true);
    const requireReadBeforeWrite = typeof overrides?.requireReadBeforeWrite === 'boolean'
        ? overrides.requireReadBeforeWrite
        : readFlag('COWORKANY_WORKSPACE_REQUIRE_READ_BEFORE_WRITE', true);

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

function buildWorkspaceCacheKey(workspacePath: string, toolsPolicy: WorkspaceToolsConfig): string {
    const writeFilePolicy = toolsPolicy[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE];
    const requireApproval = writeFilePolicy?.requireApproval === true ? '1' : '0';
    const requireReadBeforeWrite = writeFilePolicy?.requireReadBeforeWrite === true ? '1' : '0';
    return `${workspacePath}::approval=${requireApproval}::rbw=${requireReadBeforeWrite}`;
}

function buildWorkspaceId(workspaceCacheKey: string): string {
    const hash = createHash('sha1').update(workspaceCacheKey).digest('hex').slice(0, 12);
    return `coworkany-ws-${hash}`;
}

function createWorkspaceFilesystem(workspacePath: string): LocalFilesystem {
    const filesystem = new LocalFilesystem({
        basePath: workspacePath,
        contained: true,
    });
    const enablePathAliasCompatibility = readFlag(
        'COWORKANY_WORKSPACE_ENABLE_PATH_ALIAS_COMPAT',
        true,
    );
    if (!enablePathAliasCompatibility) {
        return filesystem;
    }
    const filesystemRecord = filesystem as unknown as {
        resolvePath?: (inputPath: string) => string;
    };
    const originalResolvePath = typeof filesystemRecord.resolvePath === 'function'
        ? filesystemRecord.resolvePath.bind(filesystem)
        : null;
    if (originalResolvePath) {
        filesystemRecord.resolvePath = (inputPath: string): string => originalResolvePath(
            normalizeWorkspaceToolPath(inputPath, workspacePath),
        );
    }
    return filesystem;
}

function createWorkspaceEntry(input: {
    workspacePath: string;
    workspaceCacheKey: string;
    toolsPolicy: WorkspaceToolsConfig;
}): WorkspaceCacheEntry {
    const { workspacePath, workspaceCacheKey, toolsPolicy } = input;
    ensureWorkspaceCommandPathAliases(workspacePath);
    const sandboxEnabled = readFlag('COWORKANY_ENABLE_WORKSPACE_SANDBOX', true);
    const timeout = readTimeoutMs('COWORKANY_WORKSPACE_SANDBOX_TIMEOUT_MS', 30_000);
    const workspace = new Workspace({
        id: buildWorkspaceId(workspaceCacheKey),
        name: `CoworkAny Workspace (${path.basename(workspacePath) || 'root'})`,
        filesystem: createWorkspaceFilesystem(workspacePath),
        sandbox: sandboxEnabled
            ? new LocalSandbox({
                workingDirectory: workspacePath,
                timeout,
            })
            : undefined,
        tools: toolsPolicy,
    });
    const initialized = workspace.init().catch((error) => {
        workspaceCache.delete(workspaceCacheKey);
        throw error;
    });
    return {
        workspace,
        initialized,
    };
}

export function getWorkspacePolicySnapshot(
    requestContext?: RequestContext<unknown>,
): {
    enabled: boolean;
    tools: WorkspaceToolsConfig;
} {
    return {
        enabled: readFlag('COWORKANY_ENABLE_WORKSPACE_TOOLS', true),
        tools: createWorkspaceToolsPolicy(
            resolveWorkspacePolicyOverridesFromRequestContext(requestContext),
        ),
    };
}

export async function getWorkspaceForRequestContext(
    requestContext?: RequestContext<unknown>,
): Promise<Workspace | undefined> {
    if (!readFlag('COWORKANY_ENABLE_WORKSPACE_TOOLS', true)) {
        return undefined;
    }
    const workspacePath = resolveWorkspacePathFromRequestContext(requestContext);
    const toolsPolicy = createWorkspaceToolsPolicy(
        resolveWorkspacePolicyOverridesFromRequestContext(requestContext),
    );
    const workspaceCacheKey = buildWorkspaceCacheKey(workspacePath, toolsPolicy);
    let entry = workspaceCache.get(workspaceCacheKey);
    if (!entry) {
        entry = createWorkspaceEntry({
            workspacePath,
            workspaceCacheKey,
            toolsPolicy,
        });
        workspaceCache.set(workspaceCacheKey, entry);
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
