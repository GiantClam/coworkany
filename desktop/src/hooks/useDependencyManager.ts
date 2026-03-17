import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface DependencyStatus {
    id: string;
    name: string;
    description?: string;
    installed: boolean;
    ready: boolean;
    running?: boolean;
    bundled?: boolean;
    optional?: boolean;
    path?: string;
    version?: string;
    error?: string;
}

export interface RuntimeContextStatus {
    platform: string;
    arch: string;
    appDataDir: string;
    appDir: string;
    shell: string;
    sidecarLaunchMode?: string;
}

interface DependencyStatusResponse {
    success: boolean;
    payload: {
        dependencies?: DependencyStatus[];
        runtimeContext?: RuntimeContextStatus;
        message?: string;
        errors?: string[] | null;
    };
}

function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

function resolveActionError(result: DependencyStatusResponse): string | null {
    const errors = result.payload.errors ?? [];
    if (errors.length > 0) return errors[0];
    if (result.success) return null;
    return result.payload.message ?? 'Dependency action failed';
}

export function useDependencyManager() {
    const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
    const [runtimeContext, setRuntimeContext] = useState<RuntimeContextStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeAction, setActiveAction] = useState<string | null>(null);

    const applySnapshot = useCallback((payload?: DependencyStatusResponse['payload']) => {
        if (!payload) return;
        if (payload.dependencies) setDependencies(payload.dependencies);
        if (payload.runtimeContext) setRuntimeContext(payload.runtimeContext);
    }, []);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<DependencyStatusResponse>('get_dependency_statuses');
            applySnapshot(result.payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [applySnapshot]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const installSkillhub = useCallback(async () => {
        setActiveAction('skillhub-cli');
        setError(null);
        try {
            await nextPaint();
            const result = await invoke<DependencyStatusResponse>('install_skillhub_cli');
            applySnapshot(result.payload);
            const actionError = resolveActionError(result);
            if (actionError) {
                setError(actionError);
                throw new Error(actionError);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            throw err;
        } finally {
            setActiveAction(null);
        }
    }, [applySnapshot]);

    const prepareServiceRuntime = useCallback(async (name: string) => {
        setActiveAction(name);
        setError(null);
        try {
            await nextPaint();
            const result = await invoke<DependencyStatusResponse>('prepare_service_runtime', { input: { name } });
            applySnapshot(result.payload);
            const actionError = resolveActionError(result);
            if (actionError) {
                setError(actionError);
                throw new Error(actionError);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            throw err;
        } finally {
            setActiveAction(null);
        }
    }, [applySnapshot]);

    const startDependencyService = useCallback(async (name: string) => {
        setActiveAction(name);
        setError(null);
        try {
            await nextPaint();
            const result = await invoke<DependencyStatusResponse>('start_service', { name });
            applySnapshot(result.payload);
            const actionError = resolveActionError(result);
            if (actionError) {
                setError(actionError);
                throw new Error(actionError);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            throw err;
        } finally {
            setActiveAction(null);
        }
    }, [applySnapshot]);

    const stopDependencyService = useCallback(async (name: string) => {
        setActiveAction(name);
        setError(null);
        try {
            await nextPaint();
            const result = await invoke<DependencyStatusResponse>('stop_service', { name });
            applySnapshot(result.payload);
            const actionError = resolveActionError(result);
            if (actionError) {
                setError(actionError);
                throw new Error(actionError);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            throw err;
        } finally {
            setActiveAction(null);
        }
    }, [applySnapshot]);

    return {
        dependencies,
        runtimeContext,
        loading,
        error,
        activeAction,
        refresh,
        installSkillhub,
        prepareServiceRuntime,
        startDependencyService,
        stopDependencyService,
    };
}
