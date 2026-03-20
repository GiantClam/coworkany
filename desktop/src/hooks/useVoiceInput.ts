/**
 * useVoiceInput Hook
 *
 * Provides speech-to-text using native macOS ASR when available, otherwise
 * Web Speech in browsers and recorder-based custom transcription in Tauri.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../lib/tauri';
import { getVoiceSettings } from '../lib/configStore';
import type { VoiceProviderMode } from '../types';

export interface VoiceInputState {
    /** Whether speech recognition is currently active */
    isListening: boolean;
    /** Whether recorded audio is currently being transcribed */
    isProcessing: boolean;
    /** Interim (not finalized) transcript */
    interimTranscript: string;
    /** Final accumulated transcript */
    transcript: string;
    /** Most recent finalized segment emitted by continuous ASR */
    lastFinalSegment: string;
    /** Monotonic counter for finalized segments */
    lastFinalSegmentId: number;
    /** Whether Web Speech API is supported */
    isSupported: boolean;
    /** Whether ASR is running in continuous conversation mode */
    isContinuousConversation: boolean;
    /** Error message if any */
    error: string | null;
}

export interface VoiceInputActions {
    /** Start listening for speech */
    startListening: () => void;
    /** Stop listening */
    stopListening: () => void;
    /** Toggle listening state */
    toggleListening: () => void;
    /** Clear the transcript */
    clearTranscript: () => void;
}

type TranscribeAudioResult = {
    success: boolean;
    payload?: {
        text?: string;
        error?: string;
        details?: string;
        provider?: string;
    };
};

type VoiceProviderStatusResult = {
    success: boolean;
    payload?: {
        preferredAsr?: 'custom' | 'system';
        hasCustomAsr?: boolean;
    };
};

type NativeAsrResult = {
    success: boolean;
    payload?: {
        text?: string;
        error?: string;
        details?: string;
        supported?: boolean;
    };
};

type NativeAsrSegmentEvent = {
    text?: string;
    locale?: string;
    confidence?: number;
};

type AsrSelection = {
    preferCustom: boolean;
    hasCustomProvider: boolean;
};

async function getVoiceProviderModePreference(): Promise<VoiceProviderMode> {
    try {
        const settings = await getVoiceSettings();
        return settings.providerMode;
    } catch {
        return 'auto';
    }
}

function getSpeechRecognitionAPI(): any {
    if (typeof window === 'undefined') {
        return null;
    }
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function normalizeLanguage(language: string): string {
    const normalized = language.trim();
    const lower = normalized.toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-')) {
        return 'zh-CN';
    }
    if (lower === 'en' || lower.startsWith('en-')) {
        return 'en-US';
    }
    return normalized;
}

function getSystemLanguageHint(): string | null {
    if (typeof navigator === 'undefined') {
        return null;
    }

    const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string') {
            continue;
        }
        const trimmed = candidate.trim();
        if (!trimmed) {
            continue;
        }
        return normalizeLanguage(trimmed);
    }

    return null;
}

function resolveNativeAsrLanguageHint(language: string): string | null {
    const uiLanguage = normalizeLanguage(language);
    const systemLanguage = getSystemLanguageHint();

    if (systemLanguage === 'zh-CN') {
        return systemLanguage;
    }

    if (uiLanguage === 'zh-CN') {
        return uiLanguage;
    }

    if (systemLanguage) {
        return systemLanguage;
    }

    return uiLanguage.trim() ? uiLanguage : null;
}

function supportsAudioTranscriptionFallback(): boolean {
    return (
        isTauri()
        && typeof navigator !== 'undefined'
        && typeof navigator.mediaDevices?.getUserMedia === 'function'
        && typeof MediaRecorder !== 'undefined'
    );
}

function isMacTauriRuntime(): boolean {
    return (
        isTauri()
        && typeof navigator !== 'undefined'
        && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    );
}

function supportsNativeSystemAsr(): boolean {
    return isMacTauriRuntime();
}

async function requestMicrophoneAccess(): Promise<boolean> {
    if (!supportsAudioTranscriptionFallback()) {
        return false;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return true;
    } catch {
        return false;
    }
}

function pickRecordingMimeType(): string {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return 'audio/webm';
    }

    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/mpeg',
    ];

    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || 'audio/webm';
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : '';
            const [, base64] = dataUrl.split(',', 2);
            if (!base64) {
                reject(new Error('failed_to_encode_audio'));
                return;
            }
            resolve(base64);
        };
        reader.onerror = () => reject(new Error('failed_to_encode_audio'));
        reader.readAsDataURL(blob);
    });
}

