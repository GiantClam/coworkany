import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { ClawHubSkillInfo } from '../claude_skills/openclawCompat';
import {
    summarizeSkillPermissions,
    summarizeSkillProvenance,
    summarizeSkillTrust,
} from '../extensions/governance';
import type {
    ExtensionGovernanceState,
    ExtensionGovernanceStore,
} from '../extensions/governanceStore';
import {
    isWorkspaceExtensionAllowed,
    loadWorkspaceExtensionAllowlistPolicy,
    saveWorkspaceExtensionAllowlistPolicy,
} from '../extensions/workspaceExtensionAllowlist';
import { BrowserService, type BrowserMode } from '../services/browserService';
import { SkillStore, type ClaudeSkillManifest, type StoredSkill } from '../storage/skillStore';
import type { Workspace, WorkspaceStore } from '../storage/workspaceStore';
import type { ExtensionGovernanceReview } from '../extensions/governance';
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
    governanceReview?: ExtensionGovernanceReview;
    governanceState?: ExtensionGovernanceState;
};

export type AppManagementToolDeps = {
    workspaceRoot: string;
    getResolvedAppDataRoot: () => string;
    skillStore: Pick<SkillStore, 'list' | 'get' | 'install' | 'setEnabled' | 'uninstall'>;
    getExtensionGovernanceStore?: () => Pick<ExtensionGovernanceStore, 'get' | 'markApproved'>;
    workspaceStore: Pick<WorkspaceStore, 'list' | 'create' | 'update' | 'delete'>;
    importSkillFromDirectory?: (
        inputPath: string,
        autoInstallDependencies?: boolean,
        approvePermissionExpansion?: boolean
    ) => Promise<SkillImportResponsePayload>;
    downloadSkillFromGitHub?: (
        source: string,
        workspacePath: string
    ) => Promise<{ success: boolean; path: string; filesDownloaded?: number; error?: string }>;
    searchClawHubSkills?: (query: string, limit?: number) => Promise<ClawHubSkillInfo[]>;
    installSkillFromClawHub?: (
        skillName: string,
        targetDir: string
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    getSkillhubExecutable?: () => string | undefined;
    onSkillsUpdated?: () => void;
    applyLlmConfig?: (config: ManagedLlmConfig) => void;
};

type ConfigLoadResult = {
    config: ManagedLlmConfig;
    configPath: string;
    source: 'app_data' | 'workspace' | 'default';
};

type MarketplaceKind = 'skillhub' | 'github' | 'clawhub';

type MarketplaceSkillRecord = {
    name: string;
    description: string;
    source: string;
    path: string;
    marketplace: MarketplaceKind;
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

function resolveSkillGovernanceState(
    deps: AppManagementToolDeps,
    skill: StoredSkill
): ExtensionGovernanceState | undefined {
    return deps.getExtensionGovernanceStore?.().get('skill', skill.manifest.name);
}

function toSkillSummary(skill: StoredSkill, deps: AppManagementToolDeps): Record<string, unknown> {
    const governance = resolveSkillGovernanceState(deps, skill);
    const trust = mergeTrustWithGovernance(
        summarizeSkillTrust(skill.manifest, {
            isBuiltin: skill.isBuiltin === true,
        }),
        governance,
    );

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
        provenance: summarizeSkillProvenance(skill.manifest, {
            isBuiltin: skill.isBuiltin === true,
            sourceType: skill.isBuiltin ? 'built_in' : 'local_folder',
            sourceRef: skill.manifest.directory,
        }),
        trust,
        permissions: summarizeSkillPermissions(skill.manifest),
        governance,
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

function normalizeGitHubSource(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('github:')) return trimmed;

    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/.+)?$/.test(trimmed)) {
        return `github:${trimmed}`;
    }

    const match = trimmed.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+)?(?:\/(.*))?/i);
    if (match) {
        const [, owner, repo, repoPath] = match;
        return repoPath ? `github:${owner}/${repo}/${repoPath}` : `github:${owner}/${repo}`;
    }

    return trimmed;
}

function isGitHubSource(input: string): boolean {
    return input.startsWith('github:') || /github\.com\//i.test(input);
}

function normalizeClawHubSource(input: string): string {
    return input.trim().replace(/^clawhub:/i, '').trim();
}

function isClawHubSource(input: string): boolean {
    return input.startsWith('clawhub:');
}

