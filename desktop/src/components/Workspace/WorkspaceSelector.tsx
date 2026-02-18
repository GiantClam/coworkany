import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './WorkspaceSelector.css';
import { useWorkspace, type Workspace } from '../../hooks/useWorkspace';

interface WorkspaceSelectorProps {
    className?: string;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({ className }) => {
    const { t } = useTranslation();
    const { workspaces, activeWorkspace, selectWorkspace, createWorkspace, updateWorkspace, deleteWorkspace, isLoading } = useWorkspace();
    const [isOpen, setIsOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input when editing starts
    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setEditingId(null); // Cancel edit on close
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
        if (editingId) return; // Don't select while editing
        selectWorkspace(workspace);
        setIsOpen(false);
    };

    const toggleDropdown = () => {
        if (workspaces.length > 0 || isOpen) {
            setIsOpen(!isOpen);
        }
    };

    const handleQuickCreate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        // Request default path by passing empty string
        const newWorkspace = await createWorkspace('new workspace', '');
        if (newWorkspace) {
            selectWorkspace(newWorkspace);
            setIsOpen(true); // Open dropdown to show it
            // Optional: immediately enter edit mode? User said "allow double click", not "auto enter edit".
        }
    };

    const handleDoubleClick = (e: React.MouseEvent, workspace: Workspace) => {
        e.stopPropagation();
        setEditingId(workspace.id);
        setEditName(workspace.name);
    };

    const handleRenameSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (editingId && editName.trim()) {
            await updateWorkspace(editingId, { name: editName.trim() });
            setEditingId(null);
        }
    };

    const handleDelete = async (e: React.MouseEvent, workspace: Workspace) => {
        e.stopPropagation();
        if (window.confirm(t('workspace.deleteConfirm', { name: workspace.name, path: workspace.path }))) {
            await deleteWorkspace(workspace.id);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setEditingId(null);
        }
    };

    const displayName = activeWorkspace?.name || t('workspace.noWorkspace');
    // Always enable button to allow creating new workspace even if list is empty
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
                    <span className="workspace-icon" aria-hidden="true">📁</span>
                    <span className="workspace-name">{displayName}</span>
                    <span className="workspace-arrow" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                </button>
                <button
                    className="btn-create-workspace"
                    onClick={handleQuickCreate}
                    title={t('workspace.createNewWorkspace')}
                    aria-label={t('workspace.createNewWorkspace')}
                >
                    +
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
                            onDoubleClick={(e) => handleDoubleClick(e, workspace)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleSelect(workspace);
                                }
                            }}
                        >
                            {editingId === workspace.id ? (
                                <form onSubmit={handleRenameSubmit} onClick={e => e.stopPropagation()}>
                                    <input
                                        ref={inputRef}
                                        className="workspace-rename-input"
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
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
                                        onClick={(e) => handleDelete(e, workspace)}
                                        title={t('workspace.deleteTooltip')}
                                        aria-label={t('workspace.deleteWorkspace', { name: workspace.name })}
                                    >
                                        🗑️
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

// Verified: Workspace deletion logic implemented
