/**
 * Service Manager Hook
 *
 * Provides frontend access to backend service management (RAG service, etc.)
 */

import { invoke } from '@tauri-apps/api/core';
import { useState, useCallback, useEffect } from 'react';

// ============================================================================
// Types
// ============================================================================

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'unhealthy' | 'restarting' | 'failed';

export interface ServiceInfo {
    name: string;
    status: ServiceStatus;
    pid: number | null;
    uptime_secs: number | null;
    restart_count: number;
    last_error: string | null;
    health_check_url: string | null;
}

interface ServiceStatusResult {
    success: boolean;
    services: ServiceInfo[];
}

interface SingleServiceStatusResult {
    success: boolean;
    service: ServiceInfo | null;
}

interface ServiceOperationResult {
    success: boolean;
    message: string;
    errors: string[] | null;
}

interface HealthCheckResult {
    success: boolean;
    service: string;
    healthy: boolean;
    error: string | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useServiceManager() {
    const [services, setServices] = useState<ServiceInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Refresh the status of all services
     */
    const refreshStatus = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const result = await invoke<ServiceStatusResult>('get_all_services_status');
            if (result.success) {
                setServices(result.services);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Start all services
     */
    const startAll = useCallback(async (): Promise<ServiceOperationResult> => {
        try {
            setLoading(true);
            setError(null);
            const result = await invoke<ServiceOperationResult>('start_all_services');
            await refreshStatus();
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(errorMsg);
            return { success: false, message: errorMsg, errors: [errorMsg] };
        } finally {
            setLoading(false);
        }
    }, [refreshStatus]);

    /**
     * Stop all services
     */
    const stopAll = useCallback(async (): Promise<ServiceOperationResult> => {
        try {
            setLoading(true);
            setError(null);
            const result = await invoke<ServiceOperationResult>('stop_all_services');
            await refreshStatus();
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(errorMsg);
            return { success: false, message: errorMsg, errors: [errorMsg] };
        } finally {
            setLoading(false);
        }
    }, [refreshStatus]);

    /**
     * Start a specific service
     */
    const startService = useCallback(async (name: string): Promise<ServiceOperationResult> => {
        try {
            setLoading(true);
            setError(null);
            const result = await invoke<ServiceOperationResult>('start_service', { name });
            await refreshStatus();
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(errorMsg);
            return { success: false, message: errorMsg, errors: [errorMsg] };
        } finally {
            setLoading(false);
        }
    }, [refreshStatus]);

    /**
     * Stop a specific service
     */
    const stopService = useCallback(async (name: string): Promise<ServiceOperationResult> => {
        try {
            setLoading(true);
            setError(null);
            const result = await invoke<ServiceOperationResult>('stop_service', { name });
            await refreshStatus();
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(errorMsg);
            return { success: false, message: errorMsg, errors: [errorMsg] };
        } finally {
            setLoading(false);
        }
    }, [refreshStatus]);

    /**
     * Health check a specific service
     */
    const healthCheck = useCallback(async (name: string): Promise<HealthCheckResult> => {
        try {
            const result = await invoke<HealthCheckResult>('health_check_service', { name });
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return { success: false, service: name, healthy: false, error: errorMsg };
        }
    }, []);

    /**
     * Get status of a specific service
     */
    const getServiceStatus = useCallback(async (name: string): Promise<ServiceInfo | null> => {
        try {
            const result = await invoke<SingleServiceStatusResult>('get_service_status', { name });
            return result.service;
        } catch (err) {
            return null;
        }
    }, []);

    // Auto-refresh on mount
    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    // Helper to check if RAG service is running
    const isRagServiceRunning = services.some(
        (s) => s.name === 'rag-service' && s.status === 'running'
    );

    return {
        services,
        loading,
        error,
        refreshStatus,
        startAll,
        stopAll,
        startService,
        stopService,
        healthCheck,
        getServiceStatus,
        isRagServiceRunning,
    };
}

// ============================================================================
// Standalone Functions (for use outside React components)
// ============================================================================

/**
 * Start all backend services
 */
export async function startAllServices(): Promise<ServiceOperationResult> {
    return invoke<ServiceOperationResult>('start_all_services');
}

/**
 * Stop all backend services
 */
export async function stopAllServices(): Promise<ServiceOperationResult> {
    return invoke<ServiceOperationResult>('stop_all_services');
}

/**
 * Get status of all services
 */
export async function getAllServicesStatus(): Promise<ServiceInfo[]> {
    const result = await invoke<ServiceStatusResult>('get_all_services_status');
    return result.services;
}

/**
 * Check if RAG service is healthy
 */
export async function isRagServiceHealthy(): Promise<boolean> {
    try {
        const result = await invoke<HealthCheckResult>('health_check_service', { name: 'rag-service' });
        return result.healthy;
    } catch {
        return false;
    }
}
