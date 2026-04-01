import * as fs from 'fs';
import * as path from 'path';
import { handleCapabilityCommand } from '../handlers/capabilities';
import type { SkillImportResponsePayload } from '../handlers/capabilities';
import { handleWorkspaceCommand } from '../handlers/workspaces';
import type { IpcCommand } from '../protocol';
import { SkillStore, ToolpackStore, createWorkspaceStoreFacade } from '../storage';
import type { ClaudeSkillManifest } from '../storage/skillStore';
import { DirectiveManager } from '../directives/directiveManager';
import { evaluateSkillPolicy, loadPluginPolicySnapshot, type PluginPolicySnapshot } from './pluginPolicy';
import { detectDependencyCycles, verifyAndDemotePlugins } from './pluginDependencyResolver';
import {
    getMcpConnectionSnapshot,
    getMcpSecuritySnapshot,
    refreshMcpConnections,
    removeMcpServerDefinition,
    setMcpServerApprovalPolicy,
    setMcpServerEnabledPolicy,
    upsertMcpServerDefinition,
} from './mcp/clients';
import { downloadMcpFromGitHub, downloadSkillFromGitHub } from '../utils/githubDownloader';
import {
    applyManagedSettingsFiles,
    ManagedSettingsSyncStore,
    readManagedSettingsPayload,
    restoreManagedSettingsFiles,
} from './managedSettings';
export type AdditionalCommandHandler = (raw: unknown) => Promise<Record<string, unknown> | null>;
type AdditionalCommandRuntime = {
    workspaceRoot: string;
    skillStore: SkillStore;
    getPluginPolicySnapshot: () => PluginPolicySnapshot;
};
function getResolvedAppDataRoot(root: string): string {
    fs.mkdirSync(root, { recursive: true });
    return root;
}
function registerFilesystemSkills(skillStore: SkillStore, workspaceRoot: string): void {
    const skillsDir = path.join(workspaceRoot, '.coworkany', 'skills');
    if (!fs.existsSync(skillsDir)) {
        return;
    }
    const manifests = SkillStore.scanDirectory(skillsDir);
    let changed = false;
    for (const manifest of manifests) {
        if (!skillStore.get(manifest.name)) {
            skillStore.install(manifest);
            changed = true;
        }
    }
    if (changed) {
        skillStore.save();
    }
}
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

function readStringList(input: Record<string, unknown>, key: string): string[] | undefined {
    const raw = input[key];
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const parsed = raw
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return parsed;
}

function readEnvRecord(input: Record<string, unknown>, key: string): Record<string, string> | undefined {
    const raw = input[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }
    const output: Record<string, string> = {};
    for (const [envKey, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'string') {
            continue;
        }
        const trimmedKey = envKey.trim();
        if (!trimmedKey) {
            continue;
        }
        output[trimmedKey] = value;
    }
    return Object.keys(output).length > 0 ? output : undefined;
}

function toMcpServerPatchList(settings: Record<string, unknown>): Array<Record<string, unknown>> {
    const raw = settings.mcpServers;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter((entry): entry is Record<string, unknown> => (
            Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
        ))
        .map((entry) => ({ ...entry }));
}

