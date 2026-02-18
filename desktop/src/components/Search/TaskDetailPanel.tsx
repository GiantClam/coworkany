
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveSession } from '../../stores/useTaskEventStore';
import { useUIStore } from '../../stores/uiStore';
import { Timeline } from '../Chat/Timeline/Timeline';
import { ThinkingProcess } from '../Task/ThinkingProcess';
import { useSendTaskMessage } from '../../hooks/useSendTaskMessage';

import { useCancelTask } from '../../hooks/useStartTask';

export const TaskDetailPanel: React.FC = () => {
    const { t } = useTranslation();
    const activeSession = useActiveSession();
    const { toggleDetailWindow } = useUIStore();
    const { sendMessage, isLoading: isSending } = useSendTaskMessage();
    const { cancelTask, isLoading: isCancelling } = useCancelTask();
    const [input, setInput] = useState('');

    if (!activeSession) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400 bg-white rounded-xl shadow-xl border border-gray-200">
                <p>{t('search.selectTaskToView')}</p>
            </div>
        );
    }

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        await sendMessage({
            taskId: activeSession.taskId,
            content: input,
        });
        setInput('');
    };

    const handleCancel = async () => {
        if (confirm(t('search.stopConfirm'))) {
            await cancelTask({ taskId: activeSession.taskId, reason: "User Stopped" });
        }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden font-sans">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2 overflow-hidden">
                    <span className={`w-2 h-2 rounded-full ${activeSession.status === 'running' ? 'bg-indigo-500 animate-pulse' : activeSession.status === 'finished' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                    <h3 className="text-sm font-medium text-gray-700 truncate max-w-[200px]" title={activeSession.title}>
                        {activeSession.title || t('search.taskDetails')}
                    </h3>
                </div>
                <button
                    onClick={() => toggleDetailWindow(false)}
                    className="p-1 text-gray-400 hover:bg-gray-200 rounded transition"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            {/* Content (Timeline) */}
            <div className="flex-1 overflow-y-auto bg-white p-4">
                {/* Demo: Thinking Process Visualization */}
                <div className="mb-4">
                    <ThinkingProcess steps={[
                        { id: '1', description: t('search.checkingSystemState'), status: activeSession.status === 'running' ? 'processing' : 'done' },
                        { id: '2', description: t('search.analyzingCodeStructure'), status: 'pending' }
                    ]} />
                </div>
                <Timeline session={activeSession} />
            </div>

            {/* Footer Input */}
            <div className="p-3 border-t border-gray-100 bg-gray-50/30">
                {activeSession.status === 'running' ? (
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-indigo-600 animate-pulse">{t('search.running')}</span>
                        <button
                            onClick={handleCancel}
                            disabled={isCancelling}
                            className="px-3 py-1 text-xs bg-white border border-rose-200 text-rose-600 rounded hover:bg-rose-50"
                        >
                            {t('search.stopTask')}
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSend} className="flex gap-2">
                        <input
                            className="flex-1 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-400"
                            placeholder={t('search.typeMessage')}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            disabled={isSending}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isSending}
                            className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};
