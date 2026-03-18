import { create } from 'zustand';

export interface VoicePlaybackState {
    isSpeaking: boolean;
    canStop: boolean;
    previewText?: string;
    fullTextLength?: number;
    taskId?: string;
    source?: string;
    startedAt?: string;
    endedAt?: string;
    reason?: string;
    error?: string;
}

interface VoicePlaybackStoreState {
    state: VoicePlaybackState;
    setState: (nextState: VoicePlaybackState) => void;
}

const DEFAULT_VOICE_PLAYBACK_STATE: VoicePlaybackState = {
    isSpeaking: false,
    canStop: false,
};

export const useVoicePlaybackStore = create<VoicePlaybackStoreState>((set) => ({
    state: DEFAULT_VOICE_PLAYBACK_STATE,
    setState: (nextState) => set({ state: nextState }),
}));

export function getDefaultVoicePlaybackState(): VoicePlaybackState {
    return { ...DEFAULT_VOICE_PLAYBACK_STATE };
}
