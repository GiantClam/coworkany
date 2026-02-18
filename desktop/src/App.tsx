import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useTauriEvents } from './hooks/useTauriEvents';
import { useEffectConfirmation } from './hooks/useEffectConfirmation';
import { EffectConfirmationDialog } from './components/EffectConfirmationDialog';
import { DashboardView } from './components/Dashboard/DashboardView';
import { useUIStore } from './stores/uiStore';
import { ChatInterface } from './components/Chat/ChatInterface';
import { SectionErrorBoundary } from './components/Common/AppErrorBoundary';
import { UpdateChecker } from './components/Common/UpdateChecker';
import { OfflineBanner } from './components/Common/OfflineBanner';
import { SetupWizard } from './components/Setup/SetupWizard';
import { isFirstRun } from './lib/configStore';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { ShortcutOverlay } from './components/ShortcutOverlay/ShortcutOverlay';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SHORTCUTS } from './lib/configStore';
import { formatShortcutForDisplay } from './lib/shortcuts';
import { createCommandRegistry } from './lib/commandRegistry';
import type { AppCommandId } from './lib/commandRegistry';
import { ModalDialog } from './components/Common/ModalDialog';
import { getFeatureFlag, setFeatureFlag } from './lib/uiPreferences';
import { getShortcuts } from './lib/configStore';
import { toast } from './components/Common/ToastProvider';
import { startAllServices } from './hooks/useServiceManager';

const SkillsViewLazy = lazy(async () => {
    const mod = await import('./components/Skills/SkillsView');
    return { default: mod.SkillsView };
});

const McpViewLazy = lazy(async () => {
    const mod = await import('./components/Mcp/McpView');
    return { default: mod.McpView };
});

const SettingsViewLazy = lazy(async () => {
    const mod = await import('./components/Settings/SettingsView');
    return { default: mod.SettingsView };
});

