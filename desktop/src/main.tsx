import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Common/ToastProvider';
import { GlobalErrorBoundary } from './components/Common/AppErrorBoundary';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from './lib/tauri';
import { initializeTheme } from './stores/themeStore';
import { hydrateLanguagePreference } from './i18n';
import { getStartupMeasurementConfig, recordStartupMetric, type StartupMeasurementConfig } from './lib/startupMetrics';
import { emitBootJsonLog, installMinimalConsoleMode } from './lib/appLog';
import './i18n';
import './index.css';

declare global {
    interface Window {
        __coworkanyPerf?: {
            appStart: number;
            firstPaint?: number;
            windowLabel?: string;
            startupMeasurement?: StartupMeasurementConfig;
        };
    }
}

const defaultStartupMeasurement: StartupMeasurementConfig = {
    enabled: false,
    profile: 'optimized',
    runLabel: '',
};

function syncViewportCssVars() {
    const root = document.documentElement;
    root.style.setProperty('--app-vh', `${window.innerHeight}px`);
    root.style.setProperty('--app-vw', `${window.innerWidth}px`);
}

let viewportCleanup: (() => void) | null = null;

function ensureViewportSync() {
    viewportCleanup?.();
    syncViewportCssVars();
    window.addEventListener('resize', syncViewportCssVars);
    window.addEventListener('orientationchange', syncViewportCssVars);
    viewportCleanup = () => {
        window.removeEventListener('resize', syncViewportCssVars);
        window.removeEventListener('orientationchange', syncViewportCssVars);
    };
}

function hideBootSkeleton() {
    const boot = document.getElementById('boot-skeleton');
    if (!boot) return;
    boot.classList.add('boot-skeleton--hide');
    window.setTimeout(() => {
        boot.remove();
    }, 220);
}

function renderApp() {
    let label = 'main';
    if (isTauri()) {
        try {
            label = getCurrentWindow().label;
        } catch {
            // Fall back to `main` when label lookup is unavailable.
        }
    }

    const appStart = performance.now();
    ensureViewportSync();
    window.__coworkanyPerf = {
        appStart,
        windowLabel: label,
        startupMeasurement: defaultStartupMeasurement,
    };
    emitBootJsonLog({
        runtime: isTauri() ? 'tauri' : 'web',
        windowLabel: label,
        startupProfile: defaultStartupMeasurement.profile,
    });

    const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
    const RootWrapper = isDev ? React.Fragment : React.StrictMode;
    const root = ReactDOM.createRoot(document.getElementById('root')!);
    root.render(
        <RootWrapper>
            <GlobalErrorBoundary>
                <ToastProvider>
                    <App />
                </ToastProvider>
            </GlobalErrorBoundary>
        </RootWrapper>
    );
    hideBootSkeleton();

    void (async () => {
        const startupMeasurement = await getStartupMeasurementConfig();
        if (window.__coworkanyPerf) {
            window.__coworkanyPerf.startupMeasurement = startupMeasurement;
        }
        await recordStartupMetric('frontend_bootstrap', 0, performance.now(), label);
    })();
}

void (async () => {
    installMinimalConsoleMode();
    await Promise.all([
        initializeTheme(),
        hydrateLanguagePreference(),
    ]);
    renderApp();
})();

const hot = (import.meta as ImportMeta & {
    hot?: { dispose: (cb: () => void) => void };
}).hot;

if (hot) {
    hot.dispose(() => {
        viewportCleanup?.();
        viewportCleanup = null;
    });
}
