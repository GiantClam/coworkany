import React from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useSkills } from '../../hooks/useSkills';
import { useToolpacks } from '../../hooks/useToolpacks';
import { useStartTask } from '../../hooks/useStartTask';
import { useSendTaskMessage } from '../../hooks/useSendTaskMessage';
import { useVoicePlayback } from '../../hooks/useVoicePlayback';
import { getVoiceSettings } from '../../lib/configStore';
import { useWorkspace } from '../../hooks/useWorkspace';
import { encodeTaskCollaborationMessage } from '../Chat/collaborationMessage';
import { TaskCardMessage } from '../Chat/Timeline/components/TaskCardMessage';
import { buildTimelineItems } from '../Chat/Timeline/hooks/useTimelineItems';
import { useTaskEventStore, type TaskSession } from '../../stores/useTaskEventStore';
import type { TaskCardItem, TaskStatus } from '../../types';
import './TaskListView.css';

type SessionsSnapshot = {
    sessions: TaskSession[];
    activeTaskId: string | null;
};

type BoardTask = {
    id: string;
    title: string;
    description: string;
    result: string;
    status: TaskStatus;
    updatedAt: string;
    taskCard: TaskCardItem;
};

const UNKNOWN_TASK_ID = 'unknown-task';

function compactText(value: string | undefined, maxLength = 220): string {
    const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function getSessionMessages(session: TaskSession): TaskSession['messages'] {
    return Array.isArray(session.messages) ? session.messages : [];
}

function getSessionEvents(session: TaskSession): TaskSession['events'] {
    return Array.isArray(session.events) ? session.events : [];
}

function getSessionTaskId(session: TaskSession): string {
    if (typeof session.taskId === 'string' && session.taskId.trim().length > 0) {
        return session.taskId;
    }
    return UNKNOWN_TASK_ID;
}

function getUserMessages(session: TaskSession) {
    return getSessionMessages(session).filter((message) => message.role === 'user' && message.content.trim().length > 0);
}

function deriveUserPrompt(session: TaskSession): string {
    const latestUserMessage = [...getUserMessages(session)].pop();
    if (latestUserMessage) {
        return latestUserMessage.content;
    }

    const taskStartedEvent = getSessionEvents(session).find((event) => event.type === 'TASK_STARTED');
    const context = (taskStartedEvent?.payload.context as Record<string, unknown> | undefined) ?? {};
    return typeof context.userQuery === 'string' ? context.userQuery : '';
}

function deriveResult(session: TaskSession): string {
    if ((session.status === 'finished' || session.status === 'failed') && session.summary?.trim().length) {
        return compactText(session.summary, 260);
    }

    const latestRenderableMessage = [...getSessionMessages(session)]
        .reverse()
        .find((message) => (message.role === 'assistant' || message.role === 'system') && message.content.trim().length > 0);

    return compactText(latestRenderableMessage?.content || session.summary, 260);
}

function deriveTitle(session: TaskSession): string {
    const sessionTitle = compactText(session.title, 80);
    const latestUserPrompt = compactText(deriveUserPrompt(session), 80);
    if (latestUserPrompt && getUserMessages(session).length > 1) {
        return latestUserPrompt;
    }

    if (sessionTitle && sessionTitle.toLowerCase() !== 'hi') {
        return sessionTitle;
    }

    if (latestUserPrompt) {
        return latestUserPrompt;
    }

    return `Task ${getSessionTaskId(session).slice(0, 8)}`;
}

function formatStatus(status: TaskStatus): string {
    switch (status) {
        case 'running':
            return 'Running';
        case 'finished':
            return 'Completed';
        case 'failed':
            return 'Failed';
        case 'idle':
        default:
            return 'Waiting';
    }
}

function formatUpdatedAt(timestamp: string): string {
    if (!timestamp) {
        return '';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toLocaleString([], {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function buildBoardTaskCard(session: TaskSession, taskId: string): TaskCardItem {
    const timeline = buildTimelineItems(session);
    const projectedCard = timeline.items.find((item): item is TaskCardItem => item.type === 'task_card');
    if (projectedCard) {
        return { ...projectedCard, taskId };
    }

    const description = compactText(deriveUserPrompt(session), 180);
    const result = deriveResult(session);
    const sections: TaskCardItem['sections'] = [];
    if (description) {
        sections.push({
            label: 'Conversation · Request',
            lines: [description],
        });
    }
    if (result) {
        sections.push({
            label: 'Conversation · Latest response',
            lines: [result],
        });
    }
    if (sections.length === 0) {
        sections.push({
            label: 'Conversation · Status',
            lines: [`Status: ${formatStatus(session.status)}`],
        });
    }

    return {
        type: 'task_card',
        id: `task-board-${taskId}`,
        taskId,
        title: deriveTitle(session),
        subtitle: undefined,
        status: session.status,
        sections,
        result: result ? { summary: result } : undefined,
        timestamp: session.updatedAt || session.createdAt || new Date().toISOString(),
    };
}

export function buildBoardTasks(sessions: Iterable<TaskSession>): BoardTask[] {
    return Array.from(sessions)
        .filter((session): session is TaskSession => Boolean(session && typeof session === 'object'))
        .map((session) => {
            const taskId = getSessionTaskId(session);
            return {
                id: taskId,
                title: deriveTitle(session),
                description: compactText(deriveUserPrompt(session), 180),
                result: deriveResult(session),
                status: session.status,
                updatedAt: session.updatedAt || session.createdAt || '',
                taskCard: buildBoardTaskCard(session, taskId),
            };
        })
        .sort((a, b) => {
            const aTime = new Date(a.updatedAt).getTime();
            const bTime = new Date(b.updatedAt).getTime();
            const safeA = Number.isNaN(aTime) ? 0 : aTime;
            const safeB = Number.isNaN(bTime) ? 0 : bTime;
            return safeB - safeA;
        });
}

interface TaskListViewProps {
    onSwitchToChat?: () => void;
}

export const TaskListView: React.FC<TaskListViewProps> = ({ onSwitchToChat }) => {
    const { t } = useTranslation();
    const { skills } = useSkills({ autoRefresh: true });
    const { toolpacks } = useToolpacks({ autoRefresh: true });
    const { startTask, isLoading: isStartingTask, error: startTaskError } = useStartTask();
    const { sendMessage, error: sendMessageError } = useSendTaskMessage();
    const { voiceState, stopPlayback, isStopping, error: stopVoiceError } = useVoicePlayback();
    const { activeWorkspace } = useWorkspace({ autoLoad: true });
    const sessions = useTaskEventStore((state) => state.sessions);
    const hydrate = useTaskEventStore((state) => state.hydrate);
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);
    const deleteSession = useTaskEventStore((state) => state.deleteSession);
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [taskPrompt, setTaskPrompt] = React.useState('');
    const [launcherError, setLauncherError] = React.useState<string | null>(null);
    const launcherInputRef = React.useRef<HTMLTextAreaElement>(null);

    const refreshTasks = React.useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await invoke<{ success?: boolean; payload?: SessionsSnapshot; error?: string }>('load_sessions');
            if (!response?.success || !response.payload) {
                throw new Error(response?.error || 'Failed to load task sessions');
            }
            hydrate(response.payload);
        } catch (refreshError) {
            console.error('Failed to refresh task board sessions:', refreshError);
            setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        } finally {
            setIsLoading(false);
        }
    }, [hydrate]);

    React.useEffect(() => {
        void refreshTasks();
    }, [refreshTasks]);

    const handleStopVoice = React.useCallback(async () => {
        await stopPlayback();
    }, [stopPlayback]);

    const enabledSkills = React.useMemo(
        () => skills.filter((skill) => skill.enabled).map((skill) => skill.manifest.id),
        [skills]
    );

    const enabledToolpacks = React.useMemo(
        () => toolpacks.filter((tp) => tp.enabled).map((tp) => tp.manifest.id),
        [toolpacks]
    );

    const quickActions = React.useMemo(() => ([
        {
            id: 'research',
            label: t('dashboard.quickResearch'),
            prompt: t('dashboard.quickResearchPrompt'),
        },
        {
            id: 'report',
            label: t('dashboard.quickReport'),
            prompt: t('dashboard.quickReportPrompt'),
        },
        {
            id: 'plan',
            label: t('dashboard.quickPlan'),
            prompt: t('dashboard.quickPlanPrompt'),
        },
        {
            id: 'automation',
            label: t('dashboard.quickAutomation'),
            prompt: t('dashboard.quickAutomationPrompt'),
        },
    ]), [t]);

    const ensureWorkspacePath = React.useCallback(async (): Promise<string | null> => {
        if (activeWorkspace?.path) {
            return activeWorkspace.path;
        }

        try {
            return await invoke<string>('get_default_workspace_path');
        } catch {
            return null;
        }
    }, [activeWorkspace]);

    const submitTaskPrompt = React.useCallback(async () => {
        const normalized = taskPrompt.trim();
        if (!normalized || isStartingTask) {
            return;
        }

        setLauncherError(null);
        const workspacePath = await ensureWorkspacePath();
        if (!workspacePath) {
            setLauncherError(t('dashboard.workspaceUnavailable'));
            return;
        }

        const voiceSettings = await getVoiceSettings();
        const result = await startTask({
            title: normalized.slice(0, 60),
            userQuery: normalized,
            workspacePath,
            config: {
                enabledClaudeSkills: enabledSkills,
                enabledToolpacks,
                enabledSkills,
                voiceProviderMode: voiceSettings.providerMode,
            },
        });

        if (!result?.success) {
            if (result?.error) {
                setLauncherError(result.error);
            }
            return;
        }

        setActiveTask(result.taskId);
        setTaskPrompt('');
    }, [
        taskPrompt,
        isStartingTask,
        ensureWorkspacePath,
        t,
        startTask,
        enabledSkills,
        enabledToolpacks,
        setActiveTask,
    ]);

    const applyQuickAction = React.useCallback((prompt: string) => {
        setTaskPrompt(prompt);
        window.requestAnimationFrame(() => {
            launcherInputRef.current?.focus();
            const valueLength = prompt.length;
            launcherInputRef.current?.setSelectionRange(valueLength, valueLength);
        });
    }, []);

    const handleTaskCardCollaborationSubmit = React.useCallback(async (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => {
        const taskId = input.taskId || UNKNOWN_TASK_ID;
        const message = encodeTaskCollaborationMessage({
            actionId: input.actionId,
            value: input.value,
        });
        if (!message || taskId === UNKNOWN_TASK_ID) {
            return;
        }

        setActiveTask(taskId);
        const voiceSettings = await getVoiceSettings();
        await sendMessage({
            taskId,
            content: message,
            config: {
                enabledClaudeSkills: enabledSkills,
                enabledToolpacks,
                enabledSkills,
                voiceProviderMode: voiceSettings.providerMode,
            },
        });
    }, [enabledSkills, enabledToolpacks, sendMessage, setActiveTask]);

    const handleTaskCardActionClick = React.useCallback(async (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value?: string;
    }) => {
        await handleTaskCardCollaborationSubmit({
            ...input,
            value: input.value || (input.actionId ? `继续执行（${input.actionId}）` : '继续执行'),
        });
    }, [handleTaskCardCollaborationSubmit]);

    const tasks = React.useMemo<BoardTask[]>(() => {
        return buildBoardTasks(sessions.values());
    }, [sessions]);

    if (isLoading && tasks.length === 0) {
        return (
            <div className="task-list-empty-shell">
                <div className="task-list-spinner" aria-label="Loading" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="task-list-empty-shell">
                <div className="task-list-error-card">
                    <p className="task-list-error-title">{t('dashboard.errorLoading')}</p>
                    <code className="task-list-error-code">{error}</code>
                    <button
                        type="button"
                        onClick={() => refreshTasks()}
                        className="task-list-refresh-button"
                    >
                        {t('common.retry')}
                    </button>
                </div>
            </div>
        );
    }

    const activeTasks = tasks.filter((task) => task.status === 'running' || task.status === 'idle');
    const historyTasks = tasks.filter((task) => task.status === 'finished' || task.status === 'failed');

    return (
        <div className="task-list-view">
            <div className="task-list-header">
                <div className="task-list-header-copy">
                    <span className="task-list-kicker">{t('sidebar.tasks')}</span>
                    <h1 className="task-list-title">{t('dashboard.taskModeHeadline')}</h1>
                    <p className="task-list-subtitle">{t('dashboard.taskModeHint')}</p>
                    {voiceState.isSpeaking && (
                        <div className="task-list-voice-banner" role="status" aria-live="polite">
                            <div className="task-list-voice-copy">
                                <span className="task-list-voice-label">{t('chat.voicePlaybackActive')}</span>
                                <p className="task-list-voice-preview">
                                    {voiceState.previewText || t('chat.voicePlaybackNoPreview')}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="task-list-voice-stop-button"
                                onClick={() => handleStopVoice()}
                                disabled={isStopping || !voiceState.canStop}
                            >
                                {isStopping ? t('chat.stoppingVoice') : t('chat.stopVoice')}
                            </button>
                        </div>
                    )}
                </div>
                <div className="task-list-header-actions">
                    <button
                        type="button"
                        onClick={() => refreshTasks()}
                        className="task-list-refresh-icon"
                        title={t('common.refresh')}
                        aria-label={t('common.refresh')}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M23 4v6h-6" />
                            <path d="M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
                            <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
                        </svg>
                    </button>
                </div>
            </div>

            <section className="task-mode-launcher">
                <form
                    className="task-mode-launcher-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submitTaskPrompt();
                    }}
                >
                    <textarea
                        ref={launcherInputRef}
                        className="task-mode-launcher-input"
                        rows={1}
                        value={taskPrompt}
                        onChange={(event) => setTaskPrompt(event.target.value)}
                        placeholder={t('dashboard.taskModePlaceholder')}
                    />
                    <div className="task-mode-launcher-actions">
                        <div className="task-mode-quick-actions" aria-label={t('dashboard.quickActions')}>
                            {quickActions.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    className="task-mode-chip"
                                    onClick={() => applyQuickAction(action.prompt)}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="submit"
                            className="task-mode-submit"
                            disabled={!taskPrompt.trim() || isStartingTask}
                        >
                            {isStartingTask ? t('dashboard.taskModeCreating') : t('dashboard.taskModeRun')}
                        </button>
                    </div>
                </form>
            </section>

            {(stopVoiceError || sendMessageError || launcherError || startTaskError) && (
                <div className="task-list-inline-error" role="alert">
                    {launcherError || startTaskError || stopVoiceError || sendMessageError}
                </div>
            )}

            <div className="task-list-scroll">
                <section className="task-list-section">
                    <div className="task-list-section-header">
                        <h2 className="task-list-section-title">{t('dashboard.inProgress')}</h2>
                        <span className="task-list-count-pill">{activeTasks.length}</span>
                    </div>

                    {activeTasks.length === 0 ? (
                        <div className="task-list-placeholder">{t('dashboard.noActiveTasks')}</div>
                    ) : (
                        <div className="task-list-card-grid">
                            {activeTasks.map((task) => (
                                <TaskBoardTaskCard
                                    key={task.id}
                                    task={task}
                                    onSelect={setActiveTask}
                                    onDelete={deleteSession}
                                    onSwitchToChat={onSwitchToChat}
                                    openLabel={t('dashboard.openInChat')}
                                    deleteLabel={t('common.delete')}
                                    onTaskCollaborationSubmit={handleTaskCardCollaborationSubmit}
                                    onTaskActionClick={handleTaskCardActionClick}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {historyTasks.length > 0 && (
                    <section className="task-list-section">
                        <div className="task-list-section-header">
                            <h2 className="task-list-section-title muted">{t('dashboard.history')}</h2>
                            <span className="task-list-count-pill subdued">{historyTasks.length}</span>
                        </div>
                        <div className="task-list-card-grid subdued">
                            {historyTasks.map((task) => (
                                <TaskBoardTaskCard
                                    key={task.id}
                                    task={task}
                                    onSelect={setActiveTask}
                                    onDelete={deleteSession}
                                    onSwitchToChat={onSwitchToChat}
                                    openLabel={t('dashboard.openInChat')}
                                    deleteLabel={t('common.delete')}
                                    onTaskCollaborationSubmit={handleTaskCardCollaborationSubmit}
                                    onTaskActionClick={handleTaskCardActionClick}
                                />
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

const statusTone: Record<TaskStatus, string> = {
    finished: 'completed',
    running: 'running',
    failed: 'blocked',
    idle: 'pending',
};

const DeleteIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
);

const TaskBoardTaskCard: React.FC<{
    task: BoardTask;
    onSelect: (taskId: string) => void;
    onDelete: (taskId: string) => void;
    onSwitchToChat?: () => void;
    openLabel: string;
    deleteLabel: string;
    onTaskCollaborationSubmit: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void;
    onTaskActionClick: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value?: string;
    }) => void;
}> = ({ task, onSelect, onDelete, onSwitchToChat, openLabel, deleteLabel, onTaskCollaborationSubmit, onTaskActionClick }) => {
    return (
        <div className="task-board-card-shell">
            <div className="task-board-card-toolbar">
                <div className="task-board-card-toolbar-left">
                    <span className={`task-priority-pill ${statusTone[task.status]}`}>
                        {formatStatus(task.status)}
                    </span>
                    <span className="task-card-date">{formatUpdatedAt(task.updatedAt)}</span>
                </div>
                <div className="task-board-card-toolbar-actions">
                    <button
                        type="button"
                        className="task-board-open-button"
                        onClick={() => {
                            onSelect(task.id);
                            onSwitchToChat?.();
                        }}
                    >
                        {openLabel}
                    </button>
                    <button
                        type="button"
                        className="task-board-delete-button"
                        onClick={() => onDelete(task.id)}
                        title={deleteLabel}
                        aria-label={deleteLabel}
                    >
                        <DeleteIcon />
                    </button>
                </div>
            </div>
            <TaskCardMessage
                item={task.taskCard}
                layout="board"
                onTaskCollaborationSubmit={onTaskCollaborationSubmit}
                onTaskActionClick={onTaskActionClick}
            />
        </div>
    );
};
