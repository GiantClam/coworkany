import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useTauriEvents } from './hooks/useTauriEvents';
import { useEffectConfirmation } from './hooks/useEffectConfirmation';
import { EffectConfirmationDialog } from './components/EffectConfirmationDialog';
import { ChatInterface } from './components/Chat/ChatInterface';
import { SectionErrorBoundary } from './components/Common/AppErrorBoundary';
import { UpdateChecker } from './components/Common/UpdateChecker';
import { OfflineBanner } from './components/Common/OfflineBanner';
import { SetupWizard } from './components/Setup/SetupWizard';
import { MainLayout } from './components/Layout/Layout';
import { TitleBar } from './components/TitleBar/TitleBar';
import { isFirstRun, DEFAULT_SHORTCUTS, getShortcuts } from './lib/configStore';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { ShortcutOverlay } from './components/ShortcutOverlay/ShortcutOverlay';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { formatShortcutForDisplay } from './lib/shortcuts';
import { isMacPlatform } from './lib/shortcuts';
import { createCommandRegistry } from './lib/commandRegistry';
import type { AppCommandId } from './lib/commandRegistry';
import { ModalDialog } from './components/Common/ModalDialog';
import { StartupSkeleton } from './components/Common/StartupSkeleton';
import { toast } from './components/Common/ToastProvider';
import { startAllServices, startAllServicesBackground } from './hooks/useServiceManager';
import { IS_STARTUP_BASELINE } from './lib/startupProfile';
import { recordStartupMetric } from './lib/startupMetrics';
import { isTauri } from './lib/tauri';
import { isExternalHref, openExternalUrl } from './lib/externalLinks';
import { useTaskEventStore } from './stores/useTaskEventStore';
import { useWorkspace } from './hooks/useWorkspace';

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

type DoctorPreflightPayload = {
    success?: boolean;
    report?: unknown;
    markdown?: string;
    reportPath?: string;
    markdownPath?: string;
    error?: string;
};

type DoctorPreflightInvokeResult = {
    success: boolean;
    payload: DoctorPreflightPayload;
};

