import * as fs from 'fs';
import * as path from 'path';
import {
    type IpcCommand,
    type IpcResponse,
    ToolpackManifestSchema,
} from '../protocol';
import {
    buildExtensionGovernanceReview,
    summarizeSkillPermissions,
    summarizeSkillProvenance,
    summarizeSkillTrust,
    summarizeToolpackProvenance,
    summarizeToolpackTrust,
    summarizeToolpackPermissions,
    type ExtensionGovernanceReview,
} from '../extensions/governance';
import type {
    ExtensionGovernanceState,
    ExtensionGovernanceStore,
} from '../extensions/governanceStore';
import type { Directive, DirectiveManager } from '../agent/directives/directiveManager';
import type { ToolpackStore } from '../storage/toolpackStore';
import type { SkillStore } from '../storage/skillStore';
import type { ToolpackManifest } from '../protocol/commands';
import {
    isWorkspaceExtensionAllowed,
    type WorkspaceExtensionAllowlistPolicy,
} from '../extensions/workspaceExtensionAllowlist';

export type SkillImportResponsePayload = {
    success: boolean;
    skillId?: string;
    error?: string;
    warnings?: string[];
    dependencyCheck?: unknown;
    installResults?: unknown[];
    governanceReview?: ExtensionGovernanceReview;
    governanceState?: ExtensionGovernanceState;
};

export type CapabilityCommandDeps = {
    skillStore: Pick<SkillStore, 'list' | 'get' | 'install' | 'setEnabled' | 'uninstall'>;
    toolpackStore: Pick<ToolpackStore, 'list' | 'getById' | 'add' | 'setEnabledById' | 'removeById'>;
    getExtensionGovernanceStore: () => Pick<ExtensionGovernanceStore, 'get' | 'recordReview' | 'markApproved' | 'clear'>;
    getWorkspaceExtensionAllowlistPolicy?: () => WorkspaceExtensionAllowlistPolicy;
    getDirectiveManager: () => Pick<DirectiveManager, 'listDirectives' | 'upsertDirective' | 'removeDirective'>;
    importSkillFromDirectory: (
        inputPath: string,
        autoInstallDependencies?: boolean,
        approvePermissionExpansion?: boolean
    ) => Promise<SkillImportResponsePayload>;
    downloadSkillFromGitHub: (
        source: string,
        workspacePath: string
    ) => Promise<{ success: boolean; path: string; filesDownloaded?: number; error?: string }>;
    downloadMcpFromGitHub: (
        source: string,
        workspacePath: string
    ) => Promise<{ success: boolean; path: string; filesDownloaded?: number; error?: string }>;
    validateSkillUrl: (url: string) => Promise<Record<string, unknown>>;
    validateMcpUrl: (url: string) => Promise<Record<string, unknown>>;
    scanDefaultRepositories: () => Promise<{
        skills: unknown[];
        mcpServers: unknown[];
        errors: string[];
    }>;
};

function isExtensionEnableAllowed(
    deps: CapabilityCommandDeps,
    input: {
        extensionType: 'skill' | 'toolpack';
        extensionId: string;
        isBuiltin?: boolean;
    }
): boolean {
    const policy = deps.getWorkspaceExtensionAllowlistPolicy?.();
    if (!policy) {
        return true;
    }
    return isWorkspaceExtensionAllowed(policy, input);
}

function respond(commandId: string, type: string, payload: Record<string, unknown>): IpcResponse {
    return {
        commandId,
        timestamp: new Date().toISOString(),
        type,
        payload,
    } as IpcResponse;
}

function safeStat(targetPath: string): fs.Stats | null {
    try {
        return fs.statSync(targetPath);
    } catch {
        return null;
    }
}

function ensureToolpackId(manifest: Record<string, unknown>): Record<string, unknown> {
    if (!manifest.id && typeof manifest.name === 'string') {
        return { ...manifest, id: manifest.name };
    }
    return manifest;
}

