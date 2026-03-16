import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTaskEventStore } from '../../../stores/useTaskEventStore';
import type { TaskEvent, TaskSession } from '../../../types';
import './TaskExecutionPanel.css';

type TaskSummary = {
    taskId: string;
    title: string;
    status: TaskSession['status'];
    updatedAt: string;
    progress: number;
};

type TaskRuntimeDiagnosticEntry = {
    id: string;
    timestamp: string;
    taskId: string;
    kind: 'task_finished' | 'task_failed' | 'task_resumed';
    severity: 'info' | 'warn' | 'error';
    summary: string;
    errorCode?: string;
    recoverable?: boolean;
};

function summarizeProgress(session: TaskSession): number {
    const total = session.planSteps.length;
    if (total === 0) return session.status === 'finished' ? 100 : 0;
    const done = session.planSteps.filter((step) => step.status === 'complete' || step.status === 'skipped').length;
    return Math.round((done / total) * 100);
}

function describeEvent(event: TaskEvent): string {
    const payload = event.payload as Record<string, unknown>;
    switch (event.type) {
        case 'TASK_STARTED':
            return 'Task started';
        case 'PLAN_UPDATED':
            return 'Plan updated';
        case 'TASK_STATUS':
            return `Status: ${String(payload.status ?? 'unknown')}`;
        case 'TOOL_CALLED':
            return `Calling tool: ${String(payload.toolName ?? 'unknown')}`;
        case 'TOOL_RESULT':
            return payload.success ? 'Tool completed' : `Tool failed: ${String(payload.error ?? 'unknown error')}`;
        case 'TASK_FINISHED':
            return 'Task completed';
        case 'TASK_FAILED':
            return `Task failed: ${String(payload.error ?? 'unknown error')}`;
        case 'RATE_LIMITED':
            return String(payload.message ?? 'Rate limited, retrying');
        case 'CHAT_MESSAGE':
            return String(payload.content ?? 'New message');
        default:
            return event.type;
    }
}

