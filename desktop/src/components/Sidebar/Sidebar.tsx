import React, { useEffect, useRef, useState } from 'react';
import './Sidebar.css';
import { useTaskEventStore, useActiveSession } from '../../stores/useTaskEventStore';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../../lib/tauri';

export type SidebarTab = 'chat' | 'tasks';

function normalizePath(value: string | undefined): string {
    return (value ?? '').replace(/[\\/]+$/, '');
}

interface SidebarProps {
    activeTab: SidebarTab;
    onTabChange: (tab: SidebarTab) => void;
    onOpenSettings?: () => void;
}

const ChatIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
);

const TasksIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
);

const WorkspaceIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
);

const AddIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const SettingsIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
);

const ChevronIcon: React.FC<{ expanded?: boolean }> = ({ expanded = false }) => (
    <svg
        className={`workspace-expand-icon ${expanded ? 'expanded' : ''}`}
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const CloseIcon = () => (
    <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 4.3L9.3 0 10 .7 5.7 5 10 9.3 9.3 10 5 5.7 .7 10 0 9.3 4.3 5 0 .7 .7 0z" fill="currentColor" />
    </svg>
);

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onOpenSettings }) => {
    const { t } = useTranslation();
    const sidecarConnected = useTaskEventStore((state) => state.sidecarConnected);
    const sessionsHydrating = false;
    const sessions = useTaskEventStore((state) => state.sessions);
    const activeSession = useActiveSession();
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);
    const activeSessionRef = useRef<HTMLDivElement | null>(null);

    const {
        workspaces,
        activeWorkspace,
        isLoading: workspacesLoading,
        createWorkspace,
        selectWorkspace,
    } = useWorkspace();

    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set(activeWorkspace?.id ? [activeWorkspace.id] : []));

    useEffect(() => {
        if (activeWorkspace?.id) {
            setExpandedWorkspaces((prev) => {
                const next = new Set(prev);
                next.add(activeWorkspace.id);
                return next;
            });
        }
    }, [activeWorkspace?.id]);

    useEffect(() => {
        if (activeSessionRef.current) {
            activeSessionRef.current.scrollIntoView({ block: 'nearest' });
        }
    }, [activeSession?.taskId]);

    const handleCreateWorkspace = async () => {
        const result = await createWorkspace(newWorkspaceName.trim());
        if (result) {
            setNewWorkspaceName('');
            setShowCreateForm(false);
        }
    };

    const toggleWorkspace = (workspaceId: string) => {
        setExpandedWorkspaces((prev) => {
            const next = new Set(prev);
            if (next.has(workspaceId)) {
                next.delete(workspaceId);
            } else {
                next.add(workspaceId);
            }
            return next;
        });
    };

    const getWorkspaceSessions = (workspacePath: string) => {
        const normalizedWorkspacePath = normalizePath(workspacePath);
        if (!normalizedWorkspacePath) {
            return [];
        }

        return Array.from(sessions.values())
            .filter((session) => normalizePath(session.workspacePath) === normalizedWorkspacePath)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    };

    const handleCloseWindow = async () => {
        if (!isTauri()) return;
        try {
            await getCurrentWindow().hide();
        } catch {
            await getCurrentWindow().close();
        }
    };

    return (
        <div className="sidebar">
            <div className="sidebar-header-collapsed">
                <div className="sidebar-brand-shell">
                    <img src="/logo.png" alt="CoworkAny" className="sidebar-logo" />
                    <div className="sidebar-brand-copy">
                        <span className="sidebar-brand-title">CoworkAny</span>
                        <span className="sidebar-brand-subtitle">Desktop agent</span>
                    </div>
                </div>
            </div>

            <nav className="nav-section-collapsed" aria-label="Primary">
                <span className="sidebar-nav-caption">Shell</span>
                <button
                    type="button"
                    className={`nav-item-collapsed ${activeTab === 'chat' ? 'active' : ''}`}
                    onClick={() => onTabChange('chat')}
                    title={t('sidebar.chat')}
                >
                    <ChatIcon />
                    <span className="nav-item-label">{t('sidebar.chat')}</span>
                    <span className="nav-tooltip">{t('sidebar.chat')}</span>
                </button>
                <button
                    type="button"
                    className={`nav-item-collapsed ${activeTab === 'tasks' ? 'active' : ''}`}
                    onClick={() => onTabChange('tasks')}
                    title={t('sidebar.tasks')}
                >
                    <TasksIcon />
                    <span className="nav-item-label">{t('sidebar.tasks')}</span>
                    <span className="nav-tooltip">{t('sidebar.tasks')}</span>
                </button>
            </nav>

            <div className="workspace-section">
                <div className="workspace-header">
                    <div className="nav-label">
                        <WorkspaceIcon />
                        <span>{t('sidebar.workspaces')}</span>
                    </div>
                    <button
                        type="button"
                        className="workspace-add-btn"
                        onClick={() => setShowCreateForm((prev) => !prev)}
                        title={t('sidebar.createNewWorkspace')}
                        aria-label={t('sidebar.createNewWorkspace')}
                    >
                        <AddIcon />
                    </button>
                </div>

                {showCreateForm && (
                    <div className="workspace-create-form">
                        <input
                            className="workspace-input"
                            type="text"
                            placeholder={t('sidebar.workspaceNamePlaceholder')}
                            aria-label={t('sidebar.workspaceNamePlaceholder')}
                            value={newWorkspaceName}
                            onChange={(event) => setNewWorkspaceName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') void handleCreateWorkspace();
                                if (event.key === 'Escape') setShowCreateForm(false);
                            }}
                        />
                        <div className="workspace-create-hint">
                            {t('workspace.defaultHint')}
                        </div>
                        <button type="button" className="workspace-create-btn" onClick={() => void handleCreateWorkspace()}>
                            {t('common.create')}
                        </button>
                    </div>
                )}

                <div className="workspace-list">
                    {workspacesLoading && workspaces.length === 0 ? (
                        <div className="workspace-loading-list">
                            <div className="workspace-loading-row" />
                            <div className="workspace-loading-row workspace-loading-row-short" />
                            <div className="workspace-loading-row" />
                        </div>
                    ) : workspaces.length === 0 ? (
                        <div className="workspace-empty">{t('sidebar.noWorkspaces')}</div>
                    ) : (
                        workspaces.map((workspace) => {
                            if (!workspace) return null;

                            const isExpanded = expandedWorkspaces.has(workspace.id);
                            const isActive = workspace.id === activeWorkspace?.id;
                            const workspaceSessions = getWorkspaceSessions(workspace.path);

                            return (
                                <div key={workspace.id} className="workspace-group">
                                    <div
                                        className={`workspace-item ${isActive ? 'active' : ''}`}
                                        onClick={() => {
                                            selectWorkspace(workspace);
                                            toggleWorkspace(workspace.id);
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        aria-expanded={isExpanded}
                                        aria-pressed={isActive}
                                        aria-label={`${workspace.name} (${workspaceSessions.length})`}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                selectWorkspace(workspace);
                                                toggleWorkspace(workspace.id);
                                            }
                                        }}
                                    >
                                        <span className="workspace-expand">
                                            <ChevronIcon expanded={isExpanded} />
                                        </span>
                                        <span className="workspace-name">{workspace.name}</span>
                                        <span className="workspace-count">{workspaceSessions.length}</span>
                                    </div>

                                    {isExpanded && (
                                        <div className="workspace-sessions">
                                            <div className="workspace-sessions-label">
                                                {t('sidebar.runHistory')}
                                            </div>
                                            {sessionsHydrating && isActive && (
                                                <div className="workspace-loading-inline">Loading run records...</div>
                                            )}
                                            {workspaceSessions.length === 0 ? (
                                                <div className="workspace-session-empty">{t('sidebar.noSessions')}</div>
                                            ) : (
                                                workspaceSessions.map((session) => (
                                                    <div
                                                        key={session.taskId}
                                                        className={`session-item ${session.taskId === activeSession?.taskId ? 'active' : ''} ${session.status === 'running' ? 'running' : ''}`}
                                                        ref={session.taskId === activeSession?.taskId ? activeSessionRef : undefined}
                                                        onClick={() => setActiveTask(session.taskId)}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter' || event.key === ' ') {
                                                                event.preventDefault();
                                                                setActiveTask(session.taskId);
                                                            }
                                                        }}
                                                    >
                                                        {session.title || t('search.untitledTask')}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <div className="sidebar-footer-collapsed">
                <div className="sidebar-footer-stack">
                    <button
                        type="button"
                        className="sidebar-settings-btn"
                        onClick={() => onOpenSettings?.()}
                        title={t('sidebar.settings')}
                        aria-label={t('sidebar.settings')}
                    >
                        <SettingsIcon />
                        <span>{t('sidebar.settings')}</span>
                    </button>
                    <div className="connection-status">
                        <div className={`status-dot ${sidecarConnected ? 'connected' : 'disconnected'}`} />
                        <span className="connection-text">
                            {sidecarConnected ? t('sidebar.sidecarConnected') : t('sidebar.disconnected')}
                        </span>
                        <button
                            type="button"
                            className="sidebar-hide-btn"
                            onClick={() => void handleCloseWindow()}
                            title={t('titlebar.closeWindow')}
                            aria-label={t('titlebar.closeWindow')}
                        >
                            <CloseIcon />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
