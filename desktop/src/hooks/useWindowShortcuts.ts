/**
 * useWindowShortcuts Hook
 *
 * Listens for window-level keyboard shortcuts (Ctrl+N, Ctrl+,)
 * and invokes the appropriate callbacks.
 */

import { useEffect } from 'react';
import { getShortcuts, type ShortcutConfig } from '../lib/configStore';

type ShortcutAction = 'newTask' | 'openSettings';

/** Convert a KeyboardEvent to a shortcut string matching our config format */
function matchEvent(e: KeyboardEvent): string | null {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key === ',') key = ',';
    else if (key.length === 1) key = key.toUpperCase();

    if (parts.length === 0) return null;
    parts.push(key);
    return parts.join('+');
}

export function useWindowShortcuts(
    callbacks: Partial<Record<ShortcutAction, () => void>>
) {
    useEffect(() => {
        let shortcuts: ShortcutConfig | null = null;

        // Load shortcuts asynchronously
        void getShortcuts().then((s) => {
            shortcuts = s;
        });

        const handler = (e: KeyboardEvent) => {
            if (!shortcuts) return;

            // Don't capture when user is recording a shortcut or typing in an input
            const target = e.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            const combo = matchEvent(e);
            if (!combo) return;

            if (combo === shortcuts.newTask && callbacks.newTask) {
                e.preventDefault();
                callbacks.newTask();
            } else if (combo === shortcuts.openSettings && callbacks.openSettings) {
                e.preventDefault();
                callbacks.openSettings();
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [callbacks]);
}
