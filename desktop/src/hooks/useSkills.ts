/**
 * useSkills Hook
 *
 * Manages Claude Skills state and operations via Tauri IPC.
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { syncEnabledSkillEnvironment } from '../lib/skillCredentials';

// ============================================================================
// Types
// ============================================================================

export interface SkillManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    skillPath: string;
    requires?: {
        env?: string[];
    };
    allowedTools?: string[];
    tags?: string[];
}

export interface SkillRecord {
    manifest: SkillManifest;
    enabled: boolean;
    rootPath: string;
    source: string;
    installedAt: string;
    lastUsedAt?: string;
}

export interface SkillUpdateInfo {
    skillId: string;
    supported: boolean;
    hasUpdate: boolean;
    currentVersion?: string;
    latestVersion?: string;
    sourceRepo?: string;
    sourcePath?: string;
    sourceRef?: string;
    checkedAt: string;
    error?: string;
}

interface IpcResult {
    success: boolean;
    payload: Record<string, unknown>;
}

function extractPayload(result: IpcResult): Record<string, unknown> {
    const payload = result.payload ?? {};
    const nested = (payload as Record<string, unknown>).payload;
    if (nested && typeof nested === 'object') {
        return nested as Record<string, unknown>;
    }
    return payload;
}

// ============================================================================
// Hook
// ============================================================================

interface UseSkillsOptions {
    autoRefresh?: boolean;
}

export function useSkills(options: UseSkillsOptions = {}) {
    const { autoRefresh = true } = options;
    const [skills, setSkills] = useState<SkillRecord[]>([]);
    const [updates, setUpdates] = useState<Record<string, SkillUpdateInfo>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('list_claude_skills', {
                input: { includeDisabled: true },
            });
            const payload = extractPayload(result);
            if (Array.isArray(payload.skills)) {
                setSkills(payload.skills as SkillRecord[]);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    const importSkill = useCallback(async (path: string) => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('import_claude_skill', {
                input: {
                    source: 'local_folder',
                    path,
                },
            });
            const payload = extractPayload(result);
            if (payload.error) {
                setError(String(payload.error));
                return false;
            }
            await refresh();
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return false;
        } finally {
            setLoading(false);
        }
    }, [refresh]);

    const toggle = useCallback(async (skillId: string, enabled: boolean) => {
        setLoading(true);
        setError(null);
        try {
            await invoke<IpcResult>('set_claude_skill_enabled', {
                input: { skillId, enabled },
            });
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [refresh]);

    const remove = useCallback(async (skillId: string) => {
        setLoading(true);
        setError(null);
        try {
            await invoke<IpcResult>('remove_claude_skill', {
                input: { skillId },
            });
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [refresh]);

    const checkUpdates = useCallback(async (skillIds?: string[]) => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('check_claude_skill_updates', {
                input: skillIds?.length ? { skillIds } : {},
            });
            const payload = extractPayload(result);
            if (Array.isArray(payload.updates)) {
                const nextUpdates = Object.fromEntries(
                    (payload.updates as SkillUpdateInfo[]).map((update) => [update.skillId, update])
                );
                setUpdates((current) => ({
                    ...current,
                    ...nextUpdates,
                }));
                return payload.updates as SkillUpdateInfo[];
            }
            return [];
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return [];
        } finally {
            setLoading(false);
        }
    }, []);

    const upgrade = useCallback(async (skillId: string) => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('upgrade_claude_skill', {
                input: { skillId },
            });
            const payload = extractPayload(result);
            if (payload.error) {
                setError(String(payload.error));
                return false;
            }
            if (payload.update && typeof payload.update === 'object') {
                const update = payload.update as SkillUpdateInfo;
                setUpdates((current) => ({ ...current, [update.skillId]: update }));
            }
            await refresh();
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return false;
        } finally {
            setLoading(false);
        }
    }, [refresh]);

    // Load on mount + refresh on skills-updated
    useEffect(() => {
        if (!autoRefresh) return;

        let unlisten: UnlistenFn | undefined;
        const refreshFromWindowEvent = () => {
            void refresh();
        };
        refresh();
        listen('skills-updated', () => {
            refresh();
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch(() => {
                // ignore listener errors
            });
        window.addEventListener('coworkany:skills-updated', refreshFromWindowEvent);
        return () => {
            unlisten?.();
            window.removeEventListener('coworkany:skills-updated', refreshFromWindowEvent);
        };
    }, [refresh, autoRefresh]);

    useEffect(() => {
        void syncEnabledSkillEnvironment(skills);
    }, [skills]);

    return {
        skills,
        updates,
        loading,
        error,
        refresh,
        importSkill,
        toggle,
        remove,
        checkUpdates,
        upgrade,
    };
}
