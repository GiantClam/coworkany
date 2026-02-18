/**
 * RepositoryBrowser Component
 *
 * Generic browser for discovered skills/MCP servers from repositories
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RuntimeBadge } from '../Common/RuntimeBadge';
import './RepositoryBrowser.css';

// ============================================================================
// Types
// ============================================================================

export interface RepositoryItem {
    name: string;
    description: string;
    path: string;
    source: string;
    runtime?: string;
    tools?: string[];
    hasScripts?: boolean;
}

interface RepositoryBrowserProps {
    items: RepositoryItem[];
    loading: boolean;
    error: string | null;
    onInstall: (selectedItems: RepositoryItem[]) => Promise<void>;
    onRefresh?: () => void;
    type: 'skill' | 'mcp';
    installedItemIds?: Set<string>;
}

// ============================================================================
// Component
// ============================================================================

export const RepositoryBrowser: React.FC<RepositoryBrowserProps> = ({
    items,
    loading,
    error,
    onInstall,
    onRefresh,
    type,
    installedItemIds,
}) => {
    const { t } = useTranslation();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [installing, setInstalling] = useState(false);
    const [runtimeFilter, setRuntimeFilter] = useState('all');

    // Filter items based on search and runtime
    const filteredItems = useMemo(() => {
        return items.filter((item) => {
            const matchesSearch =
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.description.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesRuntime =
                runtimeFilter === 'all' || item.runtime === runtimeFilter;

            // Handle runtime mappings for skills/MCPs if needed
            // e.g. skill might have 'python' or 'node'

            return matchesSearch && matchesRuntime;
        });
    }, [items, searchQuery, runtimeFilter]);

    const toggleSelection = (source: string) => {
        const next = new Set(selectedIds);
        if (next.has(source)) {
            next.delete(source);
        } else {
            next.add(source);
        }
        setSelectedIds(next);
    };

    const handleBulkInstall = async () => {
        if (selectedIds.size === 0) return;
        setInstalling(true);
        try {
            const selectedItems = items.filter((item) => selectedIds.has(item.source));
            await onInstall(selectedItems);
            setSelectedIds(new Set()); // Clear selection on success
        } catch (err) {
            console.error('[RepositoryBrowser] Install failed:', err);
        } finally {
            setInstalling(false);
        }
    };

    const handleIndividualInstall = async (e: React.MouseEvent, item: RepositoryItem) => {
        e.stopPropagation();
        if (installedItemIds?.has(item.source)) return;

        setInstalling(true);
        try {
            await onInstall([item]);
        } catch (err) {
            console.error('[RepositoryBrowser] Individual installation failed:', err);
        } finally {
            setInstalling(false);
        }
    };

    if (loading && items.length === 0) {
        return (
            <div className="loading-state">
                <div className="spinner"></div>
                <div style={{ marginTop: '16px' }}>{t('repository.scanningRepositories')}</div>
            </div>
        );
    }

    if (error && items.length === 0) {
        return (
            <div className="error-state">
                <div>{t('repository.errorLoadingRepositories')}</div>
                <div style={{ fontSize: '13px', marginTop: '8px' }}>{error}</div>
                {onRefresh && (
                    <button onClick={onRefresh} className="btn btn-secondary" style={{ marginTop: '16px' }}>
                        {t('common.retry')}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="repository-browser">
            {/* Header */}
            <div className="browser-header">
                <input
                    type="text"
                    className="search-input"
                    placeholder={type === 'skill' ? t('repository.searchSkillsPlaceholder') : t('repository.searchMcpPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />

                <select
                    className="runtime-filter"
                    value={runtimeFilter}
                    onChange={(e) => setRuntimeFilter(e.target.value)}
                >
                    <option value="all">{t('repository.allRuntimes')}</option>
                    <option value="python">{t('repository.python')}</option>
                    <option value="node">{t('repository.nodejs')}</option>
                    <option value="shell">{t('repository.shell')}</option>
                </select>

                {onRefresh && (
                    <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    </button>
                )}
            </div>

            <div className="results-summary">
                {t('repository.foundCount', { count: filteredItems.length, type: type === 'skill' ? t('repository.skillsLabel') : t('repository.serversLabel') })}
            </div>

            {/* Grid */}
            <div className="items-grid">
                {filteredItems.map((item) => {
                    const isInstalled = installedItemIds?.has(item.source);
                    return (
                        <div
                            key={item.source}
                            className={`repository-item ${selectedIds.has(item.source) ? 'selected' : ''}`}
                            onClick={() => !isInstalled && toggleSelection(item.source)}
                            style={{ opacity: isInstalled ? 0.8 : 1 }}
                        >
                            <div className="item-header">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(item.source)}
                                    onChange={() => toggleSelection(item.source)}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={isInstalled}
                                />
                                <div className="item-name">{item.name}</div>
                            </div>

                            <div className="item-description">{item.description}</div>

                            <div className="item-footer">
                                {item.runtime && <RuntimeBadge runtime={item.runtime as any} />}
                                {item.tools && item.tools.length > 0 && (
                                    <span className="tools-badge">{t('repository.toolsBadge', { count: item.tools.length })}</span>
                                )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                                <div className="item-source">{item.source.replace('github:', '')}</div>
                                {isInstalled ? (
                                    <span style={{ fontSize: '11px', color: 'var(--status-success)', fontWeight: 600 }}>
                                        ✓ {t('repository.installedBadge')}
                                    </span>
                                ) : (
                                    <button
                                        className="btn btn-primary"
                                        style={{ padding: '2px 8px', fontSize: '11px', minWidth: 'auto', height: '24px' }}
                                        onClick={(e) => handleIndividualInstall(e, item)}
                                        disabled={installing}
                                    >
                                        {t('common.install')}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
                {filteredItems.length === 0 && (
                    <div className="empty-state">
                        <div>{t('repository.noItemsFound')}</div>
                    </div>
                )}
            </div>

            {/* Install Bar */}
            {selectedIds.size > 0 && (
                <div className="install-bar">
                    <button
                        className="btn btn-primary install-button"
                        onClick={handleBulkInstall}
                        disabled={installing}
                    >
                        {installing ? (
                            <>
                                <div className="spinner-small"></div>
                                {t('common.loading')}
                            </>
                        ) : (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                {t('repository.installSelected', { count: selectedIds.size })}
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};
