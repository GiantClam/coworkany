/**
 * Input Area Component
 *
 * Displays input form with text input, voice input button, and send button.
 * Voice input uses the Web Speech API via useVoiceInput hook.
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceInput } from '../../../hooks/useVoiceInput';
import { getCurrentLanguage } from '../../../i18n';

interface InputAreaProps {
    query: string;
    placeholder: string;
    disabled: boolean;
    onQueryChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
}

const InputAreaComponent: React.FC<InputAreaProps> = ({
    query,
    placeholder,
    disabled,
    onQueryChange,
    onSubmit,
}) => {
    const { t } = useTranslation();
    const voiceInput = useVoiceInput(getCurrentLanguage());

    // Track the previous transcript so we only append new text
    const prevTranscriptRef = useRef('');

    useEffect(() => {
        if (voiceInput.transcript && voiceInput.transcript !== prevTranscriptRef.current) {
            const newText = voiceInput.transcript.slice(prevTranscriptRef.current.length);
            if (newText) {
                onQueryChange(query + newText);
            }
            prevTranscriptRef.current = voiceInput.transcript;
        }
    }, [voiceInput.transcript, onQueryChange, query]);

    const voiceLabel = voiceInput.isListening ? t('voice.stopRecording') : t('voice.startRecording');

    return (
        <div className="input-area">
            {voiceInput.isListening && voiceInput.interimTranscript && (
                <div className="voice-interim">
                    {voiceInput.interimTranscript}
                </div>
            )}
            <form onSubmit={onSubmit} className="input-container" aria-busy={disabled}>
                <input
                    type="text"
                    className="chat-input"
                    placeholder={placeholder}
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    disabled={disabled}
                    aria-label={placeholder}
                />
                {voiceInput.isSupported && (
                    <button
                        type="button"
                        className={`voice-button ${voiceInput.isListening ? 'listening' : ''}`}
                        onClick={voiceInput.toggleListening}
                        disabled={disabled}
                        title={voiceLabel}
                        aria-label={voiceLabel}
                        aria-pressed={voiceInput.isListening}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                            <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                    </button>
                )}
                <button
                    type="submit"
                    className="send-button"
                    disabled={!query.trim() || disabled}
                    aria-label={t('chat.sendMessage')}
                >
                    <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                </button>
            </form>
        </div>
    );
};

// Only re-render when query, placeholder, or disabled state changes
// Note: Callback functions are assumed to be stable (memoized in parent)
const arePropsEqual = (prevProps: InputAreaProps, nextProps: InputAreaProps): boolean => {
    return (
        prevProps.query === nextProps.query &&
        prevProps.placeholder === nextProps.placeholder &&
        prevProps.disabled === nextProps.disabled
    );
};

export const InputArea = React.memo(InputAreaComponent, arePropsEqual);

InputArea.displayName = 'InputArea';
