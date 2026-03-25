import React from 'react';
import './Layout.css';
import { Sidebar } from '../Sidebar/Sidebar';

interface LayoutProps {
    children: React.ReactNode;
    onOpenSettings?: () => void;
}

export const MainLayout: React.FC<LayoutProps> = ({ children, onOpenSettings }) => {
    return (
        <div className="layout">
            <div className="layout-body">
                <aside className="layout-sidebar">
                    <Sidebar onOpenSettings={onOpenSettings} />
                </aside>
                <main className="layout-content">
                    {children}
                </main>
            </div>
        </div>
    );
};
