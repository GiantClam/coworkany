import * as fs from 'fs';
import * as path from 'path';
import { BrowserService, type BrowserMode } from '../services/browserService';
import { SkillStore, type ClaudeSkillManifest, type StoredSkill } from '../storage/skillStore';
import type { Workspace, WorkspaceStore } from '../storage/workspaceStore';
import { type ToolDefinition } from './standard';
import { setSearchConfig, type SearchProvider } from './websearch';

type ManagedLlmConfig = {
    provider?: string;
    anthropic?: {
        apiKey?: string;
        model?: string;
    };
    openrouter?: {
        apiKey?: string;
        model?: string;
    };
    openai?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    };
    ollama?: {
        baseUrl?: string;
        model?: string;
    };
    custom?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        apiFormat?: 'anthropic' | 'openai';
    };
    profiles?: Array<Record<string, unknown>>;
    activeProfileId?: string;
    maxHistoryMessages?: number;
    search?: {
        provider?: SearchProvider;
        searxngUrl?: string;
        tavilyApiKey?: string;
        braveApiKey?: string;
        serperApiKey?: string;
    };
    browserUse?: {
        enabled?: boolean;
        serviceUrl?: string;
        defaultMode?: BrowserMode;
        llmModel?: string;
    };
    [key: string]: unknown;
};

type SkillImportResponsePayload = {
    success: boolean;
    skillId?: string;
    error?: string;
    warnings?: string[];
    dependencyCheck?: unknown;
    installResults?: unknown[];
};

export type AppManagementToolDeps = {
    workspaceRoot: string;
    getResolvedAppDataRoot: () => string;
    skillStore: Pick<SkillStore, 'list' | 'get' | 'install' | 'setEnabled' | 'uninstall'>;
    workspaceStore: Pick<WorkspaceStore, 'list' | 'create' | 'update' | 'delete'>;
    importSkillFromDirectory?: (
        inputPath: string,
        autoInstallDependencies?: boolean
    ) => Promise<SkillImportResponsePayload>;
    applyLlmConfig?: (config: ManagedLlmConfig) => void;
};

type ConfigLoadResult = {
    config: ManagedLlmConfig;
    configPath: string;
    source: 'app_data' | 'workspace' | 'default';
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function buildConfigCandidatePaths(workspaceRoot: string, appDataRoot: string): string[] {
    return [
        path.join(appDataRoot, 'llm-config.json'),
        path.join(workspaceRoot, 'llm-config.json'),
    ];
}

function loadManagedLlmConfig(workspaceRoot: string, appDataRoot: string): ConfigLoadResult {
    const defaultConfig: ManagedLlmConfig = { provider: 'anthropic' };
    const [appDataConfigPath, workspaceConfigPath] = buildConfigCandidatePaths(workspaceRoot, appDataRoot);
    const configPath = [appDataConfigPath, workspaceConfigPath].find((candidate) => fs.existsSync(candidate));

    if (!configPath) {
        return {
            config: defaultConfig,
            configPath: appDataConfigPath,
            source: 'default',
        };
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    return {
        config: JSON.parse(raw) as ManagedLlmConfig,
        configPath,
        source: configPath === appDataConfigPath ? 'app_data' : 'workspace',
    };
}

function saveManagedLlmConfig(configPath: string, config: ManagedLlmConfig): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function applyManagedLlmConfig(config: ManagedLlmConfig): void {
    if (config.search) {
        setSearchConfig({
            provider: config.search.provider || 'searxng',
            searxngUrl: config.search.searxngUrl,
            tavilyApiKey: config.search.tavilyApiKey,
            braveApiKey: config.search.braveApiKey,
            serperApiKey: config.search.serperApiKey,
        });
    }

    if (config.browserUse) {
        const browserService = BrowserService.getInstance(config.browserUse.serviceUrl);
        if (config.browserUse.defaultMode) {
            browserService.setMode(config.browserUse.defaultMode);
        }
    }
}

function getValueAtPath(target: unknown, fieldPath?: string): unknown {
    if (!fieldPath) {
        return target;
    }

    const segments = fieldPath.split('.').map((segment) => segment.trim()).filter(Boolean);
    let current: unknown = target;
    for (const segment of segments) {
        if (!isPlainObject(current) && !Array.isArray(current)) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
        if (typeof current === 'undefined') {
            return undefined;
        }
    }
    return current;
}

function setValueAtPath(target: Record<string, unknown>, fieldPath: string, value: unknown): void {
    const segments = fieldPath.split('.').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
        throw new Error('field_path must not be empty');
    }

    let current: Record<string, unknown> = target;
    for (const segment of segments.slice(0, -1)) {
        const existing = current[segment];
        if (!isPlainObject(existing)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }

    current[segments[segments.length - 1]!] = value;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(patch)) {
        const existing = merged[key];
        if (isPlainObject(existing) && isPlainObject(value)) {
            merged[key] = deepMerge(existing, value);
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

function isSecretSegment(segment: string): boolean {
    return /(api[-_]?key|token|secret|password|credential)/i.test(segment);
}

function redactSecrets(value: unknown, currentPath = ''): unknown {
    if (Array.isArray(value)) {
        return value.map((entry, index) => redactSecrets(entry, `${currentPath}[${index}]`));
    }

    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entryValue]) => {
                const nextPath = currentPath ? `${currentPath}.${key}` : key;
                if (isSecretSegment(key)) {
                    return [key, typeof entryValue === 'undefined' ? undefined : '[REDACTED]'];
                }
                return [key, redactSecrets(entryValue, nextPath)];
            })
        );
    }

    const leaf = currentPath.split('.').pop() || currentPath;
    if (typeof value === 'string' && leaf && isSecretSegment(leaf)) {
        return '[REDACTED]';
    }

    return value;
}

