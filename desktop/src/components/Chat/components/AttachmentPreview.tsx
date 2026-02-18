/**
 * AttachmentPreview Component
 *
 * Shows thumbnails/badges for attached files with remove buttons.
 */

import { useTranslation } from 'react-i18next';
import type { FileAttachment } from '../../../hooks/useFileAttachment';

interface AttachmentPreviewProps {
    attachments: FileAttachment[];
    onRemove: (id: string) => void;
}

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
    const { t } = useTranslation();

    if (attachments.length === 0) return null;

    return (
        <div style={{
            display: 'flex',
            gap: 6,
            padding: '6px 8px',
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border-subtle)',
        }}>
            {attachments.map((att) => (
                <div
                    key={att.id}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-sm, 6px)',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: 'var(--font-size-xs, 11px)',
                        color: 'var(--text-secondary)',
                        maxWidth: 160,
                    }}
                >
                    {att.type === 'image' && att.preview && (
                        <img
                            src={att.preview}
                            alt={att.name}
                            style={{
                                width: 20,
                                height: 20,
                                objectFit: 'cover',
                                borderRadius: 3,
                            }}
                        />
                    )}
                    {att.type !== 'image' && (
                        <span>📎</span>
                    )}
                    <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                    }}>
                        {att.name}
                    </span>
                    <button
                        onClick={() => onRemove(att.id)}
                        title={t('multimodal.removeAttachment')}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--text-tertiary)',
                            padding: '0 2px',
                            fontSize: 12,
                            lineHeight: 1,
                        }}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
