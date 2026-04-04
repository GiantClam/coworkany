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
import { useResumeInterruptedTask, useSendTaskMessage } from '../../hooks/useSendTaskMessage';
import { useClearTaskHistory } from '../../hooks/useClearTaskHistory';
import { useVoicePlayback } from '../../hooks/useVoicePlayback';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useCanonicalTaskStreamStore } from '../../stores/useCanonicalTaskStreamStore';
import { Timeline } from './Timeline/Timeline';
import { ModalDialog } from '../Common/ModalDialog';
import { Header } from './components/Header';
import { InputArea } from './components/InputArea';
import { WelcomeSection, type EntryMode } from '../Welcome/WelcomeSection';
import { useFileAttachment } from '../../hooks/useFileAttachment';
import { getPendingTaskStatus } from './Timeline/pendingTaskStatus';
import { getVoiceSettings } from '../../lib/configStore';
import {
    encodeTaskCollaborationMessage,
    ROUTE_CHAT_TOKEN,
    ROUTE_TASK_TOKEN,
} from './collaborationMessage';
import { isConversationTurnLocked, TURN_LOCK_IDLE_GRACE_MS } from './turnTaking';
import { getTaskFailureUiDescriptor } from '../../lib/taskFailureUi';
import type { TaskEvent, TaskSession } from '../../types';
import { TaskListView } from '../jarvis/TaskListView';
import {
    taskEventToCanonicalStreamEvents,
    type TaskEvent as SidecarTaskEvent,
} from '../../../../sidecar/src/protocol';

const STATUS_FINISH_DISPLAY_GRACE_MS = 2000;
const RUNNING_STALL_WATCHDOG_MS = 180_000;

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

function extractOriginalTaskFromRoutedQuery(value: string): string | null {
    const tokenMatched = value.match(/^\s*__route_(?:chat|task)__\s*(?:\n+|[\t ]+)([\s\S]*)$/iu);
    const tokenCandidate = tokenMatched?.[1]?.trim();
    if (tokenCandidate && tokenCandidate.length > 0) {
        return tokenCandidate;
    }

    const legacyPatterns = [
        /^\s*原始任务[:：]\s*(.+?)(?:\n|$)/u,
        /^\s*original task[:：]\s*(.+?)(?:\n|$)/iu,
    ];
    for (const pattern of legacyPatterns) {
        const matched = value.match(pattern);
        const candidate = matched?.[1]?.trim();
        if (candidate && candidate.length > 0) {
            return candidate;
        }
    }

    if (/^\s*__route_(?:chat|task)__\s*$/iu.test(value)) {
        return '';
    }

    return null;
}

function resolveDisplayTaskText(value: string): string | null {
    const extracted = extractOriginalTaskFromRoutedQuery(value);
    if (extracted === '') {
        return null;
    }
    if (extracted) {
        return extracted;
    }
    const trimmed = value.trim();
    if (!trimmed || /^__route_(?:chat|task)__$/iu.test(trimmed)) {
        return null;
    }
    return value;
}

function getInterruptedRecoveryCopy(
    session: ReturnType<typeof useActiveSession>
): { title: string; description: string } | null {
    if (!session?.failure?.recoverable) {
        return null;
    }

    const errorCode = session.failure.errorCode?.toUpperCase();
    const combined = [
        session.failure.error,
        session.failure.suggestion,
        session.summary,
    ].filter(Boolean).join(' ').toLowerCase();
    const isInterrupted = errorCode === 'INTERRUPTED'
        || combined.includes('task interrupted')
        || combined.includes('interrupted by app restart');

    if (!isInterrupted) {
        return null;
    }

    return {
        title: session.failure.error || 'Task interrupted by app restart',
        description: 'Task interrupted, but the saved context is still available. Resume the task to continue from the saved context.',
    };
}

