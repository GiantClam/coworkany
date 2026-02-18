import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Common/ToastProvider';
import { GlobalErrorBoundary } from './components/Common/AppErrorBoundary';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from './lib/tauri';
import { initializeTheme } from './stores/themeStore';
import './i18n'; // Initialize i18n before rendering
import './index.css';

declare global {
    interface Window {
        __coworkanyPerf?: {
            appStart: number;
            firstPaint?: number;
        };
    }
}

// Apply persisted theme immediately to avoid flash
initializeTheme();

const renderApp = async () => {
    window.__coworkanyPerf = {
        appStart: performance.now(),
    };

    let label = 'main';
    if (isTauri()) {
        try {
            label = getCurrentWindow().label;
        } catch (e) {
            console.warn('Failed to get window label, defaulting to main', e);
        }
    }

    const root = ReactDOM.createRoot(document.getElementById('root')!);

    if (label === 'dashboard') {
        const { DashboardView } = await import('./components/Dashboard/DashboardView');
        root.render(
            <React.StrictMode>
                <GlobalErrorBoundary>
                    <ToastProvider>
                        <DashboardView />
                    </ToastProvider>
                </GlobalErrorBoundary>
            </React.StrictMode>
        );
    } else if (label === 'settings') {
        const { SettingsView } = await import('./components/Settings/SettingsView');
        root.render(
            <React.StrictMode>
                <GlobalErrorBoundary>
                    <ToastProvider>
                        <SettingsView />
                    </ToastProvider>
                </GlobalErrorBoundary>
            </React.StrictMode>
        );
    } else if (label === 'quickchat') {
        const { QuickChatView } = await import('./components/QuickChat/QuickChatView');
        root.render(
            <React.StrictMode>
                <GlobalErrorBoundary>
                    <ToastProvider>
                        <QuickChatView />
                    </ToastProvider>
                </GlobalErrorBoundary>
            </React.StrictMode>
        );
    } else {
        root.render(
            <React.StrictMode>
                <GlobalErrorBoundary>
                    <ToastProvider>
                        <App />
                    </ToastProvider>
                </GlobalErrorBoundary>
            </React.StrictMode>
        );
    }
};

renderApp();
