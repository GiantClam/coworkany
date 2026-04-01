import * as fs from 'fs';
import * as path from 'path';
import {
    type IpcCommand,
    type IpcResponse,
    ToolpackManifestSchema,
} from '../protocol';
import type { Directive, DirectiveManager } from '../directives/directiveManager';
import type { ToolpackStore } from '../storage/toolpackStore';
import { SkillStore, type ClaudeSkillManifest } from '../storage/skillStore';
import type { ToolpackManifest } from '../protocol/commands';
import {
    detectDependencyCycles,
    findReverseDependents,
    verifyAndDemotePlugins,
} from '../mastra/pluginDependencyResolver';
import {
    evaluateSkillPolicy,
    evaluateToolpackPolicy,
    type PluginPolicySnapshot,
} from '../mastra/pluginPolicy';
import {
    evaluateMarketplaceSourceTrust,
    loadMarketplaceTrustPolicy,
    MarketplaceAuditStore,
    type MarketplaceAuditEntry,
    type MarketplaceTrustDecision,
} from '../mastra/marketplaceGovernance';
import { parseGitHubSource, type GitHubDownloadResult } from '../utils/githubDownloader';
export type SkillImportResponsePayload = {
    success: boolean;
    skillId?: string;
    error?: string;
    warnings?: string[];
    dependencyCheck?: unknown;
    installResults?: unknown[];
};
export type CapabilityCommandDeps = {
    workspaceRoot: string;
    appDataRoot: string;
    skillStore: Pick<SkillStore, 'list' | 'get' | 'install' | 'setEnabled' | 'uninstall'>;
    toolpackStore: Pick<ToolpackStore, 'list' | 'getById' | 'add' | 'setEnabledById' | 'removeById'>;
    getDirectiveManager: () => Pick<DirectiveManager, 'listDirectives' | 'upsertDirective' | 'removeDirective'>;
    getPluginPolicySnapshot?: () => PluginPolicySnapshot;
    importSkillFromDirectory: (
        inputPath: string,
        autoInstallDependencies?: boolean,
        approvePermissionExpansion?: boolean
    ) => Promise<SkillImportResponsePayload>;
    downloadSkillFromGitHub?: (
        source: string,
        workspacePath: string,
    ) => Promise<GitHubDownloadResult>;
    downloadMcpFromGitHub?: (
        source: string,
        workspacePath: string,
    ) => Promise<GitHubDownloadResult>;
};

type SkillSnapshot = {
    manifest: Record<string, unknown>;
    enabled: boolean;
};

type ToolpackSnapshot = {
    manifest: Record<string, unknown>;
    enabled: boolean;
    workingDir: string;
};
function asRecord(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {};
    }
    return input as Record<string, unknown>;
}
function readString(input: Record<string, unknown>, key: string): string | undefined {
    const value = input[key];
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function readBoolean(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = input[key];
    return typeof value === 'boolean' ? value : fallback;
}
function respond(commandId: string, type: string, payload: Record<string, unknown>): IpcResponse {
    return {
        commandId,
        timestamp: new Date().toISOString(),
        type,
        payload,
    } as IpcResponse;
}

const marketplaceAuditStores = new Map<string, MarketplaceAuditStore>();

function cloneJsonObject<T extends Record<string, unknown>>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getMarketplaceAuditStore(appDataRoot: string): MarketplaceAuditStore {
    const normalized = path.resolve(appDataRoot);
    const existing = marketplaceAuditStores.get(normalized);
    if (existing) {
        return existing;
    }
    const created = new MarketplaceAuditStore(normalized);
    marketplaceAuditStores.set(normalized, created);
    return created;
}

function toSkillSnapshot(input: {
    manifest: Record<string, unknown>;
    enabled: boolean;
}): SkillSnapshot {
    return {
        manifest: cloneJsonObject(input.manifest),
        enabled: input.enabled,
    };
}

function toToolpackSnapshot(input: {
    manifest: Record<string, unknown>;
    enabled: boolean;
    workingDir: string;
}): ToolpackSnapshot {
    return {
        manifest: cloneJsonObject(input.manifest),
        enabled: input.enabled,
        workingDir: input.workingDir,
    };
}
function toToolpackRecord(stored: {
    manifest: ToolpackManifest;
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
    workingDir: string;
    isBuiltin?: boolean;
}): Record<string, unknown> {
    const source = stored.isBuiltin ? 'built_in' : 'local_folder';
    return {
        manifest: stored.manifest,
        source,
        rootPath: stored.workingDir,
        installedAt: stored.installedAt,
        enabled: stored.enabled,
        lastUsedAt: stored.lastUsedAt,
        status: 'stopped',
    };
}
function toSkillRecord(stored: {
    manifest: {
        name: string;
        version: string;
        description: string;
        directory: string;
        tags?: string[];
        allowedTools?: string[];
        dependencies?: string[];
    };
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
    isBuiltin?: boolean;
}): Record<string, unknown> {
    return {
        manifest: {
            id: stored.manifest.name,
            name: stored.manifest.name,
            version: stored.manifest.version,
            description: stored.manifest.description,
            allowedTools: stored.manifest.allowedTools ?? [],
            tags: stored.manifest.tags ?? [],
            dependencies: stored.manifest.dependencies ?? [],
        },
        rootPath: stored.manifest.directory,
        source: stored.isBuiltin ? 'built_in' : 'local_folder',
        installedAt: stored.installedAt,
        enabled: stored.enabled,
        lastUsedAt: stored.lastUsedAt,
    };
}
function normalizeToolpackManifest(input: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...input };
    if (typeof normalized.name === 'string' && typeof normalized.id !== 'string') {
        normalized.id = normalized.name;
    }
    if (normalized.runtime === 'node') {
        normalized.runtime = 'stdio';
    }
    return normalized;
}
function readToolpackManifest(workingDir: string): ToolpackManifest | null {
    const manifestPath = path.join(workingDir, 'mcp.json');
    if (!fs.existsSync(manifestPath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized = normalizeToolpackManifest(parsed);
        return ToolpackManifestSchema.parse(normalized) as ToolpackManifest;
    } catch {
        return null;
    }
}
function parseDirectivePayload(payload: Record<string, unknown>): Directive | null {
    const directiveRaw = asRecord(payload.directive);
    const id = readString(directiveRaw, 'id');
    const name = readString(directiveRaw, 'name');
    const content = readString(directiveRaw, 'content');
    if (!id || !name || !content) {
        return null;
    }
    const enabled = readBoolean(directiveRaw, 'enabled', true);
    const priorityValue = directiveRaw.priority;
    const priority = typeof priorityValue === 'number' && Number.isFinite(priorityValue)
        ? Math.trunc(priorityValue)
        : 0;
    const trigger = readString(directiveRaw, 'trigger');
    return {
        id,
        name,
        content,
        enabled,
        priority,
        trigger,
    };
}
function readIdentifier(payload: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = readString(payload, key);
        if (value) {
            return value;
        }
    }
    return undefined;
}
function unsupportedSinglePath(command: IpcCommand): IpcResponse {
    return respond(command.id, `${command.type}_response`, {
        success: false,
        error: 'unsupported_in_single_path_runtime',
    });
}

