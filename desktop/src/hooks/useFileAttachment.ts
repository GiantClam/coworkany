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

export interface FileAttachment {
    id: string;
    name: string;
    type: 'image' | 'text' | 'pdf' | 'other';
    mimeType: string;
    size: number;
    /** base64-encoded content for images */
    base64?: string;
    /** text content for text files */
    textContent?: string;
    /** thumbnail data URL for preview */
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

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Remove the data URL prefix
            resolve(result.split(',')[1] || result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

export function useFileAttachment() {
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
            };

            if (fileType === 'image') {
                attachment.base64 = await readFileAsBase64(file);
                attachment.preview = `data:${file.type};base64,${attachment.base64}`;
            } else if (fileType === 'text') {
                attachment.textContent = await readFileAsText(file);
            } else if (fileType === 'pdf') {
                // For PDF, read as base64 and extract text later on sidecar side
                attachment.base64 = await readFileAsBase64(file);
            } else {
                attachment.base64 = await readFileAsBase64(file);
            }

            setAttachments((prev) => [...prev, attachment]);
        } catch (err) {
            setError('read_error');
            console.error('[useFileAttachment] Failed to read file:', err);
        }
    }, [attachments.length]);

    const addFiles = useCallback(async (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
            await addFile(file);
        }
    }, [addFile]);

    const removeAttachment = useCallback((id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    }, []);

    const clearAttachments = useCallback(() => {
        setAttachments([]);
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
     * Build content array for sending to the sidecar.
     * Combines text message with attachments into Anthropic-compatible content blocks.
     */
    const buildContentWithAttachments = useCallback((textMessage: string): string => {
        if (attachments.length === 0) return textMessage;

        const parts: string[] = [];

        // Add attachments info as text
        for (const att of attachments) {
            if (att.type === 'image' && att.base64) {
                parts.push(`[Attached image: ${att.name} (${att.mimeType})]`);
                parts.push(`<image_base64 name="${att.name}" type="${att.mimeType}">${att.base64}</image_base64>`);
            } else if (att.type === 'text' && att.textContent) {
                parts.push(`[Attached file: ${att.name}]`);
                parts.push(`<attached_file name="${att.name}">\n${att.textContent}\n</attached_file>`);
            } else if (att.base64) {
                parts.push(`[Attached file: ${att.name} (${att.mimeType}, ${(att.size / 1024).toFixed(1)}KB)]`);
            }
        }

        // Add the user's text message
        if (textMessage.trim()) {
            parts.push(textMessage);
        }

        return parts.join('\n\n');
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
