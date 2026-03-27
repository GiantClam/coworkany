import { invoke } from '@tauri-apps/api/core';
import { openExternalUrl } from './externalLinks';
import { isTauri } from './tauri';

export interface DownloadRemoteFileResult {
    savedPath: string;
    fileName: string;
}

export interface TextPreviewResult {
    content: string;
    truncated: boolean;
}

export async function openLocalFile(path: string): Promise<void> {
    if (isTauri()) {
        await invoke('open_local_file', { path });
        return;
    }

    window.open(`file://${path}`, '_blank', 'noopener,noreferrer');
}

export async function downloadRemoteFile(
    url: string,
    suggestedName?: string,
): Promise<DownloadRemoteFileResult> {
    if (isTauri()) {
        return invoke<DownloadRemoteFileResult>('download_remote_file', {
            url,
            suggestedName,
        });
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = suggestedName || url.split('/').pop() || 'download';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);

    return {
        savedPath: anchor.download,
        fileName: anchor.download,
    };
}

export async function readLocalTextPreview(
    path: string,
    maxBytes: number = 1024 * 1024,
): Promise<TextPreviewResult> {
    if (isTauri()) {
        return invoke<TextPreviewResult>('read_text_file_preview', {
            path,
            maxBytes,
        });
    }

    throw new Error('Local previews require the desktop app runtime.');
}

export async function fetchRemoteTextPreview(
    url: string,
    maxBytes: number = 1024 * 1024,
): Promise<TextPreviewResult> {
    if (isTauri()) {
        return invoke<TextPreviewResult>('fetch_remote_text_preview', {
            url,
            maxBytes,
        });
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Preview request failed with status ${response.status}`);
    }

    const content = await response.text();
    const truncated = content.length > maxBytes;
    return {
        content: truncated ? content.slice(0, maxBytes) : content,
        truncated,
    };
}

export async function openRemoteUrl(url: string): Promise<void> {
    await openExternalUrl(url);
}