function buildSkillDependencySnapshot(
    skills: Array<{
        manifest: { name: string; dependencies?: string[] };
        enabled: boolean;
    }>,
): Array<{
    id: string;
    name: string;
    enabled: boolean;
    dependencies?: string[];
}> {
    return skills.map((skill) => ({
        id: skill.manifest.name,
        name: skill.manifest.name,
        enabled: skill.enabled,
        dependencies: skill.manifest.dependencies ?? [],
    }));
}

function getPolicySnapshot(
    deps: CapabilityCommandDeps,
): PluginPolicySnapshot | undefined {
    return deps.getPluginPolicySnapshot ? deps.getPluginPolicySnapshot() : undefined;
}

const DEFAULT_SKILL_REPOS = [
    'github:anthropics/skills',
    'github:anthropics/claude-plugins-official/plugins',
    'github:OthmanAdi/planning-with-files',
    'github:obra/superpowers',
];

const DEFAULT_MCP_REPOS = [
    'github:modelcontextprotocol/servers/src',
];

function toDisplayNameFromSource(source: string, fallback: string): string {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return fallback;
    }
    const leaf = parsed.path.split('/').filter((part) => part.trim().length > 0).pop();
    return leaf || parsed.repo || fallback;
}

function toSourcePath(source: string): string {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return '';
    }
    return parsed.path;
}

type DiscoveredSkill = {
    name: string;
    description: string;
    path: string;
    source: string;
    runtime: 'unknown';
    hasScripts: boolean;
    trust?: MarketplaceTrustDecision;
};

type DiscoveredMcp = {
    name: string;
    description: string;
    path: string;
    source: string;
    runtime: 'unknown';
    tools: string[];
    trust?: MarketplaceTrustDecision;
};

function buildDiscoveredSkill(
    source: string,
    nameFallback?: string,
    description?: string,
): DiscoveredSkill {
    return {
        name: toDisplayNameFromSource(source, nameFallback ?? 'skill'),
        description: description ?? '',
        path: toSourcePath(source),
        source,
        runtime: 'unknown',
        hasScripts: false,
    };
}

function buildDiscoveredMcp(
    source: string,
    nameFallback?: string,
    description?: string,
): DiscoveredMcp {
    return {
        name: toDisplayNameFromSource(source, nameFallback ?? 'mcp-server'),
        description: description ?? '',
        path: toSourcePath(source),
        source,
        runtime: 'unknown',
        tools: [],
    };
}

function mapInstalledSkillsAsDiscovery(
    deps: CapabilityCommandDeps,
): DiscoveredSkill[] {
    return deps.skillStore
        .list()
        .map((skill) => ({
            name: skill.manifest.name,
            description: skill.manifest.description,
            path: skill.manifest.directory,
            source: skill.isBuiltin
                ? `builtin:${skill.manifest.name}`
                : `local:${skill.manifest.directory}`,
            runtime: 'unknown',
            hasScripts: Boolean(skill.manifest.scriptsDir),
        }));
}

