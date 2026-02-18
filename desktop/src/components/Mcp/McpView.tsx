import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import '../../styles/variables.css'; // Ensure variables are available if using raw CSS
import { useGitHubValidation } from '../../hooks/useGitHubValidation';
import { McpRepositoryView } from './McpRepositoryView';
import { RuntimeBadge } from '../Common/RuntimeBadge';

type ToolpackRecord = {
    manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        runtime?: string;
        tools?: string[];
        effects?: string[];
        tags?: string[];
        // Add other manifest fields if needed
    };
    source: string;
    rootPath?: string;
    installedAt: string;
    enabled: boolean;
};

type IpcResult = {
    success: boolean;
    payload: {
        payload?: Record<string, unknown>;
    };
};

function extractList<T>(result: IpcResult, key: string): T[] {
    const payload = result.payload?.payload ?? {};
    const data = payload[key];
    return Array.isArray(data) ? (data as T[]) : [];
}

export function McpView() {
    const { t } = useTranslation();
    const [toolpacks, setToolpacks] = useState<ToolpackRecord[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [installPath, setInstallPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'install' | 'browse'>('install');

    // GitHub URL validation
    const { validating, result: validationResult } = useGitHubValidation(installPath, 'mcp');

    const refresh = async () => {
        setLoading(true);
        try {
            const result = await invoke<IpcResult>('list_toolpacks', {
                input: { includeDisabled: true },
            });
            setToolpacks(extractList<ToolpackRecord>(result, 'toolpacks'));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void refresh(); }, []);

    const toggleToolpack = async (toolpackId: string, enabled: boolean) => {
        setLoading(true);
        try {
            await invoke<IpcResult>('set_toolpack_enabled', { input: { toolpackId, enabled } });
            await refresh();
        } catch (err) { setError(err instanceof Error ? err.message : 'Update failed'); }
        finally { setLoading(false); }
    };

    const install = async () => {
        if (!installPath.trim()) return;
        setLoading(true);
        try {
            // Support URL or Path? Assuming local for now per existing code
            // Check if input looks like a URL?
            const isUrl = installPath.startsWith('http');
            await invoke<IpcResult>('install_toolpack', {
                input: {
                    source: isUrl ? 'url' : 'local_folder',
                    path: isUrl ? undefined : installPath.trim(),
                    url: isUrl ? installPath.trim() : undefined
                },
            });
            setInstallPath('');
            await refresh();
        } catch (err) { setError(err instanceof Error ? err.message : 'Install failed'); }
        finally { setLoading(false); }
    };

    const remove = async (toolpackId: string) => {
        if (!window.confirm(t('toolpacks.confirmRemove'))) return;
        setLoading(true);
        try {
            await invoke<IpcResult>('remove_toolpack', { input: { toolpackId, deleteFiles: true } });
            if (selectedId === toolpackId) setSelectedId(null);
            await refresh();
        } catch (err) { setError(err instanceof Error ? err.message : 'Remove failed'); }
        finally { setLoading(false); }
    };

    const selectedToolpack = toolpacks.find(t => t.manifest.id === selectedId);

    return (
        <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>{t('mcp.mcpServers')}</h2>
                <button className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    {t('common.refresh')}
                </button>
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
                    {t('mcp.browseRepositories')}
                </button>
            </div>

            {/* Install Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <input
                            className="input-field"
                            type="text"
                            value={installPath}
                            onChange={e => setInstallPath(e.target.value)}
                            placeholder={t('mcp.localPathPlaceholder')}
                            style={{ width: '100%' }}
                        />
                        {validating && (
                            <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-muted)' }}>
                                {t('common.loading')}
                            </div>
                        )}
                    </div>
                    <button className="btn btn-primary" onClick={install} disabled={loading || !installPath.trim()}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        {t('common.install')}
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
                                        {validationResult.preview?.name || t('mcp.validMcpServer')}
                                    </div>
                                    {validationResult.preview?.description && (
                                        <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                            {validationResult.preview.description}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        {validationResult.preview?.runtime && (
                                            <span style={{
                                                fontSize: '11px',
                                                padding: '2px 6px',
                                                background: 'var(--bg-element)',
                                                borderRadius: '4px',
                                                color: 'var(--text-tertiary)'
                                            }}>
                                                {validationResult.preview.runtime}
                                            </span>
                                        )}
                                        {validationResult.preview?.tools && validationResult.preview.tools.length > 0 && (
                                            <span style={{
                                                fontSize: '11px',
                                                padding: '2px 6px',
                                                background: 'var(--bg-element)',
                                                borderRadius: '4px',
                                                color: 'var(--text-tertiary)'
                                            }}>
                                                {t('mcp.toolsCount', { count: validationResult.preview.tools.length })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                <div style={{ color: 'var(--status-error)', fontSize: '16px' }}>✗</div>
                                <div style={{ color: 'var(--text-primary)' }}>
                                    {validationResult.reason || t('mcp.invalidGitHubUrl')}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {error && <div style={{ color: 'var(--status-error)', fontSize: '14px' }}>{error}</div>}

            {/* Tab Content */}
            {activeTab === 'browse' ? (
                <McpRepositoryView onInstallComplete={refresh} />
            ) : (
                <div style={{ display: 'flex', gap: '24px', flex: 1, overflow: 'hidden' }}>
                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {toolpacks.map(tp => (
                        <div
                            key={tp.manifest.id}
                            style={{
                                padding: '12px',
                                border: `1px solid ${selectedId === tp.manifest.id ? 'var(--status-info)' : 'var(--border-subtle)'}`,
                                borderRadius: 'var(--radius-md)',
                                background: tp.enabled ? 'var(--bg-panel)' : 'var(--bg-app)',
                                opacity: tp.enabled ? 1 : 0.7,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onClick={() => setSelectedId(tp.manifest.id)}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ fontWeight: 600 }}>{tp.manifest.name}</span>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>v{tp.manifest.version}</span>
                            </div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                {tp.manifest.description || 'No description'}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <span style={{ fontSize: '11px', padding: '2px 6px', background: 'var(--bg-element)', borderRadius: '4px' }}>{tp.source}</span>
                                    {tp.manifest.runtime && <RuntimeBadge runtime={tp.manifest.runtime as any} />}
                                    {tp.manifest.tags?.includes('runtime:python') && <RuntimeBadge runtime="python" />}
                                    {tp.manifest.tags?.includes('runtime:node') && <RuntimeBadge runtime="node" />}
                                    {tp.manifest.tags?.includes('runtime:bun') && <RuntimeBadge runtime="bun" />}
                                </div>
                                <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }} onClick={e => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={tp.enabled}
                                        onChange={e => void toggleToolpack(tp.manifest.id, e.target.checked)}
                                    />
                                    {t('common.enabled')}
                                </label>
                            </div>
                        </div>
                    ))}
                    {toolpacks.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>{t('mcp.noMcpServersInstalled')}</div>}
                </div>

                {/* Details / Config */}
                <div style={{ flex: 1, borderLeft: '1px solid var(--border-subtle)', paddingLeft: '24px', overflowY: 'auto' }}>
                    {selectedToolpack ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <h3 style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>{t('mcp.configuration')}</h3>

                            <div style={{ display: 'grid', gap: '12px' }}>
                                <Field label={t('mcp.id')} value={selectedToolpack.manifest.id} />
                                <Field label={t('mcp.source')} value={selectedToolpack.source} />
                                <Field label={t('mcp.location')} value={selectedToolpack.rootPath || t('mcp.internal')} />
                                <Field label={t('mcp.installedAt')} value={new Date(selectedToolpack.installedAt).toLocaleString()} />
                            </div>

                            <div>
                                <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>{t('mcp.manifestFull')}</h4>
                                <pre style={{
                                    fontSize: '12px',
                                    background: 'var(--bg-element)',
                                    padding: '12px',
                                    borderRadius: 'var(--radius-md)',
                                    overflowX: 'auto',
                                    fontFamily: 'var(--font-code)'
                                }}>
                                    {JSON.stringify(selectedToolpack.manifest, null, 2)}
                                </pre>
                            </div>

                            <button
                                onClick={() => void remove(selectedToolpack.manifest.id)}
                                style={{ background: 'var(--status-error)', marginTop: '20px', alignSelf: 'flex-start' }}
                            >
                                {t('mcp.uninstallServer')}
                            </button>
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            {t('mcp.selectServerToView')}
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
