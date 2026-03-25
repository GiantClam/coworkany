import React, { useEffect, useMemo, useRef, useState } from 'react';
import './Sidebar.css';
import { useTaskEventStore } from '../../stores/useTaskEventStore';
import { useWorkspace, type Workspace } from '../../hooks/useWorkspace';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../../lib/tauri';
import type { TaskSession } from '../../types';

function normalizePath(value: string | undefined): string {
    return (value ?? '').replace(/[\\/]+$/, '');
}

interface SidebarProps {
    onOpenSettings?: () => void;
}

type SidebarSessionSummary = Pick<TaskSession, 'taskId' | 'title' | 'status' | 'workspacePath' | 'createdAt' | 'updatedAt'>;

function areSidebarSessionSummariesEqual(
    previous: SidebarSessionSummary[],
    next: SidebarSessionSummary[]
): boolean {
    if (previous.length !== next.length) {
        return false;
    }

    for (let index = 0; index < previous.length; index += 1) {
        const prevItem = previous[index];
        const nextItem = next[index];
        if (
            prevItem.taskId !== nextItem.taskId ||
            prevItem.title !== nextItem.title ||
            prevItem.status !== nextItem.status ||
            prevItem.workspacePath !== nextItem.workspacePath ||
            prevItem.createdAt !== nextItem.createdAt ||
            prevItem.updatedAt !== nextItem.updatedAt
        ) {
            return false;
        }
    }

    return true;
}

const TasksIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
);

const SettingsIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
);

