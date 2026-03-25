/**
 * WelcomeSection Component
 *
 * Landing state for the primary chat surface.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import './WelcomeSection.css';

export type EntryMode = 'chat' | 'task';

interface WelcomeSectionProps {
    onFocusInput: () => void;
    mode: EntryMode;
    onModeChange: (mode: EntryMode) => void;
    onUsePrompt?: (prompt: string) => void;
    suggestedPrompts?: string[];
}

const ArrowIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
    </svg>
);

export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
    onFocusInput,
    mode,
    onModeChange,
    onUsePrompt,
    suggestedPrompts = [],
}) => {
    const { t } = useTranslation();

    return (
        <div className="welcome-section">
            <div className="welcome-content">
                <div className="welcome-segmented-wrap">
                    <div className="welcome-segmented" role="tablist" aria-label={t('welcome.modeSelectorTitle')}>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'chat'}
                            className={`welcome-segmented-option ${mode === 'chat' ? 'active' : ''}`}
                            onClick={() => {
                                onModeChange('chat');
                                onFocusInput();
                            }}
                        >
                            {t('welcome.modeChatTitle')}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'task'}
                            className={`welcome-segmented-option ${mode === 'task' ? 'active' : ''}`}
                            onClick={() => {
                                onModeChange('task');
                                onFocusInput();
                            }}
                        >
                            {t('welcome.modeTaskTitle')}
                        </button>
                    </div>
                </div>
                <h1 className="welcome-headline">{t('chat.howCanIHelp')}</h1>
                <p className="welcome-hint">
                    {mode === 'chat' ? t('welcome.modeChatDesc') : t('welcome.modeTaskDesc')}
                </p>

                {suggestedPrompts.length > 0 && (
                    <div className="welcome-recommendations">
                        <h2 className="welcome-recommendations-title">
                            {t('welcome.recommendedPrompts')}
                        </h2>
                        <div className="welcome-recommendation-list">
                            {suggestedPrompts.map((prompt) => (
                                <button
                                    key={prompt}
                                    type="button"
                                    className="welcome-recommendation-item"
                                    onClick={() => {
                                        onUsePrompt?.(prompt);
                                        onFocusInput();
                                    }}
                                >
                                    <span>{prompt}</span>
                                    <ArrowIcon />
                                </button>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default WelcomeSection;