function App() {
    const { t } = useTranslation();
    const commandPaletteShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.commandPalette);
    const newTaskShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.newTask);
    const quickChatShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.quickChat);
    const openSettingsShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.openSettings);
    const showShortcutsShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.showShortcuts);

    // Initialize Tauri event listeners
    useTauriEvents();

    // First-run detection — sync fast-path from localStorage avoids Loading state
    const [showSetup, setShowSetup] = useState<boolean>(() => {
        // Synchronous check: if key exists, setup was already completed
        try {
            const raw = localStorage.getItem('coworkany:setupCompleted');
            if (raw !== null) return false; // already done — no wizard
        } catch { /* ignore */ }
        return true; // first run (Tauri store will confirm async below)
    });
    const [newShellEnabled, setNewShellEnabled] = useState(true);

    // Command palette state
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
    const [skillsDialogOpen, setSkillsDialogOpen] = useState(false);
    const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

    const { viewMode, switchToLauncher, openDashboard } = useUIStore();

    useEffect(() => {
        // Confirm with Tauri store async (corrects sync guess if needed)
        isFirstRun()
            .then(first => setShowSetup(first))
            .catch(() => setShowSetup(false));
    }, []);

    useEffect(() => {
        let mounted = true;
        void getFeatureFlag('newShellEnabled', true)
            .then((enabled) => {
                if (mounted) {
                    setNewShellEnabled(enabled);
                }
            })
            .catch(() => {
                if (mounted) {
                    setNewShellEnabled(true);
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        // Record first meaningful app paint timing for runtime diagnostics.
        if (window.__coworkanyPerf && !window.__coworkanyPerf.firstPaint) {
            window.__coworkanyPerf.firstPaint = performance.now();
            console.info('[perf] app_first_paint_ms', Math.round(window.__coworkanyPerf.firstPaint - window.__coworkanyPerf.appStart));
        }
    }, []);

    useEffect(() => {
        // Warm backend services in background to keep first interaction snappy.
        let cancelled = false;
        const timer = window.setTimeout(() => {
            void startAllServices()
                .then((result) => {
                    if (cancelled) return;
                    if (!result.success) {
                        console.warn('[services] warmup failed:', result.message);
                    }
                })
                .catch((err) => {
                    if (!cancelled) {
                        console.warn('[services] warmup error:', err);
                    }
                });
        }, 800);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, []);

    const toggleNewShell = useCallback(() => {
        setNewShellEnabled((prev) => {
            const next = !prev;
            void setFeatureFlag('newShellEnabled', next);
            return next;
        });
    }, []);

    const exportDiagnostics = useCallback(async () => {
        try {
            const shortcuts = await getShortcuts();
            const payload = {
                timestamp: new Date().toISOString(),
                locale: navigator.language,
                shell: {
                    newShellEnabled,
                },
                viewMode,
                overlays: {
                    commandPaletteOpen,
                    shortcutsOverlayOpen,
                    skillsDialogOpen,
                    mcpDialogOpen,
                    settingsDialogOpen,
                },
                shortcuts,
            };

            const text = JSON.stringify(payload, null, 2);
            await navigator.clipboard.writeText(text);
            console.info('[ui-diagnostics]', payload);
            toast.success(t('diagnostics.title'), t('diagnostics.description'));
        } catch {
            toast.error(t('diagnostics.failedTitle'), t('diagnostics.failedDescription'));
        }
    }, [
        newShellEnabled,
        viewMode,
        commandPaletteOpen,
        shortcutsOverlayOpen,
        skillsDialogOpen,
        mcpDialogOpen,
        settingsDialogOpen,
        t,
    ]);

    const openQuickChat = useCallback(async () => {
        try {
            await invoke('open_quickchat');
        } catch (e) {
            console.error('Failed to open quick chat:', e);
        }
    }, []);

    // Effect confirmation logic
    const {
        pendingRequest,
        isDialogOpen,
        approve,
        deny,
        closeDialog,
    } = useEffectConfirmation();

    // Command definitions: single registry for all command sources.
    const commands = useMemo(() => createCommandRegistry(
        t,
        {
            onNewTask: () => { void switchToLauncher(); },
            onOpenProject: () => {
                // TODO: Implement project picker
            },
            onTaskList: () => { void openDashboard(); },
            onOpenSkills: () => setSkillsDialogOpen(true),
            onOpenMcp: () => setMcpDialogOpen(true),
            onOpenSettings: () => setSettingsDialogOpen(true),
            onShowShortcuts: () => setShortcutsOverlayOpen(true),
            onOpenQuickChat: () => { void openQuickChat(); },
            onToggleNewShell: toggleNewShell,
            onExportDiagnostics: () => { void exportDiagnostics(); },
        },
        {
            newTask: newTaskShortcut,
            commandPalette: commandPaletteShortcut,
            openSettings: openSettingsShortcut,
            showShortcuts: showShortcutsShortcut,
            quickChat: quickChatShortcut,
        },
        {
            newShellEnabled,
        }
    ), [
        t,
        switchToLauncher,
        openDashboard,
        openQuickChat,
        toggleNewShell,
        exportDiagnostics,
        newShellEnabled,
        newTaskShortcut,
        commandPaletteShortcut,
        openSettingsShortcut,
        showShortcutsShortcut,
        quickChatShortcut,
    ]);

    const commandHandlers = useMemo(() => {
        const handlers = new Map<AppCommandId, () => void>();
        for (const command of commands) {
            handlers.set(command.id as AppCommandId, command.action);
        }
        return handlers;
    }, [commands]);

    const runCommandById = useCallback((id: string) => {
        const handler = commandHandlers.get(id as AppCommandId);
        if (handler) {
            handler();
        }
    }, [commandHandlers]);

    useEffect(() => {
        const unlistenCommandExecuted = listen<{ id?: string }>('command-executed', (event) => {
            const id = event.payload?.id;
            if (id) {
                runCommandById(id);
            }
        });

        return () => {
            unlistenCommandExecuted.then((fn) => fn());
        };
    }, [runCommandById]);

    // Global shortcuts
    useGlobalShortcuts({
        commandPalette: useCallback(() => setCommandPaletteOpen(true), []),
        newTask: useCallback(() => switchToLauncher(), [switchToLauncher]),
        showShortcuts: useCallback(() => setShortcutsOverlayOpen(true), []),
        openSettings: useCallback(() => setSettingsDialogOpen(true), []),
        quickChat: useCallback(() => {
            void openQuickChat();
        }, [openQuickChat]),
    });

    // Show Setup Wizard for first-time users
    if (showSetup) {
        return <SetupWizard onComplete={() => setShowSetup(false)} />;
    }

    return (
        <div className="h-screen w-screen overflow-hidden bg-app relative font-sans text-primary">

            {/* Command Palette */}
            <CommandPalette
                open={commandPaletteOpen}
                onOpenChange={setCommandPaletteOpen}
                commands={commands}
            />

            {newShellEnabled && (
                <ShortcutOverlay
                    open={shortcutsOverlayOpen}
                    onClose={() => setShortcutsOverlayOpen(false)}
                    shortcuts={{
                        commandPalette: commandPaletteShortcut,
                        newTask: newTaskShortcut,
                        quickChat: quickChatShortcut,
                        openSettings: openSettingsShortcut,
                        showShortcuts: showShortcutsShortcut,
                        esc: t('shortcutsOverlay.esc'),
                    }}
                />
            )}

            {/* Main Interactive Layer - Chat Interface is now primary */}
            <SectionErrorBoundary resetKeys={[viewMode]}>
                <div className="h-full w-full overflow-hidden">
                    <ChatInterface
                        onOpenSkills={newShellEnabled ? () => setSkillsDialogOpen(true) : undefined}
                        onOpenMcp={newShellEnabled ? () => setMcpDialogOpen(true) : undefined}
                        onOpenSettings={newShellEnabled ? () => setSettingsDialogOpen(true) : undefined}
                    />
                </div>
            </SectionErrorBoundary>

            {newShellEnabled && (
                <ModalDialog
                    open={skillsDialogOpen}
                    onClose={() => setSkillsDialogOpen(false)}
                    title={t('chat.manageSkills')}
                >
                    <Suspense fallback={<div style={{ padding: 16 }}>Loading...</div>}>
                        <div style={{ height: '100%', overflow: 'hidden' }}>
                            <SkillsViewLazy />
                        </div>
                    </Suspense>
                </ModalDialog>
            )}

            {newShellEnabled && (
                <ModalDialog
                    open={mcpDialogOpen}
                    onClose={() => setMcpDialogOpen(false)}
                    title={t('chat.manageMcpServers')}
                >
                    <Suspense fallback={<div style={{ padding: 16 }}>Loading...</div>}>
                        <div style={{ height: '100%', overflow: 'hidden' }}>
                            <McpViewLazy />
                        </div>
                    </Suspense>
                </ModalDialog>
            )}

            {newShellEnabled && (
                <ModalDialog
                    open={settingsDialogOpen}
                    onClose={() => setSettingsDialogOpen(false)}
                    title={t('chat.llmSettings')}
                >
                    <Suspense fallback={<div style={{ padding: 16 }}>Loading...</div>}>
                        <div style={{ height: '100%', overflow: 'hidden' }}>
                            <SettingsViewLazy />
                        </div>
                    </Suspense>
                </ModalDialog>
            )}

            {/* Dashboard View (Overlay) */}
            {viewMode === 'dashboard' && (
                <SectionErrorBoundary>
                    <DashboardView />
                </SectionErrorBoundary>
            )}

            {/* Effect Confirmation Dialog - Always on top */}
            <EffectConfirmationDialog
                request={pendingRequest}
                open={isDialogOpen}
                onApprove={approve}
                onDeny={deny}
                onClose={closeDialog}
            />

            {/* Offline Banner - top center */}
            <OfflineBanner />

            {/* Update Checker - bottom-right notification */}
            <UpdateChecker />
        </div>
    );
}

export default App;
