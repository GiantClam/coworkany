/**
 * ChatInterface Component
 *
 * Main chat interface using child components
 */

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ChatInterface.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useStartTask, useCancelTask } from '../../hooks/useStartTask';
import { useActiveSession, useTaskEventStore } from '../../stores/useTaskEventStore';
import { useSkills } from '../../hooks/useSkills';
import { useToolpacks } from '../../hooks/useToolpacks';
import { useResumeInterruptedTask, useSendTaskMessage } from '../../hooks/useSendTaskMessage';
import { useClearTaskHistory } from '../../hooks/useClearTaskHistory';
import { useVoicePlayback } from '../../hooks/useVoicePlayback';
import { useWorkspace } from '../../hooks/useWorkspace';
import { Timeline } from './Timeline/Timeline';
import { ModalDialog } from '../Common/ModalDialog';
import { Header } from './components/Header';
import { InputArea } from './components/InputArea';
import { WelcomeSection } from '../Welcome/WelcomeSection';
import { useFileAttachment } from '../../hooks/useFileAttachment';
import { getPendingTaskStatus } from './Timeline/pendingTaskStatus';
import { getVoiceSettings } from '../../lib/configStore';
import type { TaskEvent } from '../../types';

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
    openai?: { model?: string };
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
    onOpenTasks?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    onOpenSkills,
    onOpenMcp,
    onOpenSettings,
    onOpenTasks,
}) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [workspaceError, setWorkspaceError] = useState<string | null>(null);
    const [showSkillsDialog, setShowSkillsDialog] = useState(false);
    const [showMcpDialog, setShowMcpDialog] = useState(false);
    const [showSettingsDialog, setShowSettingsDialog] = useState(false);

    const activeSession = useActiveSession();
    const createDraftSession = useTaskEventStore((state) => state.createDraftSession);
    const addTaskEvent = useTaskEventStore((state) => state.addEvent);
    const { startTask, isLoading: isStarting, error: startError } = useStartTask();
    const { cancelTask, isLoading: isCancelling, error: cancelError } = useCancelTask();
    const { sendMessage, isLoading: isSending, error: sendError } = useSendTaskMessage();
    const { resumeInterruptedTask, isLoading: isResuming, error: resumeError } = useResumeInterruptedTask();
    const { clearHistory, isLoading: isClearing, error: clearError } = useClearTaskHistory();
    const { voiceState, stopPlayback, isStopping: isStoppingVoice, error: stopVoiceError } = useVoicePlayback();
    const { skills } = useSkills({ autoRefresh: true });
    const { toolpacks } = useToolpacks({ autoRefresh: true });
    const { activeWorkspace, createWorkspace, selectWorkspace, syncWorkspace } = useWorkspace({ autoLoad: true });
    const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
    const {
        attachments,
        error: attachmentError,
        addFiles,
        removeAttachment,
        clearAttachments,
        handlePaste,
        buildContentWithAttachments,
    } = useFileAttachment();
    const voiceSegmentQueueRef = useRef<string[]>([]);
    const processingVoiceSegmentsRef = useRef(false);
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

    const activeModelName = useMemo(() => {
        const activeProfile = llmConfig.profiles?.find((profile) => profile.id === llmConfig.activeProfileId);
        return activeProfile ? activeProfile.name : t('chat.noProfiles');
    }, [llmConfig.activeProfileId, llmConfig.profiles, t]);

    const pendingTaskStatus = useMemo(
        () => activeSession ? getPendingTaskStatus(activeSession) : null,
        [activeSession]
    );
    const canResumeInterruptedTask = activeSession?.failure?.errorCode === 'INTERRUPTED';

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
                switch (pendingTaskStatus?.phase) {
                    case 'waiting_for_model':
                        return t('chat.statusWaitingForModel');
                    case 'running_tool':
                        return t('chat.statusUsingTool', { tool: pendingTaskStatus.toolName ?? t('chat.genericTool') });
                    case 'retrying':
                        return t('chat.statusRetrying');
                    default:
                        return t('chat.statusInProgress');
                }
            case 'finished':
                return t('chat.statusReady');
            case 'failed':
                return t('chat.statusFailed');
            default:
                return t('chat.statusIdle');
        }
    }, [activeSession, pendingTaskStatus, t]);

    const handleClearHistory = useCallback(async () => {
        if (!activeSession?.taskId || activeSession.isDraft) return;
        if (!window.confirm(t('chat.clearConfirm'))) return;
        await clearHistory({ taskId: activeSession.taskId });
    }, [activeSession, clearHistory, t]);

    const handleSelectFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return;
        await addFiles(imageFiles);
    }, [addFiles]);

    const handleInputPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        void handlePaste(event.nativeEvent);
    }, [handlePaste]);

    const handleInputDrop = useCallback((event: React.DragEvent<HTMLFormElement>) => {
        event.preventDefault();
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return;
        void addFiles(imageFiles);
    }, [addFiles]);

    const appendLocalTaskEvent = useCallback((
        taskId: string,
        type: TaskEvent['type'],
        payload: TaskEvent['payload']
    ) => {
        const currentSession = useTaskEventStore.getState().getSession(taskId);
        const event: TaskEvent = {
            id: `local-${type.toLowerCase()}-${crypto.randomUUID()}`,
            taskId,
            sequence: (currentSession?.events.at(-1)?.sequence ?? 0) + 1,
            type,
            timestamp: new Date().toISOString(),
            payload,
        };
        addTaskEvent(event);
        return event;
    }, [addTaskEvent]);

    const submitRequest = useCallback(async (
        text: string,
        options?: { includeAttachments?: boolean }
    ): Promise<boolean> => {
        const includeAttachments = options?.includeAttachments ?? true;
        const trimmedQuery = text.trim();
        if (!trimmedQuery && (!includeAttachments || attachments.length === 0)) return false;
        const requestContent = includeAttachments ? buildContentWithAttachments(text) : trimmedQuery;
        const titleSource = trimmedQuery || (includeAttachments ? attachments[0]?.name : undefined) || t('chat.currentTask');
        const enabledSkillsForRequest = enabledSkills;
        const enabledToolpacksForRequest = enabledToolpacks;

        if (activeSession?.taskId && !activeSession.isDraft) {
            const voiceSettings = await getVoiceSettings();
            const taskId = activeSession.taskId;
            const sentContent = requestContent;
            const sendStartedAt = new Date().toISOString();
            appendLocalTaskEvent(taskId, 'TASK_STATUS', { status: 'running' });
            const result = await sendMessage({
                taskId,
                content: sentContent,
                config: {
                    enabledClaudeSkills: enabledSkillsForRequest,
                    enabledToolpacks: enabledToolpacksForRequest,
                    enabledSkills: enabledSkillsForRequest,
                    voiceProviderMode: voiceSettings.providerMode,
                },
            });
            if (result?.success) {
                window.setTimeout(() => {
                    const currentSession = useTaskEventStore.getState().getSession(taskId);
                    const hasUserEvent = currentSession?.events.some((event) => (
                        event.type === 'CHAT_MESSAGE'
                        && event.timestamp >= sendStartedAt
                        && event.payload?.role === 'user'
                        && event.payload?.content === sentContent
                    )) ?? false;

                    if (hasUserEvent) {
                        return;
                    }

                    const fallbackEvent: TaskEvent = {
                        id: `local-user-${crypto.randomUUID()}`,
                        taskId,
                        sequence: (currentSession?.events.at(-1)?.sequence ?? 0) + 1,
                        type: 'CHAT_MESSAGE',
                        timestamp: new Date().toISOString(),
                        payload: {
                            role: 'user',
                            content: sentContent,
                        },
                    };
                    addTaskEvent(fallbackEvent);
                }, 250);
                setQuery('');
                if (includeAttachments) {
                    clearAttachments();
                }
            } else {
                appendLocalTaskEvent(taskId, 'TASK_FAILED', {
                    error: result?.error ?? t('chat.connectionError'),
                    errorCode: 'SIDECAR_DELIVERY_FAILED',
                    recoverable: true,
                    suggestion: t('chat.connectionError'),
                });
            }
            return result?.success === true;
        }

        const draftTaskId = activeSession?.isDraft ? activeSession.taskId : undefined;

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

                const newWorkspace = await createWorkspace();
                if (newWorkspace) {
                    selectWorkspace(newWorkspace);
                    currentWorkspace = newWorkspace;
                }
            } catch (err) {
                console.error('Failed to auto-create workspace', err);
            }
        }

        if (!currentWorkspace?.path) {
            try {
                const fallbackPath = await invoke<string>('get_default_workspace_path');
                const fallbackWorkspace = {
                    id: crypto.randomUUID(),
                    name: 'New workspace',
                    path: fallbackPath,
                    createdAt: new Date().toISOString(),
                    lastUsedAt: new Date().toISOString(),
                    autoNamed: true,
                    defaultSkills: [],
                    defaultToolpacks: ['builtin-websearch'],
                };
                syncWorkspace(fallbackWorkspace);
                selectWorkspace(fallbackWorkspace);
                currentWorkspace = fallbackWorkspace;
            } catch (err) {
                console.error('Failed to provision fallback workspace', err);
            }
        }

        const currentPath = currentWorkspace?.path;
        if (!currentPath) {
            setWorkspaceError('Workspace path is not available and could not be created.');
            return false;
        }

        setWorkspaceError(null);
        const voiceSettings = await getVoiceSettings();
        const result = await startTask({
            title: titleSource.slice(0, 60),
            userQuery: requestContent,
            workspacePath: currentPath,
            config: {
                enabledClaudeSkills: enabledSkillsForRequest,
                enabledToolpacks: enabledToolpacksForRequest,
                enabledSkills: enabledSkillsForRequest,
                voiceProviderMode: voiceSettings.providerMode,
            },
        }, draftTaskId ? { draftTaskId } : undefined);
        if (result?.success) {
            setQuery('');
            if (includeAttachments) {
                clearAttachments();
            }
        }
        return result?.success === true;
    }, [attachments, buildContentWithAttachments, t, enabledSkills, enabledToolpacks, activeSession, sendMessage, clearAttachments, activeWorkspace, createWorkspace, selectWorkspace, startTask, syncWorkspace, addTaskEvent, appendLocalTaskEvent]);

    const handleSubmit = useCallback(async () => {
        await submitRequest(query, { includeAttachments: true });
    }, [query, submitRequest]);

    const processVoiceSegmentQueue = useCallback(async () => {
        if (processingVoiceSegmentsRef.current) {
            return;
        }

        processingVoiceSegmentsRef.current = true;
        try {
            while (voiceSegmentQueueRef.current.length > 0) {
                const segment = voiceSegmentQueueRef.current.shift()?.trim() || '';
                if (!segment) {
                    continue;
                }

                setQuery(segment);
                const success = await submitRequest(segment, { includeAttachments: false });
                if (!success) {
                    setQuery(segment);
                    break;
                }
            }
        } finally {
            processingVoiceSegmentsRef.current = false;
        }
    }, [submitRequest]);

    const handleVoiceSegment = useCallback((text: string) => {
        const normalized = text.trim();
        if (!normalized) {
            return;
        }

        voiceSegmentQueueRef.current.push(normalized);
        void processVoiceSegmentQueue();
    }, [processVoiceSegmentQueue]);

    const handleCancel = useCallback(async () => {
        if (activeSession?.taskId) {
            await cancelTask({
                taskId: activeSession.taskId,
                reason: 'User cancelled',
            });
        }
    }, [activeSession?.taskId, cancelTask]);

    const handleResumeInterruptedTask = useCallback(async () => {
        if (!activeSession?.taskId || activeSession.isDraft || !canResumeInterruptedTask) {
            return;
        }

        const voiceSettings = await getVoiceSettings();
        const result = await resumeInterruptedTask({
            taskId: activeSession.taskId,
            config: {
                enabledClaudeSkills: enabledSkills,
                enabledToolpacks,
                enabledSkills,
                voiceProviderMode: voiceSettings.providerMode,
            },
        });

        if (result?.success) {
            setQuery('');
            clearAttachments();
        }
    }, [activeSession, canResumeInterruptedTask, clearAttachments, enabledSkills, enabledToolpacks, resumeInterruptedTask]);
    const handleResumeInterruptedTaskClick = useCallback(() => {
        void handleResumeInterruptedTask();
    }, [handleResumeInterruptedTask]);

    const handleStopVoice = useCallback(async () => {
        await stopPlayback();
    }, [stopPlayback]);

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
    const focusComposer = useCallback(() => {
        window.requestAnimationFrame(() => {
            document
                .querySelector<HTMLInputElement | HTMLTextAreaElement>('.chat-input')
                ?.focus();
        });
    }, []);

    const handleCreateSession = useCallback(() => {
        createDraftSession({
            title: t('chat.newSessionTitle'),
            workspacePath: activeWorkspace?.path,
        });
        setWorkspaceError(null);
        setQuery('');
        clearAttachments();
        focusComposer();
    }, [activeWorkspace?.path, clearAttachments, createDraftSession, focusComposer, t]);

    if (!activeSession) {
        return (
            <div className="chat-interface">
                <WelcomeSection
                    onNewTask={focusComposer}
                    onOpenProject={() => {}}
                    onTaskList={onOpenTasks ?? (() => {})}
                />
                {(workspaceError || startError || cancelError || sendError || resumeError || clearError || stopVoiceError) && (
                    <div className="chat-error">
                        {workspaceError || startError || cancelError || sendError || resumeError || clearError || stopVoiceError}
                    </div>
                )}
                <InputArea
                    query={query}
                    placeholder={t('chat.placeholderBuild')}
                    disabled={isStarting}
                    onQueryChange={setQuery}
                    onSubmit={handleSubmit}
                    onVoiceSegment={handleVoiceSegment}
                    attachments={attachments}
                    attachmentError={attachmentError}
                    onRemoveAttachment={removeAttachment}
                    onSelectFiles={handleSelectFiles}
                    onPaste={handleInputPaste}
                    onDrop={handleInputDrop}
                    llmProfiles={llmConfig.profiles ?? []}
                    activeProfileId={llmConfig.activeProfileId}
                    onSelectProfile={setActiveProfile}
                />
            </div>
        );
    }

    return (
        <div className="chat-interface">
            <Header
                title={activeSession?.title || t('chat.newSessionTitle')}
                status={activeSession.status}
                statusLabel={statusLabel}
                modelName={activeModelName}
                enabledSkillsCount={enabledSkills.length}
                enabledToolpacksCount={enabledToolpacks.length}
                isClearing={isClearing}
                isCancelling={isCancelling}
                isSpeaking={voiceState.isSpeaking}
                isStoppingVoice={isStoppingVoice}
                onShowSettings={handleShowSettings}
                onShowSkills={handleShowSkills}
                onShowMcp={handleShowMcp}
                onCreateSession={handleCreateSession}
                onClearHistory={handleClearHistory}
                onCancel={handleCancel}
                onStopVoice={handleStopVoice}
                canClearHistory={!activeSession.isDraft}
            />

            {(workspaceError || startError || cancelError || sendError || resumeError || clearError || stopVoiceError) && (
                <div className="chat-error">
                    {workspaceError || startError || cancelError || sendError || resumeError || clearError || stopVoiceError}
                </div>
            )}

            {/* Timeline Area */}
            <Timeline
                session={activeSession}
                showResumeCard={Boolean(canResumeInterruptedTask)}
                resumeCardTitle={t('chat.resumeInterruptedTitle', {
                    defaultValue: 'Task interrupted, but the saved context is still available.',
                })}
                resumeCardSuggestion={activeSession.failure?.suggestion || t('chat.resumeInterruptedSuggestion', {
                    defaultValue: 'Resume the task to continue from the saved context.',
                })}
                resumeCardActionLabel={t('chat.resumeInterruptedAction', { defaultValue: 'Continue task' })}
                resumeCardActionDisabled={isSending || isStarting || isResuming}
                onResumeCardAction={handleResumeInterruptedTaskClick}
            />

            <InputArea
                query={query}
                placeholder={activeSession.status === 'running' ? t('chat.newInstructions') : t('chat.newInstructions')}
                disabled={isSending || isStarting || isResuming}
                onQueryChange={setQuery}
                onSubmit={handleSubmit}
                onVoiceSegment={handleVoiceSegment}
                attachments={attachments}
                attachmentError={attachmentError}
                onRemoveAttachment={removeAttachment}
                onSelectFiles={handleSelectFiles}
                onPaste={handleInputPaste}
                onDrop={handleInputDrop}
                llmProfiles={llmConfig.profiles ?? []}
                activeProfileId={llmConfig.activeProfileId}
                onSelectProfile={setActiveProfile}
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
