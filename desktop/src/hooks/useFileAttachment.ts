/**
 * useFileAttachment Hook
 *
 * Handles file attachments for the chat input:
 * - Drag-and-drop files onto input area
 * - Click to browse files
 * - Paste images from clipboard
 * - Reads files as base64 or text
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface FileAttachment {
    id: string;
    name: string;
    type: 'image' | 'text' | 'pdf' | 'other';
    mimeType: string;
    size: number;
    /** absolute persisted file path for sidecar consumption */
    filePath: string;
    /** thumbnail URL for preview */
    preview?: string;
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILES = 5;

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const SUPPORTED_TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json'];

function getFileType(mimeType: string): FileAttachment['type'] {
    if (SUPPORTED_IMAGE_TYPES.includes(mimeType)) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    if (SUPPORTED_TEXT_TYPES.includes(mimeType) || mimeType.startsWith('text/')) return 'text';
    return 'other';
}

type PersistAttachmentFileInput = {
    fileName: string;
    mimeType: string;
    bytes: number[];
    workspacePath?: string;
};

type PersistAttachmentFileResult = {
    success: boolean;
    filePath: string;
    error?: string;
};

async function persistAttachmentFile(file: File, workspacePath?: string): Promise<string> {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const input: PersistAttachmentFileInput = {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        bytes,
        workspacePath,
    };
    const result = await invoke<PersistAttachmentFileResult>('persist_attachment_file', { input });
    if (!result.success || typeof result.filePath !== 'string' || result.filePath.trim().length === 0) {
        throw new Error(result.error || 'persist_attachment_failed');
    }
    return result.filePath;
}

export function useFileAttachment(workspacePath?: string) {
    const [attachments, setAttachments] = useState<FileAttachment[]>([]);
    const [error, setError] = useState<string | null>(null);

    const addFile = useCallback(async (file: File) => {
        setError(null);

        // Validate size
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            setError(`file_too_large`);
            return;
        }

        // Validate count
        if (attachments.length >= MAX_FILES) {
            setError('max_files_reached');
            return;
        }

        const fileType = getFileType(file.type);
        
        try {
            const attachment: FileAttachment = {
                id: crypto.randomUUID(),
                name: file.name,
                type: fileType,
                mimeType: file.type,
                size: file.size,
                filePath: await persistAttachmentFile(file, workspacePath),
            };

            if (fileType === 'image') {
                attachment.preview = URL.createObjectURL(file);
            }

            setAttachments((prev) => [...prev, attachment]);
        } catch (err) {
            setError('read_error');
            console.error('[useFileAttachment] Failed to read file:', err);
        }
    }, [attachments.length, workspacePath]);

    const addFiles = useCallback(async (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
            await addFile(file);
        }
    }, [addFile]);

    const removeAttachment = useCallback((id: string) => {
        setAttachments((prev) => {
            const target = prev.find((attachment) => attachment.id === id);
            if (target?.preview?.startsWith('blob:')) {
                URL.revokeObjectURL(target.preview);
            }
            return prev.filter((attachment) => attachment.id !== id);
        });
    }, []);

    const clearAttachments = useCallback(() => {
        setAttachments((prev) => {
            for (const attachment of prev) {
                if (attachment.preview?.startsWith('blob:')) {
                    URL.revokeObjectURL(attachment.preview);
                }
            }
            return [];
        });
        setError(null);
    }, []);

    /** Handle paste event (for clipboard images) */
    const handlePaste = useCallback(async (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) await addFile(file);
            }
        }
    }, [addFile]);

    /** Handle drop event */
    const handleDrop = useCallback(async (e: DragEvent) => {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            await addFiles(files);
        }
    }, [addFiles]);

    /**
     * Build sidecar message content with resolved local attachment paths.
     */
    const buildContentWithAttachments = useCallback((textMessage: string): string => {
        if (attachments.length === 0) return textMessage;

        const parts: string[] = [
            '[Resolved attachments]',
            ...attachments.map((att) => `- ${att.filePath}`),
        ];
        if (textMessage.trim()) {
            parts.push('');
            parts.push(textMessage.trim());
        }
        return parts.join('\n');
    }, [attachments]);

    return {
        attachments,
        error,
        addFile,
        addFiles,
        removeAttachment,
        clearAttachments,
        handlePaste,
        handleDrop,
        buildContentWithAttachments,
    };
}
