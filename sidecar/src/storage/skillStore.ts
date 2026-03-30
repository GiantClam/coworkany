import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { BUILTIN_SKILLS } from '../data/defaults';
export interface SkillRequirements {
    tools: string[];
    capabilities: string[];
    bins: string[];
    env: string[];
    config: string[];
}
export interface ClaudeSkillManifest {
    name: string;
    version: string;
    description: string;
    directory: string;
    scriptsDir?: string;
    tags?: string[];
    allowedTools?: string[];
    requiredCapabilities?: string[];
    author?: string;
    homepage?: string;
    license?: string;
    requires?: SkillRequirements;
    triggers?: string[];
    userInvocable?: boolean;
    disableModelInvocation?: boolean;
    metadata?: Record<string, unknown>;
}
export interface StoredSkill {
    manifest: ClaudeSkillManifest;
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
    isBuiltin?: boolean;
}
export class SkillStore {
    private storagePath: string;
    private skills: Map<string, StoredSkill> = new Map();
    constructor(workspaceRoot: string) {
        this.storagePath = path.join(workspaceRoot, '.coworkany', 'skills.json');
        this.load();
    }
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
    reload(): void {
        console.log('[SkillStore] Reloading skills...');
        this.skills.clear();
        this.load();
    }
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
    listEnabled(): StoredSkill[] {
        return this.list().filter((s) => s.enabled);
    }
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
    setEnabled(name: string, enabled: boolean): boolean {
        const skill = this.skills.get(name);
        if (!skill) return false;
        skill.enabled = enabled;
        this.save();
        console.log(`[SkillStore] ${name} enabled: ${enabled}`);
        return true;
    }
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
                const content = fs.readFileSync(skillMd, 'utf-8');
                const manifest = SkillStore.parseSkillMd(entry.name, skillDir, content);
                if (manifest) {
                    manifests.push(manifest);
                }
            }
        }
        return manifests;
    }
    private static parseFrontmatter(yaml: string): Record<string, unknown> {
        try {
            const parsed = YAML.parse(yaml);
            return parsed && typeof parsed === 'object'
                ? (parsed as Record<string, unknown>)
                : {};
        } catch (error) {
            console.error('[SkillStore] Failed to parse SKILL.md frontmatter:', error);
            return {};
        }
    }
    static parseSkillMd(
        name: string,
        directory: string,
        content: string
    ): ClaudeSkillManifest | null {
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
        const manifest: ClaudeSkillManifest = {
            name: (parsed.name as string) || name,
            version: (parsed.version as string) || '1.0.0',
            description: (parsed.description as string) || name,
            directory,
        };
        if (parsed.author) manifest.author = parsed.author as string;
        if (parsed.homepage) manifest.homepage = parsed.homepage as string;
        if (parsed.license) manifest.license = parsed.license as string;
        if (parsed.scriptsDir) manifest.scriptsDir = parsed.scriptsDir as string;
        if (Array.isArray(parsed.tags)) {
            manifest.tags = parsed.tags as string[];
        }
        if (Array.isArray(parsed['allowed-tools'])) {
            manifest.allowedTools = parsed['allowed-tools'] as string[];
        } else if (Array.isArray(parsed.allowedTools)) {
            manifest.allowedTools = parsed.allowedTools as string[];
        }
        if (Array.isArray(parsed.triggers)) {
            manifest.triggers = parsed.triggers as string[];
        }
        if (Array.isArray(parsed.requiredCapabilities)) {
            manifest.requiredCapabilities = parsed.requiredCapabilities as string[];
        }
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
        if (parsed.requires && typeof parsed.requires === 'object') {
            const req = parsed.requires as Record<string, unknown>;
            manifest.requires = {
                tools: Array.isArray(req.tools) ? (req.tools as string[]) : [],
                capabilities: Array.isArray(req.capabilities) ? (req.capabilities as string[]) : [],
                bins: Array.isArray(req.bins) ? (req.bins as string[]) : [],
                env: Array.isArray(req.env) ? (req.env as string[]) : [],
                config: Array.isArray(req.config) ? (req.config as string[]) : [],
            };
            if (manifest.requires.capabilities.length > 0 && !manifest.requiredCapabilities) {
                manifest.requiredCapabilities = manifest.requires.capabilities;
            }
        }
        if (parsed.metadata && typeof parsed.metadata === 'object') {
            manifest.metadata = parsed.metadata as Record<string, unknown>;
        }
        return manifest;
    }
    static loadFromDirectory(skillDir: string): ClaudeSkillManifest | null {
        const skillMd = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillMd)) {
            return null;
        }
        const content = fs.readFileSync(skillMd, 'utf-8');
        const name = path.basename(skillDir);
        return SkillStore.parseSkillMd(name, skillDir, content);
    }
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
    findByTrigger(userMessage: string): StoredSkill[] {
        const messageLower = userMessage.toLowerCase();
        const matches: Array<{ skill: StoredSkill; triggerLength: number }> = [];
        for (const skill of this.listEnabled()) {
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
        matches.sort((a, b) => b.triggerLength - a.triggerLength);
        return matches.map((m) => m.skill);
    }
    listUserInvocable(): StoredSkill[] {
        return this.listEnabled().filter((s) => s.manifest.userInvocable !== false);
    }
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
        if (requires.tools && context.availableTools) {
            for (const tool of requires.tools) {
                if (!context.availableTools.includes(tool)) {
                    missing.push(`tool:${tool}`);
                }
            }
        }
        if (requires.env && context.envVars) {
            for (const envVar of requires.env) {
                if (!context.envVars[envVar]) {
                    missing.push(`env:${envVar}`);
                }
            }
        }
        if (requires.bins && requires.bins.length > 0) {
        }
        return {
            satisfied: missing.length === 0,
            missing,
        };
    }
}
