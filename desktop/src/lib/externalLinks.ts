import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function parseExternalUrl(rawHref: string | null | undefined): URL | null {
    if (!rawHref) return null;

    try {
        const url = new URL(rawHref, window.location.href);
        if (!EXTERNAL_PROTOCOLS.has(url.protocol)) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
}

export function isExternalHref(rawHref: string | null | undefined): boolean {
    return parseExternalUrl(rawHref) !== null;
}

export async function openExternalUrl(rawHref: string): Promise<void> {
    const url = parseExternalUrl(rawHref);
    if (!url) return;

    const href = url.toString();
    if (isTauri()) {
        await invoke('plugin:shell|open', {
            path: href,
        });
        return;
    }

    window.open(href, '_blank', 'noopener,noreferrer');
}
