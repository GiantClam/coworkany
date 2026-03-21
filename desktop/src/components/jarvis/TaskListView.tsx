import React from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useVoicePlayback } from '../../hooks/useVoicePlayback';
import { useTaskEventStore, type TaskSession } from '../../stores/useTaskEventStore';
import type { TaskStatus } from '../../types';
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

export function buildBoardTasks(sessions: Iterable<TaskSession>): BoardTask[] {
    return Array.from(sessions)
        .filter((session): session is TaskSession => Boolean(session && typeof session === 'object'))
        .map((session) => ({
            id: getSessionTaskId(session),
            title: deriveTitle(session),
            description: compactText(deriveUserPrompt(session), 180),
            result: deriveResult(session),
            status: session.status,
            updatedAt: session.updatedAt || session.createdAt || '',
        }))
        .sort((a, b) => {
            const aTime = new Date(a.updatedAt).getTime();
            const bTime = new Date(b.updatedAt).getTime();
            const safeA = Number.isNaN(aTime) ? 0 : aTime;
            const safeB = Number.isNaN(bTime) ? 0 : bTime;
            return safeB - safeA;
        });
}

export const TaskListView: React.FC = () => {
    const { t } = useTranslation();
    const { voiceState, stopPlayback, isStopping, error: stopVoiceError } = useVoicePlayback();
    const sessions = useTaskEventStore((state) => state.sessions);
    const hydrate = useTaskEventStore((state) => state.hydrate);
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

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
                    <span className="task-list-kicker">Workflow monitor</span>
                    <h1 className="task-list-title">{t('dashboard.tasks')}</h1>
                    <p className="task-list-subtitle">{t('dashboard.managedBy')}</p>
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

            {stopVoiceError && (
                <div className="task-list-inline-error" role="alert">
                    {stopVoiceError}
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
                                <TaskItem key={task.id} task={task} onSelect={setActiveTask} />
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
                                <TaskItem key={task.id} task={task} onSelect={setActiveTask} />
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

const TaskItem: React.FC<{ task: BoardTask; onSelect: (taskId: string) => void }> = ({ task, onSelect }) => {
    return (
        <button
            type="button"
            className={`task-card ${task.status === 'finished' ? 'completed' : ''}`}
            onClick={() => onSelect(task.id)}
        >
            <div className="task-card-header">
                <div className="task-card-copy">
                    <h3 className="task-card-title">{task.title}</h3>
                    {task.description && (
                        <p className="task-card-description">{task.description}</p>
                    )}
                </div>
                <div className={`task-status-dot ${statusTone[task.status]}`} title={task.status} />
            </div>

            <div className="task-card-meta">
                <span className={`task-priority-pill ${statusTone[task.status]}`}>
                    {formatStatus(task.status)}
                </span>
                <span className="task-card-date">{formatUpdatedAt(task.updatedAt)}</span>
            </div>

            {task.result && (
                <div className="task-card-result">
                    <span className="task-card-result-label">Result</span>
                    <p className="task-card-result-text">{task.result}</p>
                </div>
            )}
        </button>
    );
};
