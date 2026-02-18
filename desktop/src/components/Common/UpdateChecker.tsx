/**
 * UpdateChecker Component
 *
 * Checks for application updates on startup using the Tauri updater plugin.
 * Shows a banner when an update is available, with download and install options.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../../lib/tauri';

type UpdateState =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available'; version: string }
    | { status: 'downloading'; percent: number }
    | { status: 'ready' }
    | { status: 'up-to-date' }
    | { status: 'error'; message: string };

export function UpdateChecker() {
    const { t } = useTranslation();
    const [state, setState] = useState<UpdateState>({ status: 'idle' });
    const [dismissed, setDismissed] = useState(false);

    // Store the update object for later download/install
    const [updateObj, setUpdateObj] = useState<unknown>(null);

    useEffect(() => {
        if (!isTauri()) return;

        let cancelled = false;

        const checkForUpdate = async () => {
            try {
                setState({ status: 'checking' });
                const { check } = await import('@tauri-apps/plugin-updater');
                const update = await check();

                if (cancelled) return;

                if (update) {
                    setUpdateObj(update);
                    setState({
                        status: 'available',
                        version: update.version,
                    });
                } else {
                    setState({ status: 'up-to-date' });
                    // Auto-hide after 3 seconds
                    setTimeout(() => {
                        if (!cancelled) setState({ status: 'idle' });
                    }, 3000);
                }
            } catch (err) {
                if (cancelled) return;
                console.warn('[UpdateChecker] Check failed:', err);
                // Silently fail — don't show error banner for update checks
                setState({ status: 'idle' });
            }
        };

        // Check after a short delay so it doesn't block startup
        const timer = setTimeout(() => {
            void checkForUpdate();
        }, 5000);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, []);

    const handleDownload = useCallback(async () => {
        if (!updateObj || typeof (updateObj as Record<string, unknown>).downloadAndInstall !== 'function') return;

        try {
            setState({ status: 'downloading', percent: 0 });

            await (updateObj as { downloadAndInstall: (cb?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void> }).downloadAndInstall((event) => {
                if (event.event === 'Started') {
                    setState({ status: 'downloading', percent: 0 });
                } else if (event.event === 'Progress') {
                    // We don't get total easily, just show indeterminate
                    setState((prev) =>
                        prev.status === 'downloading'
                            ? { status: 'downloading', percent: Math.min((prev.percent || 0) + 5, 95) }
                            : prev
                    );
                } else if (event.event === 'Finished') {
                    setState({ status: 'ready' });
                }
            });

            setState({ status: 'ready' });
        } catch (err) {
            console.error('[UpdateChecker] Download failed:', err);
            setState({
                status: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }, [updateObj]);

    // Don't render if dismissed or idle
    if (dismissed || state.status === 'idle' || state.status === 'checking') {
        return null;
    }

    return (
        <div
            style={{
                position: 'fixed',
                bottom: 16,
                right: 16,
                zIndex: 9999,
                padding: '12px 16px',
                borderRadius: 'var(--radius-lg, 12px)',
                background: 'var(--bg-panel, #fff)',
                border: '1px solid var(--border-subtle, #e0e0e0)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                maxWidth: 380,
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--font-size-sm, 13px)',
                color: 'var(--text-primary)',
                animation: 'fadeIn 0.3s ease',
            }}
        >
            {/* Icon */}
            <div style={{ fontSize: 20, flexShrink: 0 }}>
                {state.status === 'available' && '🔄'}
                {state.status === 'downloading' && '⬇️'}
                {state.status === 'ready' && '✅'}
                {state.status === 'up-to-date' && '✓'}
                {state.status === 'error' && '⚠️'}
            </div>

            {/* Content */}
            <div style={{ flex: 1 }}>
                {state.status === 'available' && (
                    <>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>
                            {t('updater.updateAvailable')}
                        </div>
                        <div style={{ opacity: 0.7 }}>
                            {t('updater.newVersionAvailable', { version: state.version })}
                        </div>
                    </>
                )}
                {state.status === 'downloading' && (
                    <div>{t('updater.downloading')}</div>
                )}
                {state.status === 'ready' && (
                    <div>{t('updater.readyToInstall')}</div>
                )}
                {state.status === 'up-to-date' && (
                    <div style={{ opacity: 0.7 }}>{t('updater.upToDate')}</div>
                )}
                {state.status === 'error' && (
                    <div style={{ color: 'var(--status-error, red)' }}>
                        {t('updater.checkFailed')}
                    </div>
                )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {state.status === 'available' && (
                    <>
                        <button
                            onClick={() => void handleDownload()}
                            style={{
                                padding: '4px 10px',
                                border: 'none',
                                borderRadius: 'var(--radius-sm, 6px)',
                                background: 'var(--accent-primary, #0066ff)',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-xs, 11px)',
                                fontWeight: 600,
                            }}
                        >
                            {t('updater.download')}
                        </button>
                        <button
                            onClick={() => setDismissed(true)}
                            style={{
                                padding: '4px 10px',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-sm, 6px)',
                                background: 'transparent',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-xs, 11px)',
                            }}
                        >
                            {t('updater.later')}
                        </button>
                    </>
                )}
                {state.status === 'ready' && (
                    <button
                        onClick={() => setDismissed(true)}
                        style={{
                            padding: '4px 10px',
                            border: 'none',
                            borderRadius: 'var(--radius-sm, 6px)',
                            background: 'var(--status-success, #22c55e)',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: 'var(--font-size-xs, 11px)',
                            fontWeight: 600,
                        }}
                    >
                        {t('updater.installAndRestart')}
                    </button>
                )}
                {(state.status === 'up-to-date' || state.status === 'error') && (
                    <button
                        onClick={() => setDismissed(true)}
                        style={{
                            padding: '2px 6px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-tertiary)',
                            cursor: 'pointer',
                            fontSize: 14,
                        }}
                    >
                        ×
                    </button>
                )}
            </div>
        </div>
    );
}
