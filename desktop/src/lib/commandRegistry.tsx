import type { TFunction } from 'i18next';
import type { Command } from '../components/CommandPalette/CommandPalette';

export type AppCommandId =
    | 'new-task'
    | 'open-project'
    | 'task-list'
    | 'quick-chat'
    | 'skills'
    | 'mcp'
    | 'settings'
    | 'shortcuts'
    | 'toggle-shell'
    | 'export-diagnostics';

type CommandActionContext = {
    onNewTask: () => void;
    onOpenProject: () => void;
    onTaskList: () => void;
    onOpenSkills: () => void;
    onOpenMcp: () => void;
    onOpenSettings: () => void;
    onShowShortcuts: () => void;
    onOpenQuickChat: () => void;
    onToggleNewShell: () => void;
    onExportDiagnostics: () => void;
};

type CommandShortcutMap = {
    newTask: string;
    commandPalette: string;
    openSettings: string;
    showShortcuts: string;
    quickChat: string;
};

const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
);

const FolderIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
);

const ListIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
    </svg>
);

const ZapIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
    </svg>
);

const ServerIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="6" rx="1"></rect>
        <rect x="2" y="15" width="20" height="6" rx="1"></rect>
        <line x1="6" y1="6" x2="6.01" y2="6"></line>
        <line x1="6" y1="18" x2="6.01" y2="18"></line>
    </svg>
);

const KeyboardIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
        <path d="M6 8h.001"></path>
        <path d="M10 8h.001"></path>
        <path d="M14 8h.001"></path>
        <path d="M18 8h.001"></path>
        <path d="M8 12h.001"></path>
        <path d="M12 12h.001"></path>
        <path d="M16 12h.001"></path>
        <path d="M7 16h10"></path>
    </svg>
);

const SettingsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
);

const ChatIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
);

const InfoIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
);

export function createCommandRegistry(
    t: TFunction,
    actions: CommandActionContext,
    shortcuts: CommandShortcutMap,
    options?: {
        newShellEnabled?: boolean;
    }
): Command[] {
    const newShellEnabled = options?.newShellEnabled ?? true;

    return [
        {
            id: 'new-task',
            label: t('welcome.newTask'),
            icon: <PlusIcon />,
            shortcut: shortcuts.newTask,
            category: 'primary',
            action: actions.onNewTask,
        },
        {
            id: 'open-project',
            label: t('welcome.openProject'),
            icon: <FolderIcon />,
            category: 'primary',
            action: actions.onOpenProject,
        },
        {
            id: 'task-list',
            label: t('welcome.taskList'),
            icon: <ListIcon />,
            category: 'primary',
            action: actions.onTaskList,
        },
        {
            id: 'quick-chat',
            label: t('quickChat.title'),
            icon: <ChatIcon />,
            shortcut: shortcuts.quickChat,
            category: 'secondary',
            action: actions.onOpenQuickChat,
        },
        {
            id: 'skills',
            label: t('chat.manageSkills'),
            icon: <ZapIcon />,
            category: 'secondary',
            action: actions.onOpenSkills,
        },
        {
            id: 'mcp',
            label: t('mcp.mcpServers'),
            icon: <ServerIcon />,
            category: 'secondary',
            action: actions.onOpenMcp,
        },
        {
            id: 'settings',
            label: t('settings.title'),
            icon: <SettingsIcon />,
            shortcut: shortcuts.openSettings,
            category: 'settings',
            action: actions.onOpenSettings,
        },
        {
            id: 'shortcuts',
            label: t('shortcutsOverlay.showHelp'),
            icon: <KeyboardIcon />,
            shortcut: shortcuts.showShortcuts,
            category: 'settings',
            action: actions.onShowShortcuts,
        },
        {
            id: 'toggle-shell',
            label: newShellEnabled ? t('settings.disableNewShell') : t('settings.enableNewShell'),
            icon: <SettingsIcon />,
            category: 'settings',
            action: actions.onToggleNewShell,
        },
        {
            id: 'export-diagnostics',
            label: t('settings.exportDiagnostics'),
            icon: <InfoIcon />,
            category: 'settings',
            action: actions.onExportDiagnostics,
        },
    ];
}
