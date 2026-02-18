/**
 * Chat Header Component
 *
 * Minimal Glean-style header: title | model pill | actions
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
    llmConfig,
    isClearing,
    isCancelling,
    onShowSettings,
    onClearHistory,
    onCancel,
}) => {
    const { t } = useTranslation();

    const activeProfile = llmConfig.profiles?.find(p => p.id === llmConfig.activeProfileId);
    const modelName = activeProfile ? activeProfile.name : t('chat.noProfiles');

    return (
        <div className="chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                <h2 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '15px', fontWeight: 500 }}>
                    {title}
                </h2>
                <WorkspaceSelector />
            </div>

            {/* Model pill — centered */}
            <button
                onClick={onShowSettings}
                title={t('chat.editLlmSettings')}
                aria-label={`${modelName} — ${t('chat.editLlmSettings')}`}
                style={{
                    background: 'var(--bg-element)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '20px',
                    padding: '3px 12px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    whiteSpace: 'nowrap',
                }}
            >
                {modelName}
            </button>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {status === 'running' && (
                    <button
                        type="button"
                        className="status-action"
                        onClick={onCancel}
                        disabled={isCancelling}
                        style={{ fontSize: '12px' }}
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
        </div>
    );
};

// Custom comparison to prevent unnecessary re-renders
const arePropsEqual = (prevProps: HeaderProps, nextProps: HeaderProps): boolean => {
    return (
        prevProps.title === nextProps.title &&
        prevProps.status === nextProps.status &&
        prevProps.isClearing === nextProps.isClearing &&
        prevProps.isCancelling === nextProps.isCancelling &&
        prevProps.llmConfig.activeProfileId === nextProps.llmConfig.activeProfileId &&
        JSON.stringify(prevProps.llmConfig.profiles) === JSON.stringify(nextProps.llmConfig.profiles)
    );
};

export const Header = React.memo(HeaderComponent, arePropsEqual);

Header.displayName = 'Header';
