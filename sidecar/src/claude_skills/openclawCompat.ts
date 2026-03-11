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
import { parse as parseYaml } from 'yaml';
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

export type OpenClawStore = 'clawhub';

export interface OpenClawStoreSkillInfo {
    name: string;
    slug?: string;
    displayName?: string;
    description: string;
    author?: string;
    version?: string;
    downloads?: number;
    stars?: number;
    tags?: string[];
    repoUrl?: string;
    files?: string[];
    skillMdUrl?: string;
    raw?: Record<string, unknown>;
}

export type ClawHubSkillInfo = OpenClawStoreSkillInfo;

const OPENCLAW_STORE_CONFIGS: Record<
    OpenClawStore,
    {
        baseUrl: string;
        searchPaths: string[];
        detailPaths: string[];
    }
> = {
    clawhub: {
        baseUrl: 'https://clawhub.ai',
        searchPaths: [
            '/api/v1/search?q={query}&limit={limit}',
            '/api/search?q={query}&limit={limit}',
            '/api/skills/search?q={query}&limit={limit}',
            '/api/v1/skills/search?q={query}&limit={limit}',
            '/skills/search?q={query}&limit={limit}',
        ],
        detailPaths: [
            '/api/v1/skills/{skillName}',
            '/api/skill?slug={skillName}',
            '/api/skills/{skillName}',
            '/api/v1/skills/{skillName}',
            '/skills/{skillName}',
        ],
    },
};

