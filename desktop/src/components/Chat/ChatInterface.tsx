/**
 * ChatInterface Component
 *
 * Main chat interface using child components
 */

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ChatInterface.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useStartTask, useCancelTask } from '../../hooks/useStartTask';
import { useActiveSession } from '../../stores/useTaskEventStore';
import { useSkills } from '../../hooks/useSkills';
import { useToolpacks } from '../../hooks/useToolpacks';
import { useSendTaskMessage } from '../../hooks/useSendTaskMessage';
import { useClearTaskHistory } from '../../hooks/useClearTaskHistory';
import { useWorkspace } from '../../hooks/useWorkspace';
import { Timeline } from './Timeline/Timeline';
import { ModalDialog } from '../Common/ModalDialog';
import { Header } from './components/Header';
import { InputArea } from './components/InputArea';
import { WelcomeSection } from '../Welcome/WelcomeSection';
import { useUIStore } from '../../stores/uiStore';

const SkillsViewLazy = lazy(async () => {
    const mod = await import('../Skills/SkillsView');
    return { default: mod.SkillsView };
});

const McpViewLazy = lazy(async () => {
    const mod = await import('../Mcp/McpView');
    return { default: mod.McpView };
});

const SettingsViewLazy = lazy(async () => {
    const mod = await import('../Settings/SettingsView');
    return { default: mod.SettingsView };
});

// LLM Config matching llm-config.json structure
type LlmProfile = {
    id: string;
    name: string;
    provider: string;
    anthropic?: { model?: string };
    openrouter?: { model?: string };
    custom?: { model?: string };
    verified: boolean;
};

type LlmConfig = {
    profiles?: LlmProfile[];
    activeProfileId?: string;
    maxHistoryMessages?: number;
};

