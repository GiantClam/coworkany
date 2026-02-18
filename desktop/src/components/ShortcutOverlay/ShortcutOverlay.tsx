import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ShortcutOverlayProps {
    open: boolean;
    onClose: () => void;
    shortcuts: {
        commandPalette: string;
        newTask: string;
        quickChat: string;
        openSettings: string;
        showShortcuts: string;
        esc: string;
    };
}

export const ShortcutOverlay: React.FC<ShortcutOverlayProps> = ({ open, onClose, shortcuts }) => {
    const { t } = useTranslation();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeBtnRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return;

        const previousActive = document.activeElement as HTMLElement | null;
        closeBtnRef.current?.focus();

        const handleOverlayKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key !== 'Tab' || !dialogRef.current) return;

            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                )
            ).filter((el) => !el.hasAttribute('disabled'));

            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement as HTMLElement | null;

            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener('keydown', handleOverlayKeyDown);

        return () => {
            window.removeEventListener('keydown', handleOverlayKeyDown);
            previousActive?.focus();
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-panel rounded-xl border border-subtle shadow-float p-6 max-w-md w-full mx-4"
                role="dialog"
                aria-modal="true"
                aria-label={t('shortcutsOverlay.title')}
                ref={dialogRef}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-primary">{t('shortcutsOverlay.title')}</h2>
                    <button
                        ref={closeBtnRef}
                        onClick={onClose}
                        className="p-1 hover:bg-element rounded"
                        aria-label={t('common.close')}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-subtle">
                        <span className="text-secondary">{t('shortcutsOverlay.commandPalette')}</span>
                        <kbd className="px-2 py-1 bg-element rounded text-xs">{shortcuts.commandPalette}</kbd>
                    </div>
                    <div className="flex justify-between py-2 border-b border-subtle">
                        <span className="text-secondary">{t('shortcutsOverlay.newTask')}</span>
                        <kbd className="px-2 py-1 bg-element rounded text-xs">{shortcuts.newTask}</kbd>
                    </div>
                    <div className="flex justify-between py-2 border-b border-subtle">
                        <span className="text-secondary">{t('shortcutsOverlay.quickChat')}</span>
                        <kbd className="px-2 py-1 bg-element rounded text-xs">{shortcuts.quickChat}</kbd>
                    </div>
                    <div className="flex justify-between py-2 border-b border-subtle">
                        <span className="text-secondary">{t('shortcutsOverlay.openSettings')}</span>
                        <kbd className="px-2 py-1 bg-element rounded text-xs">{shortcuts.openSettings}</kbd>
                    </div>
                    <div className="flex justify-between py-2 border-b border-subtle">
                        <span className="text-secondary">{t('shortcutsOverlay.showHelp')}</span>
                        <kbd className="px-2 py-1 bg-element rounded text-xs">{shortcuts.showShortcuts}</kbd>
                    </div>
                    <div className="flex justify-between py-2">
                        <span className="text-secondary">{t('shortcutsOverlay.closeModal')}</span>
                        <kbd className="px-2 py-1 bg-element rounded text-xs">{shortcuts.esc}</kbd>
                    </div>
                </div>
            </div>
        </div>
    );
};