function getStoreBaseUrl(store: OpenClawStore): string {
    const envOverride = process.env.OPENCLAW_STORE_CLAWHUB_BASE_URL || process.env.CLAWHUB_BASE_URL;

    const fallback = OPENCLAW_STORE_CONFIGS[store].baseUrl;
    const raw = (envOverride || fallback).trim();
    return raw.replace(/\/$/, '');
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
        const frontmatterData = openclawManifest as unknown as Record<string, unknown>;
        const allowedTools = this.normalizeStringArray(
            frontmatterData['allowed-tools']
                ?? frontmatterData.allowedTools
                ?? frontmatterData.allowed_tools
        );
        const triggers = this.normalizeStringArray(frontmatterData.triggers);
        const tags = this.normalizeStringArray(frontmatterData.tags);

        const topLevelRequires = this.normalizeRequires(frontmatterData.requires);
        const metadataRequires = this.normalizeRequires(openclawManifest.metadata?.openclaw?.requires);
        const mergedRequires = this.mergeRequirements(topLevelRequires, metadataRequires);

        // Map to Coworkany SkillManifest format
        const manifest: SkillManifest = {
            id: openclawManifest.name || path.basename(directory),
            name: openclawManifest.name,
            version: '1.0.0',
            description: openclawManifest.description,

            // OpenClaw extensions
            author: 'OpenClaw Community',
            homepage: openclawManifest.homepage,
            tags,
            allowedTools,

            // Control flags
            userInvocable: openclawManifest['user-invocable'] ?? true,
            disableModelInvocation: openclawManifest['disable-model-invocation'] ?? false,

            // Requirements
            requires: mergedRequires,

            // Triggers
            triggers,

            // OpenClaw-specific metadata (including embedded content)
            metadata: {
                openclaw: openclawManifest.metadata?.openclaw,
                source: 'openclaw',
                content: body,
                frontmatter: openclawManifest,
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
        try {
            const parsed = parseYaml(yaml);
            if (parsed && typeof parsed === 'object') {
                return parsed as OpenClawSkillManifest;
            }
            return {} as OpenClawSkillManifest;
        } catch (error) {
            console.error('[OpenClawCompat] Failed to parse YAML frontmatter:', error);
            return {} as OpenClawSkillManifest;
        }
    }

    private normalizeStringArray(value: unknown): string[] {
        if (Array.isArray(value)) {
            return value
                .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
                .filter((item) => item.length > 0);
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed ? [trimmed] : [];
        }
        return [];
    }

    private normalizeRequires(value: unknown): SkillRequirements | undefined {
        if (!value) {
            return undefined;
        }

        if (Array.isArray(value)) {
            const env = value
                .map((item) => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean)
                .map((entry) => entry.split(/\s|\(/, 1)[0])
                .filter(Boolean);
            return { tools: [], capabilities: [], bins: [], env, config: [] };
        }

        if (typeof value === 'string') {
            const token = value.trim().split(/\s|\(/, 1)[0];
            return token
                ? { tools: [], capabilities: [], bins: [], env: [token], config: [] }
                : undefined;
        }

        const record = value as Record<string, unknown>;
        return {
            tools: this.normalizeStringArray(record.tools),
            capabilities: this.normalizeStringArray(record.capabilities),
            bins: this.normalizeStringArray(record.bins),
            env: this.normalizeStringArray(record.env),
            config: this.normalizeStringArray(record.config),
        };
    }

    private mergeRequirements(
        primary?: SkillRequirements,
        secondary?: SkillRequirements
    ): SkillRequirements {
        const merged: SkillRequirements = {
            tools: [],
            capabilities: [],
            bins: [],
            env: [],
            config: [],
        };
        const pushUnique = (target: string[], source?: string[]) => {
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
    // Store Integration
    // ========================================================================

    /**
     * Search skills from a configured OpenClaw-compatible store.
     */
    async searchStore(
        store: OpenClawStore,
        query: string,
        limit: number = 10
    ): Promise<OpenClawStoreSkillInfo[]> {
        const config = OPENCLAW_STORE_CONFIGS[store];
        if (!config) {
            return [];
        }
        const baseUrl = getStoreBaseUrl(store);

        const encodedQuery = encodeURIComponent(query.trim());
        const urls = config.searchPaths.map((pattern) => {
            const pathWithQuery = pattern
                .replace('{query}', encodedQuery)
                .replace('{limit}', String(limit));
            return `${baseUrl}${pathWithQuery}`;
        });

        const payload = await this.fetchFirstJson(urls);
        if (!payload) {
            return [];
        }

        try {
            const skills = this.extractSkillList(payload);
            return skills.slice(0, Math.max(1, limit));
        } catch (error) {
            console.error(`[OpenClawCompat] ${store} search parse failed:`, error);
            return [];
        }
    }

    /**
     * Get skill details from a configured store.
     */
    async getStoreSkill(
        store: OpenClawStore,
        skillName: string
    ): Promise<OpenClawStoreSkillInfo | null> {
        const config = OPENCLAW_STORE_CONFIGS[store];
        if (!config) {
            return null;
        }
        const baseUrl = getStoreBaseUrl(store);

        const encodedSkillName = encodeURIComponent(skillName.trim());
        const urls = config.detailPaths.map((pattern) => {
            const pathWithSkill = pattern.replace('{skillName}', encodedSkillName);
            return `${baseUrl}${pathWithSkill}`;
        });

        const payload = await this.fetchFirstJson(urls);
        if (!payload) {
            return null;
        }

        try {
            const normalized = this.normalizeSkillInfo(payload, skillName);
            if (!normalized.name) {
                return null;
            }
            return normalized;
        } catch (error) {
            console.error(`[OpenClawCompat] ${store} detail parse failed:`, error);
            return null;
        }
    }

    /**
     * Install skill from a configured store.
     */
    async installFromStore(
        store: OpenClawStore,
        skillName: string,
        targetDir: string
    ): Promise<{ success: boolean; path?: string; error?: string }> {
        try {
            const skillInfo = await this.getStoreSkill(store, skillName);
            if (!skillInfo) {
                return { success: false, error: `Skill not found on ${store}` };
            }

            if (store === 'clawhub') {
                const clawHubInstall = await this.installFromClawHubApiSkill(
                    skillInfo,
                    targetDir,
                    getStoreBaseUrl(store),
                    store
                );
                if (clawHubInstall.success) {
                    return clawHubInstall;
                }
                console.warn(`[OpenClawCompat] ${store} API install failed, falling back to repo/raw mode:`, clawHubInstall.error);
            }

            const safeFolderName = this.sanitizeFolderName(skillInfo.name || skillName);
            const skillDir = path.join(targetDir, safeFolderName);
            if (!fs.existsSync(skillDir)) {
                fs.mkdirSync(skillDir, { recursive: true });
            }

            const skillMdUrl = this.resolveSkillMdUrl(skillInfo);
            if (!skillMdUrl) {
                return {
                    success: false,
                    error: `No downloadable SKILL.md URL available for ${skillName}`,
                };
            }

            const skillMdResponse = await fetch(skillMdUrl);
            if (!skillMdResponse.ok) {
                throw new Error(`Failed to download SKILL.md: ${skillMdResponse.status}`);
            }
            const skillMdContent = await skillMdResponse.text();
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMdContent);

            const files = Array.isArray(skillInfo.files) ? skillInfo.files : [];
            for (const file of files) {
                if (file.toLowerCase() === 'skill.md') {
                    continue;
                }

                const fileUrl = this.resolveAdditionalFileUrl(file, skillInfo);
                if (!fileUrl) continue;

                const fileResponse = await fetch(fileUrl);
                if (!fileResponse.ok) continue;

                const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
                const normalizedFilePath = /^skill\.md$/i.test(file) ? 'SKILL.md' : file;
                const filePath = path.join(skillDir, normalizedFilePath);
                const fileDir = path.dirname(filePath);
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }
                fs.writeFileSync(filePath, fileBuffer);
            }

            return { success: true, path: skillDir };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async installFromClawHubApiSkill(
        skillInfo: OpenClawStoreSkillInfo,
        targetDir: string,
        baseUrl: string,
        store: OpenClawStore
    ): Promise<{ success: boolean; path?: string; error?: string }> {
        const slug = this.pickString(skillInfo.slug, skillInfo.name);
        if (!slug) {
            return { success: false, error: `Missing ${store} skill slug` };
        }

        const resolvedVersion = this.pickString(skillInfo.version) ?? await this.resolveClawHubLatestVersion(baseUrl, slug);
        if (!resolvedVersion) {
            return { success: false, error: `Missing version for ${store} skill: ${slug}` };
        }

        const safeFolderName = this.sanitizeFolderName(skillInfo.name || slug);
        const skillDir = path.join(targetDir, safeFolderName);
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        const versionFiles = await this.fetchClawHubVersionFileList(baseUrl, slug, resolvedVersion);
        const candidates = versionFiles.length > 0 ? versionFiles : ['SKILL.md', '_meta.json'];

        let wroteSkillMd = false;
        for (const entry of candidates) {
            const canonicalPath = /^skill\.md$/i.test(entry) ? 'SKILL.md' : entry;
            const fileText = await this.fetchClawHubSkillFile(baseUrl, slug, canonicalPath, resolvedVersion);
            if (fileText == null) {
                continue;
            }

            const outputPath = path.join(skillDir, canonicalPath);
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(outputPath, fileText, 'utf-8');

            if (canonicalPath.toLowerCase() === 'skill.md') {
                wroteSkillMd = true;
            }
        }

        if (!wroteSkillMd) {
            return { success: false, error: `Failed to download SKILL.md from ${store} for ${slug}` };
        }

        return { success: true, path: skillDir };
    }

    async searchClawHub(query: string, limit: number = 10): Promise<ClawHubSkillInfo[]> {
        return this.searchStore('clawhub', query, limit);
    }

    async getClawHubSkill(skillName: string): Promise<ClawHubSkillInfo | null> {
        return this.getStoreSkill('clawhub', skillName);
    }

    async installFromClawHub(
        skillName: string,
        targetDir: string
    ): Promise<{ success: boolean; path?: string; error?: string }> {
        return this.installFromStore('clawhub', skillName, targetDir);
    }

    private async fetchFirstJson(urls: string[]): Promise<unknown | null> {
        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    continue;
                }
                return await response.json();
            } catch {
                continue;
            }
        }
        return null;
    }

    private async resolveClawHubLatestVersion(baseUrl: string, slug: string): Promise<string | undefined> {
        const encoded = encodeURIComponent(slug);
        const payload = await this.fetchFirstJson([
            `${baseUrl}/api/v1/skills/${encoded}`,
            `${baseUrl}/api/skills/${encoded}`,
            `${baseUrl}/api/skill?slug=${encoded}`,
        ]);
        const record = this.asRecord(payload);
        const latest = this.asRecord(record?.latestVersion);
        return this.pickString(latest?.version, this.asRecord(record?.version)?.version);
    }

    private async fetchClawHubVersionFileList(baseUrl: string, slug: string, version: string): Promise<string[]> {
        const encodedSlug = encodeURIComponent(slug);
        const encodedVersion = encodeURIComponent(version);
        const payload = await this.fetchFirstJson([
            `${baseUrl}/api/v1/skills/${encodedSlug}/versions/${encodedVersion}`,
            `${baseUrl}/api/skills/${encodedSlug}/versions/${encodedVersion}`,
        ]);
        const root = this.asRecord(payload);
        const versionRecord = this.asRecord(root?.version);
        const files = versionRecord?.files;
        if (!Array.isArray(files)) {
            return [];
        }
        const list: string[] = [];
        for (const file of files) {
            const fileRecord = this.asRecord(file);
            const filePath = this.pickString(fileRecord?.path);
            if (filePath) {
                list.push(filePath);
            }
        }
        return list;
    }

    private async fetchClawHubSkillFile(
        baseUrl: string,
        slug: string,
        filePath: string,
        version: string
    ): Promise<string | null> {
        const encodedSlug = encodeURIComponent(slug);
        const urls = [
            `${baseUrl}/api/v1/skills/${encodedSlug}/file?path=${encodeURIComponent(filePath)}&version=${encodeURIComponent(version)}`,
            `${baseUrl}/api/skills/${encodedSlug}/file?path=${encodeURIComponent(filePath)}&version=${encodeURIComponent(version)}`,
        ];

        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    continue;
                }
                return await response.text();
            } catch {
                continue;
            }
        }
        return null;
    }

    private extractSkillList(payload: unknown): OpenClawStoreSkillInfo[] {
        if (Array.isArray(payload)) {
            return payload.map((item) => this.normalizeSkillInfo(item));
        }
        if (payload && typeof payload === 'object') {
            const asRecord = payload as Record<string, unknown>;
            const candidates = [asRecord.skills, asRecord.items, asRecord.data, asRecord.results];
            for (const candidate of candidates) {
                if (Array.isArray(candidate)) {
                    return candidate.map((item) => this.normalizeSkillInfo(item));
                }
            }
        }
        return [];
    }

    private normalizeSkillInfo(entry: unknown, fallbackName: string = ''): OpenClawStoreSkillInfo {
        if (!entry || typeof entry !== 'object') {
            return {
                name: fallbackName,
                description: '',
            };
        }

        const data = entry as Record<string, unknown>;
        const skill = this.asRecord(data.skill);
        const latestVersion = this.asRecord(data.latestVersion);
        const versionBlock = this.asRecord(data.version);
        const stats = this.asRecord(data.stats) ?? this.asRecord(skill?.stats);

        const slug = this.pickString(data.slug, skill?.slug, data.id, fallbackName);
        const version = this.pickString(data.version, latestVersion?.version, versionBlock?.version);
        const tagsRecord = this.asRecord(data.tags) ?? this.asRecord(skill?.tags);
        const tags = Array.isArray(data.tags)
            ? data.tags.map((tag) => String(tag))
            : (tagsRecord ? Object.keys(tagsRecord).filter((tag) => tag.length > 0) : undefined);

        return {
            name: this.pickString(data.name, slug, fallbackName) ?? '',
            slug: slug || undefined,
            displayName: this.pickString(data.displayName, skill?.displayName),
            description: this.pickString(data.description, data.summary, skill?.summary) ?? '',
            author: data.author ? String(data.author) : undefined,
            version: version || undefined,
            downloads: this.toOptionalNumber(data.downloads) ?? this.toOptionalNumber(stats?.downloads),
            stars: this.toOptionalNumber(data.stars) ?? this.toOptionalNumber(stats?.stars),
            tags,
            repoUrl: this.pickString(data.repoUrl, data.repositoryUrl),
            files: Array.isArray(data.files)
                ? data.files.map((file) => String(file))
                : (Array.isArray(versionBlock?.files)
                    ? versionBlock.files
                        .map((file) => this.pickString(this.asRecord(file)?.path))
                        .filter((filePath): filePath is string => Boolean(filePath))
                    : undefined),
            skillMdUrl: data.skillMdUrl
                ? String(data.skillMdUrl)
                : (data.downloadUrl ? String(data.downloadUrl) : undefined),
            raw: data,
        };
    }

    private asRecord(value: unknown): Record<string, unknown> | null {
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    }

    private pickString(...values: unknown[]): string | undefined {
        for (const value of values) {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length > 0) {
                    return trimmed;
                }
            }
        }
        return undefined;
    }

    private toOptionalNumber(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return undefined;
    }

    private sanitizeFolderName(name: string): string {
        const sanitized = name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        return sanitized.length > 0 ? sanitized : 'openclaw_skill';
    }

    private resolveSkillMdUrl(skill: OpenClawStoreSkillInfo): string | null {
        if (skill.skillMdUrl && /^https?:\/\//i.test(skill.skillMdUrl)) {
            return skill.skillMdUrl;
        }

        if (skill.repoUrl && /^https?:\/\//i.test(skill.repoUrl)) {
            const directSkillUrl = `${skill.repoUrl.replace(/\/$/, '')}/raw/main/SKILL.md`;
            return directSkillUrl;
        }

        return null;
    }

    private resolveAdditionalFileUrl(filePath: string, skill: OpenClawStoreSkillInfo): string | null {
        if (!skill.repoUrl || !/^https?:\/\//i.test(skill.repoUrl)) {
            return null;
        }
        return `${skill.repoUrl.replace(/\/$/, '')}/raw/main/${filePath}`;
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
