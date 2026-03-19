/**
 * Input Area Component
 *
 * Displays input form with text input, voice input button, and send button.
 * Voice input uses the Web Speech API via useVoiceInput hook.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceInput } from '../../../hooks/useVoiceInput';
import type { FileAttachment } from '../../../hooks/useFileAttachment';
import { getCurrentLanguage } from '../../../i18n';
import { AttachmentPreview } from './AttachmentPreview';
import { isImeConfirmingEnter, shouldSubmitOnEnter } from './inputComposition';

interface LlmProfile {
    id: string;
    name: string;
    provider: string;
}

interface InputAreaProps {
    query: string;
    placeholder: string;
    disabled: boolean;
    onQueryChange: (value: string) => void;
    onSubmit: () => void | Promise<void>;
    attachments: FileAttachment[];
    attachmentError: string | null;
    onRemoveAttachment: (id: string) => void;
    onSelectFiles: (files: FileList | null) => void | Promise<void>;
    onPaste: React.ClipboardEventHandler<HTMLDivElement>;
    onDrop: React.DragEventHandler<HTMLFormElement>;
    llmProfiles: LlmProfile[];
    activeProfileId?: string;
    onSelectProfile: (id: string) => void;
}

const InputAreaComponent: React.FC<InputAreaProps> = ({
    query,
    placeholder,
    disabled,
    onQueryChange,
    onSubmit,
    attachments,
    attachmentError,
    onRemoveAttachment,
    onSelectFiles,
    onPaste,
    onDrop,
    llmProfiles,
    activeProfileId,
    onSelectProfile,
}) => {
    const { t } = useTranslation();
    const voiceInput = useVoiceInput(getCurrentLanguage());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const isComposingRef = useRef(false);

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

    useEffect(() => {
        const textArea = textAreaRef.current;
        if (!textArea) return;

        textArea.style.height = '0px';
        const nextHeight = Math.min(textArea.scrollHeight, 220);
        textArea.style.height = `${Math.max(nextHeight, 40)}px`;
    }, [query]);

    const voiceLabel = voiceInput.isProcessing
        ? t('voice.processingTranscription')
        : voiceInput.isListening
            ? t('voice.stopRecording')
            : t('voice.startRecording');
    const canSubmit = query.trim().length > 0 || attachments.length > 0;
    const voiceStatusText = voiceInput.isProcessing
        ? t('voice.processingTranscription')
        : voiceInput.isListening
            ? voiceInput.interimTranscript || t('voice.listening')
            : '';
    const voiceErrorText = useMemo(() => {
        if (!voiceInput.error) return '';
        if (voiceInput.error === 'microphone_denied') {
            return t('voice.microphoneError');
        }
        if (voiceInput.error === 'no_speech' || voiceInput.error === 'empty_audio') {
            return t('voice.noSpeechDetected');
        }
        if (voiceInput.error === 'transcription_unavailable') {
            return t('voice.transcriptionUnavailable');
        }
        if (voiceInput.error === 'transcription_failed') {
            return t('voice.transcriptionFailed');
        }
        if (voiceInput.error === 'recording_failed') {
            return t('voice.recordingError');
        }
        if (voiceInput.error === 'speech_not_supported') {
            return t('voice.speechNotSupported');
        }
        return voiceInput.error;
    }, [t, voiceInput.error]);

    const attachmentErrorText = useMemo(() => {
        if (!attachmentError) return '';
        if (attachmentError === 'file_too_large') {
            return t('multimodal.fileTooLarge', { max: 10 });
        }
        if (attachmentError === 'max_files_reached') {
            return 'Maximum 5 files reached';
        }
        return 'Failed to attach file';
    }, [attachmentError, t]);

    const handleOpenPicker = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
        void onSelectFiles(event.target.files);
        event.target.value = '';
    };

    const handleProfileChange: React.ChangeEventHandler<HTMLSelectElement> = (event) => {
        const id = event.target.value;
        if (id) {
            onSelectProfile(id);
        }
    };

    const handlePasteEvent: React.ClipboardEventHandler<HTMLDivElement> = (event) => {
        if (disabled) return;
        onPaste(event);
    };

    const handleDropEvent: React.DragEventHandler<HTMLFormElement> = (event) => {
        if (disabled) {
            event.preventDefault();
            return;
        }
        onDrop(event);
    };

    const submit = () => {
        if (disabled || !canSubmit) return;
        void onSubmit();
    };

    return (
        <div className="input-area" onPaste={handlePasteEvent}>
            {voiceStatusText && (
                <div className="voice-interim">
                    {voiceStatusText}
                </div>
            )}
            {voiceErrorText && (
                <div className="voice-error">{voiceErrorText}</div>
            )}
            {attachmentErrorText && (
                <div className="attachment-error">{attachmentErrorText}</div>
            )}
            <AttachmentPreview
                attachments={attachments}
                onRemove={onRemoveAttachment}
            />
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                }}
                onDrop={handleDropEvent}
                onDragOver={(event) => event.preventDefault()}
                className="input-container"
                aria-busy={disabled}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="file-input-hidden"
                    onChange={handleFileChange}
                    disabled={disabled}
                    aria-hidden="true"
                    tabIndex={-1}
                />
                <textarea
                    ref={textAreaRef}
                    className="chat-input"
                    placeholder={placeholder}
                    value={query}
                    rows={1}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onCompositionStart={() => {
                        isComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                        isComposingRef.current = false;
                    }}
                    onKeyDown={(event) => {
                        if (isImeConfirmingEnter(event, isComposingRef.current)) {
                            event.preventDefault();
                            return;
                        }

                        if (shouldSubmitOnEnter(event, isComposingRef.current)) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    disabled={disabled}
                    aria-label={placeholder}
                />
                <button
                    type="button"
                    className="attach-button"
                    onClick={handleOpenPicker}
                    disabled={disabled}
                    title={t('multimodal.attachFile')}
                    aria-label={t('multimodal.attachFile')}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
                {voiceInput.isSupported && (
                    <button
                        type="button"
                        className={`voice-button ${voiceInput.isListening ? 'listening' : ''} ${voiceInput.isProcessing ? 'processing' : ''}`}
                        onClick={voiceInput.toggleListening}
                        disabled={disabled || voiceInput.isProcessing}
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
                    type="button"
                    className="send-button"
                    onClick={submit}
                    disabled={!canSubmit || disabled}
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
            <div className="input-meta-row">
                <span className="input-mode-badge">Build</span>
                <label className="llm-select-wrap">
                    <span className="llm-select-icon" aria-hidden="true">AI</span>
                    <select
                        className="llm-select"
                        value={activeProfileId ?? ''}
                        onChange={handleProfileChange}
                        disabled={disabled || llmProfiles.length === 0}
                        aria-label={t('chat.llmSettings')}
                    >
                        {llmProfiles.length === 0 && (
                            <option value="">{t('chat.noProfiles')}</option>
                        )}
                        {llmProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                                {profile.name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
        </div>
    );
};

// Only re-render when query, placeholder, or disabled state changes
// Note: Callback functions are assumed to be stable (memoized in parent)
const arePropsEqual = (prevProps: InputAreaProps, nextProps: InputAreaProps): boolean => {
    return (
        prevProps.query === nextProps.query &&
        prevProps.placeholder === nextProps.placeholder &&
        prevProps.disabled === nextProps.disabled &&
        prevProps.attachmentError === nextProps.attachmentError &&
        prevProps.activeProfileId === nextProps.activeProfileId &&
        prevProps.attachments.map((item) => item.id).join('|') === nextProps.attachments.map((item) => item.id).join('|') &&
        JSON.stringify(prevProps.llmProfiles) === JSON.stringify(nextProps.llmProfiles)
    );
};

export const InputArea = React.memo(InputAreaComponent, arePropsEqual);

InputArea.displayName = 'InputArea';