function sanitizeSkillhubName(slug: string, rawName?: string): string {
    const candidate = (rawName ?? '').trim();
    if (!candidate || candidate.startsWith('description:')) {
        return slug;
    }
    return candidate;
}

function runSkillhubCommand(
    executable: string,
    args: string[]
): { success: boolean; stdout: string; stderr: string; error?: string } {
    try {
        const result = spawnSync(executable, args, {
            encoding: 'utf-8',
        });

        if (result.error) {
            return {
                success: false,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
                error: result.error.message,
            };
        }

        if ((result.status ?? 0) !== 0) {
            return {
                success: false,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
                error: (result.stderr || result.stdout || `skillhub exited with status ${result.status}`).trim(),
            };
        }

        return {
            success: true,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
        };
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function searchSkillhubSkills(
    executable: string,
    query: string
): { success: boolean; skills: MarketplaceSkillRecord[]; error?: string } {
    const args = ['--skip-self-upgrade', 'search'];
    const trimmed = query.trim();
    if (trimmed) {
        args.push(...trimmed.split(/\s+/));
    }
    args.push('--json');

    const result = runSkillhubCommand(executable, args);
    if (!result.success) {
        return {
            success: false,
            skills: [],
            error: result.error ?? 'Failed to query skillhub',
        };
    }

    try {
        const raw = JSON.parse(result.stdout) as { results?: Array<Record<string, unknown>> };
        const skills: MarketplaceSkillRecord[] = [];
        for (const entry of raw.results ?? []) {
            const slug = String(entry.slug ?? '').trim();
            if (!slug) {
                continue;
            }
            skills.push({
                name: sanitizeSkillhubName(slug, typeof entry.name === 'string' ? entry.name : undefined),
                description: typeof entry.description === 'string'
                    ? entry.description.trim()
                    : typeof entry.summary === 'string'
                        ? entry.summary.trim()
                        : '',
                source: `skillhub:${slug}`,
                path: slug,
                marketplace: 'skillhub',
            });
        }

        return {
            success: true,
            skills,
        };
    } catch (error) {
        return {
            success: false,
            skills: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function extractSkillUsageGuidance(skill: StoredSkill, enabled: boolean = skill.enabled): string[] {
    const guidance = enabled
        ? [
            `已安装并启用技能 \`${skill.manifest.name}\`。`,
            `后续可以直接在聊天里提出与“${skill.manifest.name}”相关的任务，CoworkAny 会按触发词自动启用该技能。`,
        ]
        : [
            `已安装技能 \`${skill.manifest.name}\`，当前未启用。`,
            '完成权限审查后，可使用 `set_coworkany_skill_enabled` 将该技能启用。',
        ];

    const triggers = (skill.manifest.triggers ?? []).filter(Boolean).slice(0, 5);
    if (triggers.length > 0) {
        guidance.push(`常见触发词：${triggers.join('、')}`);
    }

    if (skill.manifest.directory) {
        guidance.push(`完整说明见：${path.join(skill.manifest.directory, 'SKILL.md')}`);
    }

    return guidance;
}

function shouldEnableSkillAfterImport(result: SkillImportResponsePayload): boolean {
    return result.governanceState?.quarantined !== true;
}

function canEnableSkillInWorkspace(deps: AppManagementToolDeps, skillId: string, isBuiltin: boolean): boolean {
    const policy = loadWorkspaceExtensionAllowlistPolicy(deps.workspaceRoot);
    return isWorkspaceExtensionAllowed(policy, {
        extensionType: 'skill',
        extensionId: skillId,
        isBuiltin,
    });
}

function resolveImportedSkillEnablement(
    deps: AppManagementToolDeps,
    result: SkillImportResponsePayload,
): { enabled: boolean; allowlistBlocked: boolean } {
    if (!result.skillId) {
        return { enabled: false, allowlistBlocked: false };
    }

    const shouldEnable = shouldEnableSkillAfterImport(result);
    if (!shouldEnable) {
        return { enabled: false, allowlistBlocked: false };
    }

    const installed = deps.skillStore.get(result.skillId) as StoredSkill | undefined;
    const allowlisted = canEnableSkillInWorkspace(deps, result.skillId, installed?.isBuiltin === true);
    return {
        enabled: allowlisted,
        allowlistBlocked: !allowlisted,
    };
}

function mapClawHubSkills(skills: ClawHubSkillInfo[]): MarketplaceSkillRecord[] {
    return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: `clawhub:${skill.name}`,
        path: skill.name,
        marketplace: 'clawhub',
    }));
}

function summarizePermissionExpansionDelta(review?: ExtensionGovernanceReview): string[] {
    if (!review?.delta) {
        return [];
    }

    const entries: string[] = [];
    const pushEntries = (label: string, values: string[] | undefined) => {
        const normalized = (values ?? []).filter(Boolean);
        if (normalized.length > 0) {
            entries.push(`${label}:${normalized.join(',')}`);
        }
    };

    pushEntries('tools', review.delta.added.tools);
    pushEntries('effects', review.delta.added.effects);
    pushEntries('capabilities', review.delta.added.capabilities);
    pushEntries('bins', review.delta.added.bins);
    pushEntries('env', review.delta.added.env);
    pushEntries('config', review.delta.added.config);

    return entries;
}

function buildMarketplaceInstallMessage(input: {
    skill: StoredSkill;
    marketplace: MarketplaceKind;
    source: string;
    enabled: boolean;
    warnings?: string[];
    governanceReview?: ExtensionGovernanceReview;
    governanceState?: ExtensionGovernanceState;
}): string {
    const lines = [
        input.enabled
            ? `已从 ${input.marketplace} 安装并启用技能 \`${input.skill.manifest.name}\`。`
            : `已从 ${input.marketplace} 安装技能 \`${input.skill.manifest.name}\`，当前未启用。`,
        `来源：${input.source}`,
        `目录：${input.skill.manifest.directory}`,
        ...extractSkillUsageGuidance(input.skill, input.enabled),
    ];

    if (input.governanceReview?.reviewRequired) {
        lines.push(`治理审查：${input.governanceReview.summary}`);
        const expansion = summarizePermissionExpansionDelta(input.governanceReview);
        if (expansion.length > 0) {
            lines.push(`权限增量：${expansion.join('；')}`);
        }
    }

    if (input.governanceState?.pendingReview) {
        lines.push('治理状态：该技能处于待审核状态，请在上线前完成权限审查。');
    }

    if (input.warnings && input.warnings.length > 0) {
        lines.push(`注意事项：${input.warnings.join('；')}`);
    }

    return lines.join('\n');
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
            name: 'get_coworkany_extension_allowlist',
            description: 'Read the workspace-level extension allowlist policy used to gate skill/toolpack enablement.',
            effects: ['filesystem:read'],
            input_schema: {
                type: 'object',
                properties: {},
            },
            handler: async () => ({
                policy: loadWorkspaceExtensionAllowlistPolicy(deps.workspaceRoot),
            }),
        },
        {
            name: 'set_coworkany_extension_allowlist',
            description: 'Update the workspace-level extension allowlist policy. In enforce mode, only listed extensions can be enabled.',
            effects: ['filesystem:read', 'filesystem:write'],
            input_schema: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        description: 'Policy mode: off or enforce.',
                    },
                    allowed_skill_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Skill ids allowed when mode=enforce.',
                    },
                    allowed_toolpack_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Toolpack ids allowed when mode=enforce.',
                    },
                },
            },
            handler: async (args: {
                mode?: 'off' | 'enforce';
                allowed_skill_ids?: string[];
                allowed_toolpack_ids?: string[];
            }) => ({
                success: true,
                policy: saveWorkspaceExtensionAllowlistPolicy(deps.workspaceRoot, {
                    ...(typeof args.mode === 'string' ? { mode: args.mode } : {}),
                    ...(Array.isArray(args.allowed_skill_ids) ? { allowedSkills: args.allowed_skill_ids } : {}),
                    ...(Array.isArray(args.allowed_toolpack_ids) ? { allowedToolpacks: args.allowed_toolpack_ids } : {}),
                }),
            }),
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
                skills: deps.skillStore.list().map((skill) => toSkillSummary(skill as StoredSkill, deps)),
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
                    skill: skill ? toSkillSummary(skill as StoredSkill, deps) : undefined,
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
                    approve_permission_expansion: {
                        type: 'boolean',
                        description: 'Set true only when the user explicitly approved a skill permission expansion update.',
                    },
                },
                required: ['path'],
            },
            handler: async (args: {
                path: string;
                auto_install_dependencies?: boolean;
                approve_permission_expansion?: boolean;
            }) => {
                const result = deps.importSkillFromDirectory
                    ? await deps.importSkillFromDirectory(
                        args.path,
                        args.auto_install_dependencies ?? true,
                        args.approve_permission_expansion === true
                    )
                    : importSkillDirectly(deps.skillStore, args.path);

                if (result.success && result.skillId) {
                    const enablement = resolveImportedSkillEnablement(deps, result);
                    deps.skillStore.setEnabled(result.skillId, enablement.enabled);
                    deps.onSkillsUpdated?.();
                    if (enablement.allowlistBlocked) {
                        return {
                            ...result,
                            warnings: [
                                ...(result.warnings ?? []),
                                `Workspace extension allowlist blocked enabling skill "${result.skillId}".`,
                            ],
                        };
                    }
                }

                return result;
            },
        },
        {
            name: 'search_coworkany_skill_marketplace',
            description: 'Search CoworkAny-supported skill marketplace sources. Skillhub and ClawHub support keyword search; GitHub sources must be provided directly as github:owner/repo or a GitHub URL.',
            effects: ['network:outbound', 'process:spawn', 'filesystem:read'],
            input_schema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Keyword, slug, clawhub:skill source, github:owner/repo source, or GitHub URL.',
                    },
                    marketplace: {
                        type: 'string',
                        description: 'Optional marketplace selector: auto, skillhub, clawhub, or github.',
                    },
                },
                required: ['query'],
            },
            handler: async (args: { query: string; marketplace?: 'auto' | MarketplaceKind }) => {
                const query = args.query.trim();
                const marketplace = args.marketplace ?? 'auto';

                if (!query) {
                    return {
                        success: false,
                        error: 'missing_query',
                        skills: [],
                    };
                }

                if (marketplace === 'github' || isGitHubSource(query)) {
                    const normalized = normalizeGitHubSource(query);
                    return {
                        success: true,
                        marketplace: 'github',
                        skills: [{
                            name: normalized.replace(/^github:/, ''),
                            description: 'GitHub skill source',
                            source: normalized,
                            path: normalized.replace(/^github:/, ''),
                            marketplace: 'github',
                        }],
                    };
                }

                if (marketplace === 'clawhub' || isClawHubSource(query)) {
                    const clawHubQuery = normalizeClawHubSource(query);
                    const skills = deps.searchClawHubSkills
                        ? await deps.searchClawHubSkills(clawHubQuery)
                        : [];
                    return {
                        success: true,
                        marketplace: 'clawhub',
                        skills: mapClawHubSkills(skills),
                    };
                }

                const executable = deps.getSkillhubExecutable?.() ?? 'skillhub';
                const result = searchSkillhubSkills(executable, query);
                return {
                    success: result.success,
                    marketplace: 'skillhub',
                    skills: result.skills,
                    error: result.error,
                };
            },
        },
        {
            name: 'install_coworkany_skill_from_marketplace',
            description: 'Install and enable a CoworkAny skill from a supported marketplace source. Supports GitHub sources, Skillhub queries/slugs, and ClawHub skill names.',
            effects: ['filesystem:read', 'filesystem:write', 'process:spawn', 'network:outbound'],
            input_schema: {
                type: 'object',
                properties: {
                    source: {
                        type: 'string',
                        description: 'A Skillhub slug/keyword, ClawHub skill name, clawhub:skill source, github:owner/repo source, or GitHub URL.',
                    },
                    marketplace: {
                        type: 'string',
                        description: 'Optional marketplace selector: auto, skillhub, clawhub, or github.',
                    },
                    auto_install_dependencies: {
                        type: 'boolean',
                        description: 'Whether to auto-install declared skill dependencies while importing.',
                    },
                    approve_permission_expansion: {
                        type: 'boolean',
                        description: 'Set true only when the user explicitly approved a skill permission expansion update.',
                    },
                },
                required: ['source'],
            },
            handler: async (args: {
                source: string;
                marketplace?: 'auto' | MarketplaceKind;
                auto_install_dependencies?: boolean;
                approve_permission_expansion?: boolean;
            }) => {
                const source = args.source.trim();
                const marketplace = args.marketplace ?? 'auto';
                const autoInstallDependencies = args.auto_install_dependencies ?? true;
                const approvePermissionExpansion = args.approve_permission_expansion === true;

                if (!source) {
                    return {
                        success: false,
                        error: 'missing_source',
                        message: '缺少 marketplace 来源。',
                    };
                }

                if (marketplace === 'github' || isGitHubSource(source)) {
                    if (!deps.downloadSkillFromGitHub) {
                        return {
                            success: false,
                            error: 'github_install_unavailable',
                            message: '当前运行环境未启用 GitHub skill 安装能力。',
                        };
                    }

                    const normalizedSource = normalizeGitHubSource(source);
                    const downloadResult = await deps.downloadSkillFromGitHub(normalizedSource, deps.workspaceRoot);
                    if (!downloadResult.success) {
                        return {
                            success: false,
                            error: downloadResult.error ?? 'github_download_failed',
                            message: `GitHub 安装失败：${downloadResult.error ?? 'unknown error'}`,
                        };
                    }

                    const importResult = deps.importSkillFromDirectory
                        ? await deps.importSkillFromDirectory(
                            downloadResult.path,
                            autoInstallDependencies,
                            approvePermissionExpansion
                        )
                        : importSkillDirectly(deps.skillStore, downloadResult.path);

                    if (!importResult.success || !importResult.skillId) {
                        return {
                            success: false,
                            error: importResult.error ?? 'skill_import_failed',
                            message: `GitHub 资源已下载，但技能导入失败：${importResult.error ?? 'unknown error'}`,
                            importResult,
                        };
                    }

                    const enablement = resolveImportedSkillEnablement(deps, importResult);
                    deps.skillStore.setEnabled(importResult.skillId, enablement.enabled);
                    deps.onSkillsUpdated?.();
                    const installedSkill = deps.skillStore.get(importResult.skillId);
                    if (!installedSkill) {
                        return {
                            success: false,
                            error: 'installed_skill_not_found',
                            message: `技能已导入，但无法在技能仓库中找到 ${importResult.skillId}。`,
                        };
                    }

                    const warnings = enablement.allowlistBlocked
                        ? [
                            ...(importResult.warnings ?? []),
                            `Workspace extension allowlist blocked enabling skill "${importResult.skillId}".`,
                        ]
                        : importResult.warnings;

                    return {
                        success: true,
                        marketplace: 'github',
                        source: normalizedSource,
                        skillId: importResult.skillId,
                        enabled: installedSkill.enabled,
                        skill: toSkillSummary(installedSkill as StoredSkill, deps),
                        usageGuidance: extractSkillUsageGuidance(installedSkill as StoredSkill, installedSkill.enabled),
                        importResult,
                        message: buildMarketplaceInstallMessage({
                            skill: installedSkill as StoredSkill,
                            marketplace: 'github',
                            source: normalizedSource,
                            enabled: installedSkill.enabled,
                            warnings,
                            governanceReview: importResult.governanceReview,
                            governanceState: importResult.governanceState,
                        }),
                    };
                }

                if (marketplace === 'clawhub' || isClawHubSource(source)) {
                    if (!deps.installSkillFromClawHub || !deps.searchClawHubSkills) {
                        return {
                            success: false,
                            error: 'clawhub_install_unavailable',
                            message: '当前运行环境未启用 ClawHub skill 安装能力。',
                        };
                    }

                    const normalizedSource = normalizeClawHubSource(source);
                    const searchResult = mapClawHubSkills(await deps.searchClawHubSkills(normalizedSource));
                    const sourceLower = normalizedSource.toLowerCase();
                    const exact = searchResult.find((skill) =>
                        skill.path.toLowerCase() === sourceLower || skill.name.toLowerCase() === sourceLower
                    );
                    const selectedSkill = exact ?? (searchResult.length === 1 ? searchResult[0] : undefined);

                    if (!selectedSkill) {
                        const candidates = searchResult.slice(0, 5).map((skill) => skill.path);
                        return {
                            success: false,
                            needsClarification: true,
                            error: 'clawhub_ambiguous',
                            candidates,
                            marketplace: 'clawhub',
                            message: candidates.length > 0
                                ? `ClawHub 找到多个候选技能：${candidates.join('、')}。请明确要安装的技能名。`
                                : `ClawHub 中没有找到与 “${normalizedSource}” 匹配的技能。`,
                        };
                    }

                    const installRoot = path.join(deps.workspaceRoot, '.coworkany', 'skills');
                    fs.mkdirSync(installRoot, { recursive: true });
                    const installResult = await deps.installSkillFromClawHub(selectedSkill.path, installRoot);
                    if (!installResult.success || !installResult.path) {
                        return {
                            success: false,
                            error: installResult.error ?? 'clawhub_install_failed',
                            message: `ClawHub 安装失败：${installResult.error ?? 'unknown error'}`,
                        };
                    }

                    const importResult = deps.importSkillFromDirectory
                        ? await deps.importSkillFromDirectory(
                            installResult.path,
                            autoInstallDependencies,
                            approvePermissionExpansion
                        )
                        : importSkillDirectly(deps.skillStore, installResult.path);

                    if (!importResult.success || !importResult.skillId) {
                        return {
                            success: false,
                            error: importResult.error ?? 'skill_import_failed',
                            message: `ClawHub 资源已下载，但技能导入失败：${importResult.error ?? 'unknown error'}`,
                            importResult,
                        };
                    }

                    const enablement = resolveImportedSkillEnablement(deps, importResult);
                    deps.skillStore.setEnabled(importResult.skillId, enablement.enabled);
                    deps.onSkillsUpdated?.();
                    const installedSkill = deps.skillStore.get(importResult.skillId);
                    if (!installedSkill) {
                        return {
                            success: false,
                            error: 'installed_skill_not_found',
                            message: `技能已导入，但无法在技能仓库中找到 ${importResult.skillId}。`,
                        };
                    }

                    const warnings = enablement.allowlistBlocked
                        ? [
                            ...(importResult.warnings ?? []),
                            `Workspace extension allowlist blocked enabling skill "${importResult.skillId}".`,
                        ]
                        : importResult.warnings;

                    return {
                        success: true,
                        marketplace: 'clawhub',
                        source: selectedSkill.source,
                        skillId: importResult.skillId,
                        enabled: installedSkill.enabled,
                        skill: toSkillSummary(installedSkill as StoredSkill, deps),
                        usageGuidance: extractSkillUsageGuidance(installedSkill as StoredSkill, installedSkill.enabled),
                        importResult,
                        message: buildMarketplaceInstallMessage({
                            skill: installedSkill as StoredSkill,
                            marketplace: 'clawhub',
                            source: selectedSkill.source,
                            enabled: installedSkill.enabled,
                            warnings,
                            governanceReview: importResult.governanceReview,
                            governanceState: importResult.governanceState,
                        }),
                    };
                }

                const executable = deps.getSkillhubExecutable?.() ?? 'skillhub';
                const searchResult = searchSkillhubSkills(executable, source);
                if (!searchResult.success) {
                    return {
                        success: false,
                        error: searchResult.error ?? 'skillhub_search_failed',
                        message: `Skillhub 检索失败：${searchResult.error ?? 'unknown error'}`,
                    };
                }

                const sourceLower = source.toLowerCase();
                const exact = searchResult.skills.find((skill) =>
                    skill.path.toLowerCase() === sourceLower || skill.name.toLowerCase() === sourceLower
                );
                const selectedSkill = exact ?? (searchResult.skills.length === 1 ? searchResult.skills[0] : undefined);

                if (!selectedSkill) {
                    const candidates = searchResult.skills.slice(0, 5).map((skill) => skill.path);
                    return {
                        success: false,
                        needsClarification: true,
                        error: 'skillhub_ambiguous',
                        candidates,
                        marketplace: 'skillhub',
                        message: candidates.length > 0
                            ? `Skillhub 找到多个候选技能：${candidates.join('、')}。请明确要安装的 slug。`
                            : `Skillhub 中没有找到与 “${source}” 匹配的技能。`,
                    };
                }

                const installRoot = path.join(deps.workspaceRoot, '.coworkany', 'skills');
                fs.mkdirSync(installRoot, { recursive: true });
                const installResult = runSkillhubCommand(executable, [
                    '--skip-self-upgrade',
                    '--dir',
                    installRoot,
                    'install',
                    selectedSkill.path,
                ]);

                if (!installResult.success) {
                    return {
                        success: false,
                        error: installResult.error ?? 'skillhub_install_failed',
                        message: `Skillhub 安装失败：${installResult.error ?? 'unknown error'}`,
                    };
                }

                const skillPath = path.join(installRoot, selectedSkill.path);
                if (!fs.existsSync(skillPath)) {
                    return {
                        success: false,
                        error: 'skillhub_installed_path_missing',
                        message: `Skillhub 报告安装成功，但未找到技能目录：${skillPath}`,
                    };
                }

                const importResult = deps.importSkillFromDirectory
                    ? await deps.importSkillFromDirectory(
                        skillPath,
                        autoInstallDependencies,
                        approvePermissionExpansion
                    )
                    : importSkillDirectly(deps.skillStore, skillPath);

                if (!importResult.success || !importResult.skillId) {
                    return {
                        success: false,
                        error: importResult.error ?? 'skill_import_failed',
                        message: `Skillhub 资源已下载，但技能导入失败：${importResult.error ?? 'unknown error'}`,
                        importResult,
                    };
                }

                const enablement = resolveImportedSkillEnablement(deps, importResult);
                deps.skillStore.setEnabled(importResult.skillId, enablement.enabled);
                deps.onSkillsUpdated?.();
                const installedSkill = deps.skillStore.get(importResult.skillId);
                if (!installedSkill) {
                    return {
                        success: false,
                        error: 'installed_skill_not_found',
                        message: `技能已导入，但无法在技能仓库中找到 ${importResult.skillId}。`,
                    };
                }

                const warnings = enablement.allowlistBlocked
                    ? [
                        ...(importResult.warnings ?? []),
                        `Workspace extension allowlist blocked enabling skill "${importResult.skillId}".`,
                    ]
                    : importResult.warnings;

                return {
                    success: true,
                    marketplace: 'skillhub',
                    source: selectedSkill.source,
                    skillId: importResult.skillId,
                    enabled: installedSkill.enabled,
                    skill: toSkillSummary(installedSkill as StoredSkill, deps),
                    usageGuidance: extractSkillUsageGuidance(installedSkill as StoredSkill, installedSkill.enabled),
                    importResult,
                    message: buildMarketplaceInstallMessage({
                        skill: installedSkill as StoredSkill,
                        marketplace: 'skillhub',
                        source: selectedSkill.source,
                        enabled: installedSkill.enabled,
                        warnings,
                        governanceReview: importResult.governanceReview,
                        governanceState: importResult.governanceState,
                    }),
                };
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

                if (args.enabled && skill && !canEnableSkillInWorkspace(deps, args.skill_id, false)) {
                    return {
                        success: false,
                        error: 'workspace_extension_not_allowlisted',
                    };
                }

                return {
                    success: deps.skillStore.setEnabled(args.skill_id, args.enabled),
                };
            },
        },
        {
            name: 'approve_coworkany_skill_governance_review',
            description: 'Explicitly approve a pending governance review for an installed CoworkAny skill. Optionally enables the skill after approval.',
            effects: ['filesystem:read', 'filesystem:write'],
            input_schema: {
                type: 'object',
                properties: {
                    skill_id: {
                        type: 'string',
                        description: 'Skill id or name.',
                    },
                    enable_after_approve: {
                        type: 'boolean',
                        description: 'Whether to enable this skill immediately after review approval.',
                    },
                },
                required: ['skill_id'],
            },
            handler: async (args: { skill_id: string; enable_after_approve?: boolean }) => {
                if (!deps.getExtensionGovernanceStore) {
                    return {
                        success: false,
                        error: 'extension_governance_unavailable',
                    };
                }

                const governanceStore = deps.getExtensionGovernanceStore();
                const current = governanceStore.get('skill', args.skill_id);
                if (!current) {
                    return {
                        success: false,
                        error: 'governance_record_not_found',
                    };
                }

                const shouldEnable = args.enable_after_approve !== false;
                if (shouldEnable) {
                    const skill = deps.skillStore.get(args.skill_id) as StoredSkill | undefined;
                    if (!canEnableSkillInWorkspace(deps, args.skill_id, skill?.isBuiltin === true)) {
                        return {
                            success: false,
                            error: 'workspace_extension_not_allowlisted',
                            governanceState: current,
                        };
                    }
                    const enabled = deps.skillStore.setEnabled(args.skill_id, true);
                    if (!enabled) {
                        return {
                            success: false,
                            error: 'skill_not_found',
                            governanceState: current,
                        };
                    }
                }

                const governanceState = governanceStore.markApproved('skill', args.skill_id);
                if (!governanceState) {
                    return {
                        success: false,
                        error: 'governance_record_not_found',
                    };
                }

                const skill = deps.skillStore.get(args.skill_id);
                return {
                    success: true,
                    skillId: args.skill_id,
                    enabled: skill?.enabled,
                    governanceState,
                    skill: skill ? toSkillSummary(skill as StoredSkill, deps) : undefined,
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
