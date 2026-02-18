import React from 'react';
import { useTasks, Task } from '../../hooks/useTasks';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useTranslation } from 'react-i18next';

export const TaskListView: React.FC = () => {
    const { t } = useTranslation();
    const { activeWorkspace } = useWorkspace();
    const { tasks, isLoading, error, refreshTasks } = useTasks(activeWorkspace?.path || null);
    // Maybe use 'useStartTask' to complete tasks? No, we need 'updateTask' or 'completeTask' which isn't hooked yet.
    // For now, read-only view.

    if (!activeWorkspace) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500">
                {t('dashboard.selectWorkspace')}
            </div>
        );
    }

    if (isLoading && tasks.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-red-500 p-4">
                <p>{t('dashboard.errorLoading')}</p>
                <code className="bg-red-50 p-2 rounded mt-2 text-sm">{error}</code>
                <button
                    onClick={() => refreshTasks()}
                    className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 rounded transition"
                >
                    {t('common.retry')}
                </button>
            </div>
        );
    }

    const pendingTasks = tasks.filter(task => task.status === 'pending' || task.status === 'in_progress');
    const completedTasks = tasks.filter(task => task.status === 'completed');

    return (
        <div className="h-full flex flex-col bg-white overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-800">{t('dashboard.tasks')}</h1>
                    <p className="text-sm text-gray-500 mt-1">{t('dashboard.managedBy')}</p>
                </div>
                <button
                    onClick={() => refreshTasks()}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition"
                    title={t('common.refresh')}
                >
                    ↻
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Active Tasks */}
                <section>
                    <h2 className="text-lg font-medium text-gray-700 mb-4 flex items-center">
                        {t('dashboard.inProgress')}
                        <span className="ml-2 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                            {pendingTasks.length}
                        </span>
                    </h2>

                    {pendingTasks.length === 0 ? (
                        <div className="text-gray-400 italic text-sm py-4">{t('dashboard.noActiveTasks')}</div>
                    ) : (
                        <div className="space-y-3">
                            {pendingTasks.map(task => (
                                <TaskItem key={task.id} task={task} />
                            ))}
                        </div>
                    )}
                </section>

                {/* Completed Tasks */}
                {completedTasks.length > 0 && (
                    <section>
                        <h2 className="text-lg font-medium text-gray-700 mb-4 opacity-75">{t('dashboard.completed')}</h2>
                        <div className="space-y-3 opacity-60">
                            {completedTasks.map(task => (
                                <TaskItem key={task.id} task={task} />
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

const TaskItem: React.FC<{ task: Task }> = ({ task }) => {
    const priorityColors = {
        critical: 'border-red-500 bg-red-50 text-red-700',
        high: 'border-orange-500 bg-orange-50 text-orange-700',
        medium: 'border-blue-500 bg-blue-50 text-blue-700',
        low: 'border-gray-300 bg-gray-50 text-gray-600',
    };

    return (
        <div className="group bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow relative">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                        {task.title}
                    </h3>
                    {task.description && (
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                        <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${priorityColors[task.priority]}`}>
                            {task.priority}
                        </span>
                        {task.dueDate && (
                            <span className="text-xs text-gray-400 flex items-center">
                                📅 {new Date(task.dueDate).toLocaleDateString()}
                            </span>
                        )}
                        {task.tags.map(tag => (
                            <span key={tag} className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                #{tag}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Status Indicator */}
                <div className={`w-2 h-2 rounded-full mt-2 ${task.status === 'completed' ? 'bg-green-500' :
                    task.status === 'in_progress' ? 'bg-blue-500' :
                        task.status === 'blocked' ? 'bg-red-500' : 'bg-gray-300'
                    }`} title={task.status} />
            </div>
        </div>
    );
};
