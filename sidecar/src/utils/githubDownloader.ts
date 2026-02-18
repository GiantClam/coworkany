/**
 * GitHub Downloader
 *
 * Utility to download folders from GitHub repositories.
 * Supports both public repositories and authenticated access.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface GitHubDownloadOptions {
    branch?: string;
    token?: string; // For private repos
}

export interface GitHubDownloadResult {
    success: boolean;
    path: string;
    filesDownloaded: number;
    error?: string;
}

interface GitHubContent {
    name: string;
    path: string;
    type: 'file' | 'dir';
    download_url: string | null;
    url: string;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse GitHub source string into components
 * Formats:
 * - github:user/repo/path/to/folder
 * - https://github.com/user/repo/tree/branch/path/to/folder
 */
export function parseGitHubSource(source: string): {
    owner: string;
    repo: string;
    path: string;
    branch: string;
} | null {
    // Format: github:user/repo/path
    if (source.startsWith('github:')) {
        const parts = source.slice(7).split('/');
        if (parts.length < 2) return null;
        return {
            owner: parts[0],
            repo: parts[1],
            path: parts.slice(2).join('/'),
            branch: 'main',
        };
    }

    // Format: https://github.com/user/repo/tree/branch/path
    const match = source.match(
        /github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/?(.*)/
    );
    if (match) {
        return {
            owner: match[1],
            repo: match[2],
            branch: match[3],
            path: match[4] || '',
        };
    }

    // Format: https://github.com/user/repo (root)
    const rootMatch = source.match(/github\.com\/([^\/]+)\/([^\/]+)\/?$/);
    if (rootMatch) {
        return {
            owner: rootMatch[1],
            repo: rootMatch[2],
            path: '',
            branch: 'main',
        };
    }

    return null;
}

// ============================================================================
// Downloader
// ============================================================================

/**
 * Download a folder from GitHub to local directory
 */
export async function downloadFromGitHub(
    source: string,
    targetDir: string,
    options: GitHubDownloadOptions = {}
): Promise<GitHubDownloadResult> {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return {
            success: false,
            path: targetDir,
            filesDownloaded: 0,
            error: `Invalid GitHub source format: ${source}`,
        };
    }

    const { owner, repo, path: repoPath, branch } = parsed;
    const actualBranch = options.branch || branch;

    console.log(`[GitHubDownloader] Downloading ${owner}/${repo}/${repoPath} (${actualBranch}) to ${targetDir}`);

    try {
        // Create target directory
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Download recursively
        const filesDownloaded = await downloadDirectory(
            owner,
            repo,
            repoPath,
            actualBranch,
            targetDir,
            options.token
        );

        return {
            success: true,
            path: targetDir,
            filesDownloaded,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[GitHubDownloader] Error:`, message);
        return {
            success: false,
            path: targetDir,
            filesDownloaded: 0,
            error: message,
        };
    }
}

/**
 * Download a directory recursively from GitHub
 */
async function downloadDirectory(
    owner: string,
    repo: string,
    repoPath: string,
    branch: string,
    localDir: string,
    token?: string
): Promise<number> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}?ref=${branch}`;

    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'CoworkAny-Desktop',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Path not found: ${repoPath}`);
        }
        if (response.status === 403) {
            const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
            if (rateLimitRemaining === '0') {
                throw new Error('GitHub API rate limit exceeded. Try again later or use a token.');
            }
        }
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const contents = await response.json() as GitHubContent | GitHubContent[];

    // Handle single file case
    if (!Array.isArray(contents)) {
        if (contents.type === 'file' && contents.download_url) {
            await downloadFile(contents.download_url, path.join(localDir, contents.name), token);
            return 1;
        }
        return 0;
    }

    let count = 0;

    for (const item of contents) {
        const localPath = path.join(localDir, item.name);

        if (item.type === 'file' && item.download_url) {
            await downloadFile(item.download_url, localPath, token);
            count++;
        } else if (item.type === 'dir') {
            if (!fs.existsSync(localPath)) {
                fs.mkdirSync(localPath, { recursive: true });
            }
            count += await downloadDirectory(owner, repo, item.path, branch, localPath, token);
        }
    }

    return count;
}

/**
 * Download a single file
 */
async function downloadFile(url: string, localPath: string, token?: string): Promise<void> {
    const headers: Record<string, string> = {
        'User-Agent': 'CoworkAny-Desktop',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status}`);
    }

    const content = await response.arrayBuffer();
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localPath, Buffer.from(content));
    console.log(`[GitHubDownloader] Downloaded: ${path.basename(localPath)}`);
}

/**
 * Download skill from GitHub
 */
export async function downloadSkillFromGitHub(
    source: string,
    workspacePath: string,
    options: GitHubDownloadOptions = {}
): Promise<GitHubDownloadResult> {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return {
            success: false,
            path: '',
            filesDownloaded: 0,
            error: `Invalid GitHub source: ${source}`,
        };
    }

    // Extract skill name from path
    const skillName = parsed.path.split('/').pop() || parsed.repo;
    const targetDir = path.join(workspacePath, '.coworkany', 'skills', skillName);

    return downloadFromGitHub(source, targetDir, options);
}

/**
 * Download MCP server from GitHub
 */
export async function downloadMcpFromGitHub(
    source: string,
    workspacePath: string,
    options: GitHubDownloadOptions = {}
): Promise<GitHubDownloadResult> {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return {
            success: false,
            path: '',
            filesDownloaded: 0,
            error: `Invalid GitHub source: ${source}`,
        };
    }

    // Extract MCP name from path
    const mcpName = parsed.path.split('/').pop() || parsed.repo;
    const targetDir = path.join(workspacePath, '.coworkany', 'mcp', mcpName);

    return downloadFromGitHub(source, targetDir, options);
}
