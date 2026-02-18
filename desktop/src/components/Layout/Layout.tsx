import React from 'react';
import './Layout.css';
import { Sidebar, SidebarTab } from '../Sidebar/Sidebar';

import { TitleBar } from '../TitleBar/TitleBar';

interface LayoutProps {
    children: React.ReactNode;
    activeTab: SidebarTab;
    onTabChange: (tab: SidebarTab) => void;
}

export const MainLayout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange }) => {
    return (
        <div className="layout">
            <TitleBar />
            <div className="layout-body">
                <aside className="layout-sidebar">
                    <Sidebar activeTab={activeTab} onTabChange={onTabChange} />
                </aside>
                <main className="layout-content">
                    {children}
                </main>
            </div>
        </div>
    );
};