function App() {
    const { t } = useTranslation();
    const commandPaletteShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.commandPalette);
    const newTaskShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.newTask);
    const openSettingsShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.openSettings);
    const showShortcutsShortcut = formatShortcutForDisplay(DEFAULT_SHORTCUTS.showShortcuts);
    const useNativeMacTitleBar = isMacPlatform();

    useTauriEvents();

    const [showSetup, setShowSetup] = useState(false);
    const [setupStateResolved, setSetupStateResolved] = useState(false);

    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
    const [skillsDialogOpen, setSkillsDialogOpen] = useState(false);
    const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
    const [startupReadySent, setStartupReadySent] = useState(false);
    const [showStartupSkeleton, setShowStartupSkeleton] = useState(true);
    const startupSkeletonStartRef = useRef<number>(performance.now());
    const titlebarOffset = useNativeMacTitleBar ? 0 : 40;
    const appShellClassName = useNativeMacTitleBar
        ? 'app-shell app-shell-macos bg-app font-sans text-primary'
        : 'app-shell bg-app font-sans text-primary';
    const createDraftSession = useTaskEventStore((state) => state.createDraftSession);
    const { activeWorkspace } = useWorkspace({ autoLoad: true });

    const createNewTaskSession = useCallback(() => {
        createDraftSession({
            title: t('chat.newSessionTitle'),
            workspacePath: activeWorkspace?.path,
        });
    }, [activeWorkspace, createDraftSession, t]);

    useEffect(() => {
        let cancelled = false;
        isFirstRun()
            .then((first) => {
                if (cancelled) return;
                setShowSetup(first);
                setSetupStateResolved(true);
            })
            .catch(() => {
                if (cancelled) return;
                setShowSetup(false);
                setSetupStateResolved(true);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const handleDocumentClick = (event: MouseEvent) => {
            if (event.defaultPrevented) return;

            const target = event.target;
            if (!(target instanceof Element)) return;

            const anchor = target.closest('a[href]');
            if (!(anchor instanceof HTMLAnchorElement)) return;

            const href = anchor.getAttribute('href');
            if (!isExternalHref(href)) return;

            event.preventDefault();
            event.stopPropagation();
            void openExternalUrl(href ?? '').catch((error) => {
                console.error('[external-link] Failed to open link:', href, error);
            });
        };

        document.addEventListener('click', handleDocumentClick, true);
        return () => {
            document.removeEventListener('click', handleDocumentClick, true);
        };
    }, []);

    useEffect(() => {
        if (window.__coworkanyPerf && !window.__coworkanyPerf.firstPaint) {
            window.__coworkanyPerf.firstPaint = performance.now();
            const elapsed = window.__coworkanyPerf.firstPaint - window.__coworkanyPerf.appStart;
            const windowLabel = window.__coworkanyPerf.windowLabel ?? 'main';
            console.info('[perf] app_first_paint_ms', Math.round(elapsed));
            void recordStartupMetric('app_first_paint', elapsed, window.__coworkanyPerf.firstPaint, windowLabel);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const now = performance.now();
            const appStart = window.__coworkanyPerf?.appStart ?? now;
            const windowLabel = window.__coworkanyPerf?.windowLabel ?? 'main';
            void recordStartupMetric('frontend_ready', now - appStart, now, windowLabel);
            setStartupReadySent(true);
        }, 150);

        return () => {
            window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setShowStartupSkeleton(false);
        }, 450);

        return () => {
            window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        if (!startupReadySent) {
            return;
        }

        const minVisibleMs = 160;
        const elapsed = performance.now() - startupSkeletonStartRef.current;
        const remaining = Math.max(0, minVisibleMs - elapsed);
        const timer = window.setTimeout(() => {
            setShowStartupSkeleton(false);
        }, remaining);

        return () => {
            window.clearTimeout(timer);
        };
    }, [startupReadySent]);

    useEffect(() => {
        if (!setupStateResolved || showSetup) {
            return;
        }

        if (!IS_STARTUP_BASELINE && !startupReadySent) {
            return;
        }

        let cancelled = false;
        const runWarmup = () => {
            const starter = IS_STARTUP_BASELINE ? startAllServices : startAllServicesBackground;
            void starter()
                .then((result) => {
                    if (!cancelled && !result.success) {
                        console.warn('[services] warmup failed:', result.message);
                    }
                })
                .catch((err) => {
                    if (!cancelled) {
                        console.warn('[services] warmup error:', err);
                    }
                });
        };

        let timer: number | null = null;
        let idleHandle: number | null = null;
        if (IS_STARTUP_BASELINE) {
            timer = window.setTimeout(runWarmup, 800);
        } else {
            const requestIdle = (window as Window & {
                requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
            }).requestIdleCallback;

            if (typeof requestIdle === 'function') {
                idleHandle = requestIdle(() => runWarmup(), { timeout: 3500 });
            } else {
                timer = window.setTimeout(runWarmup, 1500);
            }
        }

        return () => {
            cancelled = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(idleHandle);
            }
        };
    }, [startupReadySent, setupStateResolved, showSetup]);

    const exportDiagnostics = useCallback(async () => {
        try {
            const shortcuts = await getShortcuts();
            let sidecarDoctor: DoctorPreflightPayload | null = null;
            let sidecarDoctorInvokeError: string | undefined;

            if (isTauri()) {
                try {
                    const doctorResult = await invoke<DoctorPreflightInvokeResult>('run_doctor_preflight', {
                        input: {
                            startupProfile: IS_STARTUP_BASELINE ? 'baseline' : undefined,
                        },
                    });
                    sidecarDoctor = doctorResult?.payload ?? null;
                    if (!doctorResult?.success && !sidecarDoctor?.error) {
                        sidecarDoctorInvokeError = 'doctor_preflight_failed';
                    }
                } catch (error) {
                    sidecarDoctorInvokeError = error instanceof Error ? error.message : String(error);
                }
            }

            const payload = {
                timestamp: new Date().toISOString(),
                locale: navigator.language,
                shell: {
                    singleWindowShell: true,
                },
                navigation: 'single-surface',
                overlays: {
                    commandPaletteOpen,
                    shortcutsOverlayOpen,
                    skillsDialogOpen,
                    mcpDialogOpen,
                    settingsDialogOpen,
                },
                shortcuts,
                sidecarDoctor,
                sidecarDoctorInvokeError,
            };

            const text = JSON.stringify(payload, null, 2);
            await navigator.clipboard.writeText(text);
            console.info('[ui-diagnostics]', payload);
            toast.success(t('diagnostics.title'), t('diagnostics.description'));
        } catch {
            toast.error(t('diagnostics.failedTitle'), t('diagnostics.failedDescription'));
        }
    }, [
        commandPaletteOpen,
        shortcutsOverlayOpen,
        skillsDialogOpen,
        mcpDialogOpen,
        settingsDialogOpen,
        t,
    ]);

    const {
        pendingRequest,
        isDialogOpen,
        approve,
        deny,
        closeDialog,
    } = useEffectConfirmation();

    const commands = useMemo(() => createCommandRegistry(
        t,
        {
            onNewTask: () => { void createNewTaskSession(); },
            onOpenProject: () => {
                // TODO: implement project picker
            },
            onTaskList: () => { void createNewTaskSession(); },
            onOpenSkills: () => setSkillsDialogOpen(true),
            onOpenMcp: () => setMcpDialogOpen(true),
            onOpenSettings: () => setSettingsDialogOpen(true),
            onShowShortcuts: () => setShortcutsOverlayOpen(true),
            onExportDiagnostics: () => { void exportDiagnostics(); },
        },
        {
            newTask: newTaskShortcut,
            commandPalette: commandPaletteShortcut,
            openSettings: openSettingsShortcut,
            showShortcuts: showShortcutsShortcut,
        }
    ), [
        t,
        createNewTaskSession,
        exportDiagnostics,
        newTaskShortcut,
        commandPaletteShortcut,
        openSettingsShortcut,
        showShortcutsShortcut,
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
        if (!isTauri()) {
            return;
        }

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

    useGlobalShortcuts({
        commandPalette: useCallback(() => setCommandPaletteOpen(true), []),
        newTask: useCallback(() => {
            void createNewTaskSession();
        }, [createNewTaskSession]),
        showShortcuts: useCallback(() => setShortcutsOverlayOpen(true), []),
        openSettings: useCallback(() => setSettingsDialogOpen(true), []),
    });

    if (!setupStateResolved) {
        return (
            <div className={appShellClassName}>
                {!useNativeMacTitleBar && <TitleBar />}
                <div className="app-content" style={useNativeMacTitleBar ? { inset: 0 } : undefined}>
                    <StartupSkeleton visible />
                </div>
            </div>
        );
    }

    if (showSetup) {
        return (
            <div className={appShellClassName}>
                {!useNativeMacTitleBar && <TitleBar />}
                <div className="app-content" style={useNativeMacTitleBar ? { inset: 0 } : undefined}>
                    <SetupWizard onComplete={() => setShowSetup(false)} topOffset={titlebarOffset} />
                </div>
            </div>
        );
    }

    return (
        <div className={appShellClassName}>
            <div className="app-aurora app-aurora-one" />
            <div className="app-aurora app-aurora-two" />
            <div className="app-aurora app-aurora-three" />
            <div className="app-noise-overlay" />
            {!useNativeMacTitleBar && <TitleBar />}
            <div className="app-content" style={useNativeMacTitleBar ? { inset: 0 } : undefined}>
                <StartupSkeleton visible={showStartupSkeleton} />

                <CommandPalette
                    open={commandPaletteOpen}
                    onOpenChange={setCommandPaletteOpen}
                    commands={commands}
                />

                <ShortcutOverlay
                    open={shortcutsOverlayOpen}
                    onClose={() => setShortcutsOverlayOpen(false)}
                    shortcuts={{
                        commandPalette: commandPaletteShortcut,
                        newTask: newTaskShortcut,
                        openSettings: openSettingsShortcut,
                        showShortcuts: showShortcutsShortcut,
                        esc: t('shortcutsOverlay.esc'),
                    }}
                />

                <MainLayout onOpenSettings={() => setSettingsDialogOpen(true)}>
                    <SectionErrorBoundary resetKeys={['main-chat-surface']}>
                        <div className="app-main-pane">
                            <ChatInterface
                                onOpenSkills={() => setSkillsDialogOpen(true)}
                                onOpenMcp={() => setMcpDialogOpen(true)}
                                onOpenSettings={() => setSettingsDialogOpen(true)}
                            />
                        </div>
                    </SectionErrorBoundary>
                </MainLayout>

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

                <ModalDialog
                    open={settingsDialogOpen}
                    onClose={() => setSettingsDialogOpen(false)}
                    title={t('settings.title')}
                >
                    <Suspense fallback={<div style={{ padding: 16 }}>Loading...</div>}>
                        <div style={{ height: '100%', overflow: 'hidden' }}>
                            <SettingsViewLazy />
                        </div>
                    </Suspense>
                </ModalDialog>

                <EffectConfirmationDialog
                    request={pendingRequest}
                    open={isDialogOpen}
                    onApprove={approve}
                    onDeny={deny}
                    onClose={closeDialog}
                />

                <OfflineBanner />
                <UpdateChecker />
            </div>
        </div>
    );
}

export default App;
