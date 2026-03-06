import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTasks, Task } from '../../hooks/useTasks';
import { useWorkspace } from '../../hooks/useWorkspace';
import './TaskListView.css';

export const TaskListView: React.FC = () => {
    const { t } = useTranslation();
    const { activeWorkspace } = useWorkspace();
    const { tasks, isLoading, error, refreshTasks } = useTasks(activeWorkspace?.path || null);

    if (!activeWorkspace) {
        return (
            <div className="task-list-empty-shell">
                <div className="task-list-empty-card">{t('dashboard.selectWorkspace')}</div>
            </div>
        );
    }

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

    const pendingTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress');
    const completedTasks = tasks.filter((task) => task.status === 'completed');

    return (
        <div className="task-list-view">
            <div className="task-list-header">
                <div className="task-list-header-copy">
                    <span className="task-list-kicker">Workflow monitor</span>
                    <h1 className="task-list-title">{t('dashboard.tasks')}</h1>
                    <p className="task-list-subtitle">{t('dashboard.managedBy')}</p>
                </div>
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

            <div className="task-list-scroll">
                <section className="task-list-section">
                    <div className="task-list-section-header">
                        <h2 className="task-list-section-title">{t('dashboard.inProgress')}</h2>
                        <span className="task-list-count-pill">{pendingTasks.length}</span>
                    </div>

                    {pendingTasks.length === 0 ? (
                        <div className="task-list-placeholder">{t('dashboard.noActiveTasks')}</div>
                    ) : (
                        <div className="task-list-card-grid">
                            {pendingTasks.map((task) => (
                                <TaskItem key={task.id} task={task} />
                            ))}
                        </div>
                    )}
                </section>

                {completedTasks.length > 0 && (
                    <section className="task-list-section">
                        <div className="task-list-section-header">
                            <h2 className="task-list-section-title muted">{t('dashboard.completed')}</h2>
                            <span className="task-list-count-pill subdued">{completedTasks.length}</span>
                        </div>
                        <div className="task-list-card-grid subdued">
                            {completedTasks.map((task) => (
                                <TaskItem key={task.id} task={task} />
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

const priorityLabels: Record<Task['priority'], string> = {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
};

const statusTone: Record<Task['status'], string> = {
    completed: 'completed',
    in_progress: 'running',
    blocked: 'blocked',
    pending: 'pending',
    cancelled: 'cancelled',
};

const TaskItem: React.FC<{ task: Task }> = ({ task }) => {
    return (
        <div className={`task-card ${task.status === 'completed' ? 'completed' : ''}`}>
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
                <span className={`task-priority-pill ${priorityLabels[task.priority]}`}>
                    {task.priority}
                </span>
                {task.dueDate && (
                    <span className="task-card-date">{new Date(task.dueDate).toLocaleDateString()}</span>
                )}
                {task.tags.map((tag) => (
                    <span key={tag} className="task-tag-pill">
                        #{tag}
                    </span>
                ))}
            </div>
        </div>
    );
};
