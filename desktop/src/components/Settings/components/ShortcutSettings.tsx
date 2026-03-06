/**
 * ShortcutSettings Component
 *
 * Displays and allows editing of keyboard shortcuts.
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

const ResetIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 .49-9L1 10" />
    </svg>
);

function eventToShortcutString(event: KeyboardEvent): string | null {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
        return null;
    }

    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    let key = event.key;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();

    if (parts.length === 0) return null;

    parts.push(key);
    return parts.join('+');
}

export function ShortcutSettings() {
    const { t } = useTranslation();
    const [shortcuts, setShortcuts] = useState<ShortcutConfig>(DEFAULT_SHORTCUTS);
    const [recording, setRecording] = useState<ShortcutKey | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        void getShortcuts().then((nextShortcuts) => {
            setShortcuts(nextShortcuts);
            setLoaded(true);
        });
    }, []);

    useEffect(() => {
        if (!recording) return;

        const handler = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === 'Escape') {
                setRecording(null);
                return;
            }

            const combo = eventToShortcutString(event);
            if (!combo) return;

            const conflict = SHORTCUT_ENTRIES.find(
                (entry) => entry.key !== recording && shortcuts[entry.key] === combo
            );

            if (conflict) {
                toast.error(t('settings.shortcutConflict'));
                return;
            }

            const updated = { ...shortcuts, [recording]: combo };
            setShortcuts(updated);
            setRecording(null);

            void (async () => {
                try {
                    if (recording === 'toggleWindow' && isTauri()) {
                        const { invoke } = await import('@tauri-apps/api/core');
                        await invoke('update_global_shortcut', {
                            oldShortcut: shortcuts.toggleWindow,
                            newShortcut: combo,
                        });
                    }

                    await saveShortcuts(updated);
                    toast.success(t('settings.shortcutUpdated'));
                } catch (error) {
                    setShortcuts(shortcuts);
                    toast.error(
                        t('common.error'),
                        error instanceof Error ? error.message : String(error)
                    );
                }
            })();
        };

        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [recording, shortcuts, t]);

    const handleReset = useCallback(async (key: ShortcutKey) => {
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
        } catch (error) {
            setShortcuts(shortcuts);
            toast.error(
                t('common.error'),
                error instanceof Error ? error.message : String(error)
            );
        }
    }, [shortcuts, t]);

    if (!loaded) return null;

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>
                <div>
                    <h3>{t('settings.shortcuts')}</h3>
                    <p>{t('settings.shortcutsHint')}</p>
                </div>
            </div>

            <div className={styles.stack}>
                {SHORTCUT_ENTRIES.map((entry) => (
                    <div key={entry.key} className={styles.shortcutRow}>
                        <div className={styles.shortcutInfo}>
                            <span className={`${styles.scopeBadge} ${entry.scope === 'global' ? styles.scopeBadgeGlobal : styles.scopeBadgeWindow}`}>
                                {entry.scope === 'global'
                                    ? t('settings.globalShortcut')
                                    : t('settings.windowShortcut')}
                            </span>
                            <div className={styles.shortcutCopy}>
                                <span className={styles.shortcutLabel}>{t(entry.labelKey)}</span>
                                <span className={styles.shortcutHint}>
                                    {recording === entry.key ? t('settings.pressKeys') : shortcuts[entry.key]}
                                </span>
                            </div>
                        </div>

                        <div className={styles.shortcutActions}>
                            <button
                                type="button"
                                className={`${styles.shortcutCapture} ${recording === entry.key ? styles.shortcutCaptureRecording : ''}`}
                                onClick={() => setRecording(recording === entry.key ? null : entry.key)}
                                aria-pressed={recording === entry.key}
                            >
                                {recording === entry.key ? t('settings.pressKeys') : shortcuts[entry.key]}
                            </button>

                            {shortcuts[entry.key] !== DEFAULT_SHORTCUTS[entry.key] && (
                                <button
                                    type="button"
                                    className={styles.iconButton}
                                    onClick={() => void handleReset(entry.key)}
                                    title={t('settings.resetDefault')}
                                    aria-label={t('settings.resetDefault')}
                                >
                                    <ResetIcon />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
