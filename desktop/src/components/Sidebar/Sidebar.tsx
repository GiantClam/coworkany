import React, { useState, useEffect, useRef } from 'react';
import './Sidebar.css';
import { useTaskEventStore, useActiveSession } from '../../stores/useTaskEventStore';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useTranslation } from 'react-i18next';

export type SidebarTab = 'chat' | 'tasks';

interface SidebarProps {
    activeTab: SidebarTab;
    onTabChange: (tab: SidebarTab) => void;
}

const ChatIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
);

const TasksIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"></path>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
    </svg>
);

const WorkspaceIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
);

const AddIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
);

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
    const { t } = useTranslation();
    const sidecarConnected = useTaskEventStore((state) => state.sidecarConnected);
    const sessions = useTaskEventStore((state) => state.sessions);
    const activeSession = useActiveSession();
    const setActiveTask = useTaskEventStore((state) => state.setActiveTask);
    const activeSessionRef = useRef<HTMLDivElement | null>(null);

    const { workspaces, activeWorkspace, createWorkspace, selectWorkspace } = useWorkspace();
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [newWorkspacePath, setNewWorkspacePath] = useState('');
    const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set([activeWorkspace?.id || '']));
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        if (activeWorkspace?.id) {
            setExpandedWorkspaces(prev => {
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
        if (!newWorkspaceName.trim() || !newWorkspacePath.trim()) return;

        const result = await createWorkspace(newWorkspaceName.trim(), newWorkspacePath.trim());
        if (result) {
            setNewWorkspaceName('');
            setNewWorkspacePath('');
            setShowCreateForm(false);
        }
    };

    const toggleWorkspace = (workspaceId: string) => {
        setExpandedWorkspaces(prev => {
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
        if (activeWorkspace?.path === workspacePath) {
            return Array.from(sessions.values());
        }
        return [];
    };

    return (
        <div 
            className="sidebar"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="sidebar-header-collapsed">
                <img src="/logo.png" alt="CoworkAny" className="sidebar-logo" />
            </div>

            <nav className="nav-section-collapsed">
                <button
                    className={`nav-item-collapsed ${activeTab === 'chat' ? 'active' : ''}`}
                    onClick={() => onTabChange('chat')}
                    title={t('sidebar.chat')}
                >
                    <ChatIcon />
                    <span className="nav-item-label">{t('sidebar.chat')}</span>
                    <span className="nav-tooltip">{t('sidebar.chat')}</span>
                </button>
                <button
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
                        className="workspace-add-btn"
                        onClick={() => setShowCreateForm(!showCreateForm)}
                        title={t('sidebar.createNewWorkspace')}
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
                            value={newWorkspaceName}
                            onChange={(e) => setNewWorkspaceName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleCreateWorkspace();
                                if (e.key === 'Escape') setShowCreateForm(false);
                            }}
                        />
                        <input
                            className="workspace-input"
                            type="text"
                            placeholder={t('sidebar.workspacePathPlaceholder')}
                            value={newWorkspacePath}
                            onChange={(e) => setNewWorkspacePath(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleCreateWorkspace();
                                if (e.key === 'Escape') setShowCreateForm(false);
                            }}
                        />
                        <button className="workspace-create-btn" onClick={() => void handleCreateWorkspace()}>
                            {t('common.create')}
                        </button>
                    </div>
                )}

                <div className="workspace-list">
                    {workspaces.length === 0 ? (
                        <div className="workspace-empty">
                            {t('sidebar.noWorkspaces')}
                        </div>
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
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                selectWorkspace(workspace);
                                                toggleWorkspace(workspace.id);
                                            }
                                        }}
                                    >
                                        <span className="workspace-expand">
                                            {isExpanded ? '▼' : '▶'}
                                        </span>
                                        <span className="workspace-name">{workspace.name}</span>
                                        <span className="workspace-count">({workspaceSessions.length})</span>
                                    </div>

                                    {isExpanded && (
                                        <div className="workspace-sessions">
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
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
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
                <div className="connection-status">
                    <div className={`status-dot ${sidecarConnected ? 'connected' : 'disconnected'}`} />
                    {isHovered && (
                        <span className="connection-text">
                            {sidecarConnected ? t('sidebar.sidecarConnected') : t('sidebar.disconnected')}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};
