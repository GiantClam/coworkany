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
    isReconnectingLlm: boolean;
    isSpeaking: boolean;
    isStoppingVoice: boolean;
    onShowSettings: () => void;
    onShowSkills: () => void;
    onShowMcp: () => void;
    onClearHistory: () => void;
    onCancel: () => void;
    onReconnectLlm: () => void;
    onStopVoice: () => void;
    canClearHistory: boolean;
}

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
    isReconnectingLlm,
    isSpeaking,
    isStoppingVoice,
    onShowSettings,
    onShowSkills,
    onShowMcp,
    onClearHistory,
    onCancel,
    onReconnectLlm,
    onStopVoice,
    canClearHistory,
}) => {
    const { t } = useTranslation();

    const displayTitle = abbreviateTitle(title);
    const canReconnectLlm = status === 'finished';
    const isStatusActionDisabled = !isSpeaking && status !== 'running' && !canReconnectLlm;
    const statusActionHint = isSpeaking
        ? (isStoppingVoice ? t('chat.stoppingVoice') : t('chat.stopVoice'))
        : status === 'running'
            ? t('common.cancel')
            : canReconnectLlm
                ? t('chat.reconnectLlm')
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
                            return;
                        }
                        if (canReconnectLlm) {
                            onReconnectLlm();
                        }
                    }}
                    disabled={isStatusActionDisabled || isCancelling || isStoppingVoice || isReconnectingLlm}
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
