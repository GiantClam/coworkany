/**
 * GitHub Repository Scanner
 *
 * Scans GitHub repositories to discover valid skills and MCP servers.
 * Supports deep directory scanning to find nested resources.
 */

import * as fs from 'fs';
import { parseGitHubSource } from './githubDownloader';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredSkill {
    name: string;
    description: string;
    path: string;
    source: string; // Full github: URL
    runtime?: 'python' | 'node' | 'shell' | 'unknown';
    hasScripts: boolean;
}

export interface DiscoveredMcp {
    name: string;
    description: string;
    path: string;
    source: string; // Full github: URL
    runtime: 'python' | 'node' | 'unknown';
    tools?: string[];
}

export interface ScanResult {
    skills: DiscoveredSkill[];
    mcpServers: DiscoveredMcp[];
    errors: string[];
}

interface GitHubContent {
    name: string;
    path: string;
    type: 'file' | 'dir';
    download_url: string | null;
    url: string;
}

// ============================================================================
// Default Repositories
// ============================================================================

export const DEFAULT_SKILL_REPOS = [
    'github:anthropics/skills',
    'github:anthropics/claude-plugins-official/plugins',
    'github:OthmanAdi/planning-with-files',
    'github:obra/superpowers',
];

export const DEFAULT_MCP_REPOS = [
    'github:modelcontextprotocol/servers/src',
];

// ============================================================================
// Scanner
// ============================================================================

/**
 * Scan a GitHub repository for valid skills
 */
export async function scanForSkills(
    source: string,
    maxDepth: number = 3,
    token?: string
): Promise<DiscoveredSkill[]> {
    const skills: DiscoveredSkill[] = [];
    const parsed = parseGitHubSource(source);
    if (!parsed) return skills;

    try {
        await scanDirectoryForSkills(
            parsed.owner,
            parsed.repo,
            parsed.path,
            parsed.branch,
            0,
            maxDepth,
            skills,
            token
        );
    } catch (error) {
        console.error(`[Scanner] Error scanning ${source}:`, error);
    }

    return skills;
}

/**
 * Scan a GitHub repository for valid MCP servers
 */
export async function scanForMcpServers(
    source: string,
    maxDepth: number = 3,
    token?: string
): Promise<DiscoveredMcp[]> {
    const servers: DiscoveredMcp[] = [];
    const parsed = parseGitHubSource(source);
    if (!parsed) return servers;

    try {
        await scanDirectoryForMcp(
            parsed.owner,
            parsed.repo,
            parsed.path,
            parsed.branch,
            0,
            maxDepth,
            servers,
            token
        );
    } catch (error) {
        console.error(`[Scanner] Error scanning ${source}:`, error);
    }

    return servers;
}

/**
 * Scan all default repositories
 */
export const CACHE_FILE = 'scanned-repos-cache.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Scan all default repositories
 */