interface ChatInterfaceProps {
    onOpenSkills?: () => void;
    onOpenMcp?: () => void;
    onOpenSettings?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    onOpenSkills,
    onOpenMcp,
    onOpenSettings,
}) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [workspaceError, setWorkspaceError] = useState<string | null>(null);
    const [showSkillsDialog, setShowSkillsDialog] = useState(false);
    const [showMcpDialog, setShowMcpDialog] = useState(false);
    const [showSettingsDialog, setShowSettingsDialog] = useState(false);

    const activeSession = useActiveSession();
    const { startTask, isLoading: isStarting, error: startError } = useStartTask();
    const { cancelTask, isLoading: isCancelling, error: cancelError } = useCancelTask();
    const { sendMessage, isLoading: isSending, error: sendError } = useSendTaskMessage();
    const { clearHistory, isLoading: isClearing, error: clearError } = useClearTaskHistory();
    const { skills } = useSkills();
    const { toolpacks } = useToolpacks();
    const { activeWorkspace, createWorkspace, selectWorkspace, updateWorkspace } = useWorkspace();
    const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
    const { switchToLauncher, openDashboard } = useUIStore();

    useEffect(() => {
        let mounted = true;
        let unlistenSettings: UnlistenFn | undefined;

        const refreshSettings = async () => {
            try {
                const result = await invoke<{ success: boolean, payload: LlmConfig }>('get_llm_settings');
                if (mounted) {
                    setLlmConfig(result.payload ?? {});
                }
            } catch {
                if (mounted) {
                    setLlmConfig({});
                }
            }
        };

        void refreshSettings();

        listen<LlmConfig>('llm-settings-updated', (event) => {
            if (mounted) {
                setLlmConfig(event.payload ?? {});
            }
        }).then((unlisten) => {
            unlistenSettings = unlisten;
        }).catch(() => {
            // Ignore listener errors; fallback to manual refresh on mount.
        });

        return () => {
            mounted = false;
            unlistenSettings?.();
        };
    }, []);

    const enabledSkills = useMemo(
        () => skills.filter((skill) => skill.enabled).map((skill) => skill.manifest.id),
        [skills]
    );

    const enabledToolpacks = useMemo(
        () => toolpacks.filter((tp) => tp.enabled).map((tp) => tp.manifest.id),
        [toolpacks]
    );

    const setActiveProfile = useCallback(async (id: string) => {
        try {
            const newConfig = { ...llmConfig, activeProfileId: id };
            await invoke('save_llm_settings', { input: newConfig });
        } catch (err) {
            console.error('Failed to switch profile:', err);
        }
    }, [llmConfig]);

    const statusLabel = useMemo(() => {
        if (!activeSession) return '';
        switch (activeSession.status) {
            case 'running':
                return t('chat.statusInProgress');
            case 'finished':
                return t('chat.statusReady');
            case 'failed':
                return t('chat.statusFailed');
            default:
                return t('chat.statusIdle');
        }
    }, [activeSession]);

    const handleClearHistory = useCallback(async () => {
        if (!activeSession?.taskId) return;
        if (!window.confirm(t('chat.clearConfirm'))) return;
        await clearHistory({ taskId: activeSession.taskId });
    }, [activeSession?.taskId, clearHistory]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        if (activeSession?.taskId) {
            await sendMessage({
                taskId: activeSession.taskId,
                content: query,
                config: {
                    enabledClaudeSkills: enabledSkills,
                    enabledToolpacks,
                    enabledSkills,
                },
            });
            setQuery('');
            return;
        }

        // Auto-create workspace if none selected or path is invalid
        let currentWorkspace = activeWorkspace;
        if (!currentWorkspace || !currentWorkspace.path) {
            try {
                if (currentWorkspace) {
                    console.warn('Active workspace has no path or is invalid, deleting and creating new one');
                    try {
                        await invoke('delete_workspace', { input: { id: currentWorkspace.id } });
                    } catch (delErr) {
                        console.error('Failed to delete invalid workspace:', delErr);
                    }
                }

                const newWorkspace = await createWorkspace('new workspace', '');
                if (newWorkspace) {
                    selectWorkspace(newWorkspace);
                    currentWorkspace = newWorkspace;
                }
            } catch (err) {
                console.error("Failed to auto-create workspace", err);
            }
        }

        const currentPath = currentWorkspace?.path;
        if (!currentPath) {
            setWorkspaceError('Workspace path is not available and could not be created.');
            return;
        }

        if (currentWorkspace && currentWorkspace.name === 'new workspace') {
            const summary = query.trim().slice(0, 30) + (query.length > 30 ? '...' : '');
            void updateWorkspace(currentWorkspace.id, { name: summary });
        }

        setWorkspaceError(null);
        await startTask({
            title: query.trim().slice(0, 60),
            userQuery: query,
            workspacePath: currentPath,
            config: {
                enabledClaudeSkills: enabledSkills,
                enabledToolpacks,
                enabledSkills,
            },
        });
        setQuery('');
    }, [query, activeSession?.taskId, sendMessage, enabledSkills, enabledToolpacks, activeWorkspace, createWorkspace, selectWorkspace, updateWorkspace, startTask]);

    const handleCancel = useCallback(async () => {
        if (activeSession?.taskId) {
            await cancelTask({
                taskId: activeSession.taskId,
                reason: 'User cancelled',
            });
        }
    }, [activeSession?.taskId, cancelTask]);

    const handleShowSettings = useCallback(() => {
        if (onOpenSettings) {
            onOpenSettings();
            return;
        }
        setShowSettingsDialog(true);
    }, [onOpenSettings]);
    const handleShowSkills = useCallback(() => {
        if (onOpenSkills) {
            onOpenSkills();
            return;
        }
        setShowSkillsDialog(true);
    }, [onOpenSkills]);
    const handleShowMcp = useCallback(() => {
        if (onOpenMcp) {
            onOpenMcp();
            return;
        }
        setShowMcpDialog(true);
    }, [onOpenMcp]);
    const handleCloseSettings = useCallback(() => setShowSettingsDialog(false), []);
    const handleCloseSkills = useCallback(() => setShowSkillsDialog(false), []);
    const handleCloseMcp = useCallback(() => setShowMcpDialog(false), []);

    if (!activeSession) {
        return (
            <div className="chat-interface">
                <WelcomeSection
                    onNewTask={() => switchToLauncher()}
                    onOpenProject={() => {
                        // TODO: Implement project picker
                    }}
                    onTaskList={() => openDashboard()}
                />
                {(workspaceError || startError || cancelError || sendError || clearError) && (
                    <div className="chat-error">
                        {workspaceError || startError || cancelError || sendError || clearError}
                    </div>
                )}
                <InputArea
                    query={query}
                    placeholder={t('chat.placeholderBuild')}
                    disabled={isStarting}
                    onQueryChange={setQuery}
                    onSubmit={handleSubmit}
                />
            </div>
        );
    }

    return (
        <div className="chat-interface">
            <Header
                title={activeSession?.title || t('chat.currentTask')}
                status={activeSession.status}
                statusLabel={statusLabel}
                llmConfig={llmConfig}
                enabledSkillsCount={enabledSkills.length}
                enabledToolpacksCount={enabledToolpacks.length}
                isClearing={isClearing}
                isCancelling={isCancelling}
                onSetActiveProfile={setActiveProfile}
                onShowSettings={handleShowSettings}
                onShowSkills={handleShowSkills}
                onShowMcp={handleShowMcp}
                onClearHistory={handleClearHistory}
                onCancel={handleCancel}
            />

            {(workspaceError || startError || cancelError || sendError || clearError) && (
                <div className="chat-error">
                    {workspaceError || startError || cancelError || sendError || clearError}
                </div>
            )}

            {/* Timeline Area */}
            <Timeline session={activeSession} />

            <InputArea
                query={query}
                placeholder={activeSession.status === 'running' ? t('chat.taskInProgress') : t('chat.newInstructions')}
                disabled={activeSession.status === 'running' || isSending}
                onQueryChange={setQuery}
                onSubmit={handleSubmit}
            />

            {/* Dialogs */}
            <ModalDialog
                open={showSkillsDialog}
                onClose={handleCloseSkills}
                title={t('chat.manageSkills')}
            >
                <Suspense fallback={<div className="lazy-fallback">Loading...</div>}>
                    <div className="lazy-wrapper">
                        <SkillsViewLazy />
                    </div>
                </Suspense>
            </ModalDialog>

            <ModalDialog
                open={showMcpDialog}
                onClose={handleCloseMcp}
                title={t('chat.manageMcpServers')}
            >
                <Suspense fallback={<div className="lazy-fallback">Loading...</div>}>
                    <div className="lazy-wrapper">
                        <McpViewLazy />
                    </div>
                </Suspense>
            </ModalDialog>

            <ModalDialog
                open={showSettingsDialog}
                onClose={handleCloseSettings}
                title={t('chat.llmSettings')}
            >
                <Suspense fallback={<div className="lazy-fallback">Loading...</div>}>
                    <div className="lazy-wrapper">
                        <SettingsViewLazy />
                    </div>
                </Suspense>
            </ModalDialog>
        </div>
    );
};