function redactResolvedValue(value: unknown, fieldPath?: string): unknown {
    if (!fieldPath) {
        return redactSecrets(value);
    }

    const leaf = fieldPath.split('.').pop() || fieldPath;
    if (isSecretSegment(leaf) && typeof value !== 'undefined') {
        return '[REDACTED]';
    }

    return redactSecrets(value, fieldPath);
}

function buildManagedWorkspacePath(name: string, requestedPath: string | undefined, appDataRoot: string): string {
    if (requestedPath && requestedPath !== 'default') {
        return requestedPath;
    }

    const workspacesDir = appDataRoot
        ? path.join(appDataRoot, 'workspaces')
        : path.join(process.cwd(), 'workspaces');
    fs.mkdirSync(workspacesDir, { recursive: true });

    const safeName = (name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'workspace');
    const preferredPath = path.join(workspacesDir, safeName);
    if (!fs.existsSync(preferredPath)) {
        return preferredPath;
    }

    return path.join(workspacesDir, `${safeName}_${Date.now()}`);
}

function toSkillSummary(skill: StoredSkill): Record<string, unknown> {
    return {
        id: skill.manifest.name,
        name: skill.manifest.name,
        version: skill.manifest.version,
        description: skill.manifest.description,
        enabled: skill.enabled,
        isBuiltin: skill.isBuiltin === true,
        installedAt: skill.installedAt,
        lastUsedAt: skill.lastUsedAt,
        directory: skill.manifest.directory,
        tags: skill.manifest.tags ?? [],
        allowedTools: skill.manifest.allowedTools ?? [],
    };
}

function importSkillDirectly(
    skillStore: Pick<SkillStore, 'install'>,
    inputPath: string
): SkillImportResponsePayload {
    const manifest = SkillStore.loadFromDirectory(inputPath);
    if (!manifest) {
        return {
            success: false,
            error: 'missing_skill_manifest',
        };
    }

    skillStore.install(manifest as ClaudeSkillManifest);
    return {
        success: true,
        skillId: manifest.name,
    };
}

