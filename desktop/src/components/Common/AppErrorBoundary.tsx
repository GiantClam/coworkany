/**
 * Error Boundary Components
 *
 * Two layers of protection:
 *   1. GlobalErrorBoundary — wraps the entire app, catches catastrophic failures
 *   2. SectionErrorBoundary — wraps individual sections, isolated failure recovery
 *
 * Uses react-error-boundary for the actual boundary logic.
 */

import React from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { toast } from './ToastProvider';

// ============================================================================
// Global fallback — full-page error recovery UI
// ============================================================================

function GlobalFallback({ error: rawError, resetErrorBoundary }: FallbackProps) {
    const { t } = useTranslation();
    const error = rawError instanceof Error ? rawError : new Error(String(rawError));
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            width: '100vw',
            padding: '32px',
            fontFamily: 'var(--font-body, sans-serif)',
            background: 'var(--bg-app, #fcfbf9)',
            color: 'var(--text-primary, #1c1917)',
        }}>
            <div style={{
                maxWidth: 480,
                textAlign: 'center',
                background: 'var(--bg-panel, #fff)',
                padding: '40px 32px',
                borderRadius: 'var(--radius-lg, 12px)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border-subtle, #efede4)',
            }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>!</div>
                <h1 style={{
                    fontSize: 'var(--font-size-xl, 20px)',
                    fontWeight: 'var(--font-semibold, 600)',
                    marginBottom: 8,
                }}>
                    {t('errorBoundary.applicationError')}
                </h1>
                <p style={{
                    color: 'var(--text-secondary, #57534e)',
                    fontSize: 'var(--font-size-sm, 14px)',
                    marginBottom: 24,
                    lineHeight: 1.5,
                }}>
                    {t('errorBoundary.unexpectedError')}
                </p>
                <pre style={{
                    background: 'var(--bg-element, #f7f5ed)',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md, 8px)',
                    fontSize: 'var(--font-size-xs, 12px)',
                    fontFamily: 'var(--font-code, monospace)',
                    color: 'var(--status-error, #be123c)',
                    textAlign: 'left',
                    overflow: 'auto',
                    maxHeight: 120,
                    marginBottom: 24,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}>
                    {error.message}
                </pre>
                <button
                    onClick={resetErrorBoundary}
                    style={{
                        padding: '10px 28px',
                        borderRadius: 'var(--radius-md, 8px)',
                        border: 'none',
                        background: 'var(--accent-primary, #d97757)',
                        color: '#fff',
                        fontSize: 'var(--font-size-sm, 14px)',
                        fontWeight: 'var(--font-semibold, 600)',
                        cursor: 'pointer',
                    }}
                >
                    {t('errorBoundary.reloadApplication')}
                </button>
            </div>
        </div>
    );
}

// ============================================================================
// Section fallback — inline error recovery for individual modules
// ============================================================================

function SectionFallback({ error: rawError, resetErrorBoundary }: FallbackProps) {
    const { t } = useTranslation();
    const error = rawError instanceof Error ? rawError : new Error(String(rawError));
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            margin: '8px',
            background: 'var(--bg-element, #f7f5ed)',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px solid var(--border-subtle, #efede4)',
            fontFamily: 'var(--font-body, sans-serif)',
            color: 'var(--text-secondary, #57534e)',
            fontSize: 'var(--font-size-sm, 14px)',
            minHeight: 100,
        }}>
            <p style={{ marginBottom: 12, fontWeight: 500 }}>
                {t('errorBoundary.sectionError')}
            </p>
            <pre style={{
                fontSize: 'var(--font-size-xs, 12px)',
                fontFamily: 'var(--font-code, monospace)',
                color: 'var(--status-error, #be123c)',
                background: 'var(--bg-panel, #fff)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm, 4px)',
                maxWidth: '100%',
                overflow: 'auto',
                maxHeight: 60,
                marginBottom: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
            }}>
                {error.message}
            </pre>
            <button
                onClick={resetErrorBoundary}
                style={{
                    padding: '6px 16px',
                    borderRadius: 'var(--radius-sm, 4px)',
                    border: '1px solid var(--border-strong, #a8a29e)',
                    background: 'var(--bg-panel, #fff)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-size-xs, 12px)',
                    cursor: 'pointer',
                }}
            >
                {t('errorBoundary.retry')}
            </button>
        </div>
    );
}

// ============================================================================
// Error logging helper
// ============================================================================

function logError(error: unknown, info: { componentStack?: string | null }) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[ErrorBoundary] Caught error:', err);
    if (info.componentStack) {
        console.error('[ErrorBoundary] Component stack:', info.componentStack);
    }
    toast.error('Component Error', err.message);
}

// ============================================================================
// Exported wrapper components
// ============================================================================

/** Wrap the entire app — catches all uncaught React errors */
export function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary
            FallbackComponent={GlobalFallback}
            onError={logError}
            onReset={() => {
                // Reload the page on global recovery
                window.location.reload();
            }}
        >
            {children}
        </ErrorBoundary>
    );
}

/** Wrap individual sections — isolated failure, rest of app keeps working */
export function SectionErrorBoundary({
    children,
    resetKeys,
}: {
    children: React.ReactNode;
    resetKeys?: unknown[];
}) {
    return (
        <ErrorBoundary
            FallbackComponent={SectionFallback}
            onError={logError}
            resetKeys={resetKeys}
        >
            {children}
        </ErrorBoundary>
    );
}
