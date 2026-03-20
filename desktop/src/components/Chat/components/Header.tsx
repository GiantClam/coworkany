/**
 * Chat Header Component
 *
 * Shared task header for the active session view.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
    title: string;
    status: 'idle' | 'running' | 'finished' | 'failed';
    statusLabel: string;
    modelName: string;
    enabledSkillsCount: number;
    enabledToolpacksCount: number;
    isClearing: boolean;
    isCancelling: boolean;
    isSpeaking: boolean;
    isStoppingVoice: boolean;
    onShowSettings: () => void;
    onShowSkills: () => void;
    onShowMcp: () => void;
    onCreateSession: () => void;
    onClearHistory: () => void;
    onCancel: () => void;
    onStopVoice: () => void;
    canClearHistory: boolean;
}

const PlusIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

function abbreviateTitle(title: string): string {
    if (title.length <= 20) {
        return title;
    }

    return `${title.slice(0, 10)}...${title.slice(-7)}`;
}

const HeaderComponent: React.FC<HeaderProps> = ({
    title,
    status,
    statusLabel,
    modelName,
    enabledSkillsCount,
    enabledToolpacksCount,
    isClearing,
    isCancelling,
    isSpeaking,
    isStoppingVoice,
    onShowSettings,
    onShowSkills,
    onShowMcp,
    onCreateSession,
    onClearHistory,
    onCancel,
    onStopVoice,
    canClearHistory,
}) => {
    const { t } = useTranslation();

    const displayTitle = abbreviateTitle(title);
    const isStatusActionDisabled = !isSpeaking && status !== 'running';
    const statusActionHint = isSpeaking
        ? (isStoppingVoice ? t('chat.stoppingVoice') : t('chat.stopVoice'))
        : status === 'running'
            ? t('common.cancel')
            : null;
    const statusActionClassName = `chat-header-chip chat-status-chip ${status} ${isSpeaking ? 'warning' : ''}`.trim();

    return (
        <header className="chat-header">
            <div className="chat-header-main">
                <div className="chat-header-title-block">
                    <div className={`chat-status-dot ${status}`} aria-hidden="true" />
                    <div className="chat-header-copy">
                        <h2 className="chat-title" title={title}>{displayTitle}</h2>
                    </div>
                </div>
            </div>

            <div className="chat-header-actions">
                <button
                    type="button"
                    className={statusActionClassName}
                    onClick={() => {
                        if (isSpeaking) {
                            onStopVoice();
                            return;
                        }
                        if (status === 'running') {
                            onCancel();
                        }
                    }}
                    disabled={isStatusActionDisabled || isCancelling || isStoppingVoice}
                    title={statusLabel}
                    aria-label={statusLabel}
                >
                    <span className="chat-header-chip-label">STATUS</span>
                    <span className="chat-header-chip-value">{statusLabel}</span>
                    {statusActionHint ? (
                        <span className="chat-header-chip-meta">{statusActionHint}</span>
                    ) : null}
                </button>

                <button
                    type="button"
                    className="chat-header-chip"
                    onClick={onShowSettings}
                    title={t('chat.editLlmSettings')}
                    aria-label={`${modelName} | ${t('chat.editLlmSettings')}`}
                >
                    <span className="chat-header-chip-label">MODEL</span>
                    <span className="chat-header-chip-value">{modelName}</span>
                </button>

                <button
                    type="button"
                    className="chat-header-icon-button"
                    onClick={onShowSkills}
                    title={t('chat.manageSkills')}
                    aria-label={t('chat.manageSkills')}
                >
                    <span className="chat-header-icon-button-text">SK</span>
                    <span className="chat-header-icon-button-count">{enabledSkillsCount}</span>
                </button>

                <button
                    type="button"
                    className="chat-header-icon-button"
                    onClick={onShowMcp}
                    title={t('chat.manageMcpServers')}
                    aria-label={t('chat.manageMcpServers')}
                >
                    <span className="chat-header-icon-button-text">MCP</span>
                    <span className="chat-header-icon-button-count">{enabledToolpacksCount}</span>
                </button>

                <button
                    type="button"
                    className="chat-header-icon-button"
                    onClick={onCreateSession}
                    title={t('chat.createNewSession')}
                    aria-label={t('chat.createNewSession')}
                >
                    <PlusIcon />
                    <span className="chat-header-icon-button-text">NEW</span>
                </button>

                <button
                    type="button"
                    className="status-action"
                    onClick={onClearHistory}
                    disabled={isClearing || !canClearHistory}
                    title={t('chat.clearHistory')}
                >
                    {t('chat.clear')}
                </button>
            </div>
        </header>
    );
};

const arePropsEqual = (prevProps: HeaderProps, nextProps: HeaderProps): boolean => {
    return (
        prevProps.title === nextProps.title &&
        prevProps.status === nextProps.status &&
        prevProps.statusLabel === nextProps.statusLabel &&
        prevProps.modelName === nextProps.modelName &&
        prevProps.enabledSkillsCount === nextProps.enabledSkillsCount &&
        prevProps.enabledToolpacksCount === nextProps.enabledToolpacksCount &&
        prevProps.isClearing === nextProps.isClearing &&
        prevProps.isCancelling === nextProps.isCancelling &&
        prevProps.isSpeaking === nextProps.isSpeaking &&
        prevProps.isStoppingVoice === nextProps.isStoppingVoice
    );
};

export const Header = React.memo(HeaderComponent, arePropsEqual);

Header.displayName = 'Header';