function mapInstalledMcpsAsDiscovery(
    deps: CapabilityCommandDeps,
): DiscoveredMcp[] {
    return deps.toolpackStore
        .list()
        .map((toolpack) => ({
            name: toolpack.manifest.name,
            description: toolpack.manifest.description ?? '',
            path: toolpack.workingDir,
            source: toolpack.isBuiltin
                ? `builtin:${toolpack.manifest.id ?? toolpack.manifest.name}`
                : `local:${toolpack.workingDir}`,
            runtime: 'unknown',
            tools: toolpack.manifest.tools ?? [],
        }));
}

function findToolpackManifestPath(targetDir: string): string | null {
    const directManifest = path.join(targetDir, 'mcp.json');
    if (fs.existsSync(directManifest)) {
        return directManifest;
    }
    const stack = [targetDir];
    let visited = 0;
    while (stack.length > 0 && visited < 200) {
        const next = stack.pop();
        if (!next) {
            continue;
        }
        visited += 1;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(next, { withFileTypes: true });
        } catch {
            entries = [];
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const child = path.join(next, entry.name);
                if (!entry.name.startsWith('.')) {
                    stack.push(child);
                }
                continue;
            }
            if (entry.isFile() && entry.name === 'mcp.json') {
                return path.join(next, entry.name);
            }
        }
    }
    return null;
}

async function handleInstallFromGitHub(
    command: IpcCommand,
    payload: Record<string, unknown>,
    deps: CapabilityCommandDeps,
): Promise<IpcResponse> {
    const workspacePath = readString(payload, 'workspacePath');
    const source = readString(payload, 'source');
    const targetTypeRaw = readString(payload, 'targetType');
    const targetType = targetTypeRaw === 'mcp' ? 'mcp' : 'skill';
    const approvePermissionExpansion = readBoolean(payload, 'approvePermissionExpansion', false);
    if (!workspacePath || !source) {
        return respond(command.id, 'install_from_github_response', {
            success: false,
            error: 'invalid_payload',
        });
    }
    const trustPolicy = loadMarketplaceTrustPolicy(deps.workspaceRoot);
    const trust = evaluateMarketplaceSourceTrust(source, trustPolicy);
    if (!trust.allowed) {
        const deniedAuditEntry = getMarketplaceAuditStore(deps.appDataRoot).append({
            action: 'install_from_github',
            source,
            targetType,
            success: false,
            trust,
            error: trust.reason,
        });
        return respond(command.id, 'install_from_github_response', {
            success: false,
            error: trust.reason,
            trust,
            auditEntryId: deniedAuditEntry.id,
        });
    }

    const auditStore = getMarketplaceAuditStore(deps.appDataRoot);
    if (targetType === 'skill') {
        if (!deps.downloadSkillFromGitHub) {
            return respond(command.id, 'install_from_github_response', {
                success: false,
                error: 'github_install_not_configured',
                trust,
            });
        }
        const download = await deps.downloadSkillFromGitHub(source, workspacePath);
        if (!download.success) {
            const failedAudit = auditStore.append({
                action: 'install_from_github',
                source,
                targetType,
                success: false,
                trust,
                error: download.error ?? 'github_download_failed',
                metadata: {
                    path: download.path,
                    filesDownloaded: download.filesDownloaded,
                },
            });
            return respond(command.id, 'install_from_github_response', {
                success: false,
                path: download.path,
                filesDownloaded: download.filesDownloaded,
                error: download.error ?? 'github_download_failed',
                trust,
                auditEntryId: failedAudit.id,
            });
        }
        const downloadedManifest = SkillStore.loadFromDirectory(download.path);
        const previousSkill = downloadedManifest
            ? deps.skillStore.get(downloadedManifest.name)
            : undefined;
        const importResult = await deps.importSkillFromDirectory(
            download.path,
            true,
            approvePermissionExpansion,
        );
        const auditEntry = auditStore.append({
            action: 'install_from_github',
            source,
            targetType,
            success: importResult.success === true,
            trust,
            error: importResult.success ? undefined : importResult.error ?? 'skill_import_failed',
            rollback: importResult.success
                ? {
                    targetType,
                    skillId: importResult.skillId ?? downloadedManifest?.name ?? null,
                    previousSkill: previousSkill
                        ? toSkillSnapshot({
                            manifest: previousSkill.manifest as unknown as Record<string, unknown>,
                            enabled: previousSkill.enabled,
                        })
                        : null,
                }
                : undefined,
            metadata: {
                path: download.path,
                filesDownloaded: download.filesDownloaded,
            },
        });
        return respond(command.id, 'install_from_github_response', {
            success: importResult.success === true,
            path: download.path,
            filesDownloaded: download.filesDownloaded,
            importResult,
            skillId: importResult.skillId,
            warnings: importResult.warnings ?? [],
            dependencyCheck: importResult.dependencyCheck,
            installResults: importResult.installResults ?? [],
            error: importResult.success ? undefined : importResult.error ?? 'skill_import_failed',
            trust,
            auditEntryId: auditEntry.id,
        });
    }
    if (!deps.downloadMcpFromGitHub) {
        return respond(command.id, 'install_from_github_response', {
            success: false,
            error: 'github_install_not_configured',
            trust,
        });
    }
    const download = await deps.downloadMcpFromGitHub(source, workspacePath);
    if (!download.success) {
        const failedAudit = auditStore.append({
            action: 'install_from_github',
            source,
            targetType,
            success: false,
            trust,
            error: download.error ?? 'github_download_failed',
            metadata: {
                path: download.path,
                filesDownloaded: download.filesDownloaded,
            },
        });
        return respond(command.id, 'install_from_github_response', {
            success: false,
            path: download.path,
            filesDownloaded: download.filesDownloaded,
            error: download.error ?? 'github_download_failed',
            trust,
            auditEntryId: failedAudit.id,
        });
    }
    const manifestPath = findToolpackManifestPath(download.path);
    if (!manifestPath) {
        const failedAudit = auditStore.append({
            action: 'install_from_github',
            source,
            targetType,
            success: false,
            trust,
            error: 'missing_toolpack_manifest',
            metadata: {
                path: download.path,
                filesDownloaded: download.filesDownloaded,
            },
        });
        return respond(command.id, 'install_from_github_response', {
            success: false,
            path: download.path,
            filesDownloaded: download.filesDownloaded,
            error: 'missing_toolpack_manifest',
            trust,
            auditEntryId: failedAudit.id,
        });
    }
    const manifest = readToolpackManifest(path.dirname(manifestPath));
    if (!manifest) {
        const failedAudit = auditStore.append({
            action: 'install_from_github',
            source,
            targetType,
            success: false,
            trust,
            error: 'invalid_manifest',
            metadata: {
                path: download.path,
                filesDownloaded: download.filesDownloaded,
            },
        });
        return respond(command.id, 'install_from_github_response', {
            success: false,
            path: download.path,
            filesDownloaded: download.filesDownloaded,
            error: 'invalid_manifest',
            trust,
            auditEntryId: failedAudit.id,
        });
    }
    const existing = deps.toolpackStore.getById(manifest.id) ?? deps.toolpackStore.getById(manifest.name);
    deps.toolpackStore.add(manifest, path.dirname(manifestPath));
    const stored = deps.toolpackStore.getById(manifest.id) ?? deps.toolpackStore.getById(manifest.name);
    const auditEntry = auditStore.append({
        action: 'install_from_github',
        source,
        targetType,
        success: true,
        trust,
        rollback: {
            targetType,
            toolpackId: manifest.id ?? manifest.name,
            previousToolpack: existing
                ? toToolpackSnapshot({
                    manifest: existing.manifest as unknown as Record<string, unknown>,
                    enabled: existing.enabled,
                    workingDir: existing.workingDir,
                })
                : null,
        },
        metadata: {
            path: download.path,
            filesDownloaded: download.filesDownloaded,
        },
    });
    return respond(command.id, 'install_from_github_response', {
        success: true,
        path: download.path,
        filesDownloaded: download.filesDownloaded,
        toolpack: stored ? toToolpackRecord(stored) : null,
        trust,
        auditEntryId: auditEntry.id,
    });
}