function hasAssistantResponseAfterLatestUser(
    session: ReturnType<typeof useActiveSession>
): boolean {
    if (!session) {
        return false;
    }

    for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index];
        const payload = event.payload as Record<string, unknown>;

        if (event.type === 'TASK_STARTED' || (event.type === 'CHAT_MESSAGE' && payload.role === 'user')) {
            return false;
        }

        if (
            event.type === 'TEXT_DELTA'
            && payload.role !== 'thinking'
            && typeof payload.delta === 'string'
            && payload.delta.length > 0
        ) {
            return true;
        }

        if (
            event.type === 'CHAT_MESSAGE'
            && payload.role === 'assistant'
            && typeof payload.content === 'string'
            && payload.content.trim().length > 0
        ) {
            return true;
        }
    }

    return false;
}

function normalizeComparableMessage(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function getUserBoundaryContent(event: TaskEvent): string | null {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'CHAT_MESSAGE') {
        if (payload.role !== 'user') {
            return null;
        }
        if (payload.__localEcho === true) {
            return null;
        }
        return typeof payload.content === 'string' ? payload.content : null;
    }

    if (event.type === 'TASK_STARTED') {
        const context = (payload.context as Record<string, unknown> | undefined) ?? {};
        const displayText = typeof context.displayText === 'string' ? context.displayText : '';
        if (displayText.trim().length > 0) {
            return displayText;
        }
        const userQuery = typeof context.userQuery === 'string' ? context.userQuery : '';
        if (userQuery.trim().length > 0) {
            return resolveDisplayTaskText(userQuery);
        }
        if (typeof payload.description === 'string' && payload.description.trim().length > 0) {
            return resolveDisplayTaskText(payload.description);
        }
    }

    return null;
}

function hasConfirmedUserBoundary(
    session: ReturnType<typeof useActiveSession>,
    content: string
): boolean {
    if (!session) {
        return false;
    }
    const expected = normalizeComparableMessage(content);
    if (!expected) {
        return false;
    }

    return session.events.some((event) => {
        const boundary = getUserBoundaryContent(event);
        if (!boundary) {
            return false;
        }
        return normalizeComparableMessage(boundary) === expected;
    });
}

export function buildRoutedEntrySourceText(
    text: string,
    mode: EntryMode,
    options?: { forceRoute?: boolean },
): string {
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

    const forceRoute = options?.forceRoute ?? mode === 'task';
    if (!forceRoute) {
        return trimmed;
    }

    const routeToken = mode === 'chat' ? ROUTE_CHAT_TOKEN : ROUTE_TASK_TOKEN;
    return `${routeToken}\n${trimmed}`;
}

