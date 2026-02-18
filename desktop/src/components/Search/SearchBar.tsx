
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../../hooks/useWorkspace';
import { WorkspaceSelector } from '../Workspace/WorkspaceSelector';

export const SearchBar: React.FC = () => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const { isTaskWindowOpen, toggleTaskWindow, openDashboard, openSettings } = useUIStore();
    const { activeWorkspace } = useWorkspace();

    const handleSend = async () => {
        if (!query.trim()) return;

        if (!activeWorkspace) {
            alert(t('search.selectWorkspaceFirst'));
            return;
        }

        try {
            await invoke('start_task', {
                title: query.slice(0, 50),
                userQuery: query,
                context: {
                    workspacePath: activeWorkspace.path,
                }
            });
            setQuery('');
            toggleTaskWindow(true);
        } catch (err) {
            console.error("Failed to start task", err);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col gap-2 w-full max-w-3xl">
            {/* Workspace Context Bar - Clean & Minimal */}
            <div className="flex justify-between items-center px-1">
                <div className="scale-90 origin-left opacity-80 hover:opacity-100 transition">
                    <WorkspaceSelector />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => openDashboard()}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title={t('search.dashboard')}
                    >
                        {/* Layout Icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    </button>
                    <button
                        onClick={() => openSettings()}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="Settings"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                </div>
            </div>

            <div className="flex items-center w-full bg-white rounded-xl shadow-lg border border-gray-200 p-2 gap-2 interactive-window">
                {/* Main Input */}
                <div className="flex-1">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('search.placeholder')}
                        className="w-full text-lg px-4 py-2 outline-none text-gray-800 placeholder-gray-400 bg-transparent"
                        autoFocus
                    />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 border-l border-gray-100 pl-2">
                    {/* Toggle Task List */}
                    <button
                        onClick={() => toggleTaskWindow()}
                        className={`p-2 rounded-lg transition-colors ${isTaskWindowOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'}`}
                        title={isTaskWindowOpen ? t('search.collapseTasks') : t('search.expandTasks')}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>

                    {/* Send Button */}
                    <button
                        onClick={handleSend}
                        disabled={!query.trim()}
                        className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};
