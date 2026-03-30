import * as fs from 'fs';
import * as path from 'path';
import {
    type IpcCommand,
    type IpcResponse,
    ToolpackManifestSchema,
} from '../protocol';
import type { Directive, DirectiveManager } from '../directives/directiveManager';
import type { ToolpackStore } from '../storage/toolpackStore';
import type { SkillStore } from '../storage/skillStore';
import type { ToolpackManifest } from '../protocol/commands';
export type SkillImportResponsePayload = {
    success: boolean;
    skillId?: string;
    error?: string;
    warnings?: string[];
    dependencyCheck?: unknown;
    installResults?: unknown[];
};
export type CapabilityCommandDeps = {
    skillStore: Pick<SkillStore, 'list' | 'get' | 'install' | 'setEnabled' | 'uninstall'>;
    toolpackStore: Pick<ToolpackStore, 'list' | 'getById' | 'add' | 'setEnabledById' | 'removeById'>;
    getDirectiveManager: () => Pick<DirectiveManager, 'listDirectives' | 'upsertDirective' | 'removeDirective'>;
    importSkillFromDirectory: (
        inputPath: string,
        autoInstallDependencies?: boolean,
        approvePermissionExpansion?: boolean
    ) => Promise<SkillImportResponsePayload>;
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
        case 'approve_extension_governance':
        case 'install_from_github':
        case 'validate_github_url':
        case 'scan_default_repos': {
            return unsupportedSinglePath(command);
        }
        default:
            return null;
    }
}
