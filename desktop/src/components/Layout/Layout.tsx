import React from 'react';
import './Layout.css';
import { Sidebar } from '../Sidebar/Sidebar';
import { getConfig, saveConfig } from '../../lib/configStore';

interface LayoutProps {
    children: React.ReactNode;
    onOpenSettings?: () => void;
}

const SIDEBAR_WIDTH_CONFIG_KEY = 'layout.sidebarWidthPx';
const DEFAULT_SIDEBAR_WIDTH_PX = 210;
const MIN_SIDEBAR_WIDTH_PX = 180;
const MAX_SIDEBAR_WIDTH_PX = 420;

function clampSidebarWidth(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_SIDEBAR_WIDTH_PX;
    }
    return Math.min(MAX_SIDEBAR_WIDTH_PX, Math.max(MIN_SIDEBAR_WIDTH_PX, Math.round(value)));
}

export const MainLayout: React.FC<LayoutProps> = ({ children, onOpenSettings }) => {
    const [sidebarWidth, setSidebarWidth] = React.useState<number>(DEFAULT_SIDEBAR_WIDTH_PX);
    const [isDraggingSidebar, setIsDraggingSidebar] = React.useState(false);
    const layoutBodyRef = React.useRef<HTMLDivElement | null>(null);
    const sidebarWidthRef = React.useRef<number>(DEFAULT_SIDEBAR_WIDTH_PX);

    React.useEffect(() => {
        let active = true;
        void getConfig<number>(SIDEBAR_WIDTH_CONFIG_KEY)
            .then((storedWidth) => {
                if (!active || typeof storedWidth !== 'number') {
                    return;
                }
                const normalizedWidth = clampSidebarWidth(storedWidth);
                sidebarWidthRef.current = normalizedWidth;
                setSidebarWidth(normalizedWidth);
            })
            .catch(() => {
                // Ignore persisted width read failures and keep default.
            });
        return () => {
            active = false;
        };
    }, []);

    const startSidebarResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        const container = layoutBodyRef.current;
        if (!container) {
            return;
        }

        event.preventDefault();
        const pointerId = event.pointerId;
        event.currentTarget.setPointerCapture(pointerId);
        setIsDraggingSidebar(true);

        const updateSidebarWidth = (clientX: number): void => {
            const bounds = container.getBoundingClientRect();
            const nextWidth = clampSidebarWidth(clientX - bounds.left);
            sidebarWidthRef.current = nextWidth;
            setSidebarWidth(nextWidth);
        };

        updateSidebarWidth(event.clientX);

        const handlePointerMove = (moveEvent: PointerEvent): void => {
            updateSidebarWidth(moveEvent.clientX);
        };

        const finishResize = (): void => {
            setIsDraggingSidebar(false);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            void saveConfig(SIDEBAR_WIDTH_CONFIG_KEY, sidebarWidthRef.current);
        };

        const handlePointerUp = (): void => {
            finishResize();
        };

        const handlePointerCancel = (): void => {
            finishResize();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
        window.addEventListener('pointercancel', handlePointerCancel, { once: true });
    }, []);

    return (
        <div className="layout">
            <div
                className={`layout-body ${isDraggingSidebar ? 'layout-body--resizing' : ''}`}
                ref={layoutBodyRef}
                style={{ '--layout-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
            >
                <aside className="layout-sidebar">
                    <Sidebar onOpenSettings={onOpenSettings} />
                    <div
                        className="layout-sidebar-resizer"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize sidebar"
                        onPointerDown={startSidebarResize}
                    />
                </aside>
                <main className="layout-content">
                    {children}
                </main>
            </div>
        </div>
    );
};
