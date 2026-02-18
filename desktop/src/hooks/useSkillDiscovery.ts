/**
 * Skill Discovery Hook
 *
 * Provides functionality to scan GitHub repositories for available skills and MCP servers,
 * validate URLs, and install from GitHub.
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

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

interface ScanResult {
    skills: DiscoveredSkill[];
    mcpServers: DiscoveredMcp[];
    errors: string[];
}

interface IpcResult {
    success: boolean;
    payload: string;
}

interface ValidationResult {
    valid: boolean;
    reason?: string;
    skill?: DiscoveredSkill;
    server?: DiscoveredMcp;
}

interface InstallResult {
    success: boolean;
    path: string;
    filesDownloaded: number;
    error?: string;
}

// ============================================================================
// Hook
// ============================================================================

export function useSkillDiscovery() {
    const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
    const [mcpServers, setMcpServers] = useState<DiscoveredMcp[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Scan all default repositories for skills and MCP servers
     */
    const scanDefaultRepos = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('scan_default_repos');
            if (result.success && result.payload) {
                const data = JSON.parse(result.payload) as ScanResult;
                setSkills(data.skills || []);
                setMcpServers(data.mcpServers || []);
                if (data.errors?.length) {
                    console.warn('[scanDefaultRepos] Partial errors:', data.errors);
                }
                return data;
            }
            throw new Error('Scan failed');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            console.error('[scanDefaultRepos] Error:', err);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Scan a specific GitHub source for skills
     */
    const scanSkills = useCallback(async (source: string): Promise<DiscoveredSkill[]> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('scan_skills', { input: { source } });
            if (result.success && result.payload) {
                const data = JSON.parse(result.payload);
                return data.skills || [];
            }
            return [];
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Scan a specific GitHub source for MCP servers
     */
    const scanMcpServers = useCallback(async (source: string): Promise<DiscoveredMcp[]> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('scan_mcp_servers', { input: { source } });
            if (result.success && result.payload) {
                const data = JSON.parse(result.payload);
                return data.servers || [];
            }
            return [];
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Validate if a URL is a valid skill
     */
    const validateSkill = useCallback(async (source: string): Promise<ValidationResult> => {
        try {
            const result = await invoke<IpcResult>('validate_skill', { input: { source } });
            if (result.success && result.payload) {
                return JSON.parse(result.payload);
            }
            return { valid: false, reason: 'Validation failed' };
        } catch (err) {
            return { valid: false, reason: String(err) };
        }
    }, []);

    /**
     * Validate if a URL is a valid MCP server
     */
    const validateMcp = useCallback(async (source: string): Promise<ValidationResult> => {
        try {
            const result = await invoke<IpcResult>('validate_mcp', { input: { source } });
            if (result.success && result.payload) {
                return JSON.parse(result.payload);
            }
            return { valid: false, reason: 'Validation failed' };
        } catch (err) {
            return { valid: false, reason: String(err) };
        }
    }, []);

    /**
     * Install a skill from GitHub to the workspace
     */
    const installSkill = useCallback(async (
        source: string,
        workspacePath: string
    ): Promise<InstallResult> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('install_from_github', {
                input: {
                    workspacePath,
                    source,
                    targetType: 'skill',
                },
            });
            if (result.success && result.payload) {
                return JSON.parse(result.payload);
            }
            return { success: false, path: '', filesDownloaded: 0, error: 'Install failed' };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            return { success: false, path: '', filesDownloaded: 0, error: message };
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Install an MCP server from GitHub to the workspace
     */
    const installMcp = useCallback(async (
        source: string,
        workspacePath: string
    ): Promise<InstallResult> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('install_from_github', {
                input: {
                    workspacePath,
                    source,
                    targetType: 'mcp',
                },
            });
            if (result.success && result.payload) {
                return JSON.parse(result.payload);
            }
            return { success: false, path: '', filesDownloaded: 0, error: 'Install failed' };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            return { success: false, path: '', filesDownloaded: 0, error: message };
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Check if a URL is a GitHub URL
     */
    const isGitHubUrl = useCallback((url: string): boolean => {
        return (
            url.startsWith('github:') ||
            url.startsWith('https://github.com/') ||
            url.startsWith('http://github.com/')
        );
    }, []);

    /**
     * Convert GitHub URL to github: format
     */
    const normalizeGitHubSource = useCallback((url: string): string => {
        if (url.startsWith('github:')) return url;

        // Handle https://github.com/owner/repo/tree/branch/path
        const match = url.match(
            /github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+)?(?:\/(.*))?/
        );
        if (match) {
            const [, owner, repo, path] = match;
            return path ? `github:${owner}/${repo}/${path}` : `github:${owner}/${repo}`;
        }

        return url;
    }, []);

    return {
        // State
        skills,
        mcpServers,
        isLoading,
        error,

        // Actions
        scanDefaultRepos,
        scanSkills,
        scanMcpServers,
        validateSkill,
        validateMcp,
        installSkill,
        installMcp,

        // Utilities
        isGitHubUrl,
        normalizeGitHubSource,
    };
}
