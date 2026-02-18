/**
 * Diff Viewer Component
 *
 * Displays a unified diff with syntax highlighting.
 * Supports both unified and split view modes.
 */

import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useMemo } from 'react';
import clsx from 'clsx';
import './DiffViewer.css';

// ============================================================================
// Types
// ============================================================================

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
    header: string;
    context?: string;
}

export interface FilePatch {
    id: string;
    timestamp: string;
    filePath: string;
    operation: 'create' | 'modify' | 'delete' | 'rename';
    newFilePath?: string;
    hunks: DiffHunk[];
    fullContent?: string;
    additions: number;
    deletions: number;
    description?: string;
}

export interface DiffViewerProps {
    patch: FilePatch;
    originalContent?: string;
    modifiedContent?: string;
    splitView?: boolean;
    showLineNumbers?: boolean;
    className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function DiffViewer({
    patch,
    originalContent = '',
    modifiedContent = '',
    splitView = false,
    showLineNumbers: _showLineNumbers = true,
    className,
}: DiffViewerProps) {
    // Reconstruct content from hunks if not provided
    const { oldValue, newValue } = useMemo(() => {
        if (originalContent || modifiedContent) {
            return { oldValue: originalContent, newValue: modifiedContent };
        }

        // Build from hunks
        if (patch.operation === 'create') {
            return { oldValue: '', newValue: patch.fullContent || '' };
        }

        if (patch.operation === 'delete') {
            return { oldValue: patch.fullContent || '', newValue: '' };
        }

        // For modify, reconstruct from hunks
        let old = '';
        let modified = '';

        for (const hunk of patch.hunks) {
            const lines = hunk.content.split('\n');
            for (const line of lines) {
                if (line.startsWith('-') && !line.startsWith('---')) {
                    old += line.slice(1) + '\n';
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                    modified += line.slice(1) + '\n';
                } else if (line.startsWith(' ')) {
                    old += line.slice(1) + '\n';
                    modified += line.slice(1) + '\n';
                }
            }
        }

        return { oldValue: old, newValue: modified };
    }, [patch, originalContent, modifiedContent]);

    // File path display
    const oldPath =
        patch.operation === 'create' ? '/dev/null' : `a/${patch.filePath}`;
    const newPath =
        patch.operation === 'delete'
            ? '/dev/null'
            : `b/${patch.newFilePath || patch.filePath}`;

    return (
        <div className={clsx('diff-viewer', className)}>
            {/* Header */}
            <div className="diff-header">
                <div className="diff-file-info">
                    <span className="diff-file-path">{patch.filePath}</span>
                    <span
                        className={clsx('diff-operation', `op-${patch.operation}`)}
                    >
                        {patch.operation.toUpperCase()}
                    </span>
                </div>
                <div className="diff-stats">
                    <span className="additions">+{patch.additions}</span>
                    <span className="deletions">-{patch.deletions}</span>
                </div>
            </div>

            {/* Description if present */}
            {patch.description && (
                <div className="diff-description">{patch.description}</div>
            )}

            {/* Diff Content */}
            <ReactDiffViewer
                oldValue={oldValue}
                newValue={newValue}
                splitView={splitView}
                showDiffOnly={false}
                useDarkTheme={false}
                compareMethod={DiffMethod.LINES}
                leftTitle={oldPath}
                rightTitle={newPath}
                styles={{
                    variables: {
                        light: {
                            diffViewerBackground: '#fafafa',
                            addedBackground: '#e6ffed',
                            addedColor: '#24292e',
                            removedBackground: '#ffeef0',
                            removedColor: '#24292e',
                            wordAddedBackground: '#acf2bd',
                            wordRemovedBackground: '#fdb8c0',
                            addedGutterBackground: '#cdffd8',
                            removedGutterBackground: '#ffdce0',
                            gutterBackground: '#f7f7f7',
                            gutterBackgroundDark: '#f3f3f3',
                            highlightBackground: '#fffbdd',
                            highlightGutterBackground: '#fff5b1',
                        },
                    },
                    line: {
                        padding: '0 10px',
                        '&:hover': {
                            background: '#f5f5f5',
                        },
                    },
                    gutter: {
                        minWidth: '40px',
                        padding: '0 10px',
                    },
                }}
            />
        </div>
    );
}

export default DiffViewer;
