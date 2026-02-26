/**
 * useSkills Hook
 *
 * Manages Claude Skills state and operations via Tauri IPC.
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ============================================================================
// Types
// ============================================================================

export interface SkillManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    skillPath: string;
}

export interface SkillRecord {
    manifest: SkillManifest;
    enabled: boolean;
    workingDir: string;
    installedAt: string;
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

    // Load on mount + refresh on skills-updated
    useEffect(() => {
        if (!autoRefresh) return;

        let unlisten: UnlistenFn | undefined;
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
        return () => {
            unlisten?.();
        };
    }, [refresh, autoRefresh]);

    return {
        skills,
        loading,
        error,
        refresh,
        importSkill,
        toggle,
        remove,
    };
}
