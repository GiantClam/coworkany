import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVoicePlaybackStore, type VoicePlaybackState } from '../stores/useVoicePlaybackStore';

type VoiceStateResponse = {
    success?: boolean;
    state?: VoicePlaybackState;
    stopped?: boolean;
    error?: string;
};

export function useVoicePlayback() {
    const state = useVoicePlaybackStore((store) => store.state);
    const [isStopping, setIsStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const stopPlayback = useCallback(async (): Promise<boolean> => {
        setIsStopping(true);
        setError(null);
        try {
            const result = await invoke<{ success?: boolean; payload?: VoiceStateResponse; error?: string }>('stop_voice');
            const payload = result?.payload;
            if (!result?.success || !payload?.success) {
                throw new Error(payload?.error || result?.error || 'Failed to stop voice playback');
            }
            return payload.stopped ?? false;
        } catch (stopError) {
            const message = stopError instanceof Error ? stopError.message : String(stopError);
            console.error('[useVoicePlayback] Failed to stop playback:', stopError);
            setError(message);
            return false;
        } finally {
            setIsStopping(false);
        }
    }, []);

    return {
        voiceState: state,
        stopPlayback,
        isStopping,
        error,
    };
}
