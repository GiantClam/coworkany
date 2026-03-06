/**
 * Chat Header Component
 *
 * Shared task header for the active session view.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceSelector } from '../../Workspace/WorkspaceSelector';

interface LlmProfile {
    id: string;
    name: string;
    provider: string;
}

interface LlmConfig {
    profiles?: LlmProfile[];
    activeProfileId?: string;
}

interface HeaderProps {
    title: string;
    status: 'idle' | 'running' | 'finished' | 'failed';
    statusLabel: string;
    llmConfig: LlmConfig;
    enabledSkillsCount: number;
    enabledToolpacksCount: number;
    isClearing: boolean;
    isCancelling: boolean;
    onSetActiveProfile: (id: string) => void;
    onShowSettings: () => void;
    onShowSkills: () => void;
    onShowMcp: () => void;
    onClearHistory: () => void;
    onCancel: () => void;
}

const HeaderComponent: React.FC<HeaderProps> = ({
    title,
    status,
    statusLabel,
    llmConfig,
    enabledSkillsCount,
    enabledToolpacksCount,
    isClearing,
    isCancelling,
    onShowSettings,
    onShowSkills,
    onShowMcp,
    onClearHistory,
    onCancel,
}) => {
    const { t } = useTranslation();

    const activeProfile = llmConfig.profiles?.find((profile) => profile.id === llmConfig.activeProfileId);
    const modelName = activeProfile ? activeProfile.name : t('chat.noProfiles');

    return (
        <header className="chat-header">
            <div className="chat-header-main">
                <div className="chat-header-title-block">
                    <div className={`chat-status-dot ${status}`} aria-hidden="true" />
                    <div className="chat-header-copy">
                        <h2 className="chat-title" title={title}>{title}</h2>
                        <div className="chat-subtitle-row">
                            <span className={`status-badge ${status}`}>{statusLabel}</span>
                            <span className="chat-capability-pill" title={t('chat.manageSkills')}>
                                {enabledSkillsCount} SK
                            </span>
                            <span className="chat-capability-pill" title={t('chat.manageMcpServers')}>
                                {enabledToolpacksCount} MCP
                            </span>
                        </div>
                    </div>
                </div>
                <div className="chat-header-workspace">
                    <WorkspaceSelector />
                </div>
            </div>

            <div className="chat-header-actions">
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

                {status === 'running' && (
                    <button
                        type="button"
                        className="status-action accent"
                        onClick={onCancel}
                        disabled={isCancelling}
                    >
                        {t('chat.cancel') || 'Stop'}
                    </button>
                )}

                <button
                    type="button"
                    className="status-action"
                    onClick={onClearHistory}
                    disabled={isClearing}
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
        prevProps.enabledSkillsCount === nextProps.enabledSkillsCount &&
        prevProps.enabledToolpacksCount === nextProps.enabledToolpacksCount &&
        prevProps.isClearing === nextProps.isClearing &&
        prevProps.isCancelling === nextProps.isCancelling &&
        prevProps.llmConfig.activeProfileId === nextProps.llmConfig.activeProfileId &&
        JSON.stringify(prevProps.llmConfig.profiles) === JSON.stringify(nextProps.llmConfig.profiles)
    );
};

export const Header = React.memo(HeaderComponent, arePropsEqual);

Header.displayName = 'Header';
