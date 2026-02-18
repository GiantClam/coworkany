/**
 * Repository Scan Hook
 *
 * Manages scanning of default skill and MCP repositories
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
    source: string;
    runtime?: string;
    hasScripts?: boolean;
}

export interface DiscoveredMcp {
    name: string;
    description: string;
    path: string;
    source: string;
    runtime?: string;
    tools?: string[];
}



interface IpcResult {
    success: boolean;
    payload: {
        payload?: {
            skills?: DiscoveredSkill[];
            mcpServers?: DiscoveredMcp[];
            errors?: string[];
        };
    };
}

// ============================================================================
// Hook
// ============================================================================

const CACHE_DURATION = 3600000; // 1 hour in milliseconds

export function useRepositoryScan() {
    const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
    const [mcpServers, setMcpServers] = useState<DiscoveredMcp[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastScanned, setLastScanned] = useState<Date | null>(null);

    const scan = useCallback(async (forceRefresh = false) => {
        // Check cache (1 hour expiry)
        if (!forceRefresh && lastScanned && Date.now() - lastScanned.getTime() < CACHE_DURATION) {
            console.log('[useRepositoryScan] Using cached results');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            console.log('[useRepositoryScan] Scanning default repositories...');
            const result = await invoke<IpcResult>('scan_default_repos');

            if (result.success && result.payload?.payload) {
                const payload = result.payload.payload;
                setSkills(payload.skills || []);
                setMcpServers(payload.mcpServers || []);
                setLastScanned(new Date());
                console.log(
                    `[useRepositoryScan] Found ${payload.skills?.length || 0} skills and ${payload.mcpServers?.length || 0
                    } MCP servers`
                );
            } else {
                throw new Error('Invalid response from scan_default_repos');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[useRepositoryScan] Error:', message);
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [lastScanned]);

    return {
        skills,
        mcpServers,
        loading,
        error,
        lastScanned,
        scan,
    };
}