function readMarketplaceRollbackTargetType(value: unknown): 'skill' | 'mcp' | null {
    return value === 'skill' || value === 'mcp' ? value : null;
}

function restoreSkillFromAuditRollback(
    rollback: Record<string, unknown>,
    deps: CapabilityCommandDeps,
): { success: boolean; error?: string; skillId?: string } {
    const skillId = typeof rollback.skillId === 'string' ? rollback.skillId.trim() : '';
    if (!skillId) {
        return { success: false, error: 'missing_skill_id' };
    }
    const previousRaw = rollback.previousSkill;
    if (previousRaw && typeof previousRaw === 'object' && !Array.isArray(previousRaw)) {
        const previous = previousRaw as SkillSnapshot;
        const manifest = previous.manifest as unknown as ClaudeSkillManifest;
        deps.skillStore.install(manifest);
        deps.skillStore.setEnabled(skillId, previous.enabled === true);
        return { success: true, skillId };
    }
    const removed = deps.skillStore.uninstall(skillId);
    return {
        success: removed,
        skillId,
        error: removed ? undefined : 'rollback_uninstall_failed',
    };
}

function restoreMcpFromAuditRollback(
    rollback: Record<string, unknown>,
    deps: CapabilityCommandDeps,
): { success: boolean; error?: string; toolpackId?: string } {
    const toolpackId = typeof rollback.toolpackId === 'string' ? rollback.toolpackId.trim() : '';
    if (!toolpackId) {
        return { success: false, error: 'missing_toolpack_id' };
    }
    const previousRaw = rollback.previousToolpack;
    if (previousRaw && typeof previousRaw === 'object' && !Array.isArray(previousRaw)) {
        const previous = previousRaw as ToolpackSnapshot;
        const manifest = ToolpackManifestSchema.parse(previous.manifest) as ToolpackManifest;
        deps.toolpackStore.add(manifest, previous.workingDir || '');
        deps.toolpackStore.setEnabledById(manifest.id ?? manifest.name, previous.enabled === true);
        return { success: true, toolpackId: manifest.id ?? manifest.name };
    }
    const removed = deps.toolpackStore.removeById(toolpackId);
    return {
        success: removed,
        toolpackId,
        error: removed ? undefined : 'rollback_remove_failed',
    };
}

