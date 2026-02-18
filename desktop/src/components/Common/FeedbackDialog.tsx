/**
 * FeedbackDialog Component
 *
 * Provides a feedback form accessible from the sidebar/settings.
 * Collects bug reports, feature requests, and general feedback.
 * Stores feedback locally (can be extended with remote API later).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveConfig, getConfig } from '../../lib/configStore';

type FeedbackType = 'bug' | 'feature' | 'general';

interface FeedbackDialogProps {
    open: boolean;
    onClose: () => void;
}

interface FeedbackEntry {
    id: string;
    type: FeedbackType;
    message: string;
    timestamp: string;
    appVersion: string;
    platform: string;
}

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
    const { t } = useTranslation();
    const [feedbackType, setFeedbackType] = useState<FeedbackType>('general');
    const [message, setMessage] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async () => {
        if (!message.trim()) return;

        const entry: FeedbackEntry = {
            id: crypto.randomUUID(),
            type: feedbackType,
            message: message.trim(),
            timestamp: new Date().toISOString(),
            appVersion: '0.1.0',
            platform: navigator.platform,
        };

        // Store locally (can be sent to remote API later)
        const existing = (await getConfig<FeedbackEntry[]>('feedback')) || [];
        await saveConfig('feedback', [...existing, entry]);

        setSubmitted(true);
        setTimeout(() => {
            setSubmitted(false);
            setMessage('');
            onClose();
        }, 2000);
    };

    if (!open) return null;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
        }}>
            <div style={{
                background: 'var(--bg-panel, #fff)',
                borderRadius: 'var(--radius-lg, 12px)',
                padding: 24,
                width: 420,
                maxHeight: '80vh',
                overflow: 'auto',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                fontFamily: 'var(--font-body)',
            }}>
                {submitted ? (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                        <div style={{ fontWeight: 600 }}>{t('feedback.submitted')}</div>
                    </div>
                ) : (
                    <>
                        <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>
                            {t('feedback.feedbackTitle')}
                        </h3>

                        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                            {(['bug', 'feature', 'general'] as FeedbackType[]).map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setFeedbackType(type)}
                                    style={{
                                        flex: 1,
                                        padding: '6px 10px',
                                        border: feedbackType === type
                                            ? '2px solid var(--accent-primary)'
                                            : '1px solid var(--border-subtle)',
                                        borderRadius: 'var(--radius-sm, 6px)',
                                        background: feedbackType === type
                                            ? 'var(--accent-subtle)'
                                            : 'var(--bg-surface)',
                                        color: 'var(--text-primary)',
                                        cursor: 'pointer',
                                        fontSize: 'var(--font-size-xs, 11px)',
                                        fontWeight: feedbackType === type ? 600 : 400,
                                    }}
                                >
                                    {t(`feedback.${type}`)}
                                </button>
                            ))}
                        </div>

                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder={t('feedback.feedbackPlaceholder')}
                            rows={5}
                            style={{
                                width: '100%',
                                padding: 10,
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-sm, 6px)',
                                background: 'var(--bg-surface)',
                                color: 'var(--text-primary)',
                                fontFamily: 'var(--font-body)',
                                fontSize: 'var(--font-size-sm, 13px)',
                                resize: 'vertical',
                                boxSizing: 'border-box',
                            }}
                        />

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                            <button
                                onClick={onClose}
                                style={{
                                    padding: '6px 14px',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 'var(--radius-sm, 6px)',
                                    background: 'transparent',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    fontSize: 'var(--font-size-sm, 13px)',
                                }}
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                onClick={() => void handleSubmit()}
                                disabled={!message.trim()}
                                style={{
                                    padding: '6px 14px',
                                    border: 'none',
                                    borderRadius: 'var(--radius-sm, 6px)',
                                    background: message.trim()
                                        ? 'var(--accent-primary, #0066ff)'
                                        : 'var(--bg-surface)',
                                    color: message.trim() ? '#fff' : 'var(--text-tertiary)',
                                    cursor: message.trim() ? 'pointer' : 'default',
                                    fontSize: 'var(--font-size-sm, 13px)',
                                    fontWeight: 600,
                                }}
                            >
                                {t('feedback.sendFeedback')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
