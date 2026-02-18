/**
 * Patch Preview Component
 *
 * Shows a multi-file patch set with file tree navigation,
 * diff preview, and accept/reject controls.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { DiffViewer, type FilePatch } from './DiffViewer';
import './PatchPreview.css';

// ============================================================================
// Types
// ============================================================================

export interface PatchSet {
    id: string;
    taskId: string;
    timestamp: string;
    patches: FilePatch[];
    description: string;
    totalAdditions: number;
    totalDeletions: number;
    filesAffected: number;
}

export interface PatchPreviewProps {
    patchSet: PatchSet;
    onAcceptAll: () => void;
    onRejectAll: () => void;
    onAcceptPatch: (patchId: string) => void;
    onRejectPatch: (patchId: string) => void;
    className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getFileIcon(operation: FilePatch['operation']): string {
    switch (operation) {
        case 'create':
            return '➕';
        case 'modify':
            return '✏️';
        case 'delete':
            return '🗑️';
        case 'rename':
            return '📝';
        default:
            return '📄';
    }
}

function getFileName(path: string): string {
    return path.split('/').pop() || path;
}

function getFilePath(path: string): string {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
}

// ============================================================================
// Component
// ============================================================================

export function PatchPreview({
    patchSet,
    onAcceptAll,
    onRejectAll,
    onAcceptPatch,
    onRejectPatch,
    className,
}: PatchPreviewProps) {
    const { t } = useTranslation();
    const [selectedPatchId, setSelectedPatchId] = useState<string | null>(
        patchSet.patches[0]?.id || null
    );

    const selectedPatch = patchSet.patches.find((p) => p.id === selectedPatchId);

    return (
        <div className={clsx('patch-preview', className)}>
            {/* Header */}
            <div className="patch-preview-header">
                <div className="patch-info">
                    <h2 className="patch-title">{t('patch.reviewChanges')}</h2>
                    <p className="patch-description">{patchSet.description}</p>
                </div>
                <div className="patch-summary">
                    <span className="file-count">
                        {t('patch.filesAffected', { count: patchSet.filesAffected })}
                    </span>
                    <span className="additions">+{patchSet.totalAdditions}</span>
                    <span className="deletions">-{patchSet.totalDeletions}</span>
                </div>
            </div>

            {/* Main Content */}
            <div className="patch-preview-body">
                {/* File Tree */}
                <div className="patch-file-tree">
                    <div className="file-tree-header">{t('patch.changedFiles')}</div>
                    <ul className="file-list">
                        {patchSet.patches.map((patch) => (
                            <li
                                key={patch.id}
                                className={clsx('file-item', {
                                    selected: patch.id === selectedPatchId,
                                })}
                                onClick={() => setSelectedPatchId(patch.id)}
                            >
                                <span className="file-icon">
                                    {getFileIcon(patch.operation)}
                                </span>
                                <div className="file-info">
                                    <span className="file-name">
                                        {getFileName(patch.filePath)}
                                    </span>
                                    <span className="file-path">
                                        {getFilePath(patch.filePath)}
                                    </span>
                                </div>
                                <div className="file-stats">
                                    <span className="add">+{patch.additions}</span>
                                    <span className="del">-{patch.deletions}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Diff View */}
                <div className="patch-diff-view">
                    {selectedPatch ? (
                        <>
                            <div className="diff-actions">
                                <button
                                    className="action-btn accept-btn"
                                    onClick={() => onAcceptPatch(selectedPatch.id)}
                                >
                                    ✓ {t('patch.accept')}
                                </button>
                                <button
                                    className="action-btn reject-btn"
                                    onClick={() => onRejectPatch(selectedPatch.id)}
                                >
                                    ✕ {t('patch.reject')}
                                </button>
                            </div>
                            <DiffViewer patch={selectedPatch} splitView={false} />
                        </>
                    ) : (
                        <div className="no-selection">
                            {t('patch.selectFileToView')}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="patch-preview-footer">
                <button className="footer-btn reject-all-btn" onClick={onRejectAll}>
                    {t('patch.rejectAll')}
                </button>
                <button className="footer-btn accept-all-btn" onClick={onAcceptAll}>
                    {t('patch.acceptAll')}
                </button>
            </div>
        </div>
    );
}

export default PatchPreview;
