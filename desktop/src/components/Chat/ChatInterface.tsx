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
import { useStartTask, useCancelTask, useSpawnSidecar, useShutdownSidecar } from '../../hooks/useStartTask';
import { useActiveSession, useTaskEventStore } from '../../stores/useTaskEventStore';
import { useSkills } from '../../hooks/useSkills';
import { useToolpacks } from '../../hooks/useToolpacks';
import { useSendTaskMessage } from '../../hooks/useSendTaskMessage';
import { useClearTaskHistory } from '../../hooks/useClearTaskHistory';
import { useVoicePlayback } from '../../hooks/useVoicePlayback';
import { useWorkspace } from '../../hooks/useWorkspace';
import { Timeline } from './Timeline/Timeline';
import { ModalDialog } from '../Common/ModalDialog';
import { Header } from './components/Header';
import { InputArea } from './components/InputArea';
import { WelcomeSection, type EntryMode } from '../Welcome/WelcomeSection';
import { useFileAttachment } from '../../hooks/useFileAttachment';
import { getPendingTaskStatus } from './Timeline/pendingTaskStatus';
import { getVoiceSettings } from '../../lib/configStore';
import { encodeTaskCollaborationMessage } from './collaborationMessage';
import { isConversationTurnLocked } from './turnTaking';
import type { TaskEvent } from '../../types';
import { TaskListView } from '../jarvis/TaskListView';

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
}

function isLlmConfigError(error: string | null | undefined): boolean {
    if (!error) return false;
    const lower = error.toLowerCase();
    return lower.includes('missing_api_key')
        || lower.includes('missing_base_url')
        || lower.includes('invalid_api_key')
        || lower.includes('api key')
        || lower.includes('no provider')
        || lower.includes('provider not configured')
        || lower.includes('no llm');
}

function isLikelyCreateTaskIntent(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    return /^(新任务|新建任务|创建任务|开个新任务|另外一个任务|下一任务|new task|create task|start a new task|another task)\b/i.test(trimmed)
        || /^(新任务|新建任务|创建任务)[:：]/i.test(trimmed)
        || /^(new task|create task|start a new task)[:：]/i.test(trimmed);
}

function stripCreateTaskIntentPrefix(text: string): string {
    return text
        .trim()
        .replace(/^(新任务|新建任务|创建任务|开个新任务|另外一个任务|下一任务)\s*[:：-]?\s*/i, '')
        .replace(/^(new task|create task|start a new task|another task)\s*[:：-]?\s*/i, '')
        .trim();
}

export function buildRoutedEntrySourceText(text: string, mode: EntryMode): string {
    const trimmed = text.trim();
    if (!trimmed) {
        return text;
    }

    if (/^\/(?:ask|task|schedule)\b/i.test(trimmed)) {
        return trimmed;
    }

    if (/^__route_(?:chat|task)__$/i.test(trimmed)) {
        return trimmed;
    }

    const route = mode === 'chat' ? 'chat' : 'task';
    return `原始任务：${trimmed}\n用户路由：${route}`;
}

