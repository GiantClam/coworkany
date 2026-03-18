import * as fs from 'fs';
import * as path from 'path';
import {
    type IpcCommand,
    type IpcResponse,
    ToolpackManifestSchema,
} from '../protocol';
import type { Directive, DirectiveManager } from '../agent/directives/directiveManager';
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
        autoInstallDependencies?: boolean
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
}) {
    return {
        manifest: stored.manifest,
        source: 'local_folder',
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
}) {
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
    };
}

function tryRegisterDownloadedToolpack(
    toolpackStore: CapabilityCommandDeps['toolpackStore'],
    installPath: string
): void {
    const manifestPath = path.join(installPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return;
    }

    try {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = ToolpackManifestSchema.parse(JSON.parse(content));
        toolpackStore.add(manifest, installPath);
    } catch (error) {
        console.error('[handleCapabilityCommand] Failed to register MCP:', error);
    }
}

async function handleInstallFromGitHub(
    command: IpcCommand,
    deps: CapabilityCommandDeps
): Promise<IpcResponse> {
    const { workspacePath, source, targetType } = command.payload as {
        workspacePath: string;
        source: string;
        targetType: 'skill' | 'mcp';
    };

    let result: { success: boolean; path: string; filesDownloaded?: number; error?: string };
    let importResult: SkillImportResponsePayload | undefined;

    if (targetType === 'skill') {
        result = await deps.downloadSkillFromGitHub(source, workspacePath);
        if (result.success) {
            importResult = await deps.importSkillFromDirectory(result.path, true);
        }
    } else {
        result = await deps.downloadMcpFromGitHub(source, workspacePath);
        if (result.success) {
            tryRegisterDownloadedToolpack(deps.toolpackStore, result.path);
        }
    }

    return respond(command.id, 'install_from_github_response', {
        success: targetType === 'skill'
            ? result.success && (importResult?.success ?? false)
            : result.success,
        path: result.path,
        filesDownloaded: result.filesDownloaded,
        importResult,
        error: result.error ?? importResult?.error,
    });
}

function handleInstallToolpack(command: IpcCommand, deps: CapabilityCommandDeps): IpcResponse {
    const { source, path: inputPath, allowUnsigned } = command.payload as {
        source: string;
        path?: string;
        allowUnsigned?: boolean;
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

        deps.toolpackStore.add(parsed.data as ToolpackManifest, workingDir);
        return respond(command.id, 'install_toolpack_response', {
            success: true,
            toolpackId: parsed.data.id,
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
                .map((tp) => toToolpackRecord(tp as any));
            return respond(command.id, 'list_toolpacks_response', { toolpacks: toolpacks as any });
        }
        case 'get_toolpack': {
            const toolpackId = (command.payload as { toolpackId: string }).toolpackId;
            const stored = deps.toolpackStore.getById(toolpackId);
            return respond(command.id, 'get_toolpack_response', {
                toolpack: (stored ? toToolpackRecord(stored as any) : undefined) as any,
            });
        }
        case 'install_toolpack':
            return handleInstallToolpack(command, deps);
        case 'set_toolpack_enabled': {
            const { toolpackId, enabled } = command.payload as {
                toolpackId: string;
                enabled: boolean;
            };
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
                .map((skill) => toSkillRecord(skill as any));
            return respond(command.id, 'list_claude_skills_response', { skills: skills as any });
        }
        case 'get_claude_skill': {
            const skillId = (command.payload as { skillId: string }).skillId;
            const stored = deps.skillStore.get(skillId);
            return respond(command.id, 'get_claude_skill_response', {
                skill: (stored ? toSkillRecord(stored as any) : undefined) as any,
            });
        }
        case 'import_claude_skill': {
            const { source, path: inputPath, autoInstallDependencies } = command.payload as {
                source: string;
                path?: string;
                autoInstallDependencies?: boolean;
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
                autoInstallDependencies !== false
            );
            return respond(command.id, 'import_claude_skill_response', importResult);
        }
        case 'set_claude_skill_enabled': {
            const { skillId, enabled } = command.payload as {
                skillId: string;
                enabled: boolean;
            };
            const success = deps.skillStore.setEnabled(skillId, enabled);
            return respond(command.id, 'set_claude_skill_enabled_response', {
                success,
                skillId,
                error: success ? undefined : 'skill_not_found',
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
