/**
 * OpenClaw Skills Compatibility Layer
 *
 * Enables direct import and use of OpenClaw SKILL.md format skills.
 * Supports:
 * - Full OpenClaw frontmatter parsing
 * - Platform filtering (darwin/linux/win32)
 * - Binary requirement checking
 * - Auto-installer support (brew/node/uv)
 * - ClawHub integration
 *
 * Reference: https://docs.openclaw.ai/tools/skills
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { SkillManifest, SkillRequirements } from './types';

// ============================================================================
// OpenClaw Types
// ============================================================================

export interface OpenClawMetadata {
    always?: boolean;
    emoji?: string;
    os?: ('darwin' | 'linux' | 'win32')[];
    requires?: {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
    };
    primaryEnv?: string;
    install?: {
        brew?: string[];
        node?: string[];
        uv?: string[];
        go?: string[];
        download?: {
            url: string;
            extract?: boolean;
        };
    };
    skillKey?: string;
}

export interface OpenClawSkillManifest {
    name: string;
    description: string;
    homepage?: string;
    'user-invocable'?: boolean;
    'disable-model-invocation'?: boolean;
    'command-dispatch'?: 'tool';
    'command-tool'?: string;
    'command-arg-mode'?: 'raw' | 'json';
    metadata?: {
        openclaw?: OpenClawMetadata;
    };
}

export interface DependencyCheckResult {
    satisfied: boolean;
    missing: string[];
    canAutoInstall: boolean;
    installCommands?: string[];
}

export interface ClawHubSkillInfo {
    name: string;
    description: string;
    author: string;
    version: string;
    downloads: number;
    stars: number;
    tags: string[];
    repoUrl: string;
    files: string[];
}

// ============================================================================
// OpenClaw Compatibility Layer
// ============================================================================

export class OpenClawCompatLayer {
    private static instance: OpenClawCompatLayer;

    private constructor() {}

    static getInstance(): OpenClawCompatLayer {
        if (!OpenClawCompatLayer.instance) {
            OpenClawCompatLayer.instance = new OpenClawCompatLayer();
        }
        return OpenClawCompatLayer.instance;
    }

    // ========================================================================
    // SKILL.md Parsing
    // ========================================================================

    /**
     * Parse OpenClaw-style SKILL.md content
     */
    parseOpenClawSkill(content: string, directory: string): SkillManifest {
        const { frontmatter, body } = this.extractFrontmatter(content);
        const openclawManifest = this.parseYamlFrontmatter(frontmatter);

        // Map to Coworkany SkillManifest format
        const manifest: SkillManifest = {
            id: openclawManifest.name || path.basename(directory),
            name: openclawManifest.name,
            version: '1.0.0',
            description: openclawManifest.description,

            // OpenClaw extensions
            author: 'OpenClaw Community',
            homepage: openclawManifest.homepage,
            tags: [],
            allowedTools: [],

            // Control flags
            userInvocable: openclawManifest['user-invocable'] ?? true,
            disableModelInvocation: openclawManifest['disable-model-invocation'] ?? false,

            // Requirements
            requires: this.mapRequirements(openclawManifest.metadata?.openclaw?.requires),

            // Triggers (empty for now, can be extended)
            triggers: [],

            // OpenClaw-specific metadata (including embedded content)
            metadata: {
                openclaw: openclawManifest.metadata?.openclaw,
                source: 'openclaw',
                content: body,
            },
        };

        // Add emoji to tags if present
        if (openclawManifest.metadata?.openclaw?.emoji) {
            manifest.tags = [openclawManifest.metadata.openclaw.emoji];
        }

        return manifest;
    }

    /**
     * Extract YAML frontmatter from markdown content
     */
    private extractFrontmatter(content: string): { frontmatter: string; body: string } {
        const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
        const match = content.match(frontmatterRegex);

        if (match) {
            return {
                frontmatter: match[1],
                body: match[2].trim(),
            };
        }

        return { frontmatter: '', body: content.trim() };
    }

    /**
     * Parse YAML frontmatter (simple implementation)
     */
    private parseYamlFrontmatter(yaml: string): OpenClawSkillManifest {
        const result: any = {};
        const lines = yaml.split('\n');
        let currentKey = '';
        let currentIndent = 0;
        let inNestedObject = false;
        let nestedObject: any = {};
        let nestedKey = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const indent = line.search(/\S/);

            // Handle nested objects
            if (indent > currentIndent && currentKey) {
                inNestedObject = true;
                nestedKey = currentKey;
                nestedObject = {};
            }

            if (inNestedObject && indent <= currentIndent) {
                result[nestedKey] = nestedObject;
                inNestedObject = false;
            }

            // Parse key-value pairs
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0) {
                const key = trimmed.slice(0, colonIndex).trim();
                let value = trimmed.slice(colonIndex + 1).trim();

                // Handle various value types
                if (value === '') {
                    currentKey = key;
                    currentIndent = indent;
                } else if (value === 'true') {
                    this.setNestedValue(result, inNestedObject ? nestedObject : result, key, true, inNestedObject);
                } else if (value === 'false') {
                    this.setNestedValue(result, inNestedObject ? nestedObject : result, key, false, inNestedObject);
                } else if (value.startsWith('[') && value.endsWith(']')) {
                    // Array value
                    const arrayContent = value.slice(1, -1);
                    const arrayValues = arrayContent.split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''));
                    this.setNestedValue(result, inNestedObject ? nestedObject : result, key, arrayValues, inNestedObject);
                } else if (value.startsWith('"') || value.startsWith("'")) {
                    // Quoted string
                    value = value.slice(1, -1);
                    this.setNestedValue(result, inNestedObject ? nestedObject : result, key, value, inNestedObject);
                } else {
                    this.setNestedValue(result, inNestedObject ? nestedObject : result, key, value, inNestedObject);
                }
            } else if (trimmed.startsWith('-')) {
                // Array item
                const item = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
                if (!result[currentKey]) {
                    result[currentKey] = [];
                }
                if (Array.isArray(result[currentKey])) {
                    result[currentKey].push(item);
                }
            }
        }

        // Handle any remaining nested object
        if (inNestedObject) {
            result[nestedKey] = nestedObject;
        }

        return result as OpenClawSkillManifest;
    }

    private setNestedValue(root: any, target: any, key: string, value: any, isNested: boolean): void {
        if (isNested) {
            target[key] = value;
        } else {
            root[key] = value;
        }
    }

    /**
     * Map OpenClaw requirements to Coworkany format
     */
    private mapRequirements(
        openclawRequires?: OpenClawMetadata['requires']
    ): SkillRequirements {
        return {
            tools: [],
            capabilities: [],
            bins: openclawRequires?.bins ?? [],
            env: openclawRequires?.env ?? [],
            config: openclawRequires?.config ?? [],
        };
    }

    // ========================================================================
    // Platform Eligibility
    // ========================================================================

    /**
     * Check if skill is eligible on current platform
     */
    checkPlatformEligibility(manifest: SkillManifest): boolean {
        const openclawMeta = manifest.metadata?.openclaw as OpenClawMetadata | undefined;

        // No platform restriction
        if (!openclawMeta?.os || openclawMeta.os.length === 0) {
            return true;
        }

        const currentPlatform = process.platform as 'darwin' | 'linux' | 'win32';
        return openclawMeta.os.includes(currentPlatform);
    }

    /**
     * Check if skill should always be included
     */
    isAlwaysIncluded(manifest: SkillManifest): boolean {
        const openclawMeta = manifest.metadata?.openclaw as OpenClawMetadata | undefined;
        return openclawMeta?.always === true;
    }

    // ========================================================================
    // Dependency Checking
    // ========================================================================

    /**
     * Check if all dependencies are satisfied
     */
    checkDependencies(manifest: SkillManifest): DependencyCheckResult {
        const missing: string[] = [];
        const installCommands: string[] = [];
        const openclawMeta = manifest.metadata?.openclaw as OpenClawMetadata | undefined;

        // Check required binaries
        if (manifest.requires?.bins) {
            for (const bin of manifest.requires.bins) {
                if (!this.checkBinaryExists(bin)) {
                    missing.push(`bin:${bin}`);

                    // Try to find install command
                    const installCmd = this.getInstallCommand(bin, openclawMeta?.install);
                    if (installCmd) {
                        installCommands.push(installCmd);
                    }
                }
            }
        }

        // Check anyBins (at least one must exist)
        if (openclawMeta?.requires?.anyBins && openclawMeta.requires.anyBins.length > 0) {
            const hasAny = openclawMeta.requires.anyBins.some(bin =>
                this.checkBinaryExists(bin)
            );
            if (!hasAny) {
                missing.push(`anyBin:${openclawMeta.requires.anyBins.join('|')}`);
            }
        }

        // Check environment variables
        if (manifest.requires?.env) {
            for (const envVar of manifest.requires.env) {
                if (!process.env[envVar]) {
                    missing.push(`env:${envVar}`);
                }
            }
        }

        return {
            satisfied: missing.length === 0,
            missing,
            canAutoInstall: installCommands.length > 0,
            installCommands: installCommands.length > 0 ? installCommands : undefined,
        };
    }

    /**
     * Check if a binary exists on PATH
     */
    private checkBinaryExists(binary: string): boolean {
        try {
            const command = process.platform === 'win32' ? 'where' : 'which';
            execSync(`${command} ${binary}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get install command for a missing binary
     */
    private getInstallCommand(
        binary: string,
        installers?: OpenClawMetadata['install']
    ): string | null {
        if (!installers) return null;

        // Check if brew is available (macOS)
        if (installers.brew && process.platform === 'darwin') {
            if (this.checkBinaryExists('brew')) {
                const pkg = installers.brew.find(p => p.includes(binary) || binary.includes(p));
                if (pkg) {
                    return `brew install ${pkg}`;
                }
            }
        }

        // Check if npm/node is available
        if (installers.node) {
            if (this.checkBinaryExists('npm')) {
                const pkg = installers.node.find(p => p.includes(binary) || binary.includes(p));
                if (pkg) {
                    return `npm install -g ${pkg}`;
                }
            }
        }

        // Check if uv (Python) is available
        if (installers.uv) {
            if (this.checkBinaryExists('uv') || this.checkBinaryExists('pip')) {
                const pkg = installers.uv.find(p => p.includes(binary) || binary.includes(p));
                if (pkg) {
                    return this.checkBinaryExists('uv') ? `uv pip install ${pkg}` : `pip install ${pkg}`;
                }
            }
        }

        // Check if go is available
        if (installers.go) {
            if (this.checkBinaryExists('go')) {
                const pkg = installers.go.find(p => p.includes(binary) || binary.includes(p));
                if (pkg) {
                    return `go install ${pkg}@latest`;
                }
            }
        }

        return null;
    }

    // ========================================================================
    // ClawHub Integration
    // ========================================================================

    /**
     * Search skills on ClawHub
     */
    async searchClawHub(query: string, limit: number = 10): Promise<ClawHubSkillInfo[]> {
        try {
            const response = await fetch(
                `https://clawhub.ai/api/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`
            );

            if (!response.ok) {
                throw new Error(`ClawHub search failed: ${response.status}`);
            }

            const data = await response.json() as { skills: ClawHubSkillInfo[] };
            return data.skills;
        } catch (error) {
            console.error('[OpenClawCompat] ClawHub search failed:', error);
            return [];
        }
    }

    /**
     * Get skill details from ClawHub
     */
    async getClawHubSkill(skillName: string): Promise<ClawHubSkillInfo | null> {
        try {
            const response = await fetch(
                `https://clawhub.ai/api/skills/${encodeURIComponent(skillName)}`
            );

            if (!response.ok) {
                if (response.status === 404) {
                    return null;
                }
                throw new Error(`ClawHub fetch failed: ${response.status}`);
            }

            return await response.json() as ClawHubSkillInfo;
        } catch (error) {
            console.error('[OpenClawCompat] ClawHub fetch failed:', error);
            return null;
        }
    }

    /**
     * Install skill from ClawHub
     */
    async installFromClawHub(
        skillName: string,
        targetDir: string
    ): Promise<{ success: boolean; path?: string; error?: string }> {
        try {
            const skillInfo = await this.getClawHubSkill(skillName);
            if (!skillInfo) {
                return { success: false, error: 'Skill not found on ClawHub' };
            }

            // Download skill files
            const skillDir = path.join(targetDir, skillName);
            if (!fs.existsSync(skillDir)) {
                fs.mkdirSync(skillDir, { recursive: true });
            }

            // Download SKILL.md
            const skillMdUrl = `${skillInfo.repoUrl}/raw/main/SKILL.md`;
            const response = await fetch(skillMdUrl);
            if (!response.ok) {
                throw new Error(`Failed to download SKILL.md: ${response.status}`);
            }

            const content = await response.text();
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);

            // Download additional files if any
            for (const file of skillInfo.files) {
                if (file !== 'SKILL.md') {
                    const fileUrl = `${skillInfo.repoUrl}/raw/main/${file}`;
                    const fileResponse = await fetch(fileUrl);
                    if (fileResponse.ok) {
                        const fileContent = await fileResponse.text();
                        const filePath = path.join(skillDir, file);
                        const fileDir = path.dirname(filePath);
                        if (!fs.existsSync(fileDir)) {
                            fs.mkdirSync(fileDir, { recursive: true });
                        }
                        fs.writeFileSync(filePath, fileContent);
                    }
                }
            }

            return { success: true, path: skillDir };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    // ========================================================================
    // Skill Discovery
    // ========================================================================

    /**
     * Scan directory for OpenClaw-compatible skills
     */
    scanForOpenClawSkills(directory: string): SkillManifest[] {
        const skills: SkillManifest[] = [];

        if (!fs.existsSync(directory)) {
            return skills;
        }

        const entries = fs.readdirSync(directory, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skillMdPath = path.join(directory, entry.name, 'SKILL.md');
                if (fs.existsSync(skillMdPath)) {
                    try {
                        const content = fs.readFileSync(skillMdPath, 'utf-8');
                        const skillDir = path.join(directory, entry.name);
                        const manifest = this.parseOpenClawSkill(content, skillDir);

                        // Check platform eligibility
                        if (this.checkPlatformEligibility(manifest)) {
                            skills.push(manifest);
                        }
                    } catch (error) {
                        console.error(`[OpenClawCompat] Failed to parse skill: ${entry.name}`, error);
                    }
                }
            }
        }

        return skills;
    }

    /**
     * Get all eligible skills for current session
     */
    getEligibleSkills(skills: SkillManifest[]): SkillManifest[] {
        return skills.filter(skill => {
            // Check platform
            if (!this.checkPlatformEligibility(skill)) {
                return false;
            }

            // Check dependencies
            const depCheck = this.checkDependencies(skill);
            if (!depCheck.satisfied) {
                console.warn(`[OpenClawCompat] Skill ${skill.name} missing deps: ${depCheck.missing.join(', ')}`);
                return false;
            }

            return true;
        });
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const openclawCompat = OpenClawCompatLayer.getInstance();
