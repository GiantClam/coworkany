/**
 * Skill Store
 *
 * JSON-based persistence for Claude Agent Skills.
 * Stores installed skills and their configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_SKILLS } from '../data/defaults';

// ============================================================================
// Types
// ============================================================================

/**
 * Skill requirements (OpenClaw compatible)
 */
export interface SkillRequirements {
    /** Required tool names (e.g., ['Bash', 'Write', 'Read']) */
    tools: string[];
    /** Required capabilities (e.g., ['filesystem:write', 'network:outbound']) */
    capabilities: string[];
    /** Required CLI binaries on host (e.g., ['python3', 'node']) */
    bins: string[];
    /** Required environment variables (e.g., ['OPENAI_API_KEY']) */
    env: string[];
    /** Required config paths (e.g., ['llm.apiKey']) */
    config: string[];
}

export interface ClaudeSkillManifest {
    name: string;
    version: string;
    description: string;

    /**
     * Directory containing SKILL.md and resources
     */
    directory: string;

    /**
     * Optional scripts directory
     */
    scriptsDir?: string;

    /**
     * Keywords for discovery
     */
    tags?: string[];

    /**
     * OpenClaw-compatible allowed tools list.
     * Supports both `allowed-tools` and `allowedTools` frontmatter forms.
     */
    allowedTools?: string[];

    /**
     * Required capabilities (for policy evaluation)
     * @deprecated Use requires.capabilities instead
     */
    requiredCapabilities?: string[];

    // ========== OpenClaw-compatible extensions ==========

    /**
     * Author name or organization
     */
    author?: string;

    /**
     * Homepage URL for the skill
     */
    homepage?: string;

    /**
     * License identifier (e.g., 'MIT', 'Apache-2.0')
     */
    license?: string;

    /**
     * Skill requirements (tools, binaries, env vars)
     */
    requires?: SkillRequirements;

    /**
     * Trigger phrases for auto-activation
     * When user message matches any trigger, skill is auto-injected
     */
    triggers?: string[];

    /**
     * Whether to expose as slash command (e.g., /docx)
     * @default true
     */
    userInvocable?: boolean;

    /**
     * If true, skill instructions are NOT included in model prompts
     * Useful for background/system skills
     * @default false
     */
    disableModelInvocation?: boolean;

    /**
     * Extension metadata for custom integrations
     */
    metadata?: Record<string, unknown>;
}

export interface StoredSkill {
    manifest: ClaudeSkillManifest;
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
    isBuiltin?: boolean;
}

// ============================================================================
// Store
// ============================================================================

export class SkillStore {
    private storagePath: string;
    private skills: Map<string, StoredSkill> = new Map();

    constructor(workspaceRoot: string) {
        this.storagePath = path.join(workspaceRoot, '.coworkany', 'skills.json');
        this.load();
    }

