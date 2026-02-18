/**
 * Tauri Runtime Detection
 *
 * Provides utilities to detect whether the app is running inside a Tauri
 * WebView or a regular browser. Tauri APIs (invoke, listen, etc.) are only
 * available inside the WebView; calling them from a plain browser will throw.
 */

/**
 * Returns true when the page is loaded inside a Tauri WebView.
 * Safe to call at module-level or inside components.
 */
export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Wraps a Tauri API call so it silently returns `fallback` when running
 * outside the Tauri WebView (e.g. during Vite dev in a regular browser).
 */
export async function safeTauriCall<T>(
    fn: () => Promise<T>,
    fallback: T,
    label?: string,
): Promise<T> {
    if (!isTauri()) {
        if (label) {
            console.debug(`[Tauri] Skipped '${label}' — not running inside Tauri WebView`);
        }
        return fallback;
    }
    try {
        return await fn();
    } catch (err) {
        console.warn(`[Tauri] Call failed${label ? ` (${label})` : ''}:`, err);
        return fallback;
    }
}
