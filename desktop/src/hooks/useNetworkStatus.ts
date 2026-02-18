/**
 * useNetworkStatus Hook
 *
 * Monitors browser online/offline state and provides:
 * - Current online status
 * - Connection quality hint (if available)
 * - Automatic Ollama fallback suggestion when offline
 */

import { useState, useEffect, useCallback } from 'react';

export interface NetworkStatus {
    /** true when browser reports navigator.onLine */
    isOnline: boolean;
    /** Timestamp of last status change */
    lastChanged: number;
    /** Approximate round-trip time in ms (if Network Information API available) */
    rtt?: number;
    /** Connection type from Network Information API */
    effectiveType?: string;
}

export function useNetworkStatus(): NetworkStatus {
    const [status, setStatus] = useState<NetworkStatus>(() => ({
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        lastChanged: Date.now(),
        ...getConnectionInfo(),
    }));

    const handleOnline = useCallback(() => {
        setStatus({
            isOnline: true,
            lastChanged: Date.now(),
            ...getConnectionInfo(),
        });
    }, []);

    const handleOffline = useCallback(() => {
        setStatus({
            isOnline: false,
            lastChanged: Date.now(),
        });
    }, []);

    useEffect(() => {
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Also poll connection info periodically (every 30s)
        const interval = setInterval(() => {
            const info = getConnectionInfo();
            setStatus((prev) => ({
                ...prev,
                isOnline: navigator.onLine,
                ...info,
            }));
        }, 30_000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(interval);
        };
    }, [handleOnline, handleOffline]);

    return status;
}

/** Extract connection info from Network Information API (if available) */
function getConnectionInfo(): { rtt?: number; effectiveType?: string } {
    const nav = navigator as Navigator & {
        connection?: { rtt?: number; effectiveType?: string };
    };
    if (nav.connection) {
        return {
            rtt: nav.connection.rtt,
            effectiveType: nav.connection.effectiveType,
        };
    }
    return {};
}
