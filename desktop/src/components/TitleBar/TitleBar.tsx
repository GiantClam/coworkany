import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import './TitleBar.css';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../../lib/tauri';

export const TitleBar: React.FC = () => {
    const { t } = useTranslation();
    const isDesktop = isTauri();
    const [isMaximized, setIsMaximized] = useState(false);
    const [isQuitting, setIsQuitting] = useState(false);
    const appWindow = isDesktop ? getCurrentWindow() : null;

    useEffect(() => {
        if (!appWindow) return;

        const checkMaximized = async () => {
            const max = await appWindow.isMaximized();
            setIsMaximized(max);
        };

        checkMaximized();

        // Listen for resize events to update the maximize icon state
        const unlisten = appWindow.onResized(() => {
            checkMaximized();
        });

        return () => {
            unlisten.then((fn) => fn());
        };
    }, [appWindow]);

    const handleMinimize = () => {
        if (!appWindow) return;
        void appWindow.minimize();
    };
    const handleMaximize = async () => {
        if (!appWindow) return;
        await appWindow.toggleMaximize();
        setIsMaximized(!isMaximized);
    };
    const handleCloseWindow = async () => {
        if (!appWindow) return;
        try {
            await appWindow.hide();
        } catch {
            await appWindow.close();
        }
    };
    const handleQuitApp = async () => {
        if (!isDesktop) return;
        if (isQuitting) return;
        setIsQuitting(true);
        try {
            await invoke('quit_app');
        } catch (error) {
            console.error('Failed to quit app:', error);
            setIsQuitting(false);
        }
    };

    const handleStartDragging: React.MouseEventHandler<HTMLDivElement> = (event) => {
        if (!appWindow) return;
        if (event.button !== 0) return;
        void appWindow.startDragging().catch(() => {
            // Fallback to CSS drag region behavior.
        });
    };

    return (
        <div className="titlebar" data-tauri-drag-region>
            <div
                className="titlebar-drag-region"
                data-tauri-drag-region
                onMouseDown={handleStartDragging}
                onDoubleClick={handleMaximize}
            >
                <div className="titlebar-brand" data-tauri-drag-region>
                    <span className="titlebar-brand-dot" aria-hidden="true" />
                    <span className="titlebar-brand-wordmark">{t('titlebar.coworkAny')}</span>
                    <span className="titlebar-brand-chip">Desktop</span>
                </div>
            </div>

            <div className="titlebar-controls-shell">
                <div className="titlebar-controls">
                    <button
                        type="button"
                        className="titlebar-button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={handleMinimize}
                        title={t('titlebar.minimize')}
                    >
                        <svg width="10" height="1" viewBox="0 0 10 1">
                            <path d="M0 0h10v1H0z" fill="currentColor" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        className="titlebar-button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={handleMaximize}
                        title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}
                    >
                        {isMaximized ? (
                            <svg width="10" height="10" viewBox="0 0 10 10">
                                <path d="M2.1 0v2H0v8.1h8.2v-2h2V0H2.1zm6 8.1H2v-6h6.1v6zm2-2h-1v-5H4.1V1h6v7.1z" fill="currentColor" />
                            </svg>
                        ) : (
                            <svg width="10" height="10" viewBox="0 0 10 10">
                                <path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" />
                            </svg>
                        )}
                    </button>
                    <button
                        type="button"
                        className="titlebar-button close"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={handleCloseWindow}
                        title={t('titlebar.closeWindow')}
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10">
                            <path d="M5 4.3L9.3 0 10 .7 5.7 5 10 9.3 9.3 10 5 5.7 .7 10 0 9.3 4.3 5 0 .7 .7 0z" fill="currentColor" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        className="titlebar-button quit"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={handleQuitApp}
                        title={t('titlebar.quitApp')}
                        aria-label={t('titlebar.quitApp')}
                        disabled={isQuitting}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="2" x2="12" y2="12" />
                            <path d="M17.66 6.34a8 8 0 1 1-11.32 0" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};