export async function scanDefaultRepositories(token?: string): Promise<ScanResult> {
    // Try to load from cache first
    try {
        const cachePath = process.cwd() + '/' + CACHE_FILE;
        if (fs.existsSync(cachePath)) {
            const cacheContent = fs.readFileSync(cachePath, 'utf-8');
            const cache = JSON.parse(cacheContent);
            const age = Date.now() - cache.timestamp;

            if (age < CACHE_TTL_MS) {
                console.error(`[Scanner] Loading scan results from cache (${Math.round(age / 1000 / 60)}m old)`);
                return cache.data as ScanResult;
            }
        }
    } catch (e) {
        console.error('[Scanner] Failed to read cache:', e);
    }

    const result: ScanResult = {
        skills: [],
        mcpServers: [],
        errors: [],
    };

    // Scan skill repositories
    for (const repo of DEFAULT_SKILL_REPOS) {
        try {
            console.error(`[Scanner] Scanning skills from ${repo}`);
            const skills = await scanForSkills(repo, 3, token);
            result.skills.push(...skills);
        } catch (error) {
            result.errors.push(`Failed to scan ${repo}: ${error}`);
        }
    }

    // Scan MCP repositories
    for (const repo of DEFAULT_MCP_REPOS) {
        try {
            console.error(`[Scanner] Scanning MCP servers from ${repo}`);
            const servers = await scanForMcpServers(repo, 3, token);
            result.mcpServers.push(...servers);
        } catch (error) {
            result.errors.push(`Failed to scan ${repo}: ${error}`);
        }
    }

    // Save to cache
    try {
        const cacheData = {
            timestamp: Date.now(),
            data: result
        };
        const cachePath = process.cwd() + '/' + CACHE_FILE;
        fs.writeFileSync(cachePath, JSON.stringify(cacheData));
        console.error('[Scanner] Saved scan results to cache');
    } catch (e) {
        console.error('[Scanner] Failed to write cache:', e);
    }

    return result;
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function scanDirectoryForSkills(
    owner: string,
    repo: string,
    repoPath: string,
    branch: string,
    depth: number,
    maxDepth: number,
    skills: DiscoveredSkill[],
    token?: string
): Promise<void> {
    if (depth > maxDepth) return;

    const contents = await fetchGitHubContents(owner, repo, repoPath, branch, token);
    if (!contents) return;

    // Check if this directory is a skill (has SKILL.md)
    const skillMd = contents.find(
        (c) => c.type === 'file' && c.name.toLowerCase() === 'skill.md'
    );

    if (skillMd) {
        // This is a skill directory
        const skill = await parseSkillDirectory(owner, repo, repoPath, branch, contents, token);
        if (skill) {
            skills.push(skill);
        }
        return; // Don't recurse into skill directories
    }

    // Recurse into subdirectories
    const dirs = contents.filter((c) => c.type === 'dir' && !c.name.startsWith('.'));
    for (const dir of dirs) {
        await scanDirectoryForSkills(
            owner,
            repo,
            dir.path,
            branch,
            depth + 1,
            maxDepth,
            skills,
            token
        );
    }
}

async function scanDirectoryForMcp(
    owner: string,
    repo: string,
    repoPath: string,
    branch: string,
    depth: number,
    maxDepth: number,
    servers: DiscoveredMcp[],
    token?: string
): Promise<void> {
    if (depth > maxDepth) return;

    const contents = await fetchGitHubContents(owner, repo, repoPath, branch, token);
    if (!contents) return;

    // Check if this directory has MCP indicators
    const hasManifest = contents.some(
        (c) => c.type === 'file' && c.name === 'manifest.json'
    );
    const hasPackageJson = contents.some(
        (c) => c.type === 'file' && c.name === 'package.json'
    );
    const hasPyproject = contents.some(
        (c) => c.type === 'file' && (c.name === 'pyproject.toml' || c.name === 'setup.py')
    );
    const hasReadme = contents.some(
        (c) => c.type === 'file' && c.name.toLowerCase().startsWith('readme')
    );

    // MCP server detection: has package.json or pyproject.toml, and name suggests MCP
    const dirName = repoPath.split('/').pop() || repo;
    const isMcpCandidate =
        (hasPackageJson || hasPyproject || hasManifest) &&
        (dirName.includes('mcp') ||
            dirName.includes('server') ||
            hasManifest ||
            depth === 1); // First level subdirectories in MCP repos

    if (isMcpCandidate && (hasPackageJson || hasPyproject)) {
        const server = await parseMcpDirectory(
            owner,
            repo,
            repoPath,
            branch,
            contents,
            hasPackageJson ? 'node' : 'python',
            token
        );
        if (server) {
            servers.push(server);
        }
        return; // Don't recurse into MCP directories
    }

    // Recurse into subdirectories
    const dirs = contents.filter(
        (c) => c.type === 'dir' && !c.name.startsWith('.') && c.name !== 'node_modules'
    );
    for (const dir of dirs) {
        await scanDirectoryForMcp(
            owner,
            repo,
            dir.path,
            branch,
            depth + 1,
            maxDepth,
            servers,
            token
        );
    }
}

async function fetchGitHubContents(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    token?: string
): Promise<GitHubContent[] | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CoworkAny-Desktop',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            if (response.status === 403) {
                const remaining = response.headers.get('x-ratelimit-remaining');
                if (remaining === '0') {
                    console.warn('[Scanner] GitHub rate limit reached');
                }
            }
            return null;
        }
        const data = await response.json() as GitHubContent | GitHubContent[];
        return Array.isArray(data) ? data : [data];
    } catch {
        return null;
    }
}