export function useVoiceInput(
    language: string = 'en-US',
    continuous: boolean = true
): VoiceInputState & VoiceInputActions {
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [transcript, setTranscript] = useState('');
    const [lastFinalSegment, setLastFinalSegment] = useState('');
    const [lastFinalSegmentId, setLastFinalSegmentId] = useState(0);
    const [isContinuousConversation, setIsContinuousConversation] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const nativeAsrActiveRef = useRef(false);
    const nativeSegmentSeenRef = useRef(false);

    const resolveAsrSelection = useCallback(async (providerMode: VoiceProviderMode): Promise<AsrSelection> => {
        if (!isTauri()) {
            return {
                preferCustom: false,
                hasCustomProvider: false,
            };
        }

        if (providerMode === 'system') {
            return {
                preferCustom: false,
                hasCustomProvider: false,
            };
        }

        try {
            const result = await invoke<VoiceProviderStatusResult>('get_voice_provider_status', {
                input: { providerMode },
            });
            return {
                preferCustom: result.payload?.preferredAsr === 'custom',
                hasCustomProvider: result.payload?.hasCustomAsr === true,
            };
        } catch (providerError) {
            console.warn('Failed to query voice provider status', providerError);
            return {
                preferCustom: false,
                hasCustomProvider: false,
            };
        }
    }, []);

    const cleanupMediaStream = useCallback(() => {
        mediaRecorderRef.current = null;
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
        recordedChunksRef.current = [];
    }, []);

    const transcribeRecordedAudio = useCallback(async (blob: Blob, providerMode: VoiceProviderMode) => {
        if (!blob.size) {
            setError('no_speech');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setInterimTranscript('');

        try {
            const audioBase64 = await blobToBase64(blob);
            const result = await invoke<TranscribeAudioResult>('transcribe_audio', {
                input: {
                    audioBase64,
                    mimeType: blob.type || 'audio/webm',
                    language: normalizeLanguage(language),
                    providerMode,
                },
            });

            if (!result.success) {
                setError(result.payload?.error || 'transcription_failed');
                return;
            }

            const text = result.payload?.text?.trim();
            if (!text) {
                setError('no_speech');
                return;
            }

            setTranscript((prev) => prev + text);
        } catch (transcriptionError) {
            console.error('Voice transcription failed', transcriptionError);
            setError('transcription_failed');
        } finally {
            setIsProcessing(false);
        }
    }, [language]);

    const stopNativeListening = useCallback(() => {
        if (!nativeAsrActiveRef.current) {
            return;
        }

        nativeAsrActiveRef.current = false;
        setIsListening(false);
        setIsProcessing(true);
        setInterimTranscript('');

        void invoke<NativeAsrResult>('stop_native_asr')
            .then((result) => {
                if (!result.success) {
                    const errorCode = result.payload?.error || 'transcription_failed';
                    if (!(nativeSegmentSeenRef.current && errorCode === 'no_speech')) {
                        setError(errorCode);
                    }
                    return;
                }

                const text = result.payload?.text?.trim();
                if (!text) {
                    if (!nativeSegmentSeenRef.current) {
                        setError('no_speech');
                    }
                    return;
                }

                setLastFinalSegment(text);
                setLastFinalSegmentId((prev) => prev + 1);
                setTranscript((prev) => prev + text);
            })
            .catch((nativeError) => {
                console.error('Failed to stop native ASR', nativeError);
                setError('transcription_failed');
            })
            .finally(() => {
                nativeSegmentSeenRef.current = false;
                setIsContinuousConversation(false);
                setIsProcessing(false);
            });
    }, []);

    const startNativeListening = useCallback(async () => {
        try {
            const result = await invoke<NativeAsrResult>('start_native_asr', {
                input: {
                    language: resolveNativeAsrLanguageHint(language),
                },
            });

            if (!result.success) {
                setError(result.payload?.error || 'speech_not_supported');
                return;
            }

            nativeSegmentSeenRef.current = false;
            nativeAsrActiveRef.current = true;
            setIsContinuousConversation(true);
            setIsListening(true);
        } catch (nativeError) {
            console.error('Failed to start native ASR', nativeError);
            setError('speech_not_supported');
        }
    }, [language]);

    const startRecordedListening = useCallback(async (providerMode: VoiceProviderMode) => {
        if (!supportsAudioTranscriptionFallback()) {
            setError('speech_not_supported');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = pickRecordingMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

            mediaStreamRef.current = stream;
            mediaRecorderRef.current = recorder;
            recordedChunksRef.current = [];

            recorder.ondataavailable = (event: BlobEvent) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            recorder.onerror = () => {
                setError('recording_failed');
                setIsListening(false);
                cleanupMediaStream();
            };

            recorder.onstop = () => {
                const chunks = recordedChunksRef.current;
                const recordedMimeType = recorder.mimeType || mimeType;
                cleanupMediaStream();
                setIsListening(false);
                const blob = new Blob(chunks, { type: recordedMimeType || 'audio/webm' });
                void transcribeRecordedAudio(blob, providerMode);
            };

            recorder.start();
            setIsListening(true);
        } catch (recordError) {
            console.error('Failed to start audio recording', recordError);
            setIsListening(false);
            cleanupMediaStream();
            setError('microphone_denied');
        }
    }, [cleanupMediaStream, transcribeRecordedAudio]);

    const startListening = useCallback(async () => {
        const SpeechRecognitionAPI = getSpeechRecognitionAPI();
        const providerMode = await getVoiceProviderModePreference();
        const asrSelection = await resolveAsrSelection(providerMode);
        setError(null);
        setInterimTranscript('');

        if (asrSelection.preferCustom) {
            setIsContinuousConversation(false);
            await startRecordedListening('custom');
            return;
        }

        if (supportsNativeSystemAsr()) {
            await startNativeListening();
            return;
        }

        // On macOS Tauri, preflight microphone access through getUserMedia so
        // WebKit triggers the system permission flow before SpeechRecognition starts.
        if (isMacTauriRuntime() && SpeechRecognitionAPI && supportsAudioTranscriptionFallback()) {
            const granted = await requestMicrophoneAccess();
            if (!granted) {
                setError('microphone_denied');
                return;
            }
        }

        if (SpeechRecognitionAPI) {
            const recognition = new SpeechRecognitionAPI();
            recognition.continuous = continuous;
            recognition.interimResults = true;
            recognition.lang = normalizeLanguage(language);

            recognition.onresult = (event: any) => {
                let interim = '';
                let final = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        final += result[0].transcript;
                    } else {
                        interim += result[0].transcript;
                    }
                }

                if (final) {
                    setTranscript((prev) => prev + final);
                }
                setInterimTranscript(interim);
            };

            recognition.onerror = (event: any) => {
                const errorCode = event.error || 'speech_not_supported';
                setIsListening(false);
                setInterimTranscript('');
                recognitionRef.current = null;

                if (
                    errorCode === 'service-not-allowed'
                    && asrSelection.hasCustomProvider
                    && supportsAudioTranscriptionFallback()
                ) {
                    console.warn('SpeechRecognition service-not-allowed, falling back to custom recorder transcription');
                    void startRecordedListening('custom');
                    return;
                }

                if (errorCode === 'not-allowed') {
                    setError('microphone_denied');
                } else if (errorCode === 'service-not-allowed') {
                    setError('speech_permission_denied');
                } else if (errorCode === 'no-speech') {
                    setError('no_speech');
                } else {
                    setError(errorCode);
                }
            };

            recognition.onend = () => {
                setIsListening(false);
                setInterimTranscript('');
                recognitionRef.current = null;
            };

            recognitionRef.current = recognition;
            try {
                recognition.start();
                setIsListening(true);
            } catch (startError) {
                console.error('Failed to start speech recognition', startError);
                recognitionRef.current = null;
                setIsListening(false);
                setError('speech_not_supported');
            }
            return;
        }

        setError('speech_not_supported');
    }, [continuous, language, resolveAsrSelection, startNativeListening, startRecordedListening]);

    const stopListening = useCallback(() => {
        if (nativeAsrActiveRef.current) {
            stopNativeListening();
            return;
        }
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            return;
        }
        cleanupMediaStream();
        setIsListening(false);
    }, [cleanupMediaStream]);

    const toggleListening = useCallback(() => {
        if (isProcessing) {
            return;
        }
        if (isListening) {
            stopListening();
        } else {
            void startListening();
        }
    }, [isListening, isProcessing, startListening, stopListening]);

    const clearTranscript = useCallback(() => {
        setTranscript('');
        setInterimTranscript('');
        setLastFinalSegment('');
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (nativeAsrActiveRef.current) {
                nativeAsrActiveRef.current = false;
                void invoke('stop_native_asr').catch(() => undefined);
            }
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            cleanupMediaStream();
        };
    }, [cleanupMediaStream]);

    useEffect(() => {
        if (!isTauri()) {
            return;
        }

        let unlisten: UnlistenFn | undefined;

        listen<NativeAsrSegmentEvent>('native-asr-segment', (event) => {
            const text = event.payload?.text?.trim();
            if (!text) {
                return;
            }

            nativeSegmentSeenRef.current = true;
            setInterimTranscript('');
            setTranscript((prev) => prev + text);
            setLastFinalSegment(text);
            setLastFinalSegmentId((prev) => prev + 1);
        }).then((dispose) => {
            unlisten = dispose;
        }).catch((listenError) => {
            console.error('Failed to subscribe to native ASR events', listenError);
        });

        return () => {
            void unlisten?.();
        };
    }, []);

    return {
        isListening,
        isProcessing,
        interimTranscript,
        transcript,
        lastFinalSegment,
        lastFinalSegmentId,
        isSupported: !!getSpeechRecognitionAPI() || supportsAudioTranscriptionFallback() || supportsNativeSystemAsr(),
        isContinuousConversation,
        error,
        startListening,
        stopListening,
        toggleListening,
        clearTranscript,
    };
}