const CloseIcon = () => (
    <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 4.3L9.3 0 10 .7 5.7 5 10 9.3 9.3 10 5 5.7 .7 10 0 9.3 4.3 5 0 .7 .7 0z" fill="currentColor" />
    </svg>
);

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings }) => {
    const { t } = useTranslation();
    const sidecarConnected = useTaskEventStore((state) => state.sidecarConnected);
    const sessionSummaries = useTaskEventStore(
        (state) => Array.from(state.sessions.values()).map((session) => ({
            taskId: session.taskId,
            title: session.title,
            status: session.status,
            workspacePath: session.workspacePath,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
        })),
        areSidebarSessionSummariesEqual
    );
    const activeTaskId = useTaskEventStore((state) => state.activeTaskId);
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);
    const deleteSession = useTaskEventStore((state) => state.deleteSession);
    const createDraftSession = useTaskEventStore((state) => state.createDraftSession);
    const activeSessionRef = useRef<HTMLButtonElement | null>(null);

    const {
        workspaces,
        activeWorkspace,
        isLoading: workspacesLoading,
        createWorkspace,
        deleteWorkspace,
        updateWorkspace,
        selectWorkspace,
    } = useWorkspace();

    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [isTaskSectionCollapsed, setIsTaskSectionCollapsed] = useState(false);
    const [isWorkspaceSectionCollapsed, setIsWorkspaceSectionCollapsed] = useState(false);
    const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Set<string>>(() => new Set());
    const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
    const [editingWorkspaceName, setEditingWorkspaceName] = useState('');
    const workspaceRenameInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (activeSessionRef.current) {
            activeSessionRef.current.scrollIntoView({ block: 'nearest' });
        }
    }, [activeTaskId]);

    useEffect(() => {
        if (!editingWorkspaceId || !workspaceRenameInputRef.current) {
            return;
        }
        workspaceRenameInputRef.current.focus();
        workspaceRenameInputRef.current.select();
    }, [editingWorkspaceId]);

    useEffect(() => {
        setCollapsedWorkspaceIds((prev) => {
            const existingIds = new Set(workspaces.map((workspace) => workspace.id));
            let changed = false;
            const next = new Set<string>();
            for (const id of prev) {
                if (existingIds.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });

        if (editingWorkspaceId && !workspaces.some((workspace) => workspace.id === editingWorkspaceId)) {
            setEditingWorkspaceId(null);
            setEditingWorkspaceName('');
        }
    }, [editingWorkspaceId, workspaces]);

    const knownWorkspacePaths = useMemo(() => {
        const next = new Set<string>();
        for (const workspace of workspaces) {
            const normalizedPath = normalizePath(workspace.path);
            if (normalizedPath) {
                next.add(normalizedPath);
            }
        }
        return next;
    }, [workspaces]);

    const sessionsByWorkspace = useMemo(() => {
        const grouped = new Map<string, SidebarSessionSummary[]>();
        for (const session of sessionSummaries) {
            const normalizedWorkspacePath = normalizePath(session.workspacePath);
            const key = normalizedWorkspacePath && knownWorkspacePaths.has(normalizedWorkspacePath)
                ? normalizedWorkspacePath
                : '__default__';
            const bucket = grouped.get(key) ?? [];
            bucket.push(session);
            grouped.set(key, bucket);
        }

        for (const bucket of grouped.values()) {
            bucket.sort((a, b) => {
                const aTime = new Date(a.updatedAt || a.createdAt).getTime();
                const bTime = new Date(b.updatedAt || b.createdAt).getTime();
                return bTime - aTime;
            });
        }

        return grouped;
    }, [knownWorkspacePaths, sessionSummaries]);

    const taskList = useMemo(() => sessionsByWorkspace.get('__default__') ?? [], [sessionsByWorkspace]);

    const handleCreateWorkspace = async () => {
        const result = await createWorkspace(newWorkspaceName.trim());
        if (!result) {
            return;
        }
        selectWorkspace(result);
        setNewWorkspaceName('');
        setShowCreateForm(false);
    };

    const handleCreateTask = async () => {
        const taskId = createDraftSession({
            title: t('chat.newSessionTitle'),
            workspacePath: activeWorkspace?.path,
        });
        setActiveTask(taskId);
    };

    const handleTaskSectionToggle = () => {
        selectWorkspace(null);
        setIsTaskSectionCollapsed((prev) => !prev);
    };

    const handleWorkspaceSectionToggle = () => {
        setIsWorkspaceSectionCollapsed((prev) => !prev);
    };

    const toggleWorkspaceCollapsed = (workspaceId: string) => {
        setCollapsedWorkspaceIds((previous) => {
            const next = new Set(previous);
            if (next.has(workspaceId)) {
                next.delete(workspaceId);
            } else {
                next.add(workspaceId);
            }
            return next;
        });
    };

    const startWorkspaceRename = (workspace: Workspace) => {
        setEditingWorkspaceId(workspace.id);
        setEditingWorkspaceName(workspace.name);
    };

    const cancelWorkspaceRename = () => {
        setEditingWorkspaceId(null);
        setEditingWorkspaceName('');
    };

    const saveWorkspaceRename = async () => {
        if (!editingWorkspaceId) {
            return;
        }

        const workspace = workspaces.find((entry) => entry.id === editingWorkspaceId);
        const nextName = editingWorkspaceName.trim();
        if (!workspace || nextName.length === 0 || nextName === workspace.name.trim()) {
            cancelWorkspaceRename();
            return;
        }

        const success = await updateWorkspace(editingWorkspaceId, { name: nextName });
        if (success) {
            cancelWorkspaceRename();
        }
    };

    const handleWorkspaceItemClick = (workspace: Workspace, isActive: boolean) => {
        selectWorkspace(workspace);
        if (isActive) {
            toggleWorkspaceCollapsed(workspace.id);
            return;
        }
        setCollapsedWorkspaceIds((previous) => {
            if (!previous.has(workspace.id)) {
                return previous;
            }
            const next = new Set(previous);
            next.delete(workspace.id);
            return next;
        });
    };

    const handleDeleteWorkspace = async (event: React.MouseEvent<HTMLButtonElement>, workspace: Workspace) => {
        event.stopPropagation();
        event.preventDefault();

        const success = await deleteWorkspace(workspace.id);
        if (!success) {
            return;
        }

        setCollapsedWorkspaceIds((previous) => {
            if (!previous.has(workspace.id)) {
                return previous;
            }
            const next = new Set(previous);
            next.delete(workspace.id);
            return next;
        });

        if (editingWorkspaceId === workspace.id) {
            cancelWorkspaceRename();
        }
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

            <section className="task-section" aria-label={t('sidebar.tasks')}>
                <div className="task-header">
                    <button
                        type="button"
                        className={`section-anchor ${!activeWorkspace ? 'active' : ''}`}
                        onClick={handleTaskSectionToggle}
                    >
                        <TasksIcon />
                        <span>{t('sidebar.tasks')}</span>
                    </button>
                    <button
                        type="button"
                        className="workspace-add-btn"
                        onClick={() => void handleCreateTask()}
                        title={t('welcome.newTask')}
                        aria-label={t('welcome.newTask')}
                    >
                        <AddIcon />
                    </button>
                </div>
                {!isTaskSectionCollapsed && (
                    <div className="task-list">
                        {taskList.length === 0 ? (
                            <div className="workspace-session-empty">{t('sidebar.noSessions')}</div>
                        ) : (
                            taskList.map((session) => (
                                <div
                                    key={session.taskId}
                                    className={`session-row ${session.taskId === activeTaskId ? 'active' : ''}`}
                                >
                                    <button
                                        className={`session-item ${session.taskId === activeTaskId ? 'active' : ''} ${session.status === 'running' ? 'running' : ''}`}
                                        ref={session.taskId === activeTaskId ? activeSessionRef : undefined}
                                        onClick={() => {
                                            selectWorkspace(null);
                                            setActiveTask(session.taskId);
                                        }}
                                        type="button"
                                    >
                                        {session.title || t('search.untitledTask')}
                                    </button>
                                    <button
                                        type="button"
                                        className="session-delete-btn"
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                        onClick={() => deleteSession(session.taskId)}
                                        title={t('common.delete')}
                                        aria-label={t('common.delete')}
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </section>

            <section className="workspace-section" aria-label={t('sidebar.workspaces')}>
                <div className="workspace-header">
                    <button
                        type="button"
                        className={`section-anchor ${!isWorkspaceSectionCollapsed ? 'active' : ''}`}
                        onClick={handleWorkspaceSectionToggle}
                    >
                        <WorkspaceIcon />
                        <span>{t('sidebar.workspaces')}</span>
                    </button>
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

                {!isWorkspaceSectionCollapsed && showCreateForm && (
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

                {!isWorkspaceSectionCollapsed && (
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
                                const isActive = workspace.id === activeWorkspace?.id;
                                const isCollapsed = collapsedWorkspaceIds.has(workspace.id);
                                const isEditing = editingWorkspaceId === workspace.id;
                                const workspaceSessions = sessionsByWorkspace.get(normalizePath(workspace.path)) ?? [];

                                return (
                                    <div
                                        key={workspace.id}
                                        className={`workspace-group ${isActive ? 'active' : ''}`}
                                    >
                                    {isEditing ? (
                                        <div className="workspace-item-row">
                                            <div className={`workspace-item workspace-item-editing ${isActive ? 'active' : ''}`}>
                                                <input
                                                    ref={workspaceRenameInputRef}
                                                    className="workspace-rename-input"
                                                    type="text"
                                                    value={editingWorkspaceName}
                                                    onChange={(event) => setEditingWorkspaceName(event.target.value)}
                                                    onBlur={() => {
                                                        void saveWorkspaceRename();
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter') {
                                                            event.preventDefault();
                                                            void saveWorkspaceRename();
                                                        } else if (event.key === 'Escape') {
                                                            event.preventDefault();
                                                            cancelWorkspaceRename();
                                                        }
                                                    }}
                                                />
                                                <span className="workspace-count">{workspaceSessions.length}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="workspace-item-row">
                                            <button
                                                className={`workspace-item ${isActive ? 'active' : ''}`}
                                                onClick={() => handleWorkspaceItemClick(workspace, isActive)}
                                                onDoubleClick={() => startWorkspaceRename(workspace)}
                                                type="button"
                                            >
                                                <span className="workspace-name">{workspace.name}</span>
                                                <span className="workspace-count">{workspaceSessions.length}</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="workspace-delete-btn"
                                                onMouseDown={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                }}
                                                onClick={(event) => void handleDeleteWorkspace(event, workspace)}
                                                title={t('workspace.deleteTooltip')}
                                                aria-label={t('workspace.deleteTooltip')}
                                            >
                                                <TrashIcon />
                                            </button>
                                        </div>
                                    )}

                                    {!isCollapsed && (
                                        <div className="workspace-sessions">
                                                {workspaceSessions.length === 0 ? (
                                                    <div className="workspace-sessions-empty">{t('sidebar.noSessions')}</div>
                                                ) : (
                                                    workspaceSessions.map((session) => (
                                                        <div
                                                            key={session.taskId}
                                                            className={`session-row ${session.taskId === activeTaskId ? 'active' : ''}`}
                                                        >
                                                            <button
                                                                className={`session-item ${session.taskId === activeTaskId ? 'active' : ''} ${session.status === 'running' ? 'running' : ''}`}
                                                                ref={session.taskId === activeTaskId ? activeSessionRef : undefined}
                                                                onClick={() => {
                                                                    selectWorkspace(workspace);
                                                                    setActiveTask(session.taskId);
                                                                }}
                                                                type="button"
                                                            >
                                                                {session.title || t('search.untitledTask')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="session-delete-btn"
                                                                onMouseDown={(event) => {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                }}
                                                                onClick={() => deleteSession(session.taskId)}
                                                                title={t('common.delete')}
                                                                aria-label={t('common.delete')}
                                                            >
                                                                <TrashIcon />
                                                            </button>
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
                )}
            </section>

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
