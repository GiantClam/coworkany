import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type OpenClawStore = 'clawhub' | 'tencent_skillhub';

export interface OpenClawStoreSkill {
    name: string;
    slug?: string;
    displayName?: string;
    description: string;
    author?: string;
    version?: string;
    downloads?: number;
    stars?: number;
    tags?: string[];
    homepage?: string;
    repoUrl?: string;
    downloadUrl?: string;
}

export interface InstalledSkillPrompt {
    id: string;
    name: string;
    description?: string;
    requiredEnv: string[];
    source?: string;
}

interface GenericIpcResult {
    success: boolean;
    payload?: Record<string, unknown>;
}

function unwrapPayload(result: GenericIpcResult): Record<string, unknown> {
    const payload = result.payload ?? {};
    const nested = payload.payload;
    if (nested && typeof nested === 'object') {
        return nested as Record<string, unknown>;
    }
    return payload;
}

function toStoreSkills(raw: unknown): OpenClawStoreSkill[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
            name: String(item.name ?? ''),
            slug: item.slug ? String(item.slug) : undefined,
            displayName: item.displayName ? String(item.displayName) : undefined,
            description: String(item.description ?? ''),
            author: item.author ? String(item.author) : undefined,
            version: item.version ? String(item.version) : undefined,
            downloads: typeof item.downloads === 'number' ? item.downloads : undefined,
            stars: typeof item.stars === 'number' ? item.stars : undefined,
            tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)) : undefined,
            homepage: item.homepage ? String(item.homepage) : undefined,
            repoUrl: item.repoUrl ? String(item.repoUrl) : undefined,
            downloadUrl: item.downloadUrl ? String(item.downloadUrl) : undefined,
        } satisfies OpenClawStoreSkill;
    }).filter((skill) => skill.name.length > 0);
}

export function useOpenClawSkillStore() {
    const [skills, setSkills] = useState<OpenClawStoreSkill[]>([]);
    const [loading, setLoading] = useState(false);
    const [installingSkill, setInstallingSkill] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const search = useCallback(async (store: OpenClawStore, query: string, limit: number = 20) => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<GenericIpcResult>('search_openclaw_skill_store', {
                input: {
                    store,
                    query,
                    limit,
                },
            });
            const payload = unwrapPayload(result);
            setSkills(toStoreSkills(payload.skills));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setSkills([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const install = useCallback(async (store: OpenClawStore, skillName: string): Promise<{ success: boolean; error?: string; skill?: InstalledSkillPrompt }> => {
        setInstallingSkill(skillName);
        setError(null);
        try {
            const result = await invoke<GenericIpcResult>('install_openclaw_skill', {
                input: {
                    store,
                    skillName,
                },
            });
            const payload = unwrapPayload(result);
            const success = Boolean(payload.success);
            if (!success) {
                return { success: false, error: payload.error ? String(payload.error) : 'Install failed' };
            }
            const rawSkill = payload.skill;
            const skill = rawSkill && typeof rawSkill === 'object'
                ? {
                    id: String((rawSkill as Record<string, unknown>).id ?? skillName),
                    name: String((rawSkill as Record<string, unknown>).name ?? skillName),
                    description: (rawSkill as Record<string, unknown>).description
                        ? String((rawSkill as Record<string, unknown>).description)
                        : undefined,
                    requiredEnv: Array.isArray((rawSkill as Record<string, unknown>).requiredEnv)
                        ? ((rawSkill as Record<string, unknown>).requiredEnv as unknown[])
                            .map((envVar) => String(envVar).trim())
                            .filter((envVar, index, list) => envVar.length > 0 && list.indexOf(envVar) === index)
                        : [],
                    source: (rawSkill as Record<string, unknown>).source
                        ? String((rawSkill as Record<string, unknown>).source)
                        : store,
                } satisfies InstalledSkillPrompt
                : undefined;
            return { success: true, skill };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            return { success: false, error: message };
        } finally {
            setInstallingSkill(null);
        }
    }, []);

    return {
        skills,
        loading,
        installingSkill,
        error,
        search,
        install,
    };
}
