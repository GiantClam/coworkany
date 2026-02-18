import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './TitleBar.css';
import { useTranslation } from 'react-i18next';

export const TitleBar: React.FC = () => {
    const { t } = useTranslation();
    const [isMaximized, setIsMaximized] = useState(false);
    const appWindow = getCurrentWindow();

    useEffect(() => {
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
            unlisten.then(f => f());
        }
    }, []);

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = async () => {
        await appWindow.toggleMaximize();
        setIsMaximized(!isMaximized);
    };
    const handleClose = async () => {
        try {
            await appWindow.hide();
        } catch {
            await appWindow.close();
        }
    };

    return (
        <div className="titlebar">
            {/* Drag Region */}
            <div className="titlebar-drag-region" data-tauri-drag-region onDoubleClick={handleMaximize}>
                {t('titlebar.coworkAny')}
            </div>

            {/* Window Controls */}
            <div className="titlebar-controls">
                <button className="titlebar-button" onClick={handleMinimize} title={t('titlebar.minimize')}>
                    <svg width="10" height="1" viewBox="0 0 10 1">
                        <path d="M0 0h10v1H0z" fill="currentColor" />
                    </svg>
                </button>
                <button className="titlebar-button" onClick={handleMaximize} title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}>
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
                <button className="titlebar-button close" onClick={handleClose} title={t('titlebar.close')}>
                    <svg width="10" height="10" viewBox="0 0 10 10">
                        <path d="M5 4.3L9.3 0 10 .7 5.7 5 10 9.3 9.3 10 5 5.7 .7 10 0 9.3 4.3 5 0 .7 .7 0z" fill="currentColor" />
                    </svg>
                </button>
            </div>
        </div>
    );
};
