/**
 * useVoiceInput Hook
 *
 * Provides speech-to-text using the Web Speech API when available.
 * In Tauri, falls back to MediaRecorder + backend transcription.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/tauri';

export interface VoiceInputState {
    /** Whether speech recognition is currently active */
    isListening: boolean;
    /** Whether recorded audio is currently being transcribed */
    isProcessing: boolean;
    /** Interim (not finalized) transcript */
    interimTranscript: string;
    /** Final accumulated transcript */
    transcript: string;
    /** Whether Web Speech API is supported */
    isSupported: boolean;
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

function getSpeechRecognitionAPI(): any {
    if (typeof window === 'undefined') {
        return null;
    }
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function normalizeLanguage(language: string): string {
    switch (language.toLowerCase()) {
        case 'zh':
            return 'zh-CN';
        case 'en':
            return 'en-US';
        default:
            return language;
    }
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
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);

    const shouldPreferCustomAsr = useCallback(async () => {
        if (!isTauri()) {
            return false;
        }

        try {
            const result = await invoke<VoiceProviderStatusResult>('get_voice_provider_status');
            return result.payload?.preferredAsr === 'custom' || result.payload?.hasCustomAsr === true;
        } catch (providerError) {
            console.warn('Failed to query voice provider status', providerError);
            return false;
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

    const transcribeRecordedAudio = useCallback(async (blob: Blob) => {
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

    const startRecordedListening = useCallback(async () => {
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
                void transcribeRecordedAudio(blob);
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
        setError(null);
        setInterimTranscript('');

        if (await shouldPreferCustomAsr()) {
            await startRecordedListening();
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

                if (errorCode === 'service-not-allowed' && supportsAudioTranscriptionFallback()) {
                    console.warn('SpeechRecognition service-not-allowed, falling back to recorder transcription');
                    void startRecordedListening();
                    return;
                }

                if (errorCode === 'not-allowed') {
                    setError('microphone_denied');
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

        await startRecordedListening();
    }, [continuous, language, shouldPreferCustomAsr, startRecordedListening]);

    const stopListening = useCallback(() => {
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
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            cleanupMediaStream();
        };
    }, [cleanupMediaStream]);

    return {
        isListening,
        isProcessing,
        interimTranscript,
        transcript,
        isSupported: !!getSpeechRecognitionAPI() || supportsAudioTranscriptionFallback(),
        error,
        startListening,
        stopListening,
        toggleListening,
        clearTranscript,
    };
}
