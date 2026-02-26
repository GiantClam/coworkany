/**
 * useToolpacks Hook
 *
 * Manages MCP Toolpack state and operations via Tauri IPC.
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// Types
// ============================================================================

export interface ToolpackManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    runtime?: string;
    command?: string;
    args?: string[];
    riskLevel?: number;
}

export interface ToolpackRecord {
    manifest: ToolpackManifest;
    enabled: boolean;
    workingDir: string;
    installedAt: string;
    lastUsedAt?: string;
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

interface UseToolpacksOptions {
    autoRefresh?: boolean;
}

export function useToolpacks(options: UseToolpacksOptions = {}) {
    const { autoRefresh = true } = options;
    const [toolpacks, setToolpacks] = useState<ToolpackRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('list_toolpacks', {
                input: { includeDisabled: true },
            });
            const payload = extractPayload(result);
            if (Array.isArray(payload.toolpacks)) {
                setToolpacks(payload.toolpacks as ToolpackRecord[]);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    const install = useCallback(async (path: string, allowUnsigned = true) => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('install_toolpack', {
                input: {
                    source: 'local_folder',
                    path,
                    allowUnsigned,
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

    const toggle = useCallback(async (toolpackId: string, enabled: boolean) => {
        setLoading(true);
        setError(null);
        try {
            await invoke<IpcResult>('set_toolpack_enabled', {
                input: { toolpackId, enabled },
            });
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [refresh]);

    const remove = useCallback(async (toolpackId: string) => {
        setLoading(true);
        setError(null);
        try {
            await invoke<IpcResult>('remove_toolpack', {
                input: { toolpackId },
            });
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [refresh]);

    // Load on mount
    useEffect(() => {
        if (!autoRefresh) return;
        refresh();
    }, [refresh, autoRefresh]);

    return {
        toolpacks,
        loading,
        error,
        refresh,
        install,
        toggle,
        remove,
    };
}