async function applyManagedMcpServers(
    patches: Array<Record<string, unknown>>,
): Promise<{
    success: boolean;
    appliedCount: number;
    rollbackMutations: Array<Record<string, unknown>>;
    error?: string;
}> {
    if (patches.length === 0) {
        return {
            success: true,
            appliedCount: 0,
            rollbackMutations: [],
        };
    }
    const beforeSnapshot = getMcpSecuritySnapshot();
    const beforeById = new Map(
        beforeSnapshot.servers.map((server) => [server.id, server]),
    );
    const rollbackMutations: Array<Record<string, unknown>> = [];
    for (const patch of patches) {
        const id = readString(patch, 'id') ?? '';
        const command = readString(patch, 'command') ?? '';
        if (!id || !command) {
            return {
                success: false,
                appliedCount: rollbackMutations.length,
                rollbackMutations,
                error: 'managed_settings_invalid_mcp_server',
            };
        }
        const scopeRaw = readString(patch, 'scope');
        const scope = scopeRaw === 'managed' || scopeRaw === 'project' || scopeRaw === 'user'
            ? scopeRaw
            : undefined;
        const upsertResult = await upsertMcpServerDefinition({
            id,
            command,
            args: readStringList(patch, 'args'),
            env: readEnvRecord(patch, 'env'),
            scope,
            enabled: readBoolean(patch, 'enabled', true),
            approved: readBoolean(patch, 'approved', false),
            description: readString(patch, 'description'),
        });
        if (!upsertResult.success) {
            return {
                success: false,
                appliedCount: rollbackMutations.length,
                rollbackMutations,
                error: upsertResult.error ?? 'managed_settings_mcp_upsert_failed',
            };
        }
        const applied = upsertResult.snapshot.servers.find((server) => server.id === id) ?? null;
        rollbackMutations.push({
            id,
            previousServer: beforeById.get(id) ?? null,
            appliedServer: applied,
        });
    }
    return {
        success: true,
        appliedCount: rollbackMutations.length,
        rollbackMutations,
    };
}

async function rollbackManagedMcpServers(
    mutations: Array<Record<string, unknown>>,
): Promise<{
    success: boolean;
    restoredCount: number;
    error?: string;
}> {
    let restoredCount = 0;
    for (const mutation of mutations) {
        const id = readString(mutation, 'id') ?? '';
        if (!id) {
            return {
                success: false,
                restoredCount,
                error: 'managed_settings_mcp_rollback_payload_invalid',
            };
        }
        const previousServer = asRecord(mutation.previousServer);
        const hasPrevious = Object.keys(previousServer).length > 0;
        if (!hasPrevious) {
            const removeResult = await removeMcpServerDefinition(id);
            if (!removeResult.success && removeResult.error !== 'server_not_found') {
                return {
                    success: false,
                    restoredCount,
                    error: removeResult.error ?? 'managed_settings_mcp_rollback_failed',
                };
            }
            restoredCount += 1;
            continue;
        }
        const command = readString(previousServer, 'command') ?? '';
        if (!command) {
            return {
                success: false,
                restoredCount,
                error: 'managed_settings_mcp_rollback_payload_invalid',
            };
        }
        const scopeRaw = readString(previousServer, 'scope');
        const scope = scopeRaw === 'managed' || scopeRaw === 'project' || scopeRaw === 'user'
            ? scopeRaw
            : undefined;
        const upsertResult = await upsertMcpServerDefinition({
            id,
            command,
            args: readStringList(previousServer, 'args'),
            env: readEnvRecord(previousServer, 'env'),
            scope,
            enabled: readBoolean(previousServer, 'enabled', true),
            approved: readBoolean(previousServer, 'approved', false),
            description: readString(previousServer, 'description'),
        });
        if (!upsertResult.success) {
            return {
                success: false,
                restoredCount,
                error: upsertResult.error ?? 'managed_settings_mcp_rollback_failed',
            };
        }
        restoredCount += 1;
    }
    return {
        success: true,
        restoredCount,
    };
}

type SkillCatalogEntry = {
    directory: string;
    manifest: ClaudeSkillManifest;
};

