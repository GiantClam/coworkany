import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import '../../styles/variables.css';
import { useGitHubValidation } from '../../hooks/useGitHubValidation';
import { SkillRepositoryView } from './SkillRepositoryView';
import { RuntimeBadge } from '../Common/RuntimeBadge';
import { MarketplaceView } from '../Marketplace/MarketplaceView';
import { OpenClawStoreTab } from './OpenClawStoreTab';
import { SkillCredentialCard } from './SkillCredentialCard';
import { SkillCreatorWorkbench } from './SkillCreatorWorkbench';
import type { OpenClawStore } from '../../hooks/useOpenClawSkillStore';
import type { SkillRecord, SkillUpdateInfo } from '../../hooks/useSkills';
import {
    deleteSkillCredentials,
    getRequiredSkillEnvVars,
    syncEnabledSkillEnvironment,
} from '../../lib/skillCredentials';

type IpcResult = {
    success: boolean;
    payload: {
        payload?: Record<string, unknown>;
    };
};

type SkillsTab = 'install' | 'browse' | 'market' | OpenClawStore;

const STORE_TABS: Array<{ id: OpenClawStore; label: string }> = [
    { id: 'clawhub', label: 'ClawHub' },
    { id: 'tencent_skillhub', label: 'SkillHub' },
];

function extractList<T>(result: IpcResult, key: string): T[] {
    const payload = result.payload?.payload ?? {};
    const data = payload[key];
    return Array.isArray(data) ? (data as T[]) : [];
}

