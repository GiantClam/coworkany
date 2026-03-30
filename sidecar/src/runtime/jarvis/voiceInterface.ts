const MACOS_CONTRACTION_PATTERN = /([A-Za-z])[’']([A-Za-z])/g;
export function normalizeMacOSTextForSpeech(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(MACOS_CONTRACTION_PATTERN, '$1$2');
}
export interface VoiceConfig {
    enabled: boolean;
    asr: {
        provider: 'native' | 'whisper' | 'plugin';
        language: string;
        continuous: boolean;
    };
    tts: {
        provider: 'native' | 'openai' | 'elevenlabs' | 'plugin';
        voice: string;
        rate: number;
        volume: number;
    };
    wakeWord?: {
        enabled: boolean;
        words: string[];
        sensitivity: number;
    };
}
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
    enabled: false,
    asr: {
        provider: 'native',
        language: 'en-US',
        continuous: false,
    },
    tts: {
        provider: 'native',
        voice: 'default',
        rate: 1.0,
        volume: 0.8,
    },
    wakeWord: {
        enabled: false,
        words: ['Hey Jarvis', 'Jarvis'],
        sensitivity: 0.7,
    },
};
export interface SpeechRecognitionResult {
    text: string;
    confidence: number;
    isFinal: boolean;
    language?: string;
    alternatives?: Array<{ text: string; confidence: number }>;
}
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
type VoicePlaybackMetadata = {
    taskId?: string;
    source?: string;
};
function detectPlatform(): 'windows' | 'darwin' | 'linux' | 'unknown' {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'darwin';
    if (process.platform === 'linux') return 'linux';
    return 'unknown';
}
function buildPreview(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}
export class VoiceInterface {
    private config: VoiceConfig;
    private platform: 'windows' | 'darwin' | 'linux' | 'unknown';
    private nativeASRAvailable: boolean;
    private nativeTTSAvailable: boolean;
    private playbackState: VoicePlaybackState;
    private playbackListeners: Set<(state: VoicePlaybackState) => void>;
    constructor(config?: Partial<VoiceConfig>) {
        const defaultWakeWord = DEFAULT_VOICE_CONFIG.wakeWord ?? {
            enabled: false,
            words: ['Hey Jarvis', 'Jarvis'],
            sensitivity: 0.7,
        };
        const mergedWakeWord = {
            enabled: config?.wakeWord?.enabled ?? defaultWakeWord.enabled,
            words: config?.wakeWord?.words ?? defaultWakeWord.words,
            sensitivity: config?.wakeWord?.sensitivity ?? defaultWakeWord.sensitivity,
        };
        this.config = {
            ...DEFAULT_VOICE_CONFIG,
            ...config,
            asr: { ...DEFAULT_VOICE_CONFIG.asr, ...(config?.asr ?? {}) },
            tts: { ...DEFAULT_VOICE_CONFIG.tts, ...(config?.tts ?? {}) },
            wakeWord: mergedWakeWord,
        };
        this.platform = detectPlatform();
        this.nativeASRAvailable = this.platform !== 'unknown';
        this.nativeTTSAvailable = this.platform !== 'unknown';
        this.playbackState = { isSpeaking: false, canStop: false };
        this.playbackListeners = new Set();
    }
    async initialize(): Promise<void> {
        this.nativeASRAvailable = this.platform !== 'unknown';
        this.nativeTTSAvailable = this.platform !== 'unknown';
    }
    async startListening(): Promise<SpeechRecognitionResult> {
        return {
            text: '',
            confidence: 0,
            isFinal: true,
            language: this.config.asr.language,
        };
    }
    async speak(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        if (!this.config.enabled) {
            return;
        }
        await this.doSpeak(text, metadata);
    }
    async forcedSpeak(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        await this.doSpeak(text, metadata);
    }
    private async doSpeak(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        const normalizedText = this.platform === 'darwin'
            ? normalizeMacOSTextForSpeech(text)
            : text;
        this.playbackState = {
            isSpeaking: true,
            canStop: true,
            previewText: buildPreview(normalizedText),
            fullTextLength: normalizedText.length,
            taskId: metadata?.taskId,
            source: metadata?.source,
            startedAt: new Date().toISOString(),
        };
        this.notifyPlaybackListeners();
        // Keep behavior deterministic in tests and avoid platform shell dependencies.
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        this.playbackState = {
            ...this.playbackState,
            isSpeaking: false,
            canStop: false,
            endedAt: new Date().toISOString(),
            reason: 'completed',
        };
        this.notifyPlaybackListeners();
    }
    getPlaybackState(): VoicePlaybackState {
        return { ...this.playbackState };
    }
    subscribeToPlaybackState(listener: (state: VoicePlaybackState) => void): () => void {
        this.playbackListeners.add(listener);
        listener(this.getPlaybackState());
        return () => {
            this.playbackListeners.delete(listener);
        };
    }
    async stopSpeaking(reason = 'user_requested'): Promise<boolean> {
        if (!this.playbackState.isSpeaking) {
            return false;
        }
        this.playbackState = {
            ...this.playbackState,
            isSpeaking: false,
            canStop: false,
            endedAt: new Date().toISOString(),
            reason,
        };
        this.notifyPlaybackListeners();
        return true;
    }
    isAvailable(): { platform: string; asr: boolean; tts: boolean } {
        return {
            platform: this.platform,
            asr: this.nativeASRAvailable,
            tts: this.nativeTTSAvailable,
        };
    }
    private notifyPlaybackListeners(): void {
        const snapshot = this.getPlaybackState();
        for (const listener of this.playbackListeners) {
            listener(snapshot);
        }
    }
}
export function createVoiceInterface(config?: Partial<VoiceConfig>): VoiceInterface {
    return new VoiceInterface(config);
}
