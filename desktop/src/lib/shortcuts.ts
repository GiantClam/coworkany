export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') {
        return false;
    }

    return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function formatShortcutForDisplay(shortcut: string): string {
    const mac = isMacPlatform();
    const parts = shortcut.split('+').map((part) => part.trim());

    const mapped = parts.map((part) => {
        const key = part.toLowerCase();

        if (mac) {
            if (key === 'ctrl' || key === 'cmdorctrl' || key === 'meta') return '⌘';
            if (key === 'shift') return '⇧';
            if (key === 'alt' || key === 'option') return '⌥';
            if (key === 'enter') return '↵';
            return part.length === 1 ? part.toUpperCase() : part;
        }

        if (key === 'cmdorctrl') return 'Ctrl';
        if (key === 'meta') return 'Win';
        return part.length === 1 ? part.toUpperCase() : part;
    });

    return mac ? mapped.join('') : mapped.join('+');
}