export function createAppManagementTools(deps: AppManagementToolDeps): ToolDefinition[] {
    const applyConfig = deps.applyLlmConfig ?? applyManagedLlmConfig;

    return [
        {
            name: 'get_coworkany_paths',
            description: 'Inspect CoworkAny runtime paths, including app data, config file, workspace root, workspace registry, and local skill directories. Use this when the user asks where CoworkAny stores its own files or configuration.',
            effects: ['filesystem:read'],
            input_schema: {
                type: 'object',
                properties: {},
            },
            handler: async () => {
                const appDataRoot = deps.getResolvedAppDataRoot();
                const { configPath, source } = loadManagedLlmConfig(deps.workspaceRoot, appDataRoot);

                return {
                    workspaceRoot: deps.workspaceRoot,
                    appDataRoot,
                    llmConfigPath: configPath,
                    llmConfigSource: source,
                    workspaceRegistryPath: path.join(appDataRoot, 'workspaces.json'),
                    workspaceRootSkillsPath: path.join(deps.workspaceRoot, '.coworkany', 'skills'),
                    workspaceRootSkillRegistryPath: path.join(deps.workspaceRoot, '.coworkany', 'skills.json'),
                };
            },
        },
        {
            name: 'get_coworkany_config',
            description: 'Read CoworkAny app configuration from llm-config.json, including search providers and API keys. Set reveal_secret=true only when the user explicitly asks for an exact secret value such as serperApiKey.',
            effects: ['filesystem:read'],
            input_schema: {
                type: 'object',
                properties: {
                    field_path: {
                        type: 'string',
                        description: 'Optional dot path such as search.serperApiKey or browserUse.defaultMode.',
                    },
                    reveal_secret: {
                        type: 'boolean',
                        description: 'Whether to return the exact secret value instead of redacting it.',
                    },
                },
            },
            handler: async (args: { field_path?: string; reveal_secret?: boolean }) => {
                const appDataRoot = deps.getResolvedAppDataRoot();
                const loaded = loadManagedLlmConfig(deps.workspaceRoot, appDataRoot);
                const value = getValueAtPath(loaded.config, args.field_path);
                const shouldReveal = args.reveal_secret === true;

                return {
                    found: typeof value !== 'undefined',
                    fieldPath: args.field_path,
                    configPath: loaded.configPath,
                    source: loaded.source,
                    value: shouldReveal
                        ? value
                        : redactResolvedValue(
                            typeof value === 'undefined' ? loaded.config : value,
                            args.field_path
                        ),
                };
            },
        },
        {
            name: 'update_coworkany_config',
            description: 'Update CoworkAny app configuration in llm-config.json. Use field_path plus value for a focused edit, or merge for a partial object update. This is the tool to let CoworkAny self-configure search keys, providers, browser mode, and similar settings.',
            effects: ['filesystem:read', 'filesystem:write'],
            input_schema: {
                type: 'object',
                properties: {
                    field_path: {
                        type: 'string',
                        description: 'Optional dot path to write, for example search.provider or search.serperApiKey.',
                    },
                    value: {
                        description: 'Value to set at field_path.',
                    },
                    merge: {
                        type: 'object',
                        description: 'Partial config object to deep-merge into the current config.',
                        additionalProperties: true,
                    },
                    reveal_secret: {
                        type: 'boolean',
                        description: 'Whether to include exact secret values in the returned updatedValue.',
                    },
                },
            },
            handler: async (args: {
                field_path?: string;
                value?: unknown;
                merge?: Record<string, unknown>;
                reveal_secret?: boolean;
            }) => {
                if (!args.field_path && !args.merge) {
                    return { error: 'Either field_path or merge is required.' };
                }

                const appDataRoot = deps.getResolvedAppDataRoot();
                const loaded = loadManagedLlmConfig(deps.workspaceRoot, appDataRoot);
                const nextConfig = cloneJson(loaded.config) as ManagedLlmConfig;

                if (args.merge) {
                    Object.assign(nextConfig, deepMerge(nextConfig, args.merge));
                }

                if (args.field_path) {
                    setValueAtPath(nextConfig as Record<string, unknown>, args.field_path, args.value);
                }

                saveManagedLlmConfig(loaded.configPath, nextConfig);
                applyConfig(nextConfig);

                const updatedValue = args.field_path
                    ? getValueAtPath(nextConfig, args.field_path)
                    : nextConfig;
                const shouldReveal = args.reveal_secret === true;

                return {
                    success: true,
                    configPath: loaded.configPath,
                    source: loaded.source,
                    updatedFieldPath: args.field_path,
                    updatedValue: shouldReveal
                        ? updatedValue
                        : redactResolvedValue(updatedValue, args.field_path),
                };
            },
        },
        {
            name: 'list_coworkany_workspaces',
            description: 'List CoworkAny managed workspaces from workspaces.json. Use this when the user asks about CoworkAny directories or configured workspaces.',
            effects: ['filesystem:read'],
            input_schema: {
                type: 'object',
                properties: {},
            },
            handler: async () => ({
                workspaces: cloneJson(deps.workspaceStore.list()),
            }),
        },
        {
            name: 'create_coworkany_workspace',
            description: 'Create a CoworkAny managed workspace entry and initialize its .coworkany directories. Pass path=\"default\" to let CoworkAny pick a managed directory under its app data root.',
            effects: ['filesystem:read', 'filesystem:write'],
            input_schema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Workspace display name.',
                    },
                    path: {
                        type: 'string',
                        description: 'Absolute path for the workspace, or "default" to let CoworkAny choose one.',
                    },
                },
            },
            handler: async (args: { name: string; path?: string }) => {
                const finalPath = buildManagedWorkspacePath(args.name, args.path, deps.getResolvedAppDataRoot());
                const workspace = deps.workspaceStore.create(args.name, finalPath);
                return {
                    success: true,
                    workspace: cloneJson(workspace),
                };
            },
        },
        {
            name: 'update_coworkany_workspace',
            description: 'Update CoworkAny workspace metadata such as the display name or default skills.',
            effects: ['filesystem:read', 'filesystem:write'],
            input_schema: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'Workspace id.',
                    },
                    updates: {
                        type: 'object',
                        additionalProperties: true,
                        description: 'Partial workspace fields to update.',
                    },
                },
                required: ['id', 'updates'],
            },
            handler: async (args: { id: string; updates: Partial<Omit<Workspace, 'id' | 'createdAt'>> }) => {
                const workspace = deps.workspaceStore.update(args.id, args.updates);
                return {
                    success: !!workspace,
                    workspace: workspace ? cloneJson(workspace) : undefined,
                };
            },
        },
        {
            name: 'delete_coworkany_workspace',
            description: 'Remove a CoworkAny workspace entry from workspaces.json without deleting the actual files on disk.',
            effects: ['filesystem:read', 'filesystem:write'],
            input_schema: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'Workspace id.',
                    },
                },
                required: ['id'],
            },
            handler: async (args: { id: string }) => ({
                success: deps.workspaceStore.delete(args.id),
            }),
        },
        {
            name: 'list_coworkany_skills',
            description: 'List CoworkAny installed and builtin skills for the current workspace, including whether they are enabled.',
            effects: ['filesystem:read'],
            input_schema: {
                type: 'object',
                properties: {},
            },
            handler: async () => ({
                skills: deps.skillStore.list().map((skill) => toSkillSummary(skill as StoredSkill)),
            }),
        },
        {
            name: 'get_coworkany_skill',
            description: 'Inspect one CoworkAny skill by id or name, including its directory, status, tags, and allowed tools.',
            effects: ['filesystem:read'],
            input_schema: {
                type: 'object',
                properties: {
                    skill_id: {
                        type: 'string',
                        description: 'Skill id or name.',
                    },
                },
                required: ['skill_id'],
            },
            handler: async (args: { skill_id: string }) => {
                const skill = deps.skillStore.get(args.skill_id);
                return {
                    found: !!skill,
                    skill: skill ? toSkillSummary(skill as StoredSkill) : undefined,
                };
            },
        },
        {
            name: 'install_coworkany_skill',
            description: 'Install a CoworkAny skill from a local folder containing SKILL.md. This registers the skill so CoworkAny can use it in the current workspace.',
            effects: ['filesystem:read', 'filesystem:write', 'process:spawn'],
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute path to a local skill directory that contains SKILL.md.',
                    },
                    auto_install_dependencies: {
                        type: 'boolean',
                        description: 'Whether CoworkAny should try to auto-install declared dependencies while importing the skill.',
                    },
                },
                required: ['path'],
            },
            handler: async (args: { path: string; auto_install_dependencies?: boolean }) => {
                const result = deps.importSkillFromDirectory
                    ? await deps.importSkillFromDirectory(args.path, args.auto_install_dependencies ?? true)
                    : importSkillDirectly(deps.skillStore, args.path);

                return result;
            },
        },
        {
            name: 'set_coworkany_skill_enabled',
            description: 'Enable or disable an installed CoworkAny skill in the current workspace.',
            effects: ['filesystem:read', 'filesystem:write'],
            input_schema: {
                type: 'object',
                properties: {
                    skill_id: {
                        type: 'string',
                        description: 'Skill id or name.',
                    },
                    enabled: {
                        type: 'boolean',
                        description: 'Whether the skill should be enabled.',
                    },
                },
                required: ['skill_id', 'enabled'],
            },
            handler: async (args: { skill_id: string; enabled: boolean }) => {
                const skill = deps.skillStore.get(args.skill_id);
                if (skill?.isBuiltin) {
                    return {
                        success: args.enabled,
                        error: args.enabled ? undefined : 'builtin_skill_cannot_be_disabled',
                    };
                }

                return {
                    success: deps.skillStore.setEnabled(args.skill_id, args.enabled),
                };
            },
        },
        {
            name: 'remove_coworkany_skill',
            description: 'Uninstall a CoworkAny skill from the current workspace. By default it also deletes the skill directory on disk for non-builtin skills.',
            effects: ['filesystem:read', 'filesystem:write', 'filesystem:delete'],
            input_schema: {
                type: 'object',
                properties: {
                    skill_id: {
                        type: 'string',
                        description: 'Skill id or name.',
                    },
                    delete_files: {
                        type: 'boolean',
                        description: 'Whether to delete the skill directory from disk after uninstalling it.',
                    },
                },
                required: ['skill_id'],
            },
            handler: async (args: { skill_id: string; delete_files?: boolean }) => {
                const skill = deps.skillStore.get(args.skill_id);
                if (!skill) {
                    return {
                        success: false,
                        error: 'skill_not_found',
                    };
                }

                if (skill.isBuiltin) {
                    return {
                        success: false,
                        error: 'builtin_skill_cannot_be_removed',
                    };
                }

                const removed = deps.skillStore.uninstall(args.skill_id);
                let filesDeleted = false;
                if (removed && args.delete_files !== false && skill.manifest.directory && fs.existsSync(skill.manifest.directory)) {
                    fs.rmSync(skill.manifest.directory, { recursive: true, force: true });
                    filesDeleted = true;
                }

                return {
                    success: removed,
                    filesDeleted,
                };
            },
        },
    ];
}
