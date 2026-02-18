/**
 * ToolpackManager Component
 *
 * UI for managing MCP Toolpacks (list, install, enable/disable, remove).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToolpacks, type ToolpackRecord } from '../hooks/useToolpacks';
import './ToolpackManager.css';

// ============================================================================
// Sub-components
// ============================================================================

interface ToolpackCardProps {
    toolpack: ToolpackRecord;
    onToggle: (id: string, enabled: boolean) => void;
    onRemove: (id: string) => void;
}

function ToolpackCard({ toolpack, onToggle, onRemove }: ToolpackCardProps) {
    const { t } = useTranslation();
    const { manifest, enabled, installedAt } = toolpack;
    const [confirmRemove, setConfirmRemove] = useState(false);

    const handleRemove = () => {
        if (confirmRemove) {
            onRemove(manifest.id);
            setConfirmRemove(false);
        } else {
            setConfirmRemove(true);
        }
    };

    return (
        <div className={`toolpack-card ${enabled ? '' : 'disabled'}`}>
            <div className="toolpack-header">
                <div className="toolpack-info">
                    <h3 className="toolpack-name">{manifest.name}</h3>
                    <span className="toolpack-version">v{manifest.version}</span>
                </div>
                <label className="toggle-switch">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => onToggle(manifest.id, e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>

            {manifest.description && (
                <p className="toolpack-description">{manifest.description}</p>
            )}

            <div className="toolpack-meta">
                <span className="meta-item">
                    {t('toolpacks.runtime', { runtime: manifest.runtime || t('runtime.unknown') })}
                </span>
                {manifest.riskLevel && (
                    <span className={`meta-item risk-${manifest.riskLevel > 5 ? 'high' : 'low'}`}>
                        {t('toolpacks.risk', { level: `${manifest.riskLevel}/10` })}
                    </span>
                )}
                <span className="meta-item">
                    {t('skills.installedDate', { date: new Date(installedAt).toLocaleDateString() })}
                </span>
            </div>

            <div className="toolpack-actions">
                <button
                    className={`btn-remove ${confirmRemove ? 'confirm' : ''}`}
                    onClick={handleRemove}
                    onBlur={() => setConfirmRemove(false)}
                >
                    {confirmRemove ? t('toolpacks.confirmRemove') : t('common.remove')}
                </button>
            </div>
        </div>
    );
}

// ============================================================================
// Main Component
// ============================================================================

export function ToolpackManager() {
    const { t } = useTranslation();
    const { toolpacks, loading, error, refresh, install, toggle, remove } = useToolpacks();
    const [installPath, setInstallPath] = useState('');
    const [showInstall, setShowInstall] = useState(false);

    const handleInstall = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!installPath.trim()) return;
        const success = await install(installPath.trim());
        if (success) {
            setInstallPath('');
            setShowInstall(false);
        }
    };

    return (
        <div className="toolpack-manager">
            <div className="manager-header">
                <h2>{t('toolpacks.mcpToolpacks')}</h2>
                <div className="header-actions">
                    <button className="btn-refresh" onClick={refresh} disabled={loading}>
                        {loading ? t('common.loading') : t('common.refresh')}
                    </button>
                    <button className="btn-add" onClick={() => setShowInstall(!showInstall)}>
                        {t('common.install')}
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-banner">
                    Error: {error}
                </div>
            )}

            {showInstall && (
                <form className="install-form" onSubmit={handleInstall}>
                    <input
                        type="text"
                        value={installPath}
                        onChange={(e) => setInstallPath(e.target.value)}
                        placeholder={t('toolpacks.folderPlaceholder')}
                        className="install-input"
                    />
                    <button type="submit" className="btn-submit" disabled={loading || !installPath.trim()}>
                        {t('common.install')}
                    </button>
                    <button type="button" className="btn-cancel" onClick={() => setShowInstall(false)}>
                        {t('common.cancel')}
                    </button>
                </form>
            )}

            <div className="toolpack-list">
                {toolpacks.length === 0 ? (
                    <div className="empty-state">
                        <p>{t('toolpacks.noToolpacksInstalled')}</p>
                        <p>{t('toolpacks.installHint')}</p>
                    </div>
                ) : (
                    toolpacks.map((tp) => (
                        <ToolpackCard
                            key={tp.manifest.id}
                            toolpack={tp}
                            onToggle={toggle}
                            onRemove={remove}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