function scanSkillCatalog(roots: string[]): Map<string, SkillCatalogEntry> {
    const catalog = new Map<string, SkillCatalogEntry>();
    for (const root of roots) {
        if (!root || !fs.existsSync(root)) {
            continue;
        }

        const rootManifest = SkillStore.loadFromDirectory(root);
        if (rootManifest && !catalog.has(rootManifest.name)) {
            catalog.set(rootManifest.name, {
                directory: root,
                manifest: rootManifest,
            });
        }

        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(root, { withFileTypes: true });
        } catch {
            entries = [];
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const skillDir = path.join(root, entry.name);
            const manifest = SkillStore.loadFromDirectory(skillDir);
            if (!manifest || catalog.has(manifest.name)) {
                continue;
            }
            catalog.set(manifest.name, {
                directory: skillDir,
                manifest,
            });
        }
    }
    return catalog;
}
async function importSkillFromDirectory(
    inputPath: string,
    autoInstallDependencies: boolean,
    _approvePermissionExpansion: boolean,
    runtime: AdditionalCommandRuntime,
): Promise<SkillImportResponsePayload> {
    const manifest = SkillStore.loadFromDirectory(inputPath);
    if (!manifest) {
        return {
            success: false,
            error: 'missing_skill_manifest',
        };
    }
    const policySnapshot = runtime.getPluginPolicySnapshot();
    const policyDecision = evaluateSkillPolicy(
        { skillId: manifest.name, isBuiltin: false },
        policySnapshot,
    );
    if (!policyDecision.allowed) {
        return {
            success: false,
            error: policyDecision.reason ?? 'skill_blocked_by_policy',
        };
    }

    const installResults: Array<Record<string, unknown>> = [];
    const dependencyRoots = Array.from(new Set([
        path.dirname(inputPath),
        path.join(runtime.workspaceRoot, '.coworkany', 'skills'),
    ]));
    const catalog = scanSkillCatalog(dependencyRoots);
    catalog.set(manifest.name, {
        directory: inputPath,
        manifest,
    });

    const dependencyGraph = new Map<string, string[]>();
    for (const skill of runtime.skillStore.list()) {
        dependencyGraph.set(skill.manifest.name, skill.manifest.dependencies ?? []);
    }
    for (const [skillId, entry] of catalog) {
        dependencyGraph.set(skillId, entry.manifest.dependencies ?? []);
    }
    const cycles = detectDependencyCycles(
        Array.from(dependencyGraph.entries()).map(([skillId, dependencies]) => ({
            id: skillId,
            name: skillId,
            enabled: true,
            dependencies,
        })),
        manifest.name,
    );
    if (cycles.length > 0) {
        return {
            success: false,
            skillId: manifest.name,
            error: 'skill_dependency_cycle',
            dependencyCheck: {
                satisfied: false,
                cycles,
            },
            installResults,
        };
    }

    if (autoInstallDependencies) {
        const queue = [...(manifest.dependencies ?? [])];
        const visited = new Set<string>([manifest.name]);
        while (queue.length > 0) {
            const dependencyId = String(queue.shift() ?? '').trim();
            if (!dependencyId || visited.has(dependencyId)) {
                continue;
            }
            visited.add(dependencyId);

            const installed = runtime.skillStore.get(dependencyId);
            if (installed) {
                installResults.push({
                    skillId: dependencyId,
                    status: installed.enabled ? 'already_enabled' : 'already_installed_disabled',
                });
                for (const nested of installed.manifest.dependencies ?? []) {
                    queue.push(nested);
                }
                continue;
            }

            const entry = catalog.get(dependencyId);
            if (!entry) {
                installResults.push({
                    skillId: dependencyId,
                    status: 'missing',
                });
                continue;
            }
            const dependencyPolicyDecision = evaluateSkillPolicy(
                { skillId: entry.manifest.name, isBuiltin: false },
                policySnapshot,
            );
            if (!dependencyPolicyDecision.allowed) {
                installResults.push({
                    skillId: entry.manifest.name,
                    status: 'blocked',
                    error: dependencyPolicyDecision.reason ?? 'skill_blocked_by_policy',
                    path: entry.directory,
                });
                continue;
            }

            runtime.skillStore.install(entry.manifest);
            installResults.push({
                skillId: entry.manifest.name,
                status: 'installed',
                path: entry.directory,
            });
            for (const nested of entry.manifest.dependencies ?? []) {
                queue.push(nested);
            }
        }
    }

    const dependencySnapshot = runtime.skillStore.list().map((skill) => ({
        id: skill.manifest.name,
        name: skill.manifest.name,
        enabled: skill.manifest.name === manifest.name ? true : skill.enabled,
        dependencies: skill.manifest.dependencies ?? [],
    }));
    if (!dependencySnapshot.some((entry) => entry.id === manifest.name)) {
        dependencySnapshot.push({
            id: manifest.name,
            name: manifest.name,
            enabled: true,
            dependencies: manifest.dependencies ?? [],
        });
    }
    const dependencyCheck = verifyAndDemotePlugins(dependencySnapshot);
    if (dependencyCheck.demoted.has(manifest.name)) {
        return {
            success: false,
            skillId: manifest.name,
            error: 'skill_dependencies_missing',
            dependencyCheck: {
                satisfied: false,
                errors: dependencyCheck.errors.filter((entry) => entry.source === manifest.name),
            },
            installResults,
        };
    }

    runtime.skillStore.install(manifest);
    return {
        success: true,
        skillId: manifest.name,
        dependencyCheck: {
            satisfied: true,
            errors: [],
        },
        installResults,
    };
}
export function createMastraAdditionalCommandHandler(input?: {
    workspaceRoot?: string;
    appDataRoot?: string;
}): {
    handler: AdditionalCommandHandler;
    skillStore: SkillStore;
    getPluginPolicySnapshot: () => PluginPolicySnapshot;
} {
    const workspaceRoot = input?.workspaceRoot ?? process.cwd();
    const appDataRoot = input?.appDataRoot
        ?? process.env.COWORKANY_APP_DATA_DIR?.trim()
        ?? path.join(workspaceRoot, '.coworkany');
    const runtime: AdditionalCommandRuntime = {
        workspaceRoot,
        skillStore: new SkillStore(workspaceRoot),
        getPluginPolicySnapshot: () => loadPluginPolicySnapshot(workspaceRoot),
    };
    const toolpackStore = new ToolpackStore(workspaceRoot);
    const workspaceStore = createWorkspaceStoreFacade(() => getResolvedAppDataRoot(appDataRoot));
    const directiveManager = new DirectiveManager(workspaceRoot);
    const managedSettingsSyncStore = new ManagedSettingsSyncStore(getResolvedAppDataRoot(appDataRoot));
    registerFilesystemSkills(runtime.skillStore, runtime.workspaceRoot);
    const handler: AdditionalCommandHandler = async (raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }
        const command = raw as IpcCommand;
        if (typeof command.type !== 'string' || typeof command.id !== 'string') {
            return null;
        }
        const payload = asRecord(command.payload);
        if (command.type === 'get_mcp_connection_status') {
            return {
                type: 'get_mcp_connection_status_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: true,
                    snapshot: getMcpConnectionSnapshot(),
                    security: getMcpSecuritySnapshot(),
                },
            };
        }
        if (command.type === 'list_mcp_servers') {
            return {
                type: 'list_mcp_servers_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: true,
                    ...getMcpSecuritySnapshot(),
                },
            };
        }
        if (command.type === 'upsert_mcp_server') {
            const server = asRecord(payload.server);
            const id = readString(server, 'id') ?? readString(payload, 'id') ?? '';
            const commandText = readString(server, 'command') ?? readString(payload, 'command') ?? '';
            const scopeRaw = readString(server, 'scope') ?? readString(payload, 'scope');
            const scope = scopeRaw === 'managed' || scopeRaw === 'project' || scopeRaw === 'user'
                ? scopeRaw
                : undefined;
            const result = await upsertMcpServerDefinition({
                id,
                command: commandText,
                args: readStringList(server, 'args') ?? readStringList(payload, 'args'),
                env: readEnvRecord(server, 'env') ?? readEnvRecord(payload, 'env'),
                scope,
                enabled: readBoolean(server, 'enabled', readBoolean(payload, 'enabled', true)),
                approved: readBoolean(server, 'approved', readBoolean(payload, 'approved', false)),
                description: readString(server, 'description') ?? readString(payload, 'description'),
            });
            return {
                type: 'upsert_mcp_server_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: result.success,
                    error: result.error,
                    ...result.snapshot,
                },
            };
        }
        if (command.type === 'set_mcp_server_enabled') {
            const id = readString(payload, 'id') ?? readString(payload, 'serverId') ?? '';
            const result = await setMcpServerEnabledPolicy(
                id,
                readBoolean(payload, 'enabled', true),
            );
            return {
                type: 'set_mcp_server_enabled_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: result.success,
                    error: result.error,
                    ...result.snapshot,
                },
            };
        }
        if (command.type === 'set_mcp_server_approval') {
            const id = readString(payload, 'id') ?? readString(payload, 'serverId') ?? '';
            const result = await setMcpServerApprovalPolicy(
                id,
                readBoolean(payload, 'approved', false),
            );
            return {
                type: 'set_mcp_server_approval_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: result.success,
                    error: result.error,
                    ...result.snapshot,
                },
            };
        }
        if (command.type === 'refresh_mcp_connections') {
            await refreshMcpConnections();
            return {
                type: 'refresh_mcp_connections_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: true,
                    snapshot: getMcpConnectionSnapshot(),
                    security: getMcpSecuritySnapshot(),
                },
            };
        }
        if (command.type === 'sync_managed_settings') {
            const parsedSettings = readManagedSettingsPayload({
                workspaceRoot,
                payload,
            });
            if (!parsedSettings.success || !parsedSettings.settings) {
                const failedEntry = managedSettingsSyncStore.append({
                    action: 'sync',
                    source: parsedSettings.source,
                    success: false,
                    settingsPath: parsedSettings.settingsPath,
                    rollback: {},
                    applied: {
                        policySettingsUpdated: false,
                        extensionAllowlistUpdated: false,
                        mcpServerCount: 0,
                    },
                    error: parsedSettings.error ?? 'managed_settings_invalid_payload',
                });
                return {
                    type: 'sync_managed_settings_response',
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    payload: {
                        success: false,
                        error: parsedSettings.error ?? 'managed_settings_invalid_payload',
                        source: parsedSettings.source,
                        settingsPath: parsedSettings.settingsPath,
                        syncEntryId: failedEntry.id,
                    },
                };
            }

            const fileResult = applyManagedSettingsFiles({
                workspaceRoot,
                settings: parsedSettings.settings,
            });
            const mcpResult = await applyManagedMcpServers(
                toMcpServerPatchList(parsedSettings.settings),
            );
            if (!mcpResult.success) {
                await rollbackManagedMcpServers(mcpResult.rollbackMutations);
                restoreManagedSettingsFiles({
                    workspaceRoot,
                    rollback: fileResult.rollback,
                });
                const failedEntry = managedSettingsSyncStore.append({
                    action: 'sync',
                    source: parsedSettings.source,
                    success: false,
                    settingsPath: parsedSettings.settingsPath,
                    rollback: {
                        ...fileResult.rollback,
                        mcpMutations: mcpResult.rollbackMutations,
                    },
                    applied: {
                        ...fileResult.applied,
                        mcpServerCount: mcpResult.appliedCount,
                    },
                    error: mcpResult.error ?? 'managed_settings_apply_failed',
                });
                return {
                    type: 'sync_managed_settings_response',
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    payload: {
                        success: false,
                        error: mcpResult.error ?? 'managed_settings_apply_failed',
                        source: parsedSettings.source,
                        settingsPath: parsedSettings.settingsPath,
                        applied: {
                            ...fileResult.applied,
                            mcpServerCount: mcpResult.appliedCount,
                        },
                        syncEntryId: failedEntry.id,
                    },
                };
            }

            const syncEntry = managedSettingsSyncStore.append({
                action: 'sync',
                source: parsedSettings.source,
                success: true,
                settingsPath: parsedSettings.settingsPath,
                rollback: {
                    ...fileResult.rollback,
                    mcpMutations: mcpResult.rollbackMutations,
                },
                applied: {
                    ...fileResult.applied,
                    mcpServerCount: mcpResult.appliedCount,
                },
            });
            return {
                type: 'sync_managed_settings_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: true,
                    source: parsedSettings.source,
                    settingsPath: parsedSettings.settingsPath,
                    applied: syncEntry.applied,
                    syncEntryId: syncEntry.id,
                    security: getMcpSecuritySnapshot(),
                },
            };
        }
        if (command.type === 'rollback_managed_settings') {
            const entryId = readString(payload, 'entryId');
            const sourceEntry = entryId
                ? managedSettingsSyncStore.get(entryId)
                : managedSettingsSyncStore.latest();
            if (!sourceEntry) {
                return {
                    type: 'rollback_managed_settings_response',
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    payload: {
                        success: false,
                        error: 'managed_settings_sync_entry_not_found',
                        entryId: entryId ?? null,
                    },
                };
            }
            if (sourceEntry.success !== true || sourceEntry.action !== 'sync') {
                return {
                    type: 'rollback_managed_settings_response',
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    payload: {
                        success: false,
                        error: 'managed_settings_sync_not_reversible',
                        entryId: sourceEntry.id,
                    },
                };
            }

            const restoredFiles = restoreManagedSettingsFiles({
                workspaceRoot,
                rollback: sourceEntry.rollback,
            });
            const rollbackMcpResult = await rollbackManagedMcpServers(
                sourceEntry.rollback.mcpMutations ?? [],
            );
            const rollbackSuccess = restoredFiles.policySettingsRestored
                && restoredFiles.extensionAllowlistRestored
                && rollbackMcpResult.success;
            const rollbackEntry = managedSettingsSyncStore.append({
                action: 'rollback',
                source: sourceEntry.id,
                success: rollbackSuccess,
                settingsPath: sourceEntry.settingsPath,
                rollback: {
                    policySettingsRaw: null,
                    extensionAllowlistRaw: null,
                    mcpMutations: [],
                },
                applied: {
                    policySettingsUpdated: false,
                    extensionAllowlistUpdated: false,
                    mcpServerCount: 0,
                },
                error: rollbackSuccess
                    ? undefined
                    : (rollbackMcpResult.error ?? 'managed_settings_rollback_failed'),
            });
            return {
                type: 'rollback_managed_settings_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: rollbackSuccess,
                    entryId: sourceEntry.id,
                    rollbackEntryId: rollbackEntry.id,
                    restoredFiles,
                    restoredMcpCount: rollbackMcpResult.restoredCount,
                    error: rollbackSuccess
                        ? undefined
                        : (rollbackMcpResult.error ?? 'managed_settings_rollback_failed'),
                    security: getMcpSecuritySnapshot(),
                },
            };
        }
        if (command.type === 'list_managed_settings_sync_log') {
            const limit = Number.isFinite(Number(payload.limit))
                ? Math.max(1, Math.min(1000, Math.floor(Number(payload.limit))))
                : undefined;
            const actionRaw = readString(payload, 'action');
            const action = actionRaw === 'sync' || actionRaw === 'rollback'
                ? actionRaw
                : undefined;
            const entries = managedSettingsSyncStore
                .list(limit)
                .filter((entry) => !action || entry.action === action);
            return {
                type: 'list_managed_settings_sync_log_response',
                commandId: command.id,
                timestamp: new Date().toISOString(),
                payload: {
                    success: true,
                    entries,
                    count: entries.length,
                },
            };
        }
        const workspaceResponse = await handleWorkspaceCommand(command, {
            workspaceStore,
            getResolvedAppDataRoot: () => getResolvedAppDataRoot(appDataRoot),
        });
        if (workspaceResponse) {
            return workspaceResponse as Record<string, unknown>;
        }
        const capabilityResponse = await handleCapabilityCommand(command, {
            workspaceRoot,
            appDataRoot,
            skillStore: runtime.skillStore,
            toolpackStore,
            getDirectiveManager: () => directiveManager,
            getPluginPolicySnapshot: runtime.getPluginPolicySnapshot,
            downloadSkillFromGitHub,
            downloadMcpFromGitHub,
            importSkillFromDirectory: async (
                inputPath: string,
                autoInstallDependencies = true,
                approvePermissionExpansion = false,
            ) => {
                return await importSkillFromDirectory(
                    inputPath,
                    autoInstallDependencies,
                    approvePermissionExpansion,
                    runtime,
                );
            },
        });
        if (capabilityResponse) {
            return capabilityResponse as Record<string, unknown>;
        }
        return null;
    };
    return {
        handler,
        skillStore: runtime.skillStore,
        getPluginPolicySnapshot: runtime.getPluginPolicySnapshot,
    };
}
