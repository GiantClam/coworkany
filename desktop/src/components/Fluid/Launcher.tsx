import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../../stores/uiStore';
import { useTaskEventStore } from '../../stores/useTaskEventStore';
import { useTranslation } from 'react-i18next';

const Launcher: React.FC = () => {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const { expandToPanel, openDashboard } = useUIStore();
    const setActiveTask = useTaskEventStore(state => state.setActiveTask);

    const handleKeyDown = async (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && input.trim()) {
            if (input.trim() === '/dashboard') {
                openDashboard();
                return;
            } else if (input.trim() === '/settings') {
                openDashboard(); // TODO: Navigate to settings tab
                return;
            }

            // Start Task
            const taskId = crypto.randomUUID();
            console.log('Starting task:', taskId, input);

            // 1. Set Active Task immediately so UI is ready
            setActiveTask(taskId);

            // 2. Expand UI
            await expandToPanel();

            // 3. Clear Input
            setInput('');

            // 4. Invoke Backend
            try {
                await invoke('start_task', {
                    taskId,
                    userQuery: input
                });
            } catch (err) {
                console.error('Failed to start task:', err);
                // TODO: Show error in UI
            }
        }
    };

    return (
        <div style={{ backgroundColor: '#2d2d2d' }} className="flex items-center h-full px-4 bg-[#2d2d2d] rounded-xl border border-[#444444] shadow-2xl text-white overflow-hidden">
            {/* Search Icon */}
            <div className="flex items-center justify-center w-8 h-8 mr-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white opacity-80">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </div>

            {/* Input Field */}
            <input
                autoFocus
                type="text"
                className="flex-1 bg-transparent outline-none text-xl placeholder-[#9ca3af] font-sans font-normal text-white h-full"
                placeholder={t('fluid.placeholder')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
            />

            {/* Right Side Actions/Hints */}
            <div className="flex items-center gap-3 ml-4">
                {/* Enter Hint */}
                {input.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-[#374151] rounded text-[#9ca3af]">
                        <span className="text-xs font-bold font-sans">↵ {t('fluid.enterHint')}</span>
                    </div>
                )}

                {/* Vertical Divider */}
                <div className="w-[1px] h-6 bg-[#444444] mx-1"></div>

                {/* Settings Button */}
                <button
                    onClick={() => openDashboard()}
                    className="flex items-center justify-center w-8 h-8 rounded hover:bg-[#374151] text-[#9ca3af] hover:text-white transition-colors"
                    title={t('fluid.openDashboard')}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default Launcher;
