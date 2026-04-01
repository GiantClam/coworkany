import * as fs from 'fs';
import * as path from 'path';

export interface GitHubDownloadOptions {
    branch?: string;
    token?: string;
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
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRepoSegment(value: string): string {
    return value.replace(/\.git$/i, '').trim();
}

export function parseGitHubSource(source: string): {
    owner: string;
    repo: string;
    path: string;
    branch: string;
} | null {
    if (!isNonEmptyString(source)) {
        return null;
    }
    if (source.startsWith('github:')) {
        const parts = source.slice(7).split('/').filter((part) => part.trim().length > 0);
        if (parts.length < 2) {
            return null;
        }
        return {
            owner: parts[0]!,
            repo: normalizeRepoSegment(parts[1]!),
            path: parts.slice(2).join('/'),
            branch: 'main',
        };
    }

    const treeMatch = source.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)/i);
    if (treeMatch) {
        return {
            owner: treeMatch[1]!,
            repo: normalizeRepoSegment(treeMatch[2]!),
            branch: treeMatch[3]!,
            path: treeMatch[4] || '',
        };
    }

    const rootMatch = source.match(/github\.com\/([^/]+)\/([^/]+)\/?$/i);
    if (rootMatch) {
        return {
            owner: rootMatch[1]!,
            repo: normalizeRepoSegment(rootMatch[2]!),
            path: '',
            branch: 'main',
        };
    }

    return null;
}

function parseLocalSourceDirectory(source: string): string | null {
    if (!isNonEmptyString(source)) {
        return null;
    }
    let candidate: string | null = null;
    if (source.startsWith('file://')) {
        try {
            const asUrl = new URL(source);
            candidate = decodeURIComponent(asUrl.pathname);
        } catch {
            candidate = null;
        }
    } else if (!source.startsWith('github:') && !/github\.com\//i.test(source)) {
        candidate = source;
    }
    if (!candidate) {
        return null;
    }
    const resolved = path.resolve(candidate);
    try {
        const stat = fs.statSync(resolved);
        return stat.isDirectory() ? resolved : null;
    } catch {
        return null;
    }
}

function ensureDirectory(targetDir: string): void {
    fs.mkdirSync(targetDir, { recursive: true });
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string): number {
    ensureDirectory(targetDir);
    let fileCount = 0;
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            fileCount += copyDirectoryRecursive(sourcePath, targetPath);
        } else if (entry.isFile()) {
            ensureDirectory(path.dirname(targetPath));
            fs.copyFileSync(sourcePath, targetPath);
            fileCount += 1;
        }
    }
    return fileCount;
}

async function fetchGitHubContents(
    owner: string,
    repo: string,
    repoPath: string,
    branch: string,
    token?: string,
): Promise<GitHubContent[] | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}?ref=${branch}`;
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CoworkAny-Desktop',
    };
    if (isNonEmptyString(token)) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
        return null;
    }
    const data = await response.json() as GitHubContent | GitHubContent[];
    return Array.isArray(data) ? data : [data];
}

async function downloadFile(url: string, localPath: string, token?: string): Promise<void> {
    const headers: Record<string, string> = {
        'User-Agent': 'CoworkAny-Desktop',
    };
    if (isNonEmptyString(token)) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`failed_to_download_file:${response.status}`);
    }
    const content = await response.arrayBuffer();
    ensureDirectory(path.dirname(localPath));
    fs.writeFileSync(localPath, Buffer.from(content));
}

async function downloadDirectory(
    owner: string,
    repo: string,
    repoPath: string,
    branch: string,
    localDir: string,
    token?: string,
): Promise<number> {
    const contents = await fetchGitHubContents(owner, repo, repoPath, branch, token);
    if (!contents) {
        throw new Error(`github_path_not_found:${owner}/${repo}/${repoPath}`);
    }
    let count = 0;
    for (const item of contents) {
        const localPath = path.join(localDir, item.name);
        if (item.type === 'file' && isNonEmptyString(item.download_url)) {
            await downloadFile(item.download_url, localPath, token);
            count += 1;
        } else if (item.type === 'dir') {
            ensureDirectory(localPath);
            count += await downloadDirectory(owner, repo, item.path, branch, localPath, token);
        }
    }
    return count;
}

export async function downloadFromGitHub(
    source: string,
    targetDir: string,
    options: GitHubDownloadOptions = {},
): Promise<GitHubDownloadResult> {
    const localSourceDir = parseLocalSourceDirectory(source);
    if (localSourceDir) {
        try {
            fs.rmSync(targetDir, { recursive: true, force: true });
            const filesDownloaded = copyDirectoryRecursive(localSourceDir, targetDir);
            return {
                success: true,
                path: targetDir,
                filesDownloaded,
            };
        } catch (error) {
            return {
                success: false,
                path: targetDir,
                filesDownloaded: 0,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return {
            success: false,
            path: targetDir,
            filesDownloaded: 0,
            error: `invalid_github_source:${source}`,
        };
    }
    const branch = options.branch || parsed.branch;
    try {
        fs.rmSync(targetDir, { recursive: true, force: true });
        ensureDirectory(targetDir);
        const filesDownloaded = await downloadDirectory(
            parsed.owner,
            parsed.repo,
            parsed.path,
            branch,
            targetDir,
            options.token,
        );
        return {
            success: true,
            path: targetDir,
            filesDownloaded,
        };
    } catch (error) {
        return {
            success: false,
            path: targetDir,
            filesDownloaded: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function deriveInstallFolderName(source: string, fallback: string): string {
    const localSourceDir = parseLocalSourceDirectory(source);
    if (localSourceDir) {
        return path.basename(localSourceDir) || fallback;
    }
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return fallback;
    }
    const pathLeaf = parsed.path.split('/').filter((part) => part.trim().length > 0).pop();
    return pathLeaf || parsed.repo || fallback;
}

export async function downloadSkillFromGitHub(
    source: string,
    workspacePath: string,
    options: GitHubDownloadOptions = {},
): Promise<GitHubDownloadResult> {
    const skillName = deriveInstallFolderName(source, 'skill');
    const targetDir = path.join(workspacePath, '.coworkany', 'skills', skillName);
    return await downloadFromGitHub(source, targetDir, options);
}

export async function downloadMcpFromGitHub(
    source: string,
    workspacePath: string,
    options: GitHubDownloadOptions = {},
): Promise<GitHubDownloadResult> {
    const mcpName = deriveInstallFolderName(source, 'mcp-server');
    const targetDir = path.join(workspacePath, '.coworkany', 'mcp', mcpName);
    return await downloadFromGitHub(source, targetDir, options);
}