async function parseSkillDirectory(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    contents: GitHubContent[],
    token?: string
): Promise<DiscoveredSkill | null> {
    const skillMd = contents.find(
        (c) => c.type === 'file' && c.name.toLowerCase() === 'skill.md'
    );
    if (!skillMd || !skillMd.download_url) return null;

    // Fetch SKILL.md to extract metadata
    try {
        const headers: Record<string, string> = { 'User-Agent': 'CoworkAny-Desktop' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(skillMd.download_url, { headers });
        if (!response.ok) return null;

        const content = await response.text();
        const metadata = parseSkillMetadata(content);
        const name = path.split('/').pop() || 'unknown';

        // Detect runtime
        const hasScripts = contents.some((c) => c.name === 'scripts');
        const hasPython = contents.some(
            (c) => c.name.endsWith('.py') || c.name === 'requirements.txt'
        );
        const hasNode = contents.some(
            (c) => c.name === 'package.json' || c.name.endsWith('.js') || c.name.endsWith('.ts')
        );

        return {
            name: metadata.name || name,
            description: metadata.description || '',
            path,
            source: `github:${owner}/${repo}/${path}`,
            runtime: hasPython ? 'python' : hasNode ? 'node' : hasScripts ? 'shell' : 'unknown',
            hasScripts,
        };
    } catch {
        return null;
    }
}

async function parseMcpDirectory(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    contents: GitHubContent[],
    runtime: 'node' | 'python',
    token?: string
): Promise<DiscoveredMcp | null> {
    const name = path.split('/').pop() || 'unknown';
    let description = '';

    // Try to get description from README
    const readme = contents.find(
        (c) => c.type === 'file' && c.name.toLowerCase().startsWith('readme')
    );
    if (readme && readme.download_url) {
        try {
            const headers: Record<string, string> = { 'User-Agent': 'CoworkAny-Desktop' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(readme.download_url, { headers });
            if (response.ok) {
                const content = await response.text();
                // Extract first paragraph as description
                const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
                description = lines[0]?.substring(0, 200) || '';
            }
        } catch {
            // Ignore readme fetch errors
        }
    }

    return {
        name,
        description,
        path,
        source: `github:${owner}/${repo}/${path}`,
        runtime,
    };
}

function parseSkillMetadata(content: string): { name?: string; description?: string } {
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return {};

    const frontmatter = frontmatterMatch[1];
    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    const descMatch = frontmatter.match(/description:\s*(.+)/);

    return {
        name: nameMatch?.[1]?.trim(),
        description: descMatch?.[1]?.trim(),
    };
}

/**
 * Validate if a URL points to a valid skill
 */
export async function validateSkillUrl(source: string, token?: string): Promise<{
    valid: boolean;
    reason?: string;
    skill?: DiscoveredSkill;
}> {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return { valid: false, reason: 'Invalid GitHub URL format' };
    }

    const contents = await fetchGitHubContents(
        parsed.owner,
        parsed.repo,
        parsed.path,
        parsed.branch,
        token
    );

    if (!contents) {
        return { valid: false, reason: 'Path not found or rate limit exceeded' };
    }

    const skillMd = contents.find(
        (c) => c.type === 'file' && c.name.toLowerCase() === 'skill.md'
    );

    if (!skillMd) {
        return { valid: false, reason: 'No SKILL.md found in directory' };
    }

    const skill = await parseSkillDirectory(
        parsed.owner,
        parsed.repo,
        parsed.path,
        parsed.branch,
        contents,
        token
    );

    return {
        valid: true,
        skill: skill || undefined,
    };
}

/**
 * Validate if a URL points to a valid MCP server
 */
export async function validateMcpUrl(source: string, token?: string): Promise<{
    valid: boolean;
    reason?: string;
    server?: DiscoveredMcp;
}> {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return { valid: false, reason: 'Invalid GitHub URL format' };
    }

    const contents = await fetchGitHubContents(
        parsed.owner,
        parsed.repo,
        parsed.path,
        parsed.branch,
        token
    );

    if (!contents) {
        return { valid: false, reason: 'Path not found or rate limit exceeded' };
    }

    const hasPackageJson = contents.some((c) => c.name === 'package.json');
    const hasPyproject = contents.some(
        (c) => c.name === 'pyproject.toml' || c.name === 'setup.py'
    );

    if (!hasPackageJson && !hasPyproject) {
        return { valid: false, reason: 'No package.json or pyproject.toml found' };
    }

    const server = await parseMcpDirectory(
        parsed.owner,
        parsed.repo,
        parsed.path,
        parsed.branch,
        contents,
        hasPackageJson ? 'node' : 'python',
        token
    );

    return {
        valid: true,
        server: server || undefined,
    };
}
