import React, { useMemo, useState } from 'react';
import { MainLayout } from '../Layout/Layout';
import { SidebarTab } from '../Sidebar/Sidebar';
import { TaskListView } from '../jarvis/TaskListView';
import { useUIStore } from '../../stores/uiStore';
import { useTranslation } from 'react-i18next';
import { useWindowShortcuts } from '../../hooks/useWindowShortcuts';

export const DashboardView: React.FC = () => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<SidebarTab>('tasks');
    const { switchToLauncher } = useUIStore();

    // Window-level keyboard shortcuts
    const shortcutCallbacks = useMemo(() => ({
        newTask: () => setActiveTab('chat'),
    }), []);
    useWindowShortcuts(shortcutCallbacks);

    const renderContent = () => {
        switch (activeTab) {
            case 'tasks':
                return <TaskListView />;
            case 'chat':
            default:
                return (
                    <div className="p-8 flex flex-col items-center justify-center h-full text-gray-500">
                        <h2 className="text-xl font-medium mb-2">{t('dashboard.welcomeToDashboard')}</h2>
                        <p>{t('dashboard.selectTab')}</p>
                    </div>
                );
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col animate-fade-in">
            <MainLayout activeTab={activeTab} onTabChange={setActiveTab}>
                <div className="h-full relative">
                    <button
                        onClick={() => switchToLauncher()}
                        className="absolute top-4 right-4 z-50 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition"
                        title={t('dashboard.backToLauncher')}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                    {renderContent()}
                </div>
            </MainLayout>
        </div>
    );
};
