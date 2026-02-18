import React from 'react';
import { useTaskEventStore, TaskSession } from '../../stores/useTaskEventStore';
import { useUIStore } from '../../stores/uiStore';
import { useTranslation } from 'react-i18next';

const TaskItem: React.FC<{ session: TaskSession; isActive: boolean; onClick: () => void }> = ({ session, isActive, onClick }) => {
    const { t } = useTranslation();
    return (<div
        onClick={onClick}
        className={`p-3 rounded-lg border cursor-pointer transition-colors mb-2 flex justify-between items-center`}
        style={{
            backgroundColor: isActive ? 'var(--bg-element)' : 'var(--bg-card)',
            borderColor: isActive ? 'var(--accent-primary)' : 'var(--border-subtle)',
        }}
    >
        <div>
            <div className="font-medium text-primary truncate max-w-md">
                {session.title || t('search.untitledTask')}
            </div>
            <div className="text-xs text-secondary font-mono mt-1">
                {session.taskId.slice(0, 8)} • {session.status} • {session.updatedAt}
            </div>
        </div>
        <div>
            {isActive && (
                <span
                    className="text-xs font-bold px-2 py-1 rounded"
                    style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}
                >
                    {t('fluid.active')}
                </span>
            )}
        </div>
    </div>
);
};

export const TaskSwitcher: React.FC = () => {
    const { t } = useTranslation();
    const sessions = useTaskEventStore(state => Array.from(state.sessions.values()));
    const activeTaskId = useTaskEventStore(state => state.activeTaskId);
    const setActiveTask = useTaskEventStore(state => state.setActiveTask);
    const { expandToPanel } = useUIStore();

    if (sessions.length === 0) {
        return (
            <div className="p-4 text-center text-gray-500">
                {t('fluid.noActiveTasks')}
            </div>
        );
    }

    const handleTaskClick = async (taskId: string) => {
        setActiveTask(taskId);
        // If clicking, user probably wants to see it
        await expandToPanel();
    };

    return (
        <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">{t('fluid.activeSessions')}</h2>
            <div className="space-y-2">
                {sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(session => (
                    <TaskItem
                        key={session.taskId}
                        session={session}
                        isActive={session.taskId === activeTaskId}
                        onClick={() => handleTaskClick(session.taskId)}
                    />
                ))}
            </div>
        </div>
    );
};