function mergeTrustWithGovernance<T extends {
    level: 'trusted' | 'review_required' | 'untrusted';
    pendingReview: boolean;
    reasons: string[];
}>(
    trust: T,
    governanceState?: ExtensionGovernanceState
): T {
    if (!governanceState) {
        return trust;
    }

    const reasons = new Set(trust.reasons);
    if (governanceState.pendingReview) {
        reasons.add('governance_pending_review');
    }
    if (governanceState.quarantined) {
        reasons.add('governance_quarantined');
    }

    const level = governanceState.pendingReview && trust.level === 'trusted'
        ? 'review_required'
        : trust.level;

    return {
        ...trust,
        level,
        pendingReview: governanceState.pendingReview,
        reasons: Array.from(reasons),
    };
}

function toToolpackRecord(stored: {
    manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        author?: string;
        entry?: string;
        runtime?: string;
        tools?: string[];
        effects?: string[];
        tags?: string[];
        homepage?: string;
        repository?: string;
        signature?: string;
    };
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
    workingDir: string;
    isBuiltin?: boolean;
}, deps: CapabilityCommandDeps) {
    const source = stored.isBuiltin ? 'built_in' : 'local_folder';
    const governance = deps.getExtensionGovernanceStore().get('toolpack', stored.manifest.id);
    const trust = mergeTrustWithGovernance(
        summarizeToolpackTrust(stored.manifest, {
            isBuiltin: stored.isBuiltin,
        }),
        governance,
    );
    return {
        manifest: stored.manifest,
        source,
        rootPath: stored.workingDir,
        installedAt: stored.installedAt,
        enabled: stored.enabled,
        lastUsedAt: stored.lastUsedAt,
        status: 'stopped',
        provenance: summarizeToolpackProvenance(stored.manifest, {
            isBuiltin: stored.isBuiltin,
            sourceType: source,
            sourceRef: stored.workingDir,
        }),
        trust,
        permissions: summarizeToolpackPermissions(stored.manifest),
        governance,
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
    };
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
    isBuiltin?: boolean;
}, deps: CapabilityCommandDeps) {
    const governance = deps.getExtensionGovernanceStore().get('skill', stored.manifest.name);
    const trust = mergeTrustWithGovernance(
        summarizeSkillTrust(stored.manifest, {
            isBuiltin: stored.isBuiltin,
        }),
        governance,
    );
    return {
        manifest: {
            id: stored.manifest.name,
            name: stored.manifest.name,
            version: stored.manifest.version,
            description: stored.manifest.description,
            allowedTools: stored.manifest.allowedTools ?? [],
            tags: stored.manifest.tags ?? [],
        },
        rootPath: stored.manifest.directory,
        source: 'local_folder',
        installedAt: stored.installedAt,
        enabled: stored.enabled,
        lastUsedAt: stored.lastUsedAt,
        provenance: summarizeSkillProvenance(stored.manifest, {
            isBuiltin: stored.isBuiltin,
            sourceType: stored.isBuiltin ? 'built_in' : 'local_folder',
            sourceRef: stored.manifest.directory,
        }),
        trust,
        permissions: summarizeSkillPermissions(stored.manifest),
        governance,
    };
}

function getExistingToolpackManifest(
    toolpackStore: CapabilityCommandDeps['toolpackStore'],
    candidate: { id: string; name: string }
): ToolpackManifest | undefined {
    const byId = toolpackStore.getById(candidate.id) as { manifest?: ToolpackManifest } | undefined;
    if (byId?.manifest) {
        return byId.manifest;
    }

    const byName = toolpackStore.getById(candidate.name) as { manifest?: ToolpackManifest } | undefined;
    return byName?.manifest;
}

function buildToolpackGovernanceReview(
    toolpackStore: CapabilityCommandDeps['toolpackStore'],
    manifest: ToolpackManifest,
    approvePermissionExpansion: boolean
): ExtensionGovernanceReview {
    const previousManifest = getExistingToolpackManifest(toolpackStore, {
        id: manifest.id,
        name: manifest.name,
    });

    return buildExtensionGovernanceReview({
        extensionType: 'toolpack',
        extensionId: manifest.id,
        previous: previousManifest ? summarizeToolpackPermissions(previousManifest) : undefined,
        next: summarizeToolpackPermissions(manifest),
        blockOnPermissionExpansion: !approvePermissionExpansion,
    });
}

