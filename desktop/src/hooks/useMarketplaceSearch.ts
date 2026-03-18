import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type MarketplaceItemType = 'skill' | 'mcp';

export interface MarketplaceItem {
    id: string;
    name: string;
    description: string;
    source: string;
    path: string;
    runtime?: string;
    tools?: string[];
    hasScripts?: boolean;
    type: MarketplaceItemType;
}

interface GenericIpcResult {
    success: boolean;
    payload?: Record<string, unknown> | string;
}

function unwrapPayload(result: GenericIpcResult): Record<string, unknown> {
    const payload = typeof result.payload === 'string'
        ? JSON.parse(result.payload)
        : (result.payload ?? {});
    const nested = (payload as Record<string, unknown>).payload;
    if (nested && typeof nested === 'object') {
        return nested as Record<string, unknown>;
    }
    return payload as Record<string, unknown>;
}

function toMarketplaceItems(
    type: MarketplaceItemType,
    raw: unknown[] | undefined
): MarketplaceItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((entry) => entry as Record<string, unknown>)
        .map((entry) => {
            const source = String(entry.source ?? '');
            const path = String(entry.path ?? '');
            const id = `${type}:${source}:${path}`;
            return {
                id,
                name: String(entry.name ?? 'Unnamed'),
                description: String(entry.description ?? ''),
                source,
                path,
                runtime: entry.runtime ? String(entry.runtime) : undefined,
                tools: Array.isArray(entry.tools) ? entry.tools.map(String) : undefined,
                hasScripts: Boolean(entry.hasScripts),
                type,
            } satisfies MarketplaceItem;
        })
        .filter((item) => item.source.length > 0);
}

function normalizeSource(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('github:')) return trimmed;

    const match = trimmed.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+)?(?:\/(.*))?/);
    if (match) {
        const [, owner, repo, path] = match;
        return path ? `github:${owner}/${repo}/${path}` : `github:${owner}/${repo}`;
    }

    return trimmed;
}

function isGitHubSource(input: string): boolean {
    return input.startsWith('github:') || /github\.com\//i.test(input);
}

export function useMarketplaceSearch() {
    const [items, setItems] = useState<MarketplaceItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const scanDefault = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<GenericIpcResult>('scan_default_repos');
            const payload = unwrapPayload(result);
            const skills = toMarketplaceItems('skill', payload.skills as unknown[] | undefined);
            const mcps = toMarketplaceItems('mcp', payload.mcpServers as unknown[] | undefined);
            setItems([...skills, ...mcps]);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const scanSource = useCallback(async (sourceInput: string) => {
        const source = normalizeSource(sourceInput);
        if (!source) {
            setError('请输入 Skillhub 关键词或 GitHub 源');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            if (isGitHubSource(source)) {
                const [skillsResult, mcpResult] = await Promise.all([
                    invoke<GenericIpcResult>('scan_skills', { input: { source } }),
                    invoke<GenericIpcResult>('scan_mcp_servers', { input: { source } }),
                ]);

                const skillsPayload = unwrapPayload(skillsResult);
                const mcpPayload = unwrapPayload(mcpResult);
                const skills = toMarketplaceItems('skill', skillsPayload.skills as unknown[] | undefined);
                const mcps = toMarketplaceItems('mcp', mcpPayload.servers as unknown[] | undefined);
                setItems([...skills, ...mcps]);
                return;
            }

            const result = await invoke<GenericIpcResult>('search_skillhub_skills', {
                input: { query: source },
            });
            const payload = unwrapPayload(result);
            const skills = toMarketplaceItems('skill', payload.skills as unknown[] | undefined);
            setItems(skills);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const installItem = useCallback(async (item: MarketplaceItem) => {
        const workspacePath = await invoke<string>('get_workspace_root');
        const isSkillhub = item.source.startsWith('skillhub:');
        const result = isSkillhub
            ? await invoke<GenericIpcResult>('install_from_skillhub', {
                input: {
                    workspacePath,
                    slug: item.path || item.source.replace(/^skillhub:/, ''),
                },
            })
            : await invoke<GenericIpcResult>('install_from_github', {
                input: {
                    workspacePath,
                    source: item.source,
                    targetType: item.type,
                },
            });
        const payload = unwrapPayload(result);
        if (payload.success === false || payload.error) {
            throw new Error(String(payload.error ?? 'Install failed'));
        }
        return payload;
    }, []);

    const stats = useMemo(() => ({
        skillCount: items.filter((item) => item.type === 'skill').length,
        mcpCount: items.filter((item) => item.type === 'mcp').length,
    }), [items]);

    return {
        items,
        loading,
        error,
        stats,
        scanDefault,
        scanSource,
        installItem,
        normalizeSource,
    };
}