    /**
     * Load skills from storage
     */
    private load(): void {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf-8');
                const parsed = JSON.parse(data) as Record<string, StoredSkill>;
                this.skills = new Map(Object.entries(parsed));
                console.log(`[SkillStore] Loaded ${this.skills.size} skills`);
            }
        } catch (error) {
            console.error('[SkillStore] Failed to load:', error);
            this.skills = new Map();
        }
    }

    /**
     * Reload skills from storage and clear internal cache
     */
    reload(): void {
        console.log('[SkillStore] Reloading skills...');
        this.skills.clear();
        this.load();
    }

    /**
     * Save skills to storage
     */
    save(): void {
        try {
            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const data = Object.fromEntries(this.skills);
            fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[SkillStore] Failed to save:', error);
        }
    }

    /**
     * List all stored skills
     */
    list(): StoredSkill[] {
        const stored = Array.from(this.skills.values());
        const builtins = BUILTIN_SKILLS.map((manifest) => ({
            manifest: manifest as unknown as ClaudeSkillManifest,
            enabled: true,
            installedAt: new Date().toISOString(),
            isBuiltin: true,
        })).filter((b) => !this.skills.has(b.manifest.name));

        return [...builtins, ...stored];
    }

    /**
     * List enabled skills only
     */
    listEnabled(): StoredSkill[] {
        return this.list().filter((s) => s.enabled);
    }

    /**
     * Get a skill by name
     */
    get(name: string): StoredSkill | undefined {
        const stored = this.skills.get(name);
        if (stored) return stored;

        const builtin = BUILTIN_SKILLS.find((b) => b.name === name);
        if (builtin) {
            return {
                manifest: builtin as unknown as ClaudeSkillManifest,
                enabled: true,
                installedAt: new Date().toISOString(),
                isBuiltin: true,
            };
        }
        return undefined;
    }

    /**
     * Install a new skill
     */
    install(manifest: ClaudeSkillManifest): void {
        const existing = this.skills.get(manifest.name);
        this.skills.set(manifest.name, {
            manifest,
            enabled: existing?.enabled ?? true,
            installedAt: existing?.installedAt ?? new Date().toISOString(),
            lastUsedAt: existing?.lastUsedAt,
        });
        this.save();
        console.log(`[SkillStore] Installed skill: ${manifest.name}`);
    }

    /**
     * Uninstall a skill
     */
    uninstall(name: string): boolean {
        const builtin = BUILTIN_SKILLS.find((b) => b.name === name);
        if (builtin) {
            console.warn(`[SkillStore] Cannot uninstall builtin skill: ${name}`);
            return false;
        }

        const removed = this.skills.delete(name);
        if (removed) {
            this.save();
            console.log(`[SkillStore] Uninstalled skill: ${name}`);
        }
        return removed;
    }

    /**
     * Enable or disable a skill
     */
    setEnabled(name: string, enabled: boolean): boolean {
        const skill = this.skills.get(name);
        if (!skill) return false;

        skill.enabled = enabled;
        this.save();
        console.log(`[SkillStore] ${name} enabled: ${enabled}`);
        return true;
    }

    /**
     * Scan a directory for SKILL.md files and return manifests
     */
    static scanDirectory(skillsRoot: string): ClaudeSkillManifest[] {
        const manifests: ClaudeSkillManifest[] = [];

        if (!fs.existsSync(skillsRoot)) {
            return manifests;
        }

        const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillDir = path.join(skillsRoot, entry.name);
            const skillMd = path.join(skillDir, 'SKILL.md');

            if (fs.existsSync(skillMd)) {
                // Parse SKILL.md frontmatter
                const content = fs.readFileSync(skillMd, 'utf-8');
                const manifest = SkillStore.parseSkillMd(entry.name, skillDir, content);
                if (manifest) {
                    manifests.push(manifest);
                }
            }
        }

        return manifests;
    }

    /**
     * Parse YAML frontmatter into a key-value object.
     * Uses a full YAML parser so OpenClaw nested metadata/commands can be preserved.
     */
    private static parseFrontmatter(yaml: string): Record<string, unknown> {
        try {
            const parsed = parseYaml(yaml);
            return parsed && typeof parsed === 'object'
                ? (parsed as Record<string, unknown>)
                : {};
        } catch (error) {
            console.warn('[SkillStore] Failed to parse YAML frontmatter:', error);
            return {};
        }
    }

    private static asRecord(value: unknown): Record<string, unknown> | null {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    }

    private static normalizeStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed ? [trimmed] : [];
            }
            return [];
        }
        const result: string[] = [];
        for (const item of value) {
            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed) {
                    result.push(trimmed);
                }
            } else if (typeof item === 'number' || typeof item === 'boolean') {
                result.push(String(item));
            }
        }
        return result;
    }

    private static normalizeRequires(value: unknown): SkillRequirements | undefined {
        if (!value) {
            return undefined;
        }

        const empty: SkillRequirements = {
            tools: [],
            capabilities: [],
            bins: [],
            env: [],
            config: [],
        };

        if (Array.isArray(value)) {
            // Some community skills use `requires: [ENV_VAR, ...]`.
            const env = value
                .map((item) => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean)
                .map((entry) => entry.split(/\s|\(/, 1)[0])
                .filter(Boolean);
            return { ...empty, env };
        }

        if (typeof value === 'string') {
            const token = value.trim().split(/\s|\(/, 1)[0];
            if (!token) {
                return undefined;
            }
            return { ...empty, env: [token] };
        }

        const record = SkillStore.asRecord(value);
        if (!record) {
            return undefined;
        }

        return {
            tools: SkillStore.normalizeStringArray(record.tools),
            capabilities: SkillStore.normalizeStringArray(record.capabilities),
            bins: SkillStore.normalizeStringArray(record.bins),
            env: SkillStore.normalizeStringArray(record.env),
            config: SkillStore.normalizeStringArray(record.config),
        };
    }

    private static mergeRequirements(
        primary?: SkillRequirements,
        secondary?: SkillRequirements
    ): SkillRequirements | undefined {
        if (!primary && !secondary) {
            return undefined;
        }
        const merged: SkillRequirements = {
            tools: [],
            capabilities: [],
            bins: [],
            env: [],
            config: [],
        };
        const pushUnique = (target: string[], source: string[] | undefined) => {
            for (const item of source ?? []) {
                if (item && !target.includes(item)) {
                    target.push(item);
                }
            }
        };
        pushUnique(merged.tools, primary?.tools);
        pushUnique(merged.tools, secondary?.tools);
        pushUnique(merged.capabilities, primary?.capabilities);
        pushUnique(merged.capabilities, secondary?.capabilities);
        pushUnique(merged.bins, primary?.bins);
        pushUnique(merged.bins, secondary?.bins);
        pushUnique(merged.env, primary?.env);
        pushUnique(merged.env, secondary?.env);
        pushUnique(merged.config, primary?.config);
        pushUnique(merged.config, secondary?.config);
        return merged;
    }

    private static extractOpenClawEnvNames(openclawMeta: Record<string, unknown> | null): string[] {
        if (!openclawMeta) {
            return [];
        }

        const directEnv = SkillStore.normalizeStringArray(openclawMeta.env);
        if (directEnv.length > 0) {
            return directEnv;
        }

        const requires = SkillStore.asRecord(openclawMeta.requires);
        if (!requires) {
            return [];
        }

        const requiresEnv = requires.env;
        if (!Array.isArray(requiresEnv)) {
            return [];
        }

        const envVars: string[] = [];
        for (const entry of requiresEnv) {
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (trimmed) {
                    envVars.push(trimmed);
                }
                continue;
            }
            const record = SkillStore.asRecord(entry);
            const name = record?.name;
            if (typeof name === 'string' && name.trim()) {
                envVars.push(name.trim());
            }
        }
        return envVars;
    }

    private static normalizeCommandEntries(value: unknown): Array<Record<string, unknown>> {
        if (!Array.isArray(value)) {
            return [];
        }
        const commands: Array<Record<string, unknown>> = [];
        for (const entry of value) {
            const record = SkillStore.asRecord(entry);
            if (record) {
                commands.push(record);
            }
        }
        return commands;
    }

    /**
     * Parse SKILL.md frontmatter to extract manifest (OpenClaw compatible)
     */
    static parseSkillMd(
        name: string,
        directory: string,
        content: string
    ): ClaudeSkillManifest | null {
        // Extract YAML frontmatter
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!frontmatterMatch) {
            return {
                name,
                version: '1.0.0',
                description: name,
                directory,
            };
        }

        const yaml = frontmatterMatch[1];
        const parsed = SkillStore.parseFrontmatter(yaml);
        const metadata = SkillStore.asRecord(parsed.metadata) ?? {};
        const openclawMeta = SkillStore.asRecord(metadata.openclaw);
        const topLevelCommands = SkillStore.normalizeCommandEntries(parsed.commands);
        const openclawCommands = SkillStore.normalizeCommandEntries(openclawMeta?.commands);

        // Build manifest with OpenClaw-compatible fields
        const manifest: ClaudeSkillManifest = {
            name: (parsed.name as string) || name,
            version: (parsed.version as string) || '1.0.0',
            description: (parsed.description as string) || name,
            directory,
        };

        // Optional string fields
        if (typeof parsed.author === 'string') manifest.author = parsed.author;
        if (typeof parsed.homepage === 'string') manifest.homepage = parsed.homepage;
        if (typeof parsed.license === 'string') manifest.license = parsed.license;
        if (typeof parsed.scriptsDir === 'string') manifest.scriptsDir = parsed.scriptsDir;

        // Array fields
        manifest.tags = SkillStore.normalizeStringArray(parsed.tags);
        manifest.triggers = SkillStore.normalizeStringArray(parsed.triggers);
        const allowedTools = SkillStore.normalizeStringArray(
            parsed['allowed-tools'] ?? parsed.allowedTools ?? parsed.allowed_tools
        );
        if (allowedTools.length > 0) {
            manifest.allowedTools = allowedTools;
        }
        manifest.requiredCapabilities = SkillStore.normalizeStringArray(
            parsed.requiredCapabilities ?? parsed['required-capabilities']
        );

        // Boolean fields with defaults
        if (typeof parsed['user-invocable'] === 'boolean') {
            manifest.userInvocable = parsed['user-invocable'];
        } else if (typeof parsed.userInvocable === 'boolean') {
            manifest.userInvocable = parsed.userInvocable;
        }

        if (typeof parsed['disable-model-invocation'] === 'boolean') {
            manifest.disableModelInvocation = parsed['disable-model-invocation'];
        } else if (typeof parsed.disableModelInvocation === 'boolean') {
            manifest.disableModelInvocation = parsed.disableModelInvocation;
        }

        // Requires object (OpenClaw compatible, supports top-level and metadata.openclaw.requires)
        const parsedRequires = SkillStore.normalizeRequires(parsed.requires);
        const openclawRequires = SkillStore.normalizeRequires(openclawMeta?.requires);
        manifest.requires = SkillStore.mergeRequirements(parsedRequires, openclawRequires);

        // OpenClaw metadata often defines env vars as objects under metadata.openclaw.env.
        const metaEnv = SkillStore.extractOpenClawEnvNames(openclawMeta);
        if (metaEnv.length > 0) {
            manifest.requires = SkillStore.mergeRequirements(manifest.requires, {
                tools: [],
                capabilities: [],
                bins: [],
                env: metaEnv,
                config: [],
            });
        }

        // Also populate legacy requiredCapabilities from requires.capabilities
        if ((manifest.requiredCapabilities?.length ?? 0) === 0 && manifest.requires?.capabilities.length) {
            manifest.requiredCapabilities = [...manifest.requires.capabilities];
        }

        if (topLevelCommands.length > 0 || openclawCommands.length > 0) {
            const mergedCommands = [...topLevelCommands];
            for (const command of openclawCommands) {
                if (!mergedCommands.includes(command)) {
                    mergedCommands.push(command);
                }
            }
            metadata.commands = mergedCommands;
        }

        // Preserve parsed frontmatter for downstream compatibility/tooling adapters.
        try {
            metadata.frontmatter = JSON.parse(JSON.stringify(parsed));
        } catch {
            // Ignore non-serializable metadata snapshots.
        }
        if (Object.keys(metadata).length > 0) {
            manifest.metadata = metadata;
        }

        return manifest;
    }

    /**
     * Load a single skill from a directory containing SKILL.md
     */
    static loadFromDirectory(skillDir: string): ClaudeSkillManifest | null {
        const skillMd = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillMd)) {
            return null;
        }
        const content = fs.readFileSync(skillMd, 'utf-8');
        const name = path.basename(skillDir);
        return SkillStore.parseSkillMd(name, skillDir, content);
    }

    /**
     * Discover and install skills from a directory
     */
    discoverAndInstall(skillsRoot: string): number {
        const manifests = SkillStore.scanDirectory(skillsRoot);
        let installed = 0;

        for (const manifest of manifests) {
            if (!this.skills.has(manifest.name)) {
                this.install(manifest);
                installed++;
            }
        }

        return installed;
    }

    /**
     * Find skills whose triggers match the given user message
     * Returns skills sorted by trigger specificity (longer triggers first)
     */
    findByTrigger(userMessage: string): StoredSkill[] {
        const messageLower = userMessage.toLowerCase();
        const matches: Array<{ skill: StoredSkill; triggerLength: number }> = [];

        for (const skill of this.listEnabled()) {
            // Skip skills that disable model invocation
            if (skill.manifest.disableModelInvocation) continue;

            const triggers = skill.manifest.triggers || [];
            for (const trigger of triggers) {
                const triggerLower = trigger.toLowerCase();
                if (messageLower.includes(triggerLower)) {
                    matches.push({ skill, triggerLength: trigger.length });
                    break; // Only count each skill once
                }
            }
        }

        // Sort by trigger length (more specific triggers first)
        matches.sort((a, b) => b.triggerLength - a.triggerLength);
        return matches.map((m) => m.skill);
    }

    /**
     * Get skills that are user-invocable (exposed as slash commands)
     */
    listUserInvocable(): StoredSkill[] {
        return this.listEnabled().filter((s) => s.manifest.userInvocable !== false);
    }

    /**
     * Check if skill requirements are satisfied
     */
    static checkRequirements(
        manifest: ClaudeSkillManifest,
        context: {
            availableTools?: string[];
            envVars?: Record<string, string>;
            config?: Record<string, unknown>;
        }
    ): { satisfied: boolean; missing: string[] } {
        const missing: string[] = [];
        const requires = manifest.requires;

        if (!requires) {
            return { satisfied: true, missing: [] };
        }

        // Check required tools
        if (requires.tools && context.availableTools) {
            for (const tool of requires.tools) {
                if (!context.availableTools.includes(tool)) {
                    missing.push(`tool:${tool}`);
                }
            }
        }

        // Check required environment variables
        if (requires.env && context.envVars) {
            for (const envVar of requires.env) {
                if (!context.envVars[envVar]) {
                    missing.push(`env:${envVar}`);
                }
            }
        }

        // Check required binaries (requires shell execution, deferred)
        // For now, just note them as potentially missing
        if (requires.bins && requires.bins.length > 0) {
            // Binary checks should be done at runtime
        }

        return {
            satisfied: missing.length === 0,
            missing,
        };
    }
}