function tryRegisterDownloadedToolpack(
    deps: CapabilityCommandDeps,
    installPath: string,
    approvePermissionExpansion: boolean
): { governanceReview: ExtensionGovernanceReview; governanceState: ExtensionGovernanceState } | null {
    const manifestPath = path.join(installPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = ToolpackManifestSchema.parse(JSON.parse(content));
        const governanceReview = buildToolpackGovernanceReview(
            deps.toolpackStore,
            manifest as ToolpackManifest,
            approvePermissionExpansion
        );
        const governanceStore = deps.getExtensionGovernanceStore();
        if (governanceReview.blocking) {
            return {
                governanceReview,
                governanceState: governanceStore.recordReview(governanceReview, {
                    decision: 'pending',
                    quarantined: false,
                }),
            };
        }
        deps.toolpackStore.add(manifest, installPath);

        const quarantineOnFirstInstall = governanceReview.reason === 'first_install_review'
            && approvePermissionExpansion !== true;
        const governanceState = governanceStore.recordReview(governanceReview, {
            decision: quarantineOnFirstInstall ? 'pending' : 'approved',
            quarantined: quarantineOnFirstInstall,
        });
        if (governanceState.quarantined) {
            deps.toolpackStore.setEnabledById(manifest.id, false);
        }
        if (!isExtensionEnableAllowed(deps, {
            extensionType: 'toolpack',
            extensionId: manifest.id,
            isBuiltin: false,
        })) {
            deps.toolpackStore.setEnabledById(manifest.id, false);
        }
        return {
            governanceReview,
            governanceState,
        };
    } catch (error) {
        console.error('[handleCapabilityCommand] Failed to register MCP:', error);
        return null;
    }
}

async function handleInstallFromGitHub(
    command: IpcCommand,
    deps: CapabilityCommandDeps
): Promise<IpcResponse> {
    const { workspacePath, source, targetType, approvePermissionExpansion } = command.payload as {
        workspacePath: string;
        source: string;
        targetType: 'skill' | 'mcp';
        approvePermissionExpansion?: boolean;
    };

    let result: { success: boolean; path: string; filesDownloaded?: number; error?: string };
    let importResult: SkillImportResponsePayload | undefined;
    let governanceReview: ExtensionGovernanceReview | undefined;
    let governanceState: ExtensionGovernanceState | undefined;

    if (targetType === 'skill') {
        result = await deps.downloadSkillFromGitHub(source, workspacePath);
        if (result.success) {
            importResult = await deps.importSkillFromDirectory(
                result.path,
                true,
                approvePermissionExpansion === true
            );
            governanceReview = importResult.governanceReview;
            governanceState = importResult.governanceState;
        }
    } else {
        result = await deps.downloadMcpFromGitHub(source, workspacePath);
        if (result.success) {
            const registration = tryRegisterDownloadedToolpack(
                deps,
                result.path,
                approvePermissionExpansion === true
            );
            if (registration?.governanceReview.blocking) {
                return respond(command.id, 'install_from_github_response', {
                    success: false,
                    path: result.path,
                    filesDownloaded: result.filesDownloaded,
                    governanceReview: registration.governanceReview,
                    governanceState: registration.governanceState,
                    error: 'toolpack_permission_expansion_requires_review',
                });
            }
            governanceReview = registration?.governanceReview;
            governanceState = registration?.governanceState;
        }
    }

    return respond(command.id, 'install_from_github_response', {
        success: targetType === 'skill'
            ? result.success && (importResult?.success ?? false)
            : result.success,
        path: result.path,
        filesDownloaded: result.filesDownloaded,
        importResult,
        governanceReview,
        governanceState,
        error: result.error ?? importResult?.error,
    });
}

