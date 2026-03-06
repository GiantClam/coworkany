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
        <div className="attachment-preview-list">
            {attachments.map((att) => (
                <div key={att.id} className="attachment-preview-item">
                    {att.type === 'image' && att.preview && (
                        <img
                            src={att.preview}
                            alt={att.name}
                            className="attachment-preview-image"
                        />
                    )}
                    {att.type !== 'image' && (
                        <span className="attachment-preview-file-icon">FILE</span>
                    )}
                    <span className="attachment-preview-name">
                        {att.name}
                    </span>
                    <button
                        type="button"
                        className="attachment-preview-remove"
                        onClick={() => onRemove(att.id)}
                        title={t('multimodal.removeAttachment')}
                    >
                        x
                    </button>
                </div>
            ))}
        </div>
    );
}
