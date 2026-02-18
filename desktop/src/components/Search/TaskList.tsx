
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTaskEventStore, TaskSession } from '../../stores/useTaskEventStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspace } from '../../hooks/useWorkspace';

const TaskItem: React.FC<{
    session: TaskSession;
    isActive: boolean;
    onClick: () => void;
}> = ({ session, isActive, onClick }) => {
    const { t } = useTranslation();
    // Status colors
    const statusColor = {
        idle: 'bg-gray-400',
        running: 'bg-indigo-500 animate-pulse',
        finished: 'bg-emerald-500',
        failed: 'bg-rose-500'
    }[session.status] || 'bg-gray-400';

    return (
        <div
            onClick={onClick}
            className={`
                group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border
                ${isActive
                    ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                    : 'bg-white border-transparent hover:bg-gray-50 hover:border-gray-100'}
            `}
        >
            <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
            <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 truncate">
                    {session.title || session.messages[0]?.content || t('search.untitledTask')}
                </div>
                <div className="text-xs text-gray-500 truncate mt-0.5">
                    {new Date(session.updatedAt).toLocaleTimeString()} · {session.status}
                </div>
            </div>
            <div className="text-gray-400 opacity-0 group-hover:opacity-100">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </div>
        </div>
    );
};

export const TaskList: React.FC = () => {
    const { t } = useTranslation();
    const { sessions, activeTaskId, setActiveTask } = useTaskEventStore();
    const { toggleDetailWindow, toggleTaskWindow } = useUIStore();
    const { activeWorkspace } = useWorkspace(); // Get active workspace
    const [searchQuery, setSearchQuery] = React.useState('');

    // Sort tasks by update time and filter by current workspace and search
    const sortedDetails = Array.from(sessions.values())
        .filter(s => !activeWorkspace || s.workspacePath === activeWorkspace.path) // Validate association
        .filter(s => {
            if (!searchQuery.trim()) return true;
            const query = searchQuery.toLowerCase();
            // Match title
            if (s.title?.toLowerCase().includes(query)) return true;
            // Match message content
            if (s.messages.some(m => m.content.toLowerCase().includes(query))) return true;
            return false;
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const handleTaskClick = (taskId: string) => {
        setActiveTask(taskId);
        toggleDetailWindow(true);
    };

    return (
        <div className="flex flex-col w-full h-full bg-white rounded-xl shadow-xl overflow-hidden border border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider pl-1">{t('search.recentTasks')}</h3>
                <input
                    type="text"
                    placeholder={t('search.searchConversations')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        flex: 1,
                        maxWidth: '200px',
                        marginLeft: '8px',
                        marginRight: '8px',
                        padding: '4px 8px',
                        fontSize: '12px',
                        border: '1px solid var(--border-subtle, #e5e7eb)',
                        borderRadius: '4px',
                        outline: 'none',
                        background: 'var(--bg-primary, white)',
                    }}
                />
                <button
                    onClick={() => toggleTaskWindow(false)}
                    className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {sortedDetails.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                        {t('search.noTasksYet')}
                    </div>
                ) : (
                    sortedDetails.map(session => (
                        <TaskItem
                            key={session.taskId}
                            session={session}
                            isActive={activeTaskId === session.taskId}
                            onClick={() => handleTaskClick(session.taskId)}
                        />
                    ))
                )}
            </div>
        </div>
    );
};