function handleInstallToolpack(command: IpcCommand, deps: CapabilityCommandDeps): IpcResponse {
    const { source, path: inputPath, allowUnsigned, approvePermissionExpansion } = command.payload as {
        source: string;
        path?: string;
        allowUnsigned?: boolean;
        approvePermissionExpansion?: boolean;
    };

    if (source !== 'local_folder') {
        return respond(command.id, 'install_toolpack_response', {
            success: false,
            error: 'unsupported_source',
        });
    }

    if (!inputPath) {
        return respond(command.id, 'install_toolpack_response', {
            success: false,
            error: 'missing_path',
        });
    }

    const stat = safeStat(inputPath);
    if (!stat) {
        return respond(command.id, 'install_toolpack_response', {
            success: false,
            error: 'path_not_found',
        });
    }

    let manifestPath = inputPath;
    let workingDir = inputPath;
    if (stat.isDirectory()) {
        const candidates = [
            path.join(inputPath, 'toolpack.json'),
            path.join(inputPath, 'mcp.json'),
        ];
        const found = candidates.find((candidate) => fs.existsSync(candidate));
        if (!found) {
            return respond(command.id, 'install_toolpack_response', {
                success: false,
                error: 'missing_toolpack_manifest',
            });
        }
        manifestPath = found;
    } else {
        workingDir = path.dirname(inputPath);
    }

    try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        const normalized = ensureToolpackId(raw);
        const parsed = ToolpackManifestSchema.safeParse(normalized);
        if (!parsed.success) {
            return respond(command.id, 'install_toolpack_response', {
                success: false,
                error: 'invalid_manifest',
            });
        }

        if (!parsed.data.signature && !allowUnsigned) {
            return respond(command.id, 'install_toolpack_response', {
                success: false,
                error: 'unsigned_toolpack',
            });
        }

        const governanceReview = buildToolpackGovernanceReview(
            deps.toolpackStore,
            parsed.data as ToolpackManifest,
            approvePermissionExpansion === true
        );
        const governanceStore = deps.getExtensionGovernanceStore();
        if (governanceReview.blocking) {
            const governanceState = governanceStore.recordReview(governanceReview, {
                decision: 'pending',
                quarantined: false,
            });
            return respond(command.id, 'install_toolpack_response', {
                success: false,
                governanceReview,
                governanceState,
                error: 'toolpack_permission_expansion_requires_review',
            });
        }

        deps.toolpackStore.add(parsed.data as ToolpackManifest, workingDir);
        const quarantineOnFirstInstall = governanceReview.reason === 'first_install_review'
            && approvePermissionExpansion !== true;
        const governanceState = governanceStore.recordReview(governanceReview, {
            decision: quarantineOnFirstInstall ? 'pending' : 'approved',
            quarantined: quarantineOnFirstInstall,
        });
        if (governanceState.quarantined) {
            deps.toolpackStore.setEnabledById(parsed.data.id, false);
        }
        if (!isExtensionEnableAllowed(deps, {
            extensionType: 'toolpack',
            extensionId: parsed.data.id,
            isBuiltin: false,
        })) {
            deps.toolpackStore.setEnabledById(parsed.data.id, false);
        }
        return respond(command.id, 'install_toolpack_response', {
            success: true,
            toolpackId: parsed.data.id,
            governanceReview,
            governanceState,
        });
    } catch (error) {
        return respond(command.id, 'install_toolpack_response', {
            success: false,
            error: error instanceof Error ? error.message : 'install_failed',
        });
    }
}