function handleRollbackMarketplaceInstall(
    command: IpcCommand,
    payload: Record<string, unknown>,
    deps: CapabilityCommandDeps,
): IpcResponse {
    const entryId = readString(payload, 'entryId');
    if (!entryId) {
        return respond(command.id, 'rollback_marketplace_install_response', {
            success: false,
            error: 'missing_entry_id',
        });
    }
    const auditStore = getMarketplaceAuditStore(deps.appDataRoot);
    const entry = auditStore.get(entryId);
    if (!entry) {
        return respond(command.id, 'rollback_marketplace_install_response', {
            success: false,
            entryId,
            error: 'audit_entry_not_found',
        });
    }
    if (entry.action !== 'install_from_github' || entry.success !== true || !entry.rollback) {
        return respond(command.id, 'rollback_marketplace_install_response', {
            success: false,
            entryId,
            error: 'rollback_not_available',
        });
    }
    const rollbackTargetType = readMarketplaceRollbackTargetType(entry.rollback.targetType);
    if (!rollbackTargetType) {
        return respond(command.id, 'rollback_marketplace_install_response', {
            success: false,
            entryId,
            error: 'rollback_payload_invalid',
        });
    }

    if (rollbackTargetType === 'skill') {
        const rollbackResult = restoreSkillFromAuditRollback(entry.rollback, deps);
        const rollbackAuditEntry = getMarketplaceAuditStore(deps.appDataRoot).append({
            action: 'rollback_marketplace_install',
            source: entry.source,
            targetType: entry.targetType,
            success: rollbackResult.success,
            trust: entry.trust,
            error: rollbackResult.error,
            metadata: {
                sourceEntryId: entry.id,
                rollbackTargetType,
            },
        });
        return respond(command.id, 'rollback_marketplace_install_response', {
            success: rollbackResult.success,
            entryId,
            rollbackEntryId: rollbackAuditEntry.id,
            error: rollbackResult.error,
            result: {
                targetType: 'skill',
                skillId: rollbackResult.skillId ?? null,
            },
        });
    }

    const rollbackResult = restoreMcpFromAuditRollback(entry.rollback, deps);
    const rollbackAuditEntry = getMarketplaceAuditStore(deps.appDataRoot).append({
        action: 'rollback_marketplace_install',
        source: entry.source,
        targetType: entry.targetType,
        success: rollbackResult.success,
        trust: entry.trust,
        error: rollbackResult.error,
        metadata: {
            sourceEntryId: entry.id,
            rollbackTargetType,
        },
    });
    return respond(command.id, 'rollback_marketplace_install_response', {
        success: rollbackResult.success,
        entryId,
        rollbackEntryId: rollbackAuditEntry.id,
        error: rollbackResult.error,
        result: {
            targetType: 'mcp',
            toolpackId: rollbackResult.toolpackId ?? null,
        },
    });
}

