import React, { useMemo } from 'react';
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

const statusText: Record<TaskSession['status'], string> = {
    idle: 'Idle',
    running: 'Running',
    finished: 'Finished',
    failed: 'Failed',
};

export const TaskExecutionPanel: React.FC = () => {
    const sessions = useTaskEventStore((state) => state.sessions);
    const activeTaskId = useTaskEventStore((state) => state.activeTaskId);
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);

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

    return (
        <aside className="task-panel">
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
