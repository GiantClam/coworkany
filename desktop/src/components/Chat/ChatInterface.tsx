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
import { useSendTaskMessage } from '../../hooks/useSendTaskMessage';
import { useClearTaskHistory } from '../../hooks/useClearTaskHistory';
import { useWorkspace } from '../../hooks/useWorkspace';
import { Timeline } from './Timeline/Timeline';
import { ModalDialog } from '../Common/ModalDialog';
import { Header } from './components/Header';
import { InputArea } from './components/InputArea';
import { WelcomeSection } from '../Welcome/WelcomeSection';
import { useFileAttachment } from '../../hooks/useFileAttachment';
import type { SystemEventAction } from '../../types';
import { toast } from '../Common/ToastProvider';

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
    anthropic?: { apiKey?: string; model?: string };
    openrouter?: { apiKey?: string; model?: string };
    openai?: { apiKey?: string; baseUrl?: string; model?: string };
    custom?: { apiKey?: string; baseUrl?: string; model?: string; apiFormat?: 'anthropic' | 'openai' };
    ollama?: { baseUrl?: string; model?: string };
    verified: boolean;
};

type LlmConfig = {
    profiles?: LlmProfile[];
    activeProfileId?: string;
    maxHistoryMessages?: number;
};

type ValidateLlmInput = {
    provider: string;
    anthropic?: LlmProfile['anthropic'];
    openrouter?: LlmProfile['openrouter'];
    openai?: LlmProfile['openai'];
    custom?: LlmProfile['custom'];
};

type ValidateLlmResult = {
    success: boolean;
    payload?: {
        message?: string;
        error?: string;
    };
};

type ModelConnectionStatus = 'unknown' | 'checking' | 'connected' | 'failed' | 'unsupported' | 'no_profile';

function buildValidateInput(profile: LlmProfile | undefined): ValidateLlmInput | null {
    if (!profile) return null;
    if (profile.provider === 'ollama') return null;

    return {
        provider: profile.provider,
        anthropic: profile.anthropic,
        openrouter: profile.openrouter,
        openai: profile.openai,
        custom: profile.custom,
    };
}

