/**
 * Command Palette Component
 *
 * A keyboard-driven command interface (Cmd+K)
 * Provides quick access to all app functions
 */

import React, { useState, useEffect, useCallback, useMemo, useId } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import './CommandPalette.css';
import { formatShortcutForDisplay } from '../../lib/shortcuts';

export interface Command {
    id: string;
    label: string;
    icon?: React.ReactNode;
    shortcut?: string;
    category: 'primary' | 'secondary' | 'settings';
    action: () => void;
}

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    commands: Command[];
}

const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
);

export const CommandPalette: React.FC<CommandPaletteProps> = ({
    open,
    onOpenChange,
    commands,
}) => {
    const { t } = useTranslation();
    const listboxId = useId();
    const [search, setSearch] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const escHint = formatShortcutForDisplay('Esc');

    const filteredCommands = useMemo(() => {
        if (!search.trim()) return commands;
        const lower = search.toLowerCase();
        return commands.filter(cmd => cmd.label.toLowerCase().includes(lower));
    }, [commands, search]);

    const groupedCommands = useMemo(() => {
        const groups: Record<string, Command[]> = {
            primary: [],
            secondary: [],
            settings: [],
        };
        filteredCommands.forEach(cmd => {
            groups[cmd.category].push(cmd);
        });
        return groups;
    }, [filteredCommands]);

    const flatCommands = useMemo(() => {
        return [...groupedCommands.primary, ...groupedCommands.secondary, ...groupedCommands.settings];
    }, [groupedCommands]);

    const activeCommand = flatCommands[selectedIndex];

    const getOptionId = useCallback((commandId: string) => {
        return `${listboxId}-${commandId}`;
    }, [listboxId]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [search]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, flatCommands.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = flatCommands[selectedIndex];
            if (cmd) {
                cmd.action();
                onOpenChange(false);
                setSearch('');
            }
        }
    }, [flatCommands, selectedIndex, onOpenChange]);

    const handleCommandSelect = useCallback((cmd: Command) => {
        cmd.action();
        onOpenChange(false);
        setSearch('');
    }, [onOpenChange]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="command-palette-overlay" />
                <Dialog.Content className="command-palette-content">
                    <div className="command-palette-header">
                        <SearchIcon />
                        <span className="command-search-label">Search</span>
                        <input
                            type="text"
                            placeholder={t('commandPalette.search')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            role="combobox"
                            aria-controls={listboxId}
                            aria-expanded={open}
                            aria-autocomplete="list"
                            aria-activedescendant={activeCommand ? getOptionId(activeCommand.id) : undefined}
                            autoFocus
                        />
                        <kbd>{escHint}</kbd>
                    </div>

                    <div className="command-palette-body" id={listboxId} role="listbox" aria-label={t('commandPalette.search')}>
                        {groupedCommands.primary.length > 0 && (
                            <div className="command-group">
                                <div className="command-group-label">{t('commandPalette.primaryActions')}</div>
                                {groupedCommands.primary.map((cmd, idx) => {
                                    const globalIdx = idx;
                                    return (
                                        <button
                                            key={cmd.id}
                                            id={getOptionId(cmd.id)}
                                            role="option"
                                            aria-selected={globalIdx === selectedIndex}
                                            className={`command-item ${globalIdx === selectedIndex ? 'selected' : ''}`}
                                            onClick={() => handleCommandSelect(cmd)}
                                            onMouseEnter={() => setSelectedIndex(globalIdx)}
                                            tabIndex={-1}
                                        >
                                            <span className="command-icon">{cmd.icon}</span>
                                            <span className="command-label">{cmd.label}</span>
                                            {cmd.shortcut && <kbd className="command-shortcut">{cmd.shortcut}</kbd>}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {groupedCommands.secondary.length > 0 && (
                            <div className="command-group">
                                <div className="command-group-label">{t('commandPalette.tools')}</div>
                                {groupedCommands.secondary.map((cmd, idx) => {
                                    const globalIdx = groupedCommands.primary.length + idx;
                                    return (
                                        <button
                                            key={cmd.id}
                                            id={getOptionId(cmd.id)}
                                            role="option"
                                            aria-selected={globalIdx === selectedIndex}
                                            className={`command-item ${globalIdx === selectedIndex ? 'selected' : ''}`}
                                            onClick={() => handleCommandSelect(cmd)}
                                            onMouseEnter={() => setSelectedIndex(globalIdx)}
                                            tabIndex={-1}
                                        >
                                            <span className="command-icon">{cmd.icon}</span>
                                            <span className="command-label">{cmd.label}</span>
                                            {cmd.shortcut && <kbd className="command-shortcut">{cmd.shortcut}</kbd>}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {groupedCommands.settings.length > 0 && (
                            <div className="command-group">
                                <div className="command-group-label">{t('commandPalette.settings')}</div>
                                {groupedCommands.settings.map((cmd, idx) => {
                                    const globalIdx = groupedCommands.primary.length + groupedCommands.secondary.length + idx;
                                    return (
                                        <button
                                            key={cmd.id}
                                            id={getOptionId(cmd.id)}
                                            role="option"
                                            aria-selected={globalIdx === selectedIndex}
                                            className={`command-item ${globalIdx === selectedIndex ? 'selected' : ''}`}
                                            onClick={() => handleCommandSelect(cmd)}
                                            onMouseEnter={() => setSelectedIndex(globalIdx)}
                                            tabIndex={-1}
                                        >
                                            <span className="command-icon">{cmd.icon}</span>
                                            <span className="command-label">{cmd.label}</span>
                                            {cmd.shortcut && <kbd className="command-shortcut">{cmd.shortcut}</kbd>}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {flatCommands.length === 0 && (
                            <div className="command-empty">{t('commandPalette.noResults')}</div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default CommandPalette;
