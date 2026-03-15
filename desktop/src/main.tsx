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
const e2eBootFallbackEnabled =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_E2E_BOOT_FALLBACK === '1';

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
        } catch (error) {
            console.warn('Failed to get window label, defaulting to main', error);
        }
    }

    const appStart = performance.now();
    ensureViewportSync();
    window.__coworkanyPerf = {
        appStart,
        windowLabel: label,
        startupMeasurement: defaultStartupMeasurement,
    };

    const root = ReactDOM.createRoot(document.getElementById('root')!);
    root.render(
        <React.StrictMode>
            <GlobalErrorBoundary>
                <ToastProvider>
                    <App />
                </ToastProvider>
            </GlobalErrorBoundary>
        </React.StrictMode>
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
    if (e2eBootFallbackEnabled) {
        renderApp();
        void Promise.all([
            initializeTheme(),
            hydrateLanguagePreference(),
        ]).catch((error) => {
            console.warn('[startup] Deferred theme/language hydration failed during E2E bootstrap', error);
        });
        return;
    }

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