export function parseRouteCommand(text: string): {
    mode: EntryMode | null;
    normalizedQuery: string;
} {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
        return { mode: null, normalizedQuery: text };
    }

    const matched = trimmed.match(/^\/(ask|task|schedule)\b\s*(.*)$/i);
    if (!matched) {
        return { mode: null, normalizedQuery: text };
    }

    const mode: EntryMode = matched[1].toLowerCase() === 'ask' ? 'chat' : 'task';
    const normalizedQuery = matched[2]?.trim() ?? '';
    return {
        mode,
        normalizedQuery,
    };
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
    const [entryMode, setEntryMode] = useState<EntryMode>('chat');
    const [nextRouteMode, setNextRouteMode] = useState<EntryMode | null>(null);
    const [isReconnectingLlm, setIsReconnectingLlm] = useState(false);

    const activeSession = useActiveSession();
    const addTaskEvent = useTaskEventStore((state) => state.addEvent);
    const createDraftSession = useTaskEventStore((state) => state.createDraftSession);
    const { startTask, isLoading: isStarting, error: startError } = useStartTask();
    const { cancelTask, isLoading: isCancelling, error: cancelError } = useCancelTask();
    const { sendMessage, isLoading: isSending, error: sendError } = useSendTaskMessage();
    const { clearHistory, isLoading: isClearing, error: clearError } = useClearTaskHistory();
    const { spawn: spawnSidecar } = useSpawnSidecar();
    const { shutdown: shutdownSidecar } = useShutdownSidecar();
    const { voiceState, stopPlayback, isStopping: isStoppingVoice, error: stopVoiceError } = useVoicePlayback();
    const { skills } = useSkills({ autoRefresh: true });
    const { toolpacks } = useToolpacks({ autoRefresh: true });
    const { activeWorkspace } = useWorkspace({ autoLoad: true });
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
    const isTurnLocked = useMemo(
        () => isConversationTurnLocked(activeSession),
        [activeSession],
    );
    const showInitialEntry = !activeSession || (activeSession.isDraft && activeSession.messages.length === 0);

    useEffect(() => {
        if (!activeSession || activeSession.isDraft) {
            setEntryMode('chat');
            return;
        }
        setNextRouteMode(null);
    }, [activeSession?.taskId, activeSession?.isDraft]);

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

    const appendLocalUserEcho = useCallback((taskId: string, content: string) => {
        const normalized = content.trim();
        if (!normalized) {
            return null;
        }
        return appendLocalTaskEvent(taskId, 'CHAT_MESSAGE', {
            role: 'user',
            content,
            __localEcho: true,
        });
    }, [appendLocalTaskEvent]);

    const submitRequest = useCallback(async (
        text: string,
        options?: { includeAttachments?: boolean }
    ): Promise<boolean> => {
        const includeAttachments = options?.includeAttachments ?? true;
        const trimmedQuery = text.trim();
        const routeCommand = parseRouteCommand(trimmedQuery);
        const createTaskIntent = Boolean(
            activeSession?.taskId
            && !activeSession.isDraft
            && (isLikelyCreateTaskIntent(trimmedQuery) || routeCommand.mode === 'task')
        );
        const normalizedQuery = createTaskIntent ? stripCreateTaskIntentPrefix(trimmedQuery) : trimmedQuery;
        const commandNormalizedQuery = routeCommand.normalizedQuery.trim();
        const effectiveQuery = commandNormalizedQuery || normalizedQuery || trimmedQuery;
        if (!effectiveQuery && (!includeAttachments || attachments.length === 0)) return false;
        const requestContent = includeAttachments ? buildContentWithAttachments(effectiveQuery) : effectiveQuery;
        const routedMode: EntryMode = createTaskIntent
            ? 'task'
            : (routeCommand.mode ?? nextRouteMode ?? entryMode);
        const routedRequestContent = buildRoutedEntrySourceText(
            requestContent,
            routedMode,
        );
        const titleSource = effectiveQuery || (includeAttachments ? attachments[0]?.name : undefined) || t('chat.currentTask');
        const enabledSkillsForRequest = enabledSkills;
        const enabledToolpacksForRequest = enabledToolpacks;

        if (activeSession?.taskId && !activeSession.isDraft && !createTaskIntent) {
            const voiceSettings = await getVoiceSettings();
            const taskId = activeSession.taskId;
            const sentContent = requestContent;
            appendLocalTaskEvent(taskId, 'TASK_STATUS', { status: 'running' });
            appendLocalUserEcho(taskId, sentContent);
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
                setQuery('');
                if (includeAttachments) {
                    clearAttachments();
                }
                setNextRouteMode(null);
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

        const draftTaskId = createTaskIntent ? undefined : (activeSession?.isDraft ? activeSession.taskId : undefined);

        let currentPath = activeWorkspace?.path;
        if (!currentPath) {
            try {
                currentPath = await invoke<string>('get_default_workspace_path');
            } catch (err) {
                console.error('Failed to resolve default workspace path', err);
            }
        }
        if (!currentPath) {
            setWorkspaceError('Workspace path is not available and could not be created.');
            return false;
        }

        setWorkspaceError(null);
        const optimisticDraftTaskId = createTaskIntent
            ? undefined
            : (
                draftTaskId
                ?? (!activeSession
                    ? createDraftSession({
                        title: titleSource.slice(0, 60),
                        workspacePath: currentPath,
                    })
                    : undefined)
            );
        if (optimisticDraftTaskId) {
            appendLocalUserEcho(optimisticDraftTaskId, requestContent);
        }
        const voiceSettings = await getVoiceSettings();
        const result = await startTask({
            title: titleSource.slice(0, 60),
            userQuery: routedRequestContent,
            displayText: requestContent,
            workspacePath: currentPath,
            config: {
                enabledClaudeSkills: enabledSkillsForRequest,
                enabledToolpacks: enabledToolpacksForRequest,
                enabledSkills: enabledSkillsForRequest,
                voiceProviderMode: voiceSettings.providerMode,
            },
        }, optimisticDraftTaskId ? { draftTaskId: optimisticDraftTaskId } : undefined);
        if (result?.success) {
            setQuery('');
            if (includeAttachments) {
                clearAttachments();
            }
            setNextRouteMode(null);
        }
        return result?.success === true;
    }, [attachments, buildContentWithAttachments, t, enabledSkills, enabledToolpacks, activeSession, sendMessage, clearAttachments, activeWorkspace, startTask, appendLocalTaskEvent, appendLocalUserEcho, createDraftSession, entryMode, nextRouteMode]);

    const handleSubmit = useCallback(async () => {
        if (isTurnLocked) {
            return;
        }
        await submitRequest(query, { includeAttachments: true });
    }, [isTurnLocked, query, submitRequest]);

    const handleTaskCardCollaborationSubmit = useCallback(async (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => {
        const message = encodeTaskCollaborationMessage({
            actionId: input.actionId,
            value: input.value,
        });
        if (!message) {
            return;
        }

        if (!activeSession?.taskId || activeSession.taskId === input.taskId) {
            await submitRequest(message, { includeAttachments: false });
            return;
        }

        const voiceSettings = await getVoiceSettings();
        await sendMessage({
            taskId: input.taskId || activeSession.taskId,
            content: message,
            config: {
                enabledClaudeSkills: enabledSkills,
                enabledToolpacks,
                enabledSkills,
                voiceProviderMode: voiceSettings.providerMode,
            },
        });
    }, [activeSession?.taskId, enabledSkills, enabledToolpacks, sendMessage, submitRequest]);

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
    const handleReconnectLlm = useCallback(async () => {
        if (isReconnectingLlm) {
            return;
        }
        setIsReconnectingLlm(true);
        setWorkspaceError(null);
        try {
            try {
                await shutdownSidecar();
            } catch {
                // No-op: best-effort shutdown before spawn.
            }
            await spawnSidecar();
        } catch (error) {
            setWorkspaceError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsReconnectingLlm(false);
        }
    }, [isReconnectingLlm, shutdownSidecar, spawnSidecar]);

    const currentError = workspaceError || startError || cancelError || sendError || clearError || stopVoiceError;
    const showErrorBanner = Boolean(currentError);
    const isLlmError = isLlmConfigError(currentError);
    const suggestedPrompts = useMemo(() => ([
        t('welcome.promptSummarize'),
        t('welcome.promptUseGuide'),
        t('welcome.promptCapabilities'),
    ]), [t]);

    if (showInitialEntry && entryMode === 'task') {
        return (
            <div className="chat-interface">
                <TaskListView
                    onSwitchToChat={() => {
                        setEntryMode('chat');
                    }}
                />
            </div>
        );
    }

    if (showInitialEntry) {
        return (
            <div className="chat-interface">
                <WelcomeSection
                    onFocusInput={focusComposer}
                    mode={entryMode}
                    onModeChange={setEntryMode}
                    onUsePrompt={(prompt) => {
                        setQuery(prompt);
                    }}
                    suggestedPrompts={suggestedPrompts}
                />
                {showErrorBanner && (
                    <div className={`chat-error${isLlmError ? ' chat-error--llm' : ''}`}>
                        <span className="chat-error__text">{currentError}</span>
                        {isLlmError && (
                            <button
                                type="button"
                                className="chat-error__action"
                                onClick={handleShowSettings}
                            >
                                {t('chat.goToSettings', { defaultValue: 'Go to Settings' })}
                            </button>
                        )}
                    </div>
                )}
                <InputArea
                    query={query}
                    placeholder={entryMode === 'chat' ? t('chat.placeholderChatMode') : t('dashboard.taskModePlaceholder')}
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
                    showRouteControls={true}
                    routeMode={nextRouteMode ?? entryMode}
                    onRouteModeChange={(mode) => {
                        setEntryMode(mode);
                        setNextRouteMode(mode);
                    }}
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
                isReconnectingLlm={isReconnectingLlm}
                isSpeaking={voiceState.isSpeaking}
                isStoppingVoice={isStoppingVoice}
                onShowSettings={handleShowSettings}
                onShowSkills={handleShowSkills}
                onShowMcp={handleShowMcp}
                onClearHistory={handleClearHistory}
                onCancel={handleCancel}
                onReconnectLlm={handleReconnectLlm}
                onStopVoice={handleStopVoice}
                canClearHistory={!activeSession.isDraft}
            />

            {(workspaceError || startError || cancelError || sendError || clearError || stopVoiceError) && (
                <div className={`chat-error${isLlmError ? ' chat-error--llm' : ''}`}>
                    <span className="chat-error__text">{workspaceError || startError || cancelError || sendError || clearError || stopVoiceError}</span>
                    {isLlmError && (
                        <button
                            type="button"
                            className="chat-error__action"
                            onClick={handleShowSettings}
                        >
                            {t('chat.goToSettings', { defaultValue: 'Go to Settings' })}
                        </button>
                    )}
                </div>
            )}

            {/* Timeline Area */}
            <Timeline
                session={activeSession}
                onTaskCollaborationSubmit={handleTaskCardCollaborationSubmit}
            />

            <InputArea
                query={query}
                placeholder={isTurnLocked
                    ? t('chat.turnLockedPlaceholder', { defaultValue: '等待 CoworkAny 完成当前回合，需补充时请使用上方输入面板。' })
                    : t('chat.newInstructions')}
                disabled={isTurnLocked || isSending || isStarting}
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
                showRouteControls={Boolean(activeSession?.isDraft)}
                routeMode={nextRouteMode ?? entryMode}
                onRouteModeChange={(mode) => {
                    setEntryMode(mode);
                    setNextRouteMode(mode);
                }}
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
