/**
 * useVoiceInput Hook
 *
 * Provides speech-to-text using the Web Speech API (SpeechRecognition).
 * Falls back gracefully when not supported.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceInputState {
    /** Whether speech recognition is currently active */
    isListening: boolean;
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

// Get the SpeechRecognition constructor (browser-specific)
const SpeechRecognitionAPI =
    typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

export function useVoiceInput(
    language: string = 'en-US',
    continuous: boolean = true
): VoiceInputState & VoiceInputActions {
    const [isListening, setIsListening] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<any>(null);

    const isSupported = !!SpeechRecognitionAPI;

    const startListening = useCallback(() => {
        if (!SpeechRecognitionAPI) {
            setError('Speech recognition not supported');
            return;
        }

        setError(null);
        
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = continuous;
        recognition.interimResults = true;
        recognition.lang = language;

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
            if (event.error === 'not-allowed') {
                setError('microphone_denied');
            } else if (event.error === 'no-speech') {
                setError('no_speech');
            } else {
                setError(event.error);
            }
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
            setInterimTranscript('');
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
    }, [language, continuous]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }
        setIsListening(false);
    }, []);

    const toggleListening = useCallback(() => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }, [isListening, startListening, stopListening]);

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
        };
    }, []);

    return {
        isListening,
        interimTranscript,
        transcript,
        isSupported,
        error,
        startListening,
        stopListening,
        toggleListening,
        clearTranscript,
    };
}