export function SkillsView() {
    const { t } = useTranslation();
    const [skills, setSkills] = useState<SkillRecord[]>([]);
    const [updates, setUpdates] = useState<Record<string, SkillUpdateInfo>>({});
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [importPath, setImportPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [checkingUpdates, setCheckingUpdates] = useState(false);
    const [upgradingSkillId, setUpgradingSkillId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<SkillsTab>('install');

    // GitHub URL validation
    const { validating, result: validationResult } = useGitHubValidation(importPath, 'skill');

    const refresh = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('list_claude_skills', {
                input: { includeDisabled: true },
            });
            const nextSkills = extractList<SkillRecord>(result, 'skills');
            setSkills(nextSkills);
            await syncEnabledSkillEnvironment(nextSkills);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh');
        } finally {
            setLoading(false);
        }
    };

    const checkUpdates = async (skillIds?: string[]) => {
        setCheckingUpdates(true);
        setError(null);
        try {
            const result = await invoke<IpcResult>('check_claude_skill_updates', {
                input: skillIds?.length ? { skillIds } : {},
            });
            const payload = result.payload?.payload ?? {};
            const nextUpdates = Array.isArray(payload.updates) ? payload.updates as SkillUpdateInfo[] : [];
            setUpdates((current) => ({
                ...current,
                ...Object.fromEntries(nextUpdates.map((update) => [update.skillId, update])),
            }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to check updates');
        } finally {
            setCheckingUpdates(false);
        }
    };

    const upgradeSkill = async (skillId: string) => {
        setUpgradingSkillId(skillId);
        setError(null);
        try {
            const result = await invoke<IpcResult>('upgrade_claude_skill', {
                input: { skillId },
            });
            const payload = result.payload?.payload ?? {};
            if (payload.error) {
                throw new Error(String(payload.error));
            }
            if (payload.update && typeof payload.update === 'object') {
                const update = payload.update as SkillUpdateInfo;
                setUpdates((current) => ({ ...current, [skillId]: update }));
            }
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upgrade failed');
        } finally {
            setUpgradingSkillId(null);
        }
    };

    useEffect(() => { void refresh(); }, []);

    const toggleSkill = async (skillId: string, enabled: boolean) => {
        setLoading(true);
        try {
            await invoke<IpcResult>('set_claude_skill_enabled', { input: { skillId, enabled } });
            await refresh();
        } catch (err) { setError(err instanceof Error ? err.message : 'Update failed'); }
        finally { setLoading(false); }
    };

    const importSkill = async () => {
        if (!importPath.trim()) return;
        setLoading(true);
        try {
            // Assume local folder for skills usually
            await invoke<IpcResult>('import_claude_skill', {
                input: { source: 'local_folder', path: importPath.trim() },
            });
            setImportPath('');
            await refresh();
        } catch (err) { setError(err instanceof Error ? err.message : 'Import failed'); }
        finally { setLoading(false); }
    };

    const remove = async (skillId: string) => {
        if (!window.confirm(t('skills.confirmRemove'))) return;
        setLoading(true);
        try {
            await invoke<IpcResult>('remove_claude_skill', { input: { skillId, deleteFiles: true } });
            await deleteSkillCredentials(skillId);
            if (selectedId === skillId) setSelectedId(null);
            await refresh();
        } catch (err) { setError(err instanceof Error ? err.message : 'Remove failed'); }
        finally { setLoading(false); }
    };

    const selectedSkill = skills.find(s => s.manifest.id === selectedId);
    const selectedUpdate = selectedSkill ? updates[selectedSkill.manifest.id] : undefined;
    const requiredEnvVars = useMemo(
        () => (selectedSkill ? getRequiredSkillEnvVars(selectedSkill) : []),
        [selectedSkill]
    );
    const showImportBar = activeTab === 'install';

    return (
        <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>{t('skills.claudeSkills')}</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary" onClick={() => void checkUpdates()} disabled={loading || checkingUpdates}>
                        {checkingUpdates ? 'Checking updates...' : 'Check updates'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        {t('common.refresh')}
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)' }}>
                <button
                    onClick={() => setActiveTab('install')}
                    style={{
                        padding: '8px 16px',
                        border: 'none',
                        background: 'transparent',
                        color: activeTab === 'install' ? 'var(--status-info)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'install' ? '2px solid var(--status-info)' : '2px solid transparent',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'install' ? 600 : 400,
                        transition: 'all 0.2s'
                    }}
                >
                    {t('common.install')}
                </button>
                <button
                    onClick={() => setActiveTab('browse')}
                    style={{
                        padding: '8px 16px',
                        border: 'none',
                        background: 'transparent',
                        color: activeTab === 'browse' ? 'var(--status-info)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'browse' ? '2px solid var(--status-info)' : '2px solid transparent',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'browse' ? 600 : 400,
                        transition: 'all 0.2s'
                    }}
                >
                    {t('skills.browseRepositories')}
                </button>
                <button
                    onClick={() => setActiveTab('market')}
                    style={{
                        padding: '8px 16px',
                        border: 'none',
                        background: 'transparent',
                        color: activeTab === 'market' ? 'var(--status-info)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'market' ? '2px solid var(--status-info)' : '2px solid transparent',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'market' ? 600 : 400,
                        transition: 'all 0.2s'
                    }}
                >
                    Market
                </button>
                {STORE_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '8px 16px',
                            border: 'none',
                            background: 'transparent',
                            color: activeTab === tab.id ? 'var(--status-info)' : 'var(--text-secondary)',
                            borderBottom: activeTab === tab.id ? '2px solid var(--status-info)' : '2px solid transparent',
                            cursor: 'pointer',
                            fontWeight: activeTab === tab.id ? 600 : 400,
                            transition: 'all 0.2s'
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Import Bar */}
            {showImportBar && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <input
                            className="input-field"
                            type="text"
                            value={importPath}
                            onChange={e => setImportPath(e.target.value)}
                            placeholder={t('skills.localPathPlaceholder')}
                            style={{ width: '100%' }}
                        />
                        {validating && (
                            <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-muted)' }}>
                                {t('common.loading')}
                            </div>
                        )}
                    </div>
                    <button className="btn btn-primary" onClick={importSkill} disabled={loading || !importPath.trim()}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        {t('common.import')}
                    </button>
                </div>

                {/* GitHub Validation Preview */}
                {validationResult && (
                    <div style={{
                        padding: '12px',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${validationResult.valid ? 'var(--status-success)' : 'var(--status-error)'}`,
                        background: validationResult.valid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        fontSize: '13px'
                    }}>
                        {validationResult.valid ? (
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                <div style={{ color: 'var(--status-success)', fontSize: '16px' }}>✓</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
                                        {validationResult.preview?.name || t('skills.validSkill')}
                                    </div>
                                    {validationResult.preview?.description && (
                                        <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                            {validationResult.preview.description}
                                        </div>
                                    )}
                                    {validationResult.preview?.runtime && (
                                        <span style={{
                                            display: 'inline-block',
                                            fontSize: '11px',
                                            padding: '2px 6px',
                                            background: 'var(--bg-element)',
                                            borderRadius: '4px',
                                            color: 'var(--text-tertiary)'
                                        }}>
                                            {validationResult.preview.runtime}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                <div style={{ color: 'var(--status-error)', fontSize: '16px' }}>✗</div>
                                <div style={{ color: 'var(--text-primary)' }}>
                                    {validationResult.reason || t('skills.invalidGitHubUrl')}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            )}
            {error && <div style={{ color: 'var(--status-error)', fontSize: '14px' }}>{error}</div>}

            {/* Tab Content */}
            {activeTab === 'market' ? (
                <MarketplaceView
                    initialType="skill"
                    installedSources={new Set(skills.map(s => s.source))}
                    onInstallComplete={refresh}
                />
            ) : STORE_TABS.some((tab) => tab.id === activeTab) ? (
                <OpenClawStoreTab
                    store={activeTab as OpenClawStore}
                    installedSkillIds={new Set(skills.map(s => s.manifest.id))}
                    onInstallComplete={refresh}
                />
            ) : activeTab === 'browse' ? (
                <SkillRepositoryView
                    onInstallComplete={refresh}
                    installedSkillIds={new Set(skills.map(s => s.source))}
                />
            ) : (
                <div style={{ display: 'flex', gap: '24px', flex: 1, overflow: 'hidden' }}>
                    {/* List */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {skills.map(skill => {
                            const update = updates[skill.manifest.id];
                            return (
                            <div
                                key={skill.manifest.id}
                                style={{
                                    padding: '12px',
                                    border: `1px solid ${selectedId === skill.manifest.id ? 'var(--status-info)' : 'var(--border-subtle)'}`,
                                    borderRadius: 'var(--radius-md)',
                                    background: skill.enabled ? 'var(--bg-panel)' : 'var(--bg-app)',
                                    opacity: skill.enabled ? 1 : 0.7,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onClick={() => setSelectedId(skill.manifest.id)}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: 600 }}>{skill.manifest.name}</span>
                                        {update?.hasUpdate && (
                                            <span style={{
                                                fontSize: '11px',
                                                padding: '2px 6px',
                                                borderRadius: '999px',
                                                background: 'rgba(245, 158, 11, 0.14)',
                                                color: 'var(--status-warning)'
                                            }}>
                                                Update available
                                            </span>
                                        )}
                                    </div>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>v{skill.manifest.version}</span>
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                    {skill.manifest.description || 'No description'}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '11px', padding: '2px 6px', background: 'var(--bg-element)', borderRadius: '4px' }}>{skill.source}</span>
                                        {skill.manifest.tags?.includes('runtime:python') && <RuntimeBadge runtime="python" />}
                                        {skill.manifest.tags?.includes('runtime:node') && <RuntimeBadge runtime="node" />}
                                    </div>
                                    <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }} onClick={e => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={skill.enabled}
                                            onChange={e => void toggleSkill(skill.manifest.id, e.target.checked)}
                                        />
                                        {t('common.enabled')}
                                    </label>
                                </div>
                            </div>
                        );})}
                        {skills.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>{t('skills.noSkillsInstalled')}</div>}
                    </div>

                    {/* Details / Config */}
                    <div style={{ flex: 1, borderLeft: '1px solid var(--border-subtle)', paddingLeft: '24px', overflowY: 'auto' }}>
                        {selectedSkill ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <h3 style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>{t('skills.configuration')}</h3>

                                <div style={{ display: 'grid', gap: '12px' }}>
                                    <Field label={t('skills.id')} value={selectedSkill.manifest.id} />
                                    <Field label={t('skills.sourceType')} value={selectedSkill.source} />
                                    <Field label={t('skills.location')} value={selectedSkill.rootPath} />
                                    <Field label={t('skills.installedAt')} value={new Date(selectedSkill.installedAt).toLocaleString()} />
                                </div>

                                <div style={{
                                    padding: '12px',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 'var(--radius-md)',
                                    background: 'var(--bg-panel)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ display: 'grid', gap: '4px' }}>
                                            <div style={{ fontSize: '14px', fontWeight: 600 }}>Updates</div>
                                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                                {selectedUpdate
                                                    ? selectedUpdate.supported
                                                        ? selectedUpdate.error
                                                            ? selectedUpdate.error
                                                            : selectedUpdate.hasUpdate
                                                                ? `Latest version: ${selectedUpdate.latestVersion ?? 'unknown'}`
                                                                : `Up to date${selectedUpdate.latestVersion ? ` (${selectedUpdate.latestVersion})` : ''}`
                                                        : 'This skill does not have a supported upstream source.'
                                                    : 'No update check has been run for this skill yet.'}
                                            </div>
                                            {selectedUpdate?.sourceRepo && (
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                    {selectedUpdate.sourceRepo}@{selectedUpdate.sourceRef} / {selectedUpdate.sourcePath}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => void checkUpdates([selectedSkill.manifest.id])}
                                                disabled={checkingUpdates}
                                            >
                                                {checkingUpdates ? 'Checking...' : 'Check'}
                                            </button>
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => void upgradeSkill(selectedSkill.manifest.id)}
                                                disabled={
                                                    upgradingSkillId === selectedSkill.manifest.id
                                                    || !selectedUpdate?.supported
                                                    || !selectedUpdate?.hasUpdate
                                                }
                                            >
                                                {upgradingSkillId === selectedSkill.manifest.id ? 'Upgrading...' : 'Upgrade'}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div>
                                        <h4 style={{ fontSize: '14px', marginBottom: '6px' }}>{t('skills.credentialsTitle')}</h4>
                                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            {requiredEnvVars.length > 0
                                                ? t('skills.credentialsHint')
                                                : t('skills.noCredentialsRequired')}
                                        </div>
                                    </div>

                                    {requiredEnvVars.length > 0 && (
                                        <>
                                            <SkillCredentialCard
                                                skillId={selectedSkill.manifest.id}
                                                skillName={selectedSkill.manifest.name}
                                                requiredEnv={requiredEnvVars}
                                                source={selectedSkill.source}
                                            />
                                        </>
                                    )}
                                </div>

                                <SkillCreatorWorkbench
                                    skill={selectedSkill}
                                    onError={(message) => setError(message)}
                                />

                                <div>
                                    <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>{t('skills.manifestFull')}</h4>
                                    <pre style={{
                                        fontSize: '12px',
                                        background: 'var(--bg-element)',
                                        padding: '12px',
                                        borderRadius: 'var(--radius-md)',
                                        overflowX: 'auto',
                                        fontFamily: 'var(--font-code)'
                                    }}>
                                        {JSON.stringify(selectedSkill.manifest, null, 2)}
                                    </pre>
                                </div>

                                {selectedSkill.manifest.allowedTools && (
                                    <div>
                                        <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>{t('skills.allowedTools')}</h4>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                            {selectedSkill.manifest.allowedTools.map(tool => (
                                                <span key={tool} style={{ fontSize: '12px', padding: '4px 8px', background: 'var(--bg-element)', borderRadius: '4px' }}>{tool}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <button
                                    className="btn"
                                    onClick={() => void remove(selectedSkill.manifest.id)}
                                    style={{ background: 'var(--status-error)', marginTop: '20px', alignSelf: 'flex-start', color: 'white' }}
                                >
                                    {t('skills.uninstallSkill')}
                                </button>
                            </div>
                        ) : (
                            <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                {t('skills.selectSkillToView')}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

const Field = ({ label, value }: { label: string, value: string }) => (
    <div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: '14px', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{value}</div>
    </div>
);