function formatTime(ts: string): string {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describeDiagnostic(entry: TaskRuntimeDiagnosticEntry): string {
    switch (entry.kind) {
        case 'task_resumed':
            return `Recovered: ${entry.summary}`;
        case 'task_finished':
            return `Completed: ${entry.summary}`;
        case 'task_failed':
            return entry.errorCode ? `${entry.summary} (${entry.errorCode})` : entry.summary;
        default:
            return entry.summary;
    }
}

const statusText: Record<TaskSession['status'], string> = {
    idle: 'Idle',
    running: 'Running',
    finished: 'Finished',
    failed: 'Failed',
};

export const TaskExecutionPanel: React.FC<{ variant?: 'sidebar' | 'dialog' }> = ({ variant = 'sidebar' }) => {
    const sessions = useTaskEventStore((state) => state.sessions);
    const activeTaskId = useTaskEventStore((state) => state.activeTaskId);
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);
    const [diagnostics, setDiagnostics] = useState<TaskRuntimeDiagnosticEntry[]>([]);
    const [diagnosticsPath, setDiagnosticsPath] = useState<string | null>(null);

    const orderedTasks = useMemo<TaskSummary[]>(() => {
        return Array.from(sessions.values())
            .map((session) => ({
                taskId: session.taskId,
                title: session.title || 'Untitled task',
                status: session.status,
                updatedAt: session.updatedAt,
                progress: summarizeProgress(session),
            }))
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }, [sessions]);

    const activeSession = useMemo(() => {
        if (!activeTaskId) return undefined;
        return sessions.get(activeTaskId);
    }, [activeTaskId, sessions]);

    const recentEvents = useMemo(() => {
        if (!activeSession) return [];
        return [...activeSession.events]
            .filter((event) => event.type !== 'TEXT_DELTA')
            .slice(-8)
            .reverse();
    }, [activeSession]);

    useEffect(() => {
        let cancelled = false;

        async function loadDiagnostics(): Promise<void> {
            if (!activeSession?.workspacePath || !activeSession.taskId) {
                if (!cancelled) {
                    setDiagnostics([]);
                    setDiagnosticsPath(null);
                }
                return;
            }

            try {
                const result = await invoke<{
                    success: boolean;
                    payload?: { entries?: TaskRuntimeDiagnosticEntry[]; path?: string };
                }>('load_task_runtime_diagnostics', {
                    input: {
                        workspacePath: activeSession.workspacePath,
                        taskId: activeSession.taskId,
                        limit: 6,
                    },
                });

                if (!cancelled) {
                    setDiagnostics(result.payload?.entries ?? []);
                    setDiagnosticsPath(result.payload?.path ?? null);
                }
            } catch {
                if (!cancelled) {
                    setDiagnostics([]);
                    setDiagnosticsPath(null);
                }
            }
        }

        void loadDiagnostics();
        return () => {
            cancelled = true;
        };
    }, [activeSession?.taskId, activeSession?.workspacePath, activeSession?.updatedAt]);

    const openDiagnosticsPath = async (): Promise<void> => {
        if (!diagnosticsPath) {
            return;
        }
        try {
            await invoke('open_local_path', { input: { path: diagnosticsPath } });
        } catch (error) {
            console.warn('Failed to open task diagnostics path:', error);
        }
    };

    return (
        <aside className={`task-panel task-panel-${variant}`}>
            <section className="task-panel-section">
                <div className="task-panel-title-row">
                    <h3 className="task-panel-title">Tasks</h3>
                    <span className="task-panel-count">{orderedTasks.length}</span>
                </div>
                <div className="task-list">
                    {orderedTasks.length === 0 ? (
                        <div className="task-panel-empty">No tasks yet</div>
                    ) : (
                        orderedTasks.map((task) => (
                            <button
                                key={task.taskId}
                                type="button"
                                className={`task-list-item ${activeTaskId === task.taskId ? 'active' : ''}`}
                                onClick={() => setActiveTask(task.taskId)}
                            >
                                <div className="task-list-title">{task.title}</div>
                                <div className="task-list-meta">
                                    <span className={`task-status ${task.status}`}>{statusText[task.status]}</span>
                                    <span>{task.progress}%</span>
                                </div>
                                <div className="task-progress-track">
                                    <div className="task-progress-fill" style={{ width: `${task.progress}%` }} />
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </section>

            <section className="task-panel-section">
                <h3 className="task-panel-title">Progress</h3>
                {!activeSession ? (
                    <div className="task-panel-empty">Select a task to view progress</div>
                ) : activeSession.planSteps.length === 0 ? (
                    <div className="task-panel-empty">Waiting for plan...</div>
                ) : (
                    <div className="step-list">
                        {activeSession.planSteps.map((step) => (
                            <div key={step.id} className="step-item">
                                <span className={`step-dot ${step.status}`} />
                                <span className="step-text">{step.description}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="task-panel-section">
                <div className="task-panel-title-row">
                    <h3 className="task-panel-title">Diagnostics</h3>
                    {diagnosticsPath ? (
                        <button type="button" className="task-panel-link" onClick={openDiagnosticsPath}>
                            Open log
                        </button>
                    ) : null}
                </div>
                {!activeSession ? (
                    <div className="task-panel-empty">No active session</div>
                ) : diagnostics.length === 0 ? (
                    <div className="task-panel-empty">No runtime diagnostics for this task</div>
                ) : (
                    <div className="diagnostic-list">
                        {diagnostics.map((entry) => (
                            <div key={entry.id} className="diagnostic-item">
                                <div className="diagnostic-meta">
                                    <span className={`diagnostic-severity ${entry.severity}`}>{entry.severity}</span>
                                    <span className="feed-time">{formatTime(entry.timestamp)}</span>
                                </div>
                                <span className="feed-text">{describeDiagnostic(entry)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="task-panel-section feedback">
                <h3 className="task-panel-title">Session Feed</h3>
                {!activeSession ? (
                    <div className="task-panel-empty">No active session</div>
                ) : recentEvents.length === 0 ? (
                    <div className="task-panel-empty">Waiting for updates...</div>
                ) : (
                    <div className="feed-list">
                        {recentEvents.map((event) => (
                            <div key={event.id} className="feed-item">
                                <span className="feed-time">{formatTime(event.timestamp)}</span>
                                <span className="feed-text">{describeEvent(event)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </aside>
    );
};