function isModelTransportError(error: string | null | undefined): boolean {
    if (!error) return false;
    return /MODEL_STREAM_ERROR|openai_error|No output generated|certificate|Improperly formed request|AI_APICallError|Request failed/i.test(error);
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

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
    const [modelConnectionStatus, setModelConnectionStatus] = useState<ModelConnectionStatus>('unknown');
    const [modelConnectionError, setModelConnectionError] = useState<string | null>(null);
    const [isRetryingModelConnection, setIsRetryingModelConnection] = useState(false);
    const modelConnectionCheckSeq = useRef(0);

    const activeSession = useActiveSession();
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);
    const { startTask, isLoading: isStarting, error: startError } = useStartTask();
    const { cancelTask, isLoading: isCancelling, error: cancelError } = useCancelTask();
    const { sendMessage, isLoading: isSending, error: sendError } = useSendTaskMessage();
    const { clearHistory, isLoading: isClearing, error: clearError } = useClearTaskHistory();
    const { skills } = useSkills({ autoRefresh: true });
    const { toolpacks } = useToolpacks({ autoRefresh: true });
    const { activeWorkspace, createWorkspace, selectWorkspace } = useWorkspace({ autoLoad: true });
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

    const activeProfile = useMemo(
        () => llmConfig.profiles?.find((profile) => profile.id === llmConfig.activeProfileId),
        [llmConfig.profiles, llmConfig.activeProfileId]
    );

    const runModelConnectionCheck = useCallback(async (
        profile: LlmProfile | undefined,
        options?: { manual?: boolean; initialDelayMs?: number; maxAttempts?: number },
    ) => {
        const checkSeq = ++modelConnectionCheckSeq.current;

        if (!profile) {
            setModelConnectionStatus('no_profile');
            setModelConnectionError(null);
            setIsRetryingModelConnection(false);
            return;
        }

        const input = buildValidateInput(profile);
        if (!input) {
            setModelConnectionStatus('unsupported');
            setModelConnectionError(null);
            setIsRetryingModelConnection(false);
            return;
        }

        const isManual = Boolean(options?.manual);
        const maxAttempts = options?.maxAttempts ?? (isManual ? 2 : 3);

        if (!isManual && options?.initialDelayMs) {
            await wait(options.initialDelayMs);
            if (checkSeq !== modelConnectionCheckSeq.current) return;
        }

        setIsRetryingModelConnection(isManual);
        setModelConnectionStatus('checking');
        setModelConnectionError(null);

        let lastError = 'Connection failed';
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const result = await invoke<ValidateLlmResult>('validate_llm_settings', { input });
                if (checkSeq !== modelConnectionCheckSeq.current) return;
                if (result.success) {
                    setModelConnectionStatus('connected');
                    setModelConnectionError(null);
                    setIsRetryingModelConnection(false);
                    return;
                }
                lastError = result.payload?.error ?? 'Connection failed';
            } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
            }

            if (attempt < maxAttempts) {
                await wait(700 * attempt);
                if (checkSeq !== modelConnectionCheckSeq.current) return;
            }
        }

        if (checkSeq !== modelConnectionCheckSeq.current) return;
        setModelConnectionStatus('failed');
        setModelConnectionError(lastError);
        setIsRetryingModelConnection(false);
    }, []);

    const activeProfileFingerprint = activeProfile
        ? JSON.stringify({
            id: activeProfile.id,
            provider: activeProfile.provider,
            anthropic: activeProfile.anthropic ?? null,
            openrouter: activeProfile.openrouter ?? null,
            openai: activeProfile.openai ?? null,
            custom: activeProfile.custom ?? null,
        })
        : 'no-profile';

    useEffect(() => {
        void runModelConnectionCheck(activeProfile, { initialDelayMs: 600 });
    }, [activeProfileFingerprint, runModelConnectionCheck]);

    const retryModelConnection = useCallback(() => {
        void runModelConnectionCheck(activeProfile, { manual: true, maxAttempts: 2 });
    }, [activeProfile, runModelConnectionCheck]);

    useEffect(() => {
        const errorCandidates = [startError, sendError, cancelError, clearError];
        const firstModelError = errorCandidates.find((item) => isModelTransportError(item ?? null));
        if (firstModelError) {
            setModelConnectionStatus('failed');
            setModelConnectionError(firstModelError);
        }
    }, [startError, sendError, cancelError, clearError]);

    const modelConnectionLabel = useMemo(() => {
        switch (modelConnectionStatus) {
            case 'checking':
                return t('common.loading');
            case 'connected':
                return 'Connected';
            case 'failed':
                return 'Failed - Retry';
            case 'unsupported':
                return 'Unsupported';
            case 'no_profile':
                return t('chat.noProfiles');
            default:
                return t('common.unknown');
        }
    }, [modelConnectionStatus, t]);

    const canRetryModelConnection = modelConnectionStatus !== 'checking' && modelConnectionStatus !== 'unsupported' && modelConnectionStatus !== 'no_profile';

    const setActiveProfile = useCallback(async (id: string) => {
        try {
            const newConfig = { ...llmConfig, activeProfileId: id };
            await invoke('save_llm_settings', { input: newConfig });
        } catch (err) {
            console.error('Failed to switch profile:', err);
        }
    }, [llmConfig]);

    const handleClearHistory = useCallback(async () => {
        if (!activeSession?.taskId) return;
        if (!window.confirm(t('chat.clearConfirm'))) return;
        await clearHistory({ taskId: activeSession.taskId });
    }, [activeSession?.taskId, clearHistory]);

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

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedQuery = query.trim();
        if (!trimmedQuery && attachments.length === 0) return;
        const requestContent = buildContentWithAttachments(query);
        const titleSource = trimmedQuery || attachments[0]?.name || t('chat.currentTask');
        const enabledSkillsForRequest = enabledSkills;
        const enabledToolpacksForRequest = enabledToolpacks;

        if (activeSession?.taskId) {
            const result = await sendMessage({
                taskId: activeSession.taskId,
                content: requestContent,
                workspacePath: activeWorkspace?.path,
                config: {
                    enabledClaudeSkills: enabledSkillsForRequest,
                    enabledToolpacks: enabledToolpacksForRequest,
                    enabledSkills: enabledSkillsForRequest,
                },
            });
            if (result?.success) {
                setQuery('');
                clearAttachments();
            }
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

                const newWorkspace = await createWorkspace();
                if (newWorkspace) {
                    selectWorkspace(newWorkspace);
                    currentWorkspace = newWorkspace;
                }
            } catch (err) {
                console.error('Failed to auto-create workspace', err);
            }
        }

        const currentPath = currentWorkspace?.path;
        if (!currentPath) {
            setWorkspaceError('Workspace path is not available and could not be created.');
            return;
        }

        setWorkspaceError(null);
        const result = await startTask({
            title: titleSource.slice(0, 60),
            userQuery: requestContent,
            workspacePath: currentPath,
            config: {
                enabledClaudeSkills: enabledSkillsForRequest,
                enabledToolpacks: enabledToolpacksForRequest,
                enabledSkills: enabledSkillsForRequest,
            },
        });
        if (result?.success) {
            setQuery('');
            clearAttachments();
        }
    }, [query, attachments, buildContentWithAttachments, t, enabledSkills, enabledToolpacks, activeSession?.taskId, sendMessage, clearAttachments, activeWorkspace, createWorkspace, selectWorkspace, startTask]);

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
    const focusComposer = useCallback(() => {
        window.requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>('.chat-input')?.focus();
        });
    }, []);

    const handleCreateSession = useCallback(() => {
        setActiveTask(null);
        setWorkspaceError(null);
        setQuery('');
        clearAttachments();
        focusComposer();
    }, [setActiveTask, clearAttachments, focusComposer]);

    const handleSystemAction = useCallback(async (action: SystemEventAction) => {
        if (action.kind === 'copy_text') {
            try {
                await navigator.clipboard.writeText(action.value);
                toast.success('已复制', '启动已登录浏览器所需内容已复制。到系统终端粘贴运行后，再回到这里继续。');
            } catch {
                toast.error('复制失败', '无法复制所需内容，请稍后重试。');
            }
            return;
        }

        if (action.kind === 'send_message') {
            if (!activeSession?.taskId) return;
            const result = await sendMessage({
                taskId: activeSession.taskId,
                content: action.value,
                workspacePath: activeWorkspace?.path || activeSession.workspacePath,
                config: {
                    enabledClaudeSkills: enabledSkills,
                    enabledToolpacks,
                    enabledSkills,
                },
            });
            if (result?.success) {
                toast.success('Sent', 'Follow-up instruction sent.');
            }
        }
    }, [activeSession?.taskId, activeSession?.workspacePath, activeWorkspace?.path, enabledSkills, enabledToolpacks, sendMessage]);

    if (!activeSession) {
        return (
            <div className="chat-interface">
                <WelcomeSection
                    onNewTask={focusComposer}
                    onOpenProject={() => {}}
                    onTaskList={onOpenTasks ?? (() => {})}
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
                title={activeSession?.title || t('chat.currentTask')}
                status={activeSession.status}
                modelConnectionStatus={modelConnectionStatus}
                modelConnectionLabel={modelConnectionLabel}
                modelConnectionError={modelConnectionError}
                canRetryModelConnection={canRetryModelConnection}
                isRetryingModelConnection={isRetryingModelConnection}
                llmConfig={llmConfig}
                enabledSkillsCount={enabledSkills.length}
                enabledToolpacksCount={enabledToolpacks.length}
                isClearing={isClearing}
                isCancelling={isCancelling}
                onCreateSession={handleCreateSession}
                onShowSettings={handleShowSettings}
                onShowSkills={handleShowSkills}
                onShowMcp={handleShowMcp}
                onRetryModelConnection={retryModelConnection}
                onClearHistory={handleClearHistory}
                onCancel={handleCancel}
            />

            {(workspaceError || startError || cancelError || sendError || clearError) && (
                <div className="chat-error">
                    {workspaceError || startError || cancelError || sendError || clearError}
                </div>
            )}

            {/* Timeline Area */}
            <Timeline session={activeSession} onSystemAction={handleSystemAction} />

            <InputArea
                query={query}
                placeholder={activeSession.status === 'running' ? t('chat.taskInProgress') : t('chat.newInstructions')}
                disabled={activeSession.status === 'running' || isSending}
                onQueryChange={setQuery}
                onSubmit={handleSubmit}
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
