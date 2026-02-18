/**
 * ShortcutSettings Component
 *
 * Displays and allows editing of keyboard shortcuts.
 * - Toggle Window (global, managed by Tauri)
 * - New Task (window-level, managed by React)
 * - Open Settings (window-level, managed by React)
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getShortcuts,
    saveShortcuts,
    DEFAULT_SHORTCUTS,
    type ShortcutConfig,
} from '../../../lib/configStore';
import { isTauri } from '../../../lib/tauri';
import { toast } from '../../Common/ToastProvider';
import styles from '../SettingsView.module.css';

type ShortcutKey = keyof ShortcutConfig;

interface ShortcutEntry {
    key: ShortcutKey;
    labelKey: string;
    scope: 'global' | 'window';
}

const SHORTCUT_ENTRIES: ShortcutEntry[] = [
    { key: 'toggleWindow', labelKey: 'settings.toggleWindow', scope: 'global' },
    { key: 'newTask', labelKey: 'settings.newTask', scope: 'window' },
    { key: 'openSettings', labelKey: 'settings.openSettings', scope: 'window' },
];

/** Convert a KeyboardEvent to a shortcut string like "Ctrl+Shift+K" */
function eventToShortcutString(e: KeyboardEvent): string | null {
    // Ignore standalone modifier keys
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return null;
    }

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    // Normalize key name
    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key === ',') key = ',';
    else if (key.length === 1) key = key.toUpperCase();

    // Must have at least one modifier
    if (parts.length === 0) return null;

    parts.push(key);
    return parts.join('+');
}

export function ShortcutSettings() {
    const { t } = useTranslation();
    const [shortcuts, setShortcuts] = useState<ShortcutConfig>(DEFAULT_SHORTCUTS);
    const [recording, setRecording] = useState<ShortcutKey | null>(null);
    const [loaded, setLoaded] = useState(false);

    // Load shortcuts on mount
    useEffect(() => {
        void getShortcuts().then((s) => {
            setShortcuts(s);
            setLoaded(true);
        });
    }, []);

    // Keyboard capture when recording
    useEffect(() => {
        if (!recording) return;

        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Escape cancels recording
            if (e.key === 'Escape') {
                setRecording(null);
                return;
            }

            const combo = eventToShortcutString(e);
            if (!combo) return;

            // Check for conflicts with other shortcuts
            const conflict = SHORTCUT_ENTRIES.find(
                (entry) => entry.key !== recording && shortcuts[entry.key] === combo
            );
            if (conflict) {
                toast.error(t('settings.shortcutConflict'));
                return;
            }

            // Update and save
            const updated = { ...shortcuts, [recording]: combo };
            setShortcuts(updated);
            setRecording(null);

            void (async () => {
                try {
                    // If this is the global toggle window shortcut, update via Tauri IPC
                    if (recording === 'toggleWindow' && isTauri()) {
                        const { invoke } = await import('@tauri-apps/api/core');
                        await invoke('update_global_shortcut', {
                            oldShortcut: shortcuts.toggleWindow,
                            newShortcut: combo,
                        });
                    }
                    await saveShortcuts(updated);
                    toast.success(t('settings.shortcutUpdated'));
                } catch (err) {
                    // Revert on failure
                    setShortcuts(shortcuts);
                    toast.error(
                        t('common.error'),
                        err instanceof Error ? err.message : String(err)
                    );
                }
            })();
        };

        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [recording, shortcuts, t]);

    const handleReset = useCallback(
        async (key: ShortcutKey) => {
            const defaultValue = DEFAULT_SHORTCUTS[key];
            const updated = { ...shortcuts, [key]: defaultValue };
            setShortcuts(updated);

            try {
                if (key === 'toggleWindow' && isTauri()) {
                    const { invoke } = await import('@tauri-apps/api/core');
                    await invoke('update_global_shortcut', {
                        oldShortcut: shortcuts.toggleWindow,
                        newShortcut: defaultValue,
                    });
                }
                await saveShortcuts(updated);
                toast.success(t('settings.shortcutUpdated'));
            } catch (err) {
                setShortcuts(shortcuts);
                toast.error(
                    t('common.error'),
                    err instanceof Error ? err.message : String(err)
                );
            }
        },
        [shortcuts, t]
    );

    if (!loaded) return null;

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>
                <h3>{t('settings.shortcuts')}</h3>
                <p>{t('settings.shortcutsHint')}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {SHORTCUT_ENTRIES.map((entry) => (
                    <div
                        key={entry.key}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--bg-panel)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                                style={{
                                    fontSize: '10px',
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background:
                                        entry.scope === 'global'
                                            ? 'var(--accent-subtle)'
                                            : 'var(--bg-surface)',
                                    color:
                                        entry.scope === 'global'
                                            ? 'var(--accent-primary)'
                                            : 'var(--text-secondary)',
                                    border: '1px solid var(--border-subtle)',
                                    fontWeight: 500,
                                }}
                            >
                                {entry.scope === 'global'
                                    ? t('settings.globalShortcut')
                                    : t('settings.windowShortcut')}
                            </span>
                            <span
                                style={{
                                    fontFamily: 'var(--font-body)',
                                    fontSize: 'var(--font-size-sm)',
                                    color: 'var(--text-primary)',
                                }}
                            >
                                {t(entry.labelKey)}
                            </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                                onClick={() =>
                                    setRecording(recording === entry.key ? null : entry.key)
                                }
                                style={{
                                    padding: '4px 10px',
                                    border:
                                        recording === entry.key
                                            ? '2px solid var(--accent-primary)'
                                            : '1px solid var(--border-subtle)',
                                    borderRadius: 'var(--radius-sm)',
                                    background:
                                        recording === entry.key
                                            ? 'var(--accent-subtle)'
                                            : 'var(--bg-surface)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontFamily: 'var(--font-mono, monospace)',
                                    fontSize: 'var(--font-size-xs)',
                                    fontWeight: 600,
                                    minWidth: 100,
                                    textAlign: 'center',
                                    transition: 'var(--transition-fast)',
                                }}
                            >
                                {recording === entry.key
                                    ? t('settings.pressKeys')
                                    : shortcuts[entry.key]}
                            </button>

                            {shortcuts[entry.key] !== DEFAULT_SHORTCUTS[entry.key] && (
                                <button
                                    onClick={() => void handleReset(entry.key)}
                                    title={t('settings.resetDefault')}
                                    style={{
                                        padding: '4px 6px',
                                        border: '1px solid var(--border-subtle)',
                                        borderRadius: 'var(--radius-sm)',
                                        background: 'transparent',
                                        color: 'var(--text-tertiary)',
                                        cursor: 'pointer',
                                        fontSize: '11px',
                                        lineHeight: 1,
                                    }}
                                >
                                    ↺
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
