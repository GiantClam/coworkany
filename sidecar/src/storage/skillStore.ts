/**
 * Skill Store
 *
 * JSON-based persistence for Claude Agent Skills.
 * Stores installed skills and their configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
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
     * Parse YAML frontmatter into a key-value object
     * Supports simple values, arrays (flow and block style), and nested objects
     */
    private static parseFrontmatter(yaml: string): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        const lines = yaml.split('\n');
        let currentKey: string | null = null;
        let currentArray: string[] | null = null;
        let currentObject: Record<string, unknown> | null = null;
        let objectKey: string | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Check for array item (starts with -)
            if (trimmed.startsWith('- ') && currentArray !== null) {
                const value = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
                currentArray.push(value);
                continue;
            }

            // Check for nested object property (indented key: value)
            if (line.startsWith('  ') && currentObject !== null && objectKey !== null) {
                const match = trimmed.match(/^(\w+):\s*(.*)$/);
                if (match) {
                    const [, key, value] = match;
                    if (value.startsWith('[') && value.endsWith(']')) {
                        // Inline array: [item1, item2]
                        const items = value.slice(1, -1).split(',').map((s) =>
                            s.trim().replace(/^["']|["']$/g, '')
                        ).filter(Boolean);
                        currentObject[key] = items;
                    } else {
                        currentObject[key] = value.replace(/^["']|["']$/g, '');
                    }
                }
                continue;
            }

            // Close any open array/object when we hit a new top-level key
            if (!line.startsWith(' ') && currentArray !== null && currentKey !== null) {
                result[currentKey] = currentArray;
                currentArray = null;
                currentKey = null;
            }
            if (!line.startsWith(' ') && currentObject !== null && objectKey !== null) {
                result[objectKey] = currentObject;
                currentObject = null;
                objectKey = null;
            }

            // Parse top-level key: value
            const match = trimmed.match(/^([\w-]+):\s*(.*)$/);
            if (match) {
                const [, key, value] = match;

                if (value === '' || value === '|' || value === '>') {
                    // Check next line to determine if array or object
                    const nextLine = lines[i + 1]?.trim() || '';
                    if (nextLine.startsWith('-')) {
                        currentKey = key;
                        currentArray = [];
                    } else if (nextLine.match(/^\w+:/)) {
                        objectKey = key;
                        currentObject = {};
                    } else {
                        result[key] = '';
                    }
                } else if (value.startsWith('[') && value.endsWith(']')) {
                    // Inline array: [item1, item2]
                    const items = value.slice(1, -1).split(',').map((s) =>
                        s.trim().replace(/^["']|["']$/g, '')
                    ).filter(Boolean);
                    result[key] = items;
                } else if (value === 'true') {
                    result[key] = true;
                } else if (value === 'false') {
                    result[key] = false;
                } else if (/^\d+$/.test(value)) {
                    result[key] = parseInt(value, 10);
                } else if (/^\d+\.\d+$/.test(value)) {
                    result[key] = parseFloat(value);
                } else {
                    // String value (remove quotes if present)
                    result[key] = value.replace(/^["']|["']$/g, '');
                }
            }
        }

        // Close any remaining open array/object
        if (currentArray !== null && currentKey !== null) {
            result[currentKey] = currentArray;
        }
        if (currentObject !== null && objectKey !== null) {
            result[objectKey] = currentObject;
        }

        return result;
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
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
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

        // Build manifest with OpenClaw-compatible fields
        const manifest: ClaudeSkillManifest = {
            name: (parsed.name as string) || name,
            version: (parsed.version as string) || '1.0.0',
            description: (parsed.description as string) || name,
            directory,
        };

        // Optional string fields
        if (parsed.author) manifest.author = parsed.author as string;
        if (parsed.homepage) manifest.homepage = parsed.homepage as string;
        if (parsed.license) manifest.license = parsed.license as string;
        if (parsed.scriptsDir) manifest.scriptsDir = parsed.scriptsDir as string;

        // Array fields
        if (Array.isArray(parsed.tags)) {
            manifest.tags = parsed.tags as string[];
        }
        if (Array.isArray(parsed.triggers)) {
            manifest.triggers = parsed.triggers as string[];
        }
        if (Array.isArray(parsed.requiredCapabilities)) {
            manifest.requiredCapabilities = parsed.requiredCapabilities as string[];
        }

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

        // Requires object (OpenClaw compatible)
        if (parsed.requires && typeof parsed.requires === 'object') {
            const req = parsed.requires as Record<string, unknown>;
            manifest.requires = {
                tools: Array.isArray(req.tools) ? (req.tools as string[]) : [],
                capabilities: Array.isArray(req.capabilities) ? (req.capabilities as string[]) : [],
                bins: Array.isArray(req.bins) ? (req.bins as string[]) : [],
                env: Array.isArray(req.env) ? (req.env as string[]) : [],
                config: Array.isArray(req.config) ? (req.config as string[]) : [],
            };

            // Also populate legacy requiredCapabilities from requires.capabilities
            if (manifest.requires.capabilities.length > 0 && !manifest.requiredCapabilities) {
                manifest.requiredCapabilities = manifest.requires.capabilities;
            }
        }

        // Metadata object
        if (parsed.metadata && typeof parsed.metadata === 'object') {
            manifest.metadata = parsed.metadata as Record<string, unknown>;
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
