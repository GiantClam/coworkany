/**
 * useGlobalShortcuts Hook
 *
 * Listens for application-level keyboard shortcuts and invokes the appropriate callbacks.
 * Supports: Cmd+K (command palette), Cmd+N (new task), Cmd+/ (shortcuts), Cmd+Shift+J (quick chat)
 */

import { useEffect, useCallback, useRef } from 'react';
import { getShortcuts, type ShortcutConfig } from '../lib/configStore';

export type GlobalShortcutAction = 
    | 'newTask' 
    | 'openSettings' 
    | 'commandPalette' 
    | 'showShortcuts' 
    | 'quickChat';

function matchEvent(e: KeyboardEvent): string | null {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key === ',') key = ',';
    else if (key === '/') key = '/';
    else if (key.length === 1) key = key.toUpperCase();

    if (parts.length === 0) return null;
    parts.push(key);
    return parts.join('+');
}

export function useGlobalShortcuts(
    callbacks: Partial<Record<GlobalShortcutAction, () => void>>
) {
    const shortcutsRef = useRef<ShortcutConfig | null>(null);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable
        ) {
            return;
        }

        // Prevent repeatedly triggering actions while a key is held down.
        if (e.repeat) {
            return;
        }

        const shortcuts = shortcutsRef.current;

        const combo = matchEvent(e);
        if (!combo || !shortcuts) return;

        if (combo === shortcuts.commandPalette && callbacks.commandPalette) {
            e.preventDefault();
            callbacks.commandPalette();
        } else if (combo === shortcuts.newTask && callbacks.newTask) {
            e.preventDefault();
            callbacks.newTask();
        } else if (combo === shortcuts.showShortcuts && callbacks.showShortcuts) {
            e.preventDefault();
            callbacks.showShortcuts();
        } else if (combo === shortcuts.quickChat && callbacks.quickChat) {
            e.preventDefault();
            callbacks.quickChat();
        } else if (combo === shortcuts.openSettings && callbacks.openSettings) {
            e.preventDefault();
            callbacks.openSettings();
        }
    }, [callbacks]);

    useEffect(() => {
        void getShortcuts().then((s) => {
            shortcutsRef.current = s;
        });

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}
