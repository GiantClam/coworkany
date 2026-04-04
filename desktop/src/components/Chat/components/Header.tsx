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
    onRetryFailedTask?: () => void;
    onStopVoice: () => void;
    canClearHistory: boolean;
    failedAction?: 'reconnect' | 'settings' | 'retry';
}

function abbreviateTitle(title: string): string {
    if (title.length <= 32) {
        return title;
    }

    return `${title.slice(0, 20)}...${title.slice(-9)}`;
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
    onRetryFailedTask,
    onStopVoice,
    canClearHistory,
    failedAction = 'reconnect',
}) => {
    const { t } = useTranslation();
    const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
    const moreMenuRef = React.useRef<HTMLDivElement | null>(null);

    const displayTitle = abbreviateTitle(title);
    const canReconnectLlm = status === 'finished' || status === 'failed';
    const failedStatusActionHint = failedAction === 'settings'
        ? t('chat.failureActionOpenSettings', { defaultValue: 'Open LLM Settings' })
        : failedAction === 'retry'
            ? t('chat.failureActionRetry', { defaultValue: 'Retry' })
            : t('chat.reconnectLlm');
    const isStatusActionDisabled = !isSpeaking && status !== 'running' && !canReconnectLlm;
    const statusActionHint = isSpeaking
        ? (isStoppingVoice ? t('chat.stoppingVoice') : t('chat.stopVoice'))
        : status === 'running'
            ? t('common.cancel')
            : canReconnectLlm
                ? (status === 'failed' ? failedStatusActionHint : t('chat.reconnectLlm'))
                : null;
    const statusActionClassName = `chat-header-chip chat-status-chip ${status} ${isSpeaking ? 'warning' : ''}`.trim();
    const moreActionsLabel = t('chat.moreActions', { defaultValue: 'Actions' });

    const closeMoreMenu = React.useCallback(() => {
        setIsMoreMenuOpen(false);
    }, []);

    React.useEffect(() => {
        if (!isMoreMenuOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent): void => {
            if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
                setIsMoreMenuOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setIsMoreMenuOpen(false);
            }
        };

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleEscape);

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [isMoreMenuOpen]);

    return (
        <header className="chat-header">
            <div className="chat-header-inner">
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
                                if (status === 'failed' && failedAction === 'settings') {
                                    onShowSettings();
                                    return;
                                }
                                if (status === 'failed' && failedAction === 'retry' && onRetryFailedTask) {
                                    onRetryFailedTask();
                                    return;
                                }
                                onReconnectLlm();
                            }
                        }}
                        disabled={isStatusActionDisabled || isCancelling || isStoppingVoice || isReconnectingLlm}
                        title={statusLabel}
                        aria-label={statusLabel}
                    >
                        <span className="chat-header-chip-value">{statusLabel}</span>
                        {statusActionHint ? (
                            <span className="chat-header-chip-action">{statusActionHint}</span>
                        ) : null}
                    </button>

                    <button
                        type="button"
                        className="chat-header-chip"
                        onClick={onShowSettings}
                        title={t('chat.editLlmSettings')}
                        aria-label={`${modelName} | ${t('chat.editLlmSettings')}`}
                    >
                        <span className="chat-header-chip-value">{modelName}</span>
                    </button>

                    <div className="chat-header-more" ref={moreMenuRef}>
                        <button
                            type="button"
                            className="chat-header-more-trigger"
                            onClick={() => setIsMoreMenuOpen((open) => !open)}
                            aria-haspopup="menu"
                            aria-expanded={isMoreMenuOpen}
                            aria-label={moreActionsLabel}
                            title={moreActionsLabel}
                        >
                            <span aria-hidden="true">⋯</span>
                        </button>

                        {isMoreMenuOpen ? (
                            <div className="chat-header-more-menu" role="menu" aria-label={moreActionsLabel}>
                                <button
                                    type="button"
                                    className="chat-header-more-item"
                                    role="menuitem"
                                    onClick={() => {
                                        closeMoreMenu();
                                        onShowSkills();
                                    }}
                                    title={t('chat.manageSkills')}
                                >
                                    <span className="chat-header-more-item-label">{t('chat.skills', { defaultValue: 'Skills' })}</span>
                                    <span className="chat-header-more-item-value">{enabledSkillsCount}</span>
                                </button>

                                <button
                                    type="button"
                                    className="chat-header-more-item"
                                    role="menuitem"
                                    onClick={() => {
                                        closeMoreMenu();
                                        onShowMcp();
                                    }}
                                    title={t('chat.manageMcpServers')}
                                >
                                    <span className="chat-header-more-item-label">{t('chat.tools', { defaultValue: 'Tools' })}</span>
                                    <span className="chat-header-more-item-value">{enabledToolpacksCount}</span>
                                </button>

                                <button
                                    type="button"
                                    className="chat-header-more-item"
                                    role="menuitem"
                                    onClick={() => {
                                        closeMoreMenu();
                                        onClearHistory();
                                    }}
                                    disabled={isClearing || !canClearHistory}
                                    title={t('chat.clearHistory')}
                                >
                                    <span className="chat-header-more-item-label">{t('chat.clear')}</span>
                                    {isClearing ? (
                                        <span className="chat-header-more-item-value">{t('common.processing', { defaultValue: 'Processing' })}</span>
                                    ) : null}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </header>
    );
};

export const Header = React.memo(HeaderComponent);

Header.displayName = 'Header';
