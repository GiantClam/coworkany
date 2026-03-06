import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './WorkspaceSelector.css';
import { useWorkspace, type Workspace } from '../../hooks/useWorkspace';

interface WorkspaceSelectorProps {
    className?: string;
}

const FolderIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
);

const ChevronDown = ({ open }: { open: boolean }) => (
    <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`workspace-arrow-icon ${open ? 'open' : ''}`}
        aria-hidden="true"
    >
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
);

const PlusIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
);

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
);

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({ className }) => {
    const { t } = useTranslation();
    const { workspaces, activeWorkspace, selectWorkspace, createWorkspace, updateWorkspace, deleteWorkspace, isLoading } = useWorkspace();
    const [isOpen, setIsOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setEditingId(null);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleSelect = (workspace: Workspace) => {
        if (editingId) return;
        selectWorkspace(workspace);
        setIsOpen(false);
    };

    const toggleDropdown = () => {
        if (workspaces.length > 0 || isOpen) {
            setIsOpen(!isOpen);
        }
    };

    const handleQuickCreate = async (event: React.MouseEvent) => {
        event.stopPropagation();
        const newWorkspace = await createWorkspace();
        if (newWorkspace) {
            selectWorkspace(newWorkspace);
            setIsOpen(true);
        }
    };

    const handleDoubleClick = (event: React.MouseEvent, workspace: Workspace) => {
        event.stopPropagation();
        setEditingId(workspace.id);
        setEditName(workspace.name);
    };

    const handleRenameSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (editingId && editName.trim()) {
            await updateWorkspace(editingId, { name: editName.trim(), autoNamed: false });
            setEditingId(null);
        }
    };

    const handleDelete = async (event: React.MouseEvent, workspace: Workspace) => {
        event.stopPropagation();
        if (window.confirm(t('workspace.deleteConfirm', { name: workspace.name, path: workspace.path }))) {
            await deleteWorkspace(workspace.id);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            setEditingId(null);
        }
    };

    const displayName = activeWorkspace?.name || t('workspace.noWorkspace');
    const hasWorkspaces = workspaces.length > 0;

    return (
        <div className={`workspace-selector ${className || ''}`} ref={dropdownRef}>
            <div className="workspace-selector-row">
                <button
                    className="workspace-selector-button"
                    onClick={toggleDropdown}
                    disabled={isLoading}
                    title={activeWorkspace?.path || t('workspace.noWorkspaceSelected')}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                >
                    <span className="workspace-icon">
                        <FolderIcon />
                    </span>
                    <span className="workspace-name">{displayName}</span>
                    <span className="workspace-arrow">
                        <ChevronDown open={isOpen} />
                    </span>
                </button>
                <button
                    className="btn-create-workspace"
                    onClick={handleQuickCreate}
                    title={t('workspace.createNewWorkspace')}
                    aria-label={t('workspace.createNewWorkspace')}
                >
                    <PlusIcon />
                </button>
            </div>

            {isOpen && (
                <div
                    className="workspace-dropdown"
                    role="listbox"
                    aria-label={t('workspace.selectWorkspace')}
                >
                    {hasWorkspaces ? workspaces.map((workspace) => (
                        <div
                            key={workspace.id}
                            className={`workspace-item ${activeWorkspace?.id === workspace.id ? 'active' : ''}`}
                            role="option"
                            aria-selected={activeWorkspace?.id === workspace.id}
                            tabIndex={0}
                            onClick={() => handleSelect(workspace)}
                            onDoubleClick={(event) => handleDoubleClick(event, workspace)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    handleSelect(workspace);
                                }
                            }}
                        >
                            {editingId === workspace.id ? (
                                <form onSubmit={handleRenameSubmit} onClick={(event) => event.stopPropagation()}>
                                    <input
                                        ref={inputRef}
                                        className="workspace-rename-input"
                                        value={editName}
                                        onChange={(event) => setEditName(event.target.value)}
                                        onBlur={() => setEditingId(null)}
                                        onKeyDown={handleKeyDown}
                                    />
                                </form>
                            ) : (
                                <>
                                    <div className="workspace-item-content">
                                        <div className="workspace-item-name">{workspace.name}</div>
                                        <div className="workspace-item-path">{workspace.path}</div>
                                    </div>
                                    <button
                                        className="workspace-delete-btn"
                                        onClick={(event) => handleDelete(event, workspace)}
                                        title={t('workspace.deleteTooltip')}
                                        aria-label={t('workspace.deleteWorkspace', { name: workspace.name })}
                                    >
                                        <TrashIcon />
                                    </button>
                                </>
                            )}
                        </div>
                    )) : (
                        <div className="workspace-empty-hint">
                            {t('workspace.defaultHint')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
