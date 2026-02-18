/**
 * SkillManager Component
 *
 * UI for managing Claude Skills (list, import, enable/disable, remove).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkills, type SkillRecord } from '../hooks/useSkills';
import './SkillManager.css';

// ============================================================================
// Sub-components
// ============================================================================

interface SkillCardProps {
    skill: SkillRecord;
    onToggle: (id: string, enabled: boolean) => void;
    onRemove: (id: string) => void;
}

function SkillCard({ skill, onToggle, onRemove }: SkillCardProps) {
    const { t } = useTranslation();
    const { manifest, enabled, installedAt } = skill;
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
        <div className={`skill-card ${enabled ? '' : 'disabled'}`}>
            <div className="skill-header">
                <div className="skill-info">
                    <h3 className="skill-name">{manifest.name}</h3>
                    <span className="skill-version">v{manifest.version}</span>
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
                <p className="skill-description">{manifest.description}</p>
            )}

            <div className="skill-meta">
                <span className="meta-item">
                    {t('skills.path', { path: manifest.skillPath })}
                </span>
                <span className="meta-item">
                    {t('skills.installedDate', { date: new Date(installedAt).toLocaleDateString() })}
                </span>
            </div>

            <div className="skill-actions">
                <button
                    className={`btn-remove ${confirmRemove ? 'confirm' : ''}`}
                    onClick={handleRemove}
                    onBlur={() => setConfirmRemove(false)}
                >
                    {confirmRemove ? t('skills.confirmRemove') : t('common.remove')}
                </button>
            </div>
        </div>
    );
}

// ============================================================================
// Main Component
// ============================================================================

export function SkillManager() {
    const { t } = useTranslation();
    const { skills, loading, error, refresh, importSkill, toggle, remove } = useSkills();
    const [importPath, setImportPath] = useState('');
    const [showImport, setShowImport] = useState(false);

    const handleImport = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!importPath.trim()) return;
        const success = await importSkill(importPath.trim());
        if (success) {
            setImportPath('');
            setShowImport(false);
        }
    };

    return (
        <div className="skill-manager">
            <div className="manager-header">
                <h2>{t('skills.claudeSkills')}</h2>
                <div className="header-actions">
                    <button className="btn-refresh" onClick={refresh} disabled={loading}>
                        {loading ? t('common.loading') : t('common.refresh')}
                    </button>
                    <button className="btn-add" onClick={() => setShowImport(!showImport)}>
                        {t('common.import')}
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-banner">
                    Error: {error}
                </div>
            )}

            {showImport && (
                <form className="import-form" onSubmit={handleImport}>
                    <input
                        type="text"
                        value={importPath}
                        onChange={(e) => setImportPath(e.target.value)}
                        placeholder={t('skills.folderPlaceholder')}
                        className="import-input"
                    />
                    <button type="submit" className="btn-submit" disabled={loading || !importPath.trim()}>
                        {t('common.import')}
                    </button>
                    <button type="button" className="btn-cancel" onClick={() => setShowImport(false)}>
                        {t('common.cancel')}
                    </button>
                </form>
            )}

            <div className="skill-list">
                {skills.length === 0 ? (
                    <div className="empty-state">
                        <p>{t('skills.noSkillsImported')}</p>
                        <p>{t('skills.importHint')}</p>
                    </div>
                ) : (
                    skills.map((skill) => (
                        <SkillCard
                            key={skill.manifest.id}
                            skill={skill}
                            onToggle={toggle}
                            onRemove={remove}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
