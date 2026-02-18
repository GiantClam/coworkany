/**
 * Effect Confirmation Hook
 *
 * Listens for effect confirmation requests from Tauri
 * and manages the confirmation dialog state.
 */

import { useEffect, useState, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { EffectRequest } from '../components/EffectConfirmationDialog';
import { isTauri } from '../lib/tauri';

// ============================================================================
// Types
// ============================================================================

interface UseEffectConfirmationReturn {
    pendingRequest: EffectRequest | null;
    isDialogOpen: boolean;
    approve: (requestId: string, remember: boolean) => Promise<void>;
    deny: (requestId: string) => Promise<void>;
    closeDialog: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useEffectConfirmation(): UseEffectConfirmationReturn {
    const [pendingRequest, setPendingRequest] = useState<EffectRequest | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Listen for effect confirmation requests
    useEffect(() => {
        let unlistenConfirmation: UnlistenFn | undefined;

        async function setup() {
            if (!isTauri()) return;
            unlistenConfirmation = await listen<EffectRequest>(
                'effect-confirmation-required',
                (event) => {
                    console.log('[useEffectConfirmation] Received request:', event.payload);
                    setPendingRequest(event.payload);
                    setIsDialogOpen(true);
                }
            );
        }

        setup();

        return () => {
            unlistenConfirmation?.();
        };
    }, []);

    // Approve handler
    const approve = useCallback(async (requestId: string, remember: boolean) => {
        if (!isTauri()) return;
        try {
            await invoke('confirm_effect', {
                requestId,
                sessionId: pendingRequest?.sessionId || '',
                remember,
            });
            console.log('[useEffectConfirmation] Approved:', requestId);
        } catch (e) {
            console.error('[useEffectConfirmation] Approve error:', e);
        } finally {
            setPendingRequest(null);
            setIsDialogOpen(false);
        }
    }, [pendingRequest]);

    // Deny handler
    const deny = useCallback(async (requestId: string) => {
        if (!isTauri()) return;
        try {
            await invoke('deny_effect', { requestId });
            console.log('[useEffectConfirmation] Denied:', requestId);
        } catch (e) {
            console.error('[useEffectConfirmation] Deny error:', e);
        } finally {
            setPendingRequest(null);
            setIsDialogOpen(false);
        }
    }, []);

    // Close dialog
    const closeDialog = useCallback(() => {
        setIsDialogOpen(false);
    }, []);

    return {
        pendingRequest,
        isDialogOpen,
        approve,
        deny,
        closeDialog,
    };
}

export default useEffectConfirmation;
