import React from 'react';
import { useUIStore } from '../stores/uiStore';
import Launcher from '../components/Fluid/Launcher';

interface FluidLayoutProps {
    panelContent: React.ReactNode;
    dashboardContent: React.ReactNode;
}

export const FluidLayout: React.FC<FluidLayoutProps> = ({ panelContent, dashboardContent }) => {
    const { viewMode } = useUIStore();

    // Determine container styles based on mode
    const containerClasses = React.useMemo(() => {
        const base = "h-screen w-screen overflow-hidden flex flex-col transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]";

        switch (viewMode) {
            case 'launcher':
                // Clean floating bar style handled by Launcher component inner style, 
                // but layout needs to be transparent
                return `${base} bg-transparent`;
            case 'panel':
                // Companion mode: slight glass effect
                return `${base} rounded-xl border border-[#444] bg-[#1e1e1e] shadow-2xl`;
            case 'dashboard':
                // Full window
                return `${base} bg-white`;
            default:
                return base;
        }
    }, [viewMode]);

    return (
        <div className={containerClasses} data-tauri-drag-region>
            {/* Drag Handle - Only needed if we want a specifically clickable area, 
                but data-tauri-drag-region on the main div handles it mostly. 
                However, for inputs to work, we need to be careful. 
                Let's put the region on a top strip or the component itself. */}

            <div className="flex-1 flex flex-col relative w-full h-full overflow-hidden">
                {viewMode === 'launcher' && <Launcher />}
                {viewMode === 'panel' && <div className="h-full w-full">{panelContent}</div>}
                {viewMode === 'dashboard' && <div className="h-full w-full">{dashboardContent}</div>}
            </div>
        </div>
    );
};
