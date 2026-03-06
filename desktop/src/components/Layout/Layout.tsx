import React from 'react';
import './Layout.css';
import { Sidebar, SidebarTab } from '../Sidebar/Sidebar';

interface LayoutProps {
    children: React.ReactNode;
    activeTab: SidebarTab;
    onTabChange: (tab: SidebarTab) => void;
    onOpenSettings?: () => void;
}

export const MainLayout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange, onOpenSettings }) => {
    return (
        <div className="layout">
            <div className="layout-body">
                <aside className="layout-sidebar">
                    <Sidebar activeTab={activeTab} onTabChange={onTabChange} onOpenSettings={onOpenSettings} />
                </aside>
                <main className="layout-content">
                    {children}
                </main>
            </div>
        </div>
    );
};