export function shouldForceRouteEnvelope(input: {
    routedMode: EntryMode;
    explicitRouteMode: EntryMode | null;
    nextRouteMode: EntryMode | null;
    activeTaskMode?: TaskSession['taskMode'];
}): boolean {
    if (input.routedMode === 'task') {
        return true;
    }
    if (input.explicitRouteMode !== null || input.nextRouteMode !== null) {
        return true;
    }
    return input.routedMode === 'chat'
        && Boolean(input.activeTaskMode)
        && input.activeTaskMode !== 'chat';
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

export function isRunningSessionStalled(
    session: Pick<TaskSession, 'status' | 'updatedAt' | 'failure' | 'suspension' | 'isDraft'>,
    nowMs: number,
    stallMs: number = RUNNING_STALL_WATCHDOG_MS
): boolean {
    if (
        session.isDraft
        || session.status !== 'running'
        || Boolean(session.failure)
        || Boolean(session.suspension)
    ) {
        return false;
    }

    const updatedAtMs = Date.parse(session.updatedAt);
    if (Number.isNaN(updatedAtMs)) {
        return false;
    }

    return nowMs - updatedAtMs >= stallMs;
}

export type RunningStallReason =
    | 'tool_call_timeout'
    | 'provider_retry_timeout'
    | 'model_response_timeout';

export function resolveRunningStallReason(
    session: Pick<TaskSession, 'status' | 'events'>
): RunningStallReason {
    const pending = getPendingTaskStatus(session);
    if (pending?.phase === 'running_tool') {
        return 'tool_call_timeout';
    }
    if (pending?.phase === 'retrying') {
        return 'provider_retry_timeout';
    }
    return 'model_response_timeout';
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
    const [turnLockTick, setTurnLockTick] = useState(0);
    const [optimisticUserEntry, setOptimisticUserEntry] = useState<{
        taskId: string;
        id: string;
        content: string;
        timestamp: string;
    } | null>(null);

    const activeSession = useActiveSession();
    const addTaskEvent = useTaskEventStore((state) => state.addEvent);
    const createDraftSession = useTaskEventStore((state) => state.createDraftSession);
    const { startTask, isLoading: isStarting, error: startError } = useStartTask();
    const { cancelTask, isLoading: isCancelling, error: cancelError } = useCancelTask();
    const { sendMessage, isLoading: isSending, error: sendError } = useSendTaskMessage();
    const { resumeInterruptedTask, isLoading: isResumingInterruptedTask, error: resumeError } = useResumeInterruptedTask();
    const { clearHistory, isLoading: isClearing, error: clearError } = useClearTaskHistory();
    const clearCanonicalSession = useCanonicalTaskStreamStore((state) => state.clearSession);
    const addCanonicalEvents = useCanonicalTaskStreamStore((state) => state.addEvents);
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
    const recentFinishedGraceActive = useMemo(() => {
        if (!activeSession || activeSession.status !== 'finished' || activeSession.failure) {
            return false;
        }
        const updatedAtMs = Date.parse(activeSession.updatedAt);
        if (Number.isNaN(updatedAtMs)) {
            return false;
        }
        return Date.now() - updatedAtMs < STATUS_FINISH_DISPLAY_GRACE_MS;
    }, [activeSession, turnLockTick]);
    const headerStatus = useMemo<'idle' | 'running' | 'finished' | 'failed'>(() => {
        if (!activeSession) {
            return 'idle';
        }
        if (activeSession.status === 'failed') {
            return 'failed';
        }
        if (activeSession.status === 'suspended') {
            return 'failed';
        }
        if (activeSession.failure) {
            return 'failed';
        }
        if (recentFinishedGraceActive) {
            return 'running';
        }
        if (activeSession.status === 'running') {
            return 'running';
        }
        return activeSession.status;
    }, [activeSession, recentFinishedGraceActive]);
    useEffect(() => {
        if (!activeSession) {
            return undefined;
        }

        const updatedAtMs = Date.parse(activeSession.updatedAt);
        if (Number.isNaN(updatedAtMs)) {
            return undefined;
        }

        let remainingMs: number | null = null;
        if (activeSession.status === 'running' && !pendingTaskStatus) {
            remainingMs = TURN_LOCK_IDLE_GRACE_MS - (Date.now() - updatedAtMs);
        } else if (activeSession.status === 'finished' && !activeSession.failure) {
            remainingMs = STATUS_FINISH_DISPLAY_GRACE_MS - (Date.now() - updatedAtMs);
        }

        if (remainingMs === null) {
            return undefined;
        }
        if (remainingMs <= 0) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setTurnLockTick((value) => value + 1);
        }, remainingMs + 16);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [activeSession?.taskId, activeSession?.status, activeSession?.updatedAt, activeSession?.failure, pendingTaskStatus]);

    const isTurnLocked = useMemo(
        () => isConversationTurnLocked(activeSession, pendingTaskStatus, Date.now()),
        [activeSession, pendingTaskStatus, turnLockTick],
    );
    const showInitialEntry = !activeSession || (activeSession.isDraft && activeSession.messages.length === 0);
    const interruptedRecovery = useMemo(
        () => getInterruptedRecoveryCopy(activeSession),
        [activeSession]
    );
    const activeFailureDescriptor = useMemo(
        () => getTaskFailureUiDescriptor(activeSession),
        [activeSession],
    );

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
        switch (headerStatus) {
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
                if (activeFailureDescriptor?.category === 'configuration_required') {
                    return t('chat.statusFailedNeedsConfig', { defaultValue: 'Configuration required' });
                }
                if (activeFailureDescriptor?.category === 'retryable') {
                    return t('chat.statusFailedRetryable', { defaultValue: 'Retry available' });
                }
                return t('chat.statusFailed');
            default:
                return t('chat.statusIdle');
        }
    }, [activeFailureDescriptor?.category, activeSession, headerStatus, pendingTaskStatus, t]);

    const applyLocalTaskHistoryClear = useCallback((taskId: string) => {
        const currentSession = useTaskEventStore.getState().getSession(taskId);
        const clearedAt = new Date().toISOString();
        addTaskEvent({
            id: `local-task-history-cleared-${crypto.randomUUID()}`,
            taskId,
            sequence: (currentSession?.events.at(-1)?.sequence ?? 0) + 1,
            timestamp: clearedAt,
            type: 'TASK_HISTORY_CLEARED',
            payload: {
                reason: 'user_requested',
                source: 'chat_header',
            },
        });
        clearCanonicalSession(taskId);
        setOptimisticUserEntry((current) => (current?.taskId === taskId ? null : current));
    }, [addTaskEvent, clearCanonicalSession]);

    const handleClearHistory = useCallback(async () => {
        if (!activeSession?.taskId) return;

        const taskId = activeSession.taskId;
        applyLocalTaskHistoryClear(taskId);

        if (!activeSession.isDraft) {
            const result = await clearHistory({ taskId });
            if (!result?.success) {
                console.warn('[ChatInterface] clear_task_history backend request failed; local session already cleared.', {
                    taskId,
                    error: result?.error ?? 'unknown_error',
                });
            }
        }
    }, [activeSession, applyLocalTaskHistoryClear, clearHistory]);

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
        const canonicalEvents = taskEventToCanonicalStreamEvents(event as unknown as SidecarTaskEvent);
        if (canonicalEvents.length > 0) {
            addCanonicalEvents(canonicalEvents);
        }
        return event;
    }, [addCanonicalEvents, addTaskEvent]);

    const stageOptimisticUserEcho = useCallback((taskId: string, content: string) => {
        const normalized = content.trim();
        if (!normalized) {
            return null;
        }
        const entry = {
            taskId,
            id: `optimistic-user-${crypto.randomUUID()}`,
            content: normalized,
            timestamp: new Date().toISOString(),
        };
        setOptimisticUserEntry(entry);
        return entry;
    }, []);

    useEffect(() => {
        if (!optimisticUserEntry || !activeSession || activeSession.taskId !== optimisticUserEntry.taskId) {
            return;
        }

        if (hasConfirmedUserBoundary(activeSession, optimisticUserEntry.content)) {
            setOptimisticUserEntry((current) => {
                if (!current || current.id !== optimisticUserEntry.id) {
                    return current;
                }
                return null;
            });
        }
    }, [activeSession, optimisticUserEntry]);

    useEffect(() => {
        if (
            !activeSession
            || activeSession.isDraft
            || activeSession.status !== 'running'
            || activeSession.failure
            || activeSession.suspension
        ) {
            return;
        }

        const updatedAtMs = Date.parse(activeSession.updatedAt);
        if (Number.isNaN(updatedAtMs)) {
            return;
        }

        const triggerWatchdog = () => {
            const latestSession = useTaskEventStore.getState().getSession(activeSession.taskId);
            if (
                !latestSession
                || latestSession.isDraft
                || latestSession.status !== 'running'
                || latestSession.failure
                || latestSession.suspension
            ) {
                return;
            }
            if (!isRunningSessionStalled(latestSession, Date.now(), RUNNING_STALL_WATCHDOG_MS)) {
                return;
            }

            const reason = resolveRunningStallReason(latestSession);

            appendLocalTaskEvent(latestSession.taskId, 'TASK_SUSPENDED', {
                reason,
                userMessage: t('chat.stalledSuspended'),
                canAutoResume: false,
                maxWaitTimeMs: RUNNING_STALL_WATCHDOG_MS,
            });
        };

        const remainingMs = RUNNING_STALL_WATCHDOG_MS - (Date.now() - updatedAtMs);
        const timeoutId = window.setTimeout(
            triggerWatchdog,
            Math.max(remainingMs, 0) + 32
        );

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [
        activeSession?.taskId,
        activeSession?.status,
        activeSession?.updatedAt,
        activeSession?.failure,
        activeSession?.suspension,
        activeSession?.isDraft,
        appendLocalTaskEvent,
        t,
    ]);

    const activeOptimisticUserEntry = useMemo(() => {
        if (!optimisticUserEntry || !activeSession || optimisticUserEntry.taskId !== activeSession.taskId) {
            return null;
        }
        return {
            id: optimisticUserEntry.id,
            content: optimisticUserEntry.content,
            timestamp: optimisticUserEntry.timestamp,
        };
    }, [activeSession, optimisticUserEntry]);

    const hasAssistantResponseInActiveTurn = useMemo(
        () => hasAssistantResponseAfterLatestUser(activeSession),
        [activeSession]
    );

    useEffect(() => {
        if (!hasAssistantResponseInActiveTurn) {
            return;
        }
        setOptimisticUserEntry((current) => {
            if (!current || !activeSession || current.taskId !== activeSession.taskId) {
                return current;
            }
            if (hasConfirmedUserBoundary(activeSession, current.content)) {
                return null;
            }
            return current;
        });
    }, [activeSession, hasAssistantResponseInActiveTurn]);

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
            {
                forceRoute: shouldForceRouteEnvelope({
                    routedMode,
                    explicitRouteMode: routeCommand.mode,
                    nextRouteMode,
                    activeTaskMode: activeSession?.taskMode,
                }),
            },
        );
        const executionPath = routedMode === 'chat' ? 'direct' : 'workflow';
        const titleSource = effectiveQuery || (includeAttachments ? attachments[0]?.name : undefined) || t('chat.currentTask');
        const enabledSkillsForRequest = enabledSkills;
        const enabledToolpacksForRequest = enabledToolpacks;

        if (activeSession?.taskId && !activeSession.isDraft && !createTaskIntent) {
            const voiceSettings = await getVoiceSettings();
            const taskId = activeSession.taskId;
            const sentContent = requestContent;
            setWorkspaceError(null);
            stageOptimisticUserEcho(taskId, sentContent);
            appendLocalTaskEvent(taskId, 'CHAT_MESSAGE', {
                role: 'user',
                content: sentContent,
                __localEcho: true,
            });
            appendLocalTaskEvent(taskId, 'TASK_STATUS', {
                status: 'running',
            });
            const result = await sendMessage({
                taskId,
                content: routedRequestContent,
                config: {
                    executionPath,
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
                appendLocalTaskEvent(taskId, 'TASK_STATUS', {
                    status: 'idle',
                });
                setWorkspaceError(result?.error ?? t('chat.connectionError'));
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
            stageOptimisticUserEcho(optimisticDraftTaskId, requestContent);
        }
        const voiceSettings = await getVoiceSettings();
        const result = await startTask({
            title: titleSource.slice(0, 60),
            userQuery: routedRequestContent,
            displayText: requestContent,
            workspacePath: currentPath,
            config: {
                executionPath,
                enabledClaudeSkills: enabledSkillsForRequest,
                enabledToolpacks: enabledToolpacksForRequest,
                enabledSkills: enabledSkillsForRequest,
                voiceProviderMode: voiceSettings.providerMode,
            },
        }, optimisticDraftTaskId ? { draftTaskId: optimisticDraftTaskId } : undefined);
        if (result?.success) {
            if (optimisticDraftTaskId && result.taskId !== optimisticDraftTaskId) {
                setOptimisticUserEntry((current) => {
                    if (!current || current.taskId !== optimisticDraftTaskId) {
                        return current;
                    }
                    return {
                        ...current,
                        taskId: result.taskId,
                    };
                });
            }
            setQuery('');
            if (includeAttachments) {
                clearAttachments();
            }
            setNextRouteMode(null);
        }
        return result?.success === true;
    }, [attachments, buildContentWithAttachments, t, enabledSkills, enabledToolpacks, activeSession, sendMessage, clearAttachments, activeWorkspace, startTask, stageOptimisticUserEcho, appendLocalTaskEvent, createDraftSession, entryMode, nextRouteMode]);

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

    const handleRetryFailedTask = useCallback(async () => {
        if (!activeSession || (activeSession.status !== 'failed' && activeSession.status !== 'suspended')) {
            return;
        }
        const latestUserMessage = [...activeSession.messages]
            .reverse()
            .find((message) => (
                message.role === 'user'
                && message.content.trim().length > 0
                && !message.content.trim().startsWith('[RESUME_REQUESTED]')
            ));
        if (!latestUserMessage) {
            await handleReconnectLlm();
            return;
        }
        const voiceSettings = await getVoiceSettings();
        setWorkspaceError(null);
        stageOptimisticUserEcho(activeSession.taskId, latestUserMessage.content);
        const result = await sendMessage({
            taskId: activeSession.taskId,
            content: latestUserMessage.content,
            bypassDedup: true,
            config: {
                enabledClaudeSkills: enabledSkills,
                enabledToolpacks,
                enabledSkills,
                voiceProviderMode: voiceSettings.providerMode,
            },
        });
        if (!result?.success) {
            setWorkspaceError(result?.error ?? t('chat.connectionError'));
        }
    }, [activeSession, enabledSkills, enabledToolpacks, handleReconnectLlm, sendMessage, stageOptimisticUserEcho, t]);

    const handleContinueInterruptedTask = useCallback(async () => {
        if (!activeSession?.taskId || !interruptedRecovery) {
            return;
        }

        setWorkspaceError(null);
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
        if (!result?.success && result?.error) {
            setWorkspaceError(result.error);
        }
    }, [activeSession?.taskId, enabledSkills, enabledToolpacks, interruptedRecovery, resumeInterruptedTask]);

    const currentError = workspaceError || startError || cancelError || sendError || resumeError || clearError || stopVoiceError;
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
                    routeMode={nextRouteMode ?? entryMode}
                />
            </div>
        );
    }

    return (
        <div className="chat-interface chat-interface--thread">
            <Header
                title={activeSession?.title || t('chat.newSessionTitle')}
                status={headerStatus}
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
                onRetryFailedTask={handleRetryFailedTask}
                onStopVoice={handleStopVoice}
                canClearHistory={Boolean(activeSession?.taskId)}
                failedAction={activeFailureDescriptor?.action === 'settings'
                    ? 'settings'
                    : activeFailureDescriptor?.action === 'retry'
                        ? 'retry'
                        : 'reconnect'}
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

            {interruptedRecovery && (
                <div className="chat-recovery-banner" role="status" aria-live="polite">
                    <div className="chat-recovery-banner__copy">
                        <strong className="chat-recovery-banner__title">{interruptedRecovery.title}</strong>
                        <span className="chat-recovery-banner__description">{interruptedRecovery.description}</span>
                    </div>
                    <button
                        type="button"
                        className="status-action accent"
                        onClick={handleContinueInterruptedTask}
                        disabled={isResumingInterruptedTask}
                    >
                        {t('chat.continueTask', { defaultValue: 'Continue task' })}
                    </button>
                </div>
            )}

            {(activeSession.status === 'failed' || activeSession.status === 'suspended') && activeFailureDescriptor && (
                <div className="chat-recovery-banner" role="status" aria-live="polite">
                    <div className="chat-recovery-banner__copy">
                        <strong className="chat-recovery-banner__title">
                            {t(activeFailureDescriptor.titleKey, { defaultValue: activeFailureDescriptor.titleDefault })}
                        </strong>
                        <span className="chat-recovery-banner__description">
                            {activeSession.failure?.suggestion
                                || t(activeFailureDescriptor.descriptionKey, { defaultValue: activeFailureDescriptor.descriptionDefault })}
                        </span>
                    </div>
                    <button
                        type="button"
                        className="status-action accent"
                        onClick={() => {
                            if (activeFailureDescriptor.action === 'settings') {
                                handleShowSettings();
                                return;
                            }
                            void handleRetryFailedTask();
                        }}
                    >
                        {t(activeFailureDescriptor.actionLabelKey, { defaultValue: activeFailureDescriptor.actionLabelDefault })}
                    </button>
                </div>
            )}

            {/* Timeline Area */}
            <Timeline
                session={activeSession}
                optimisticUserEntry={activeOptimisticUserEntry}
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
                routeMode={nextRouteMode ?? entryMode}
                isRunning={activeSession.status === 'running'}
                isInterrupting={isCancelling}
                onInterrupt={handleCancel}
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
