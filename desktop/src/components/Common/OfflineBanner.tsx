/**
 * OfflineBanner Component
 *
 * Displays a non-intrusive banner when the app detects no network connection.
 * Suggests switching to Ollama (local model) as a fallback.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

export function OfflineBanner() {
    const { t } = useTranslation();
    const { isOnline } = useNetworkStatus();
    const [dismissed, setDismissed] = useState(false);

    // Reset dismissed state when going back online then offline again
    if (isOnline && dismissed) {
        setDismissed(false);
    }

    if (isOnline || dismissed) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: 36,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 9998,
                padding: '8px 16px',
                borderRadius: 'var(--radius-lg, 12px)',
                background: 'var(--status-warning-bg, #fef3cd)',
                border: '1px solid var(--status-warning-border, #ffc107)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                maxWidth: 500,
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--font-size-sm, 13px)',
                color: 'var(--text-primary, #333)',
            }}
        >
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t('offline.noConnection')}</div>
                <div style={{ opacity: 0.7, fontSize: 'var(--font-size-xs, 11px)' }}>
                    {t('offline.ollamaHint')}
                </div>
            </div>
            <button
                onClick={() => setDismissed(true)}
                style={{
                    padding: '2px 8px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    fontSize: 16,
                    flexShrink: 0,
                }}
                title={t('common.dismiss')}
            >
                ×
            </button>
        </div>
    );
}