export async function handleCapabilityCommand(
    command: IpcCommand,
    deps: CapabilityCommandDeps,
): Promise<IpcResponse | null> {
    const payload = asRecord(command.payload);
    switch (command.type) {
        case 'list_toolpacks': {
            const includeDisabled = readBoolean(payload, 'includeDisabled', false);
            const toolpacks = deps.toolpackStore
                .list()
                .filter((toolpack) => includeDisabled || toolpack.enabled)
                .map((toolpack) => toToolpackRecord(toolpack));
            return respond(command.id, 'list_toolpacks_response', {
                toolpacks,
            });
        }
        case 'get_toolpack': {
            const toolpackId = readIdentifier(payload, ['toolpackId', 'toolpack_id', 'name', 'id']);
            if (!toolpackId) {
                return respond(command.id, 'get_toolpack_response', {
                    success: false,
                    error: 'missing_toolpack_id',
                });
            }
            const toolpack = deps.toolpackStore.getById(toolpackId);
            return respond(command.id, 'get_toolpack_response', {
                success: !!toolpack,
                toolpack: toolpack ? toToolpackRecord(toolpack) : null,
                error: toolpack ? undefined : 'toolpack_not_found',
            });
        }
        case 'install_toolpack': {
            const installPath = readIdentifier(payload, ['path', 'installPath', 'toolpackPath']);
            if (!installPath) {
                return respond(command.id, 'install_toolpack_response', {
                    success: false,
                    error: 'invalid_path',
                });
            }
            const manifest = readToolpackManifest(installPath);
            if (!manifest) {
                return respond(command.id, 'install_toolpack_response', {
                    success: false,
                    error: 'invalid_manifest',
                });
            }
            const policySnapshot = getPolicySnapshot(deps);
            if (policySnapshot) {
                const policyDecision = evaluateToolpackPolicy(
                    { toolpackId: manifest.id ?? manifest.name, isBuiltin: false },
                    policySnapshot,
                );
                if (!policyDecision.allowed) {
                    return respond(command.id, 'install_toolpack_response', {
                        success: false,
                        error: policyDecision.reason ?? 'toolpack_blocked_by_policy',
                    });
                }
            }
            deps.toolpackStore.add(manifest, installPath);
            const stored = deps.toolpackStore.getById(manifest.id) ?? deps.toolpackStore.getById(manifest.name);
            return respond(command.id, 'install_toolpack_response', {
                success: true,
                toolpack: stored ? toToolpackRecord(stored) : null,
            });
        }
        case 'set_toolpack_enabled': {
            const toolpackId = readIdentifier(payload, ['toolpackId', 'toolpack_id', 'name', 'id']);
            if (!toolpackId) {
                return respond(command.id, 'set_toolpack_enabled_response', {
                    success: false,
                    error: 'missing_toolpack_id',
                });
            }
            const enabled = readBoolean(payload, 'enabled', true);
            const target = deps.toolpackStore.getById(toolpackId);
            if (!target) {
                return respond(command.id, 'set_toolpack_enabled_response', {
                    success: false,
                    toolpackId,
                    enabled,
                    error: 'toolpack_not_found',
                });
            }
            if (enabled) {
                const policySnapshot = getPolicySnapshot(deps);
                if (policySnapshot) {
                    const policyDecision = evaluateToolpackPolicy(
                        { toolpackId: target.manifest.id ?? target.manifest.name, isBuiltin: target.isBuiltin },
                        policySnapshot,
                    );
                    if (!policyDecision.allowed) {
                        return respond(command.id, 'set_toolpack_enabled_response', {
                            success: false,
                            toolpackId,
                            enabled,
                            error: policyDecision.reason ?? 'toolpack_blocked_by_policy',
                        });
                    }
                }
            }
            const success = deps.toolpackStore.setEnabledById(toolpackId, enabled);
            return respond(command.id, 'set_toolpack_enabled_response', {
                success,
                toolpackId,
                enabled,
                error: success ? undefined : 'toolpack_not_found',
            });
        }
        case 'remove_toolpack': {
            const toolpackId = readIdentifier(payload, ['toolpackId', 'toolpack_id', 'name', 'id']);
            if (!toolpackId) {
                return respond(command.id, 'remove_toolpack_response', {
                    success: false,
                    error: 'missing_toolpack_id',
                });
            }
            const success = deps.toolpackStore.removeById(toolpackId);
            return respond(command.id, 'remove_toolpack_response', {
                success,
                toolpackId,
                error: success ? undefined : 'toolpack_not_found_or_builtin',
            });
        }
        case 'list_claude_skills': {
            const includeDisabled = readBoolean(payload, 'includeDisabled', false);
            const skills = deps.skillStore
                .list()
                .filter((skill) => includeDisabled || skill.enabled)
                .map((skill) => toSkillRecord(skill));
            return respond(command.id, 'list_claude_skills_response', {
                skills,
            });
        }
        case 'get_claude_skill': {
            const skillId = readIdentifier(payload, ['skillId', 'skill_id', 'name', 'id']);
            if (!skillId) {
                return respond(command.id, 'get_claude_skill_response', {
                    success: false,
                    error: 'missing_skill_id',
                });
            }
            const skill = deps.skillStore.get(skillId);
            return respond(command.id, 'get_claude_skill_response', {
                success: !!skill,
                skill: skill ? toSkillRecord(skill) : null,
                error: skill ? undefined : 'skill_not_found',
            });
        }
        case 'import_claude_skill': {
            const inputPath = readIdentifier(payload, ['path', 'skillPath', 'directory']);
            if (!inputPath) {
                return respond(command.id, 'import_claude_skill_response', {
                    success: false,
                    error: 'invalid_path',
                });
            }
            const autoInstallDependencies = readBoolean(payload, 'autoInstallDependencies', true);
            const approvePermissionExpansion = readBoolean(payload, 'approvePermissionExpansion', false);
            const result = await deps.importSkillFromDirectory(
                inputPath,
                autoInstallDependencies,
                approvePermissionExpansion,
            );
            return respond(command.id, 'import_claude_skill_response', asRecord(result));
        }
        case 'set_claude_skill_enabled': {
            const skillId = readIdentifier(payload, ['skillId', 'skill_id', 'name', 'id']);
            if (!skillId) {
                return respond(command.id, 'set_claude_skill_enabled_response', {
                    success: false,
                    error: 'missing_skill_id',
                });
            }
            const enabled = readBoolean(payload, 'enabled', true);
            const skill = deps.skillStore.get(skillId);
            if (!skill) {
                return respond(command.id, 'set_claude_skill_enabled_response', {
                    success: false,
                    skillId,
                    enabled,
                    error: 'skill_not_found_or_builtin',
                });
            }
            if (enabled) {
                const policySnapshot = getPolicySnapshot(deps);
                if (policySnapshot) {
                    const policyDecision = evaluateSkillPolicy(
                        { skillId: skill.manifest.name, isBuiltin: skill.isBuiltin },
                        policySnapshot,
                    );
                    if (!policyDecision.allowed) {
                        return respond(command.id, 'set_claude_skill_enabled_response', {
                            success: false,
                            skillId,
                            enabled,
                            error: policyDecision.reason ?? 'skill_blocked_by_policy',
                        });
                    }
                }
                const simulated = buildSkillDependencySnapshot(deps.skillStore.list()).map((entry) => (
                    entry.id === skill.manifest.name ? { ...entry, enabled: true } : entry
                ));
                const cycles = detectDependencyCycles(simulated, skill.manifest.name);
                if (cycles.length > 0) {
                    return respond(command.id, 'set_claude_skill_enabled_response', {
                        success: false,
                        skillId,
                        enabled,
                        error: 'skill_dependency_cycle',
                        dependencyCheck: {
                            satisfied: false,
                            cycles,
                        },
                    });
                }
                const dependencyCheck = verifyAndDemotePlugins(simulated);
                if (dependencyCheck.demoted.has(skill.manifest.name)) {
                    const dependencyErrors = dependencyCheck.errors
                        .filter((entry) => entry.source === skill.manifest.name);
                    return respond(command.id, 'set_claude_skill_enabled_response', {
                        success: false,
                        skillId,
                        enabled,
                        error: 'skill_dependencies_missing',
                        dependencyCheck: {
                            satisfied: false,
                            errors: dependencyErrors,
                        },
                    });
                }
            } else {
                const dependents = findReverseDependents(
                    skill.manifest.name,
                    buildSkillDependencySnapshot(deps.skillStore.list()),
                );
                if (dependents.length > 0) {
                    return respond(command.id, 'set_claude_skill_enabled_response', {
                        success: false,
                        skillId,
                        enabled,
                        error: 'skill_required_by_dependents',
                        dependents,
                    });
                }
            }
            const success = deps.skillStore.setEnabled(skillId, enabled);
            return respond(command.id, 'set_claude_skill_enabled_response', {
                success,
                skillId,
                enabled,
                error: success ? undefined : 'skill_not_found_or_builtin',
            });
        }
        case 'remove_claude_skill': {
            const skillId = readIdentifier(payload, ['skillId', 'skill_id', 'name', 'id']);
            if (!skillId) {
                return respond(command.id, 'remove_claude_skill_response', {
                    success: false,
                    error: 'missing_skill_id',
                });
            }
            const warnings: string[] = [];
            const deleteFiles = readBoolean(payload, 'deleteFiles', true);
            const skill = deps.skillStore.get(skillId);
            if (deleteFiles && skill && !skill.isBuiltin) {
                try {
                    fs.rmSync(skill.manifest.directory, { recursive: true, force: true });
                } catch {
                    warnings.push('failed_to_delete_skill_directory');
                }
            }
            const success = deps.skillStore.uninstall(skillId);
            return respond(command.id, 'remove_claude_skill_response', {
                success,
                skillId,
                warnings,
                error: success ? undefined : 'skill_not_found_or_builtin',
            });
        }
        case 'list_directives': {
            const directiveManager = deps.getDirectiveManager();
            return respond(command.id, 'list_directives_response', {
                directives: directiveManager.listDirectives(),
            });
        }
        case 'upsert_directive': {
            const directiveManager = deps.getDirectiveManager();
            const directive = parseDirectivePayload(payload);
            if (!directive) {
                return respond(command.id, 'upsert_directive_response', {
                    success: false,
                    error: 'invalid_directive_payload',
                });
            }
            const saved = directiveManager.upsertDirective(directive);
            return respond(command.id, 'upsert_directive_response', {
                success: true,
                directive: saved,
            });
        }
        case 'remove_directive': {
            const directiveManager = deps.getDirectiveManager();
            const directiveId = readIdentifier(payload, ['directiveId', 'directive_id', 'id']);
            if (!directiveId) {
                return respond(command.id, 'remove_directive_response', {
                    success: false,
                    error: 'missing_directive_id',
                });
            }
            const success = directiveManager.removeDirective(directiveId);
            return respond(command.id, 'remove_directive_response', {
                success,
                directiveId,
            });
        }
        case 'install_from_github': {
            return await handleInstallFromGitHub(command, payload, deps);
        }
        case 'get_marketplace_trust_policy': {
            const trustPolicy = loadMarketplaceTrustPolicy(deps.workspaceRoot);
            return respond(command.id, 'get_marketplace_trust_policy_response', {
                success: true,
                policy: {
                    mode: trustPolicy.mode,
                    blockedOwners: Array.from(trustPolicy.blockedOwners.values()).sort((a, b) => a.localeCompare(b)),
                    trustedOwners: Array.from(trustPolicy.trustedOwners.values()).sort((a, b) => a.localeCompare(b)),
                    blockedSources: Array.from(trustPolicy.blockedSources.values()).sort((a, b) => a.localeCompare(b)),
                    allowedSources: Array.from(trustPolicy.allowedSources.values()).sort((a, b) => a.localeCompare(b)),
                    ownerScores: trustPolicy.ownerScores,
                    minTrustScore: trustPolicy.minTrustScore,
                },
            });
        }
        case 'list_marketplace_audit_log': {
            const limit = Number.isFinite(Number(payload.limit))
                ? Math.max(1, Math.min(1000, Math.floor(Number(payload.limit))))
                : undefined;
            const actionRaw = readString(payload, 'action');
            const action = actionRaw === 'install_from_github' || actionRaw === 'rollback_marketplace_install'
                ? actionRaw
                : undefined;
            const entries = getMarketplaceAuditStore(deps.appDataRoot).list({
                limit,
                action,
            });
            return respond(command.id, 'list_marketplace_audit_log_response', {
                success: true,
                entries,
                count: entries.length,
            });
        }
        case 'rollback_marketplace_install': {
            return handleRollbackMarketplaceInstall(command, payload, deps);
        }
        case 'scan_default_repos': {
            const trustPolicy = loadMarketplaceTrustPolicy(deps.workspaceRoot);
            const skillRepos = DEFAULT_SKILL_REPOS.map((source) => (
                {
                    ...buildDiscoveredSkill(source, undefined, 'Default marketplace source'),
                    trust: evaluateMarketplaceSourceTrust(source, trustPolicy),
                }
            ));
            const mcpRepos = DEFAULT_MCP_REPOS.map((source) => (
                {
                    ...buildDiscoveredMcp(source, undefined, 'Default MCP marketplace source'),
                    trust: evaluateMarketplaceSourceTrust(source, trustPolicy),
                }
            ));
            const installedSkills = mapInstalledSkillsAsDiscovery(deps);
            const installedMcpServers = mapInstalledMcpsAsDiscovery(deps);
            return respond(command.id, 'scan_default_repos_response', {
                success: true,
                skills: [
                    ...installedSkills,
                    ...skillRepos.filter((entry) =>
                        !installedSkills.some((skill) => String(skill.source) === String(entry.source)),
                    ),
                ],
                mcpServers: [
                    ...installedMcpServers,
                    ...mcpRepos.filter((entry) =>
                        !installedMcpServers.some((server) => String(server.source) === String(entry.source)),
                    ),
                ],
                errors: [],
            });
        }
        case 'scan_skills': {
            const source = readString(payload, 'source');
            if (!source) {
                return respond(command.id, 'scan_skills_response', {
                    success: false,
                    skills: [],
                    error: 'invalid_source',
                });
            }
            const parsed = parseGitHubSource(source);
            if (!parsed) {
                return respond(command.id, 'scan_skills_response', {
                    success: false,
                    skills: [],
                    error: 'invalid_github_source',
                });
            }
            return respond(command.id, 'scan_skills_response', {
                success: true,
                skills: [
                    buildDiscoveredSkill(source, parsed.repo, 'Skill repository preview'),
                ],
            });
        }
        case 'scan_mcp_servers': {
            const source = readString(payload, 'source');
            if (!source) {
                return respond(command.id, 'scan_mcp_servers_response', {
                    success: false,
                    servers: [],
                    error: 'invalid_source',
                });
            }
            const parsed = parseGitHubSource(source);
            if (!parsed) {
                return respond(command.id, 'scan_mcp_servers_response', {
                    success: false,
                    servers: [],
                    error: 'invalid_github_source',
                });
            }
            return respond(command.id, 'scan_mcp_servers_response', {
                success: true,
                servers: [
                    buildDiscoveredMcp(source, parsed.repo, 'MCP repository preview'),
                ],
            });
        }
        case 'validate_skill': {
            const source = readString(payload, 'source');
            if (!source) {
                return respond(command.id, 'validate_skill_response', {
                    valid: false,
                    reason: 'invalid_source',
                });
            }
            const parsed = parseGitHubSource(source);
            if (!parsed) {
                return respond(command.id, 'validate_skill_response', {
                    valid: false,
                    reason: 'invalid_github_source',
                });
            }
            return respond(command.id, 'validate_skill_response', {
                valid: true,
                skill: buildDiscoveredSkill(source, parsed.repo, 'Skill repository preview'),
            });
        }
        case 'validate_mcp': {
            const source = readString(payload, 'source');
            if (!source) {
                return respond(command.id, 'validate_mcp_response', {
                    valid: false,
                    reason: 'invalid_source',
                });
            }
            const parsed = parseGitHubSource(source);
            if (!parsed) {
                return respond(command.id, 'validate_mcp_response', {
                    valid: false,
                    reason: 'invalid_github_source',
                });
            }
            return respond(command.id, 'validate_mcp_response', {
                valid: true,
                server: buildDiscoveredMcp(source, parsed.repo, 'MCP repository preview'),
            });
        }
        case 'validate_github_url': {
            const url = readString(payload, 'url');
            const validationType = readString(payload, 'type') ?? 'skill';
            if (!url) {
                return respond(command.id, 'validate_github_url_response', {
                    valid: false,
                    reason: 'invalid_url',
                });
            }
            const parsed = parseGitHubSource(url);
            if (!parsed) {
                return respond(command.id, 'validate_github_url_response', {
                    valid: false,
                    reason: 'invalid_github_source',
                });
            }
            const trustPolicy = loadMarketplaceTrustPolicy(deps.workspaceRoot);
            const trust = evaluateMarketplaceSourceTrust(url, trustPolicy);
            if (validationType === 'mcp') {
                const preview = buildDiscoveredMcp(url, parsed.repo, 'MCP repository preview');
                return respond(command.id, 'validate_github_url_response', {
                    valid: trust.allowed,
                    preview: {
                        name: preview.name,
                        description: preview.description,
                        runtime: preview.runtime,
                        path: preview.path,
                        tools: preview.tools,
                    },
                    server: preview,
                    trust,
                    reason: trust.allowed ? undefined : trust.reason,
                });
            }
            const preview = buildDiscoveredSkill(url, parsed.repo, 'Skill repository preview');
            return respond(command.id, 'validate_github_url_response', {
                valid: trust.allowed,
                preview: {
                    name: preview.name,
                    description: preview.description,
                    runtime: preview.runtime,
                    path: preview.path,
                },
                skill: preview,
                trust,
                reason: trust.allowed ? undefined : trust.reason,
            });
        }
        case 'approve_extension_governance': {
            return unsupportedSinglePath(command);
        }
        default:
            return null;
    }
}