export async function handleCapabilityCommand(
    command: IpcCommand,
    deps: CapabilityCommandDeps
): Promise<IpcResponse | null> {
    switch (command.type) {
        case 'list_toolpacks': {
            const includeDisabled = (command.payload as { includeDisabled?: boolean } | undefined)?.includeDisabled ?? true;
            const toolpacks = deps.toolpackStore
                .list()
                .filter((tp) => includeDisabled || tp.enabled)
                .map((tp) => toToolpackRecord(tp as any, deps));
            return respond(command.id, 'list_toolpacks_response', { toolpacks: toolpacks as any });
        }
        case 'get_toolpack': {
            const toolpackId = (command.payload as { toolpackId: string }).toolpackId;
            const stored = deps.toolpackStore.getById(toolpackId);
            return respond(command.id, 'get_toolpack_response', {
                toolpack: (stored ? toToolpackRecord(stored as any, deps) : undefined) as any,
            });
        }
        case 'install_toolpack':
            return handleInstallToolpack(command, deps);
        case 'set_toolpack_enabled': {
            const { toolpackId, enabled } = command.payload as {
                toolpackId: string;
                enabled: boolean;
            };
            if (enabled) {
                const stored = deps.toolpackStore.getById(toolpackId) as
                    | { isBuiltin?: boolean; manifest?: { id?: string; name?: string } }
                    | undefined;
                const extensionId = stored?.manifest?.id ?? stored?.manifest?.name ?? toolpackId;
                if (!isExtensionEnableAllowed(deps, {
                    extensionType: 'toolpack',
                    extensionId,
                    isBuiltin: stored?.isBuiltin === true,
                })) {
                    return respond(command.id, 'set_toolpack_enabled_response', {
                        success: false,
                        toolpackId,
                        error: 'workspace_extension_not_allowlisted',
                    });
                }
            }
            const success = deps.toolpackStore.setEnabledById(toolpackId, enabled);
            return respond(command.id, 'set_toolpack_enabled_response', {
                success,
                toolpackId,
                error: success ? undefined : 'toolpack_not_found',
            });
        }
        case 'remove_toolpack': {
            const { toolpackId, deleteFiles } = command.payload as {
                toolpackId: string;
                deleteFiles?: boolean;
            };
            const record = deps.toolpackStore.getById(toolpackId) as { workingDir?: string } | undefined;
            const success = deps.toolpackStore.removeById(toolpackId);
            if (success && deleteFiles !== false && record?.workingDir) {
                try {
                    fs.rmSync(record.workingDir, { recursive: true, force: true });
                } catch (error) {
                    console.error('[handleCapabilityCommand] Failed to delete toolpack files:', error);
                }
            }
            if (success) {
                const extensionId = (record as { manifest?: { id?: string; name?: string } } | undefined)?.manifest?.id
                    ?? (record as { manifest?: { id?: string; name?: string } } | undefined)?.manifest?.name
                    ?? toolpackId;
                deps.getExtensionGovernanceStore().clear('toolpack', extensionId);
            }
            return respond(command.id, 'remove_toolpack_response', {
                success,
                toolpackId,
                error: success ? undefined : 'toolpack_not_found',
            });
        }
        case 'list_claude_skills': {
            const includeDisabled = (command.payload as { includeDisabled?: boolean } | undefined)?.includeDisabled ?? true;
            const skills = deps.skillStore
                .list()
                .filter((skill) => includeDisabled || skill.enabled)
                .map((skill) => toSkillRecord(skill as any, deps));
            return respond(command.id, 'list_claude_skills_response', { skills: skills as any });
        }
        case 'get_claude_skill': {
            const skillId = (command.payload as { skillId: string }).skillId;
            const stored = deps.skillStore.get(skillId);
            return respond(command.id, 'get_claude_skill_response', {
                skill: (stored ? toSkillRecord(stored as any, deps) : undefined) as any,
            });
        }
        case 'import_claude_skill': {
            const { source, path: inputPath, autoInstallDependencies, approvePermissionExpansion } = command.payload as {
                source: string;
                path?: string;
                autoInstallDependencies?: boolean;
                approvePermissionExpansion?: boolean;
            };

            if (source !== 'local_folder') {
                return respond(command.id, 'import_claude_skill_response', {
                    success: false,
                    error: 'unsupported_source',
                });
            }

            if (!inputPath) {
                return respond(command.id, 'import_claude_skill_response', {
                    success: false,
                    error: 'missing_path',
                });
            }

            const importResult = await deps.importSkillFromDirectory(
                inputPath,
                autoInstallDependencies !== false,
                approvePermissionExpansion === true
            );
            return respond(command.id, 'import_claude_skill_response', importResult);
        }
        case 'set_claude_skill_enabled': {
            const { skillId, enabled } = command.payload as {
                skillId: string;
                enabled: boolean;
            };
            if (enabled) {
                const stored = deps.skillStore.get(skillId) as
                    | { isBuiltin?: boolean; manifest?: { name?: string } }
                    | undefined;
                const extensionId = stored?.manifest?.name ?? skillId;
                if (!isExtensionEnableAllowed(deps, {
                    extensionType: 'skill',
                    extensionId,
                    isBuiltin: stored?.isBuiltin === true,
                })) {
                    return respond(command.id, 'set_claude_skill_enabled_response', {
                        success: false,
                        skillId,
                        error: 'workspace_extension_not_allowlisted',
                    });
                }
            }
            const success = deps.skillStore.setEnabled(skillId, enabled);
            return respond(command.id, 'set_claude_skill_enabled_response', {
                success,
                skillId,
                error: success ? undefined : 'skill_not_found',
            });
        }
        case 'approve_extension_governance': {
            const { extensionType, extensionId, enableAfterApprove } = command.payload as {
                extensionType: 'skill' | 'toolpack';
                extensionId: string;
                enableAfterApprove?: boolean;
            };
            const governanceStore = deps.getExtensionGovernanceStore();
            const existing = governanceStore.get(extensionType, extensionId);
            if (!existing) {
                return respond(command.id, 'approve_extension_governance_response', {
                    success: false,
                    extensionType,
                    extensionId,
                    error: 'governance_record_not_found',
                });
            }

            let enabled: boolean | undefined;
            const shouldEnable = enableAfterApprove !== false;
            if (shouldEnable) {
                if (!isExtensionEnableAllowed(deps, {
                    extensionType,
                    extensionId,
                })) {
                    return respond(command.id, 'approve_extension_governance_response', {
                        success: false,
                        extensionType,
                        extensionId,
                        governanceState: existing,
                        enabled: false,
                        error: 'workspace_extension_not_allowlisted',
                    });
                }
                enabled = extensionType === 'skill'
                    ? deps.skillStore.setEnabled(extensionId, true)
                    : deps.toolpackStore.setEnabledById(extensionId, true);
                if (enabled !== true) {
                    return respond(command.id, 'approve_extension_governance_response', {
                        success: false,
                        extensionType,
                        extensionId,
                        governanceState: existing,
                        enabled,
                        error: 'extension_not_found',
                    });
                }
            }

            const governanceState = governanceStore.markApproved(extensionType, extensionId);
            if (!governanceState) {
                return respond(command.id, 'approve_extension_governance_response', {
                    success: false,
                    extensionType,
                    extensionId,
                    error: 'governance_record_not_found',
                });
            }

            return respond(command.id, 'approve_extension_governance_response', {
                success: true,
                extensionType,
                extensionId,
                governanceState,
                enabled,
            });
        }
        case 'remove_claude_skill': {
            const { skillId, deleteFiles } = command.payload as {
                skillId: string;
                deleteFiles?: boolean;
            };
            const record = deps.skillStore.get(skillId) as { manifest?: { directory?: string } } | undefined;
            const success = deps.skillStore.uninstall(skillId);
            if (success && deleteFiles !== false && record?.manifest?.directory) {
                try {
                    fs.rmSync(record.manifest.directory, { recursive: true, force: true });
                } catch (error) {
                    console.error('[handleCapabilityCommand] Failed to delete skill files:', error);
                }
            }
            if (success) {
                deps.getExtensionGovernanceStore().clear('skill', skillId);
            }
            return respond(command.id, 'remove_claude_skill_response', {
                success,
                skillId,
                error: success ? undefined : 'skill_not_found',
            });
        }
        case 'list_directives': {
            return respond(command.id, 'list_directives_response', {
                directives: deps.getDirectiveManager().listDirectives(),
            });
        }
        case 'upsert_directive': {
            const { directive } = command.payload as { directive: Directive };
            const saved = deps.getDirectiveManager().upsertDirective(directive);
            return respond(command.id, 'upsert_directive_response', {
                success: true,
                directive: saved,
            });
        }
        case 'remove_directive': {
            const { directiveId } = command.payload as { directiveId: string };
            const success = deps.getDirectiveManager().removeDirective(directiveId);
            return respond(command.id, 'remove_directive_response', {
                success,
                directiveId,
                error: success ? undefined : 'directive_not_found',
            });
        }
        case 'install_from_github':
            return handleInstallFromGitHub(command, deps);
        case 'validate_github_url': {
            const { url, type } = command.payload as { url: string; type: string };
            const result = type === 'skill'
                ? await deps.validateSkillUrl(url)
                : await deps.validateMcpUrl(url);
            return respond(command.id, 'validate_github_url_response', result);
        }
        case 'scan_default_repos': {
            const result = await deps.scanDefaultRepositories();
            return respond(command.id, 'scan_default_repos_response', {
                skills: result.skills,
                mcpServers: result.mcpServers,
                errors: result.errors,
            });
        }
        default:
            return null;
    }
}
