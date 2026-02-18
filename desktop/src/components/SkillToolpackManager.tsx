/**
 * Skill & Toolpack Manager
 *
 * Minimal UI to manage MCP Toolpacks and Claude Skills.
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

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
    };
    source: string;
    rootPath?: string;
    installedAt: string;
    enabled: boolean;
};

type SkillRecord = {
    manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        allowedTools?: string[];
        tags?: string[];
    };
    rootPath: string;
    source: string;
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

export function SkillToolpackManager() {
    const { t } = useTranslation();
    const [toolpacks, setToolpacks] = useState<ToolpackRecord[]>([]);
    const [skills, setSkills] = useState<SkillRecord[]>([]);
    const [selectedToolpackId, setSelectedToolpackId] = useState<string | null>(null);
    const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
    const [toolpackPath, setToolpackPath] = useState('');
    const [skillPath, setSkillPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        setLoading(true);
        setError(null);
        try {
            const toolpackResult = await invoke<IpcResult>('list_toolpacks', {
                input: { includeDisabled: true },
            });
            const skillResult = await invoke<IpcResult>('list_claude_skills', {
                input: { includeDisabled: true },
            });
            setToolpacks(extractList<ToolpackRecord>(toolpackResult, 'toolpacks'));
            setSkills(extractList<SkillRecord>(skillResult, 'skills'));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    const installToolpack = async () => {
        if (!toolpackPath.trim()) return;
        setLoading(true);
        try {
            await invoke<IpcResult>('install_toolpack', {
                input: { source: 'local_folder', path: toolpackPath.trim() },
            });
            setToolpackPath('');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Install failed');
        } finally {
            setLoading(false);
        }
    };

    const installSkill = async () => {
        if (!skillPath.trim()) return;
        setLoading(true);
        try {
            await invoke<IpcResult>('import_claude_skill', {
                input: { source: 'local_folder', path: skillPath.trim() },
            });
            setSkillPath('');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Import failed');
        } finally {
            setLoading(false);
        }
    };

    const toggleToolpack = async (toolpackId: string, enabled: boolean) => {
        setLoading(true);
        try {
            await invoke<IpcResult>('set_toolpack_enabled', {
                input: { toolpackId, enabled },
            });
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Update failed');
        } finally {
            setLoading(false);
        }
    };

    const toggleSkill = async (skillId: string, enabled: boolean) => {
        setLoading(true);
        try {
            await invoke<IpcResult>('set_claude_skill_enabled', {
                input: { skillId, enabled },
            });
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Update failed');
        } finally {
            setLoading(false);
        }
    };

    const removeToolpack = async (toolpackId: string) => {
        if (!window.confirm(t('toolpacks.removeToolpackConfirm'))) return;
        setLoading(true);
        try {
            await invoke<IpcResult>('remove_toolpack', {
                input: { toolpackId, deleteFiles: true },
            });
            if (selectedToolpackId === toolpackId) {
                setSelectedToolpackId(null);
            }
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Remove failed');
        } finally {
            setLoading(false);
        }
    };

    const removeSkill = async (skillId: string) => {
        if (!window.confirm(t('toolpacks.removeSkillConfirm'))) return;
        setLoading(true);
        try {
            await invoke<IpcResult>('remove_claude_skill', {
                input: { skillId, deleteFiles: true },
            });
            if (selectedSkillId === skillId) {
                setSelectedSkillId(null);
            }
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Remove failed');
        } finally {
            setLoading(false);
        }
    };

    const selectedToolpack = toolpacks.find((tp) => tp.manifest.id === selectedToolpackId) ?? null;
    const selectedSkill = skills.find((sk) => sk.manifest.id === selectedSkillId) ?? null;

    return (
        <div style={{ display: 'grid', gap: '24px' }}>
            <div>
                <h2>{t('toolpacks.mcpToolpacks')}</h2>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <input
                        type="text"
                        value={toolpackPath}
                        onChange={(e) => setToolpackPath(e.target.value)}
                        placeholder={t('toolpacks.localToolpackPlaceholder')}
                        style={{ flex: 1, padding: '8px' }}
                    />
                    <button onClick={installToolpack} disabled={loading}>
                        {t('common.install')}
                    </button>
                </div>
                {toolpacks.map((tp) => (
                    <div
                        key={tp.manifest.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '6px',
                            marginBottom: '6px',
                            cursor: 'pointer',
                            backgroundColor:
                                selectedToolpackId === tp.manifest.id ? '#f5f5f5' : 'transparent',
                        }}
                        onClick={() => setSelectedToolpackId(tp.manifest.id)}
                    >
                        <div>
                            <div style={{ fontWeight: 600 }}>
                                {tp.manifest.name} <span style={{ color: '#666' }}>v{tp.manifest.version}</span>
                            </div>
                            {tp.manifest.description && (
                                <div style={{ fontSize: '12px', color: '#666' }}>
                                    {tp.manifest.description}
                                </div>
                            )}
                        </div>
                        <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                checked={tp.enabled}
                                onChange={(e) => void toggleToolpack(tp.manifest.id, e.target.checked)}
                            />
                            {t('common.enabled')}
                        </label>
                    </div>
                ))}

                {selectedToolpack && (
                    <div style={{ padding: '12px', border: '1px solid #ddd', borderRadius: '6px' }}>
                        <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                            {t('toolpacks.details', { name: selectedToolpack.manifest.name })}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                            {t('toolpacks.idLabel', { id: selectedToolpack.manifest.id })}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                            {t('toolpacks.runtime', { runtime: selectedToolpack.manifest.runtime ?? 'default' })}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                            {t('toolpacks.sourceLabel', { source: selectedToolpack.source })}
                        </div>
                        {selectedToolpack.rootPath && (
                            <div style={{ fontSize: '12px', color: '#666' }}>
                                {t('toolpacks.pathLabel', { path: selectedToolpack.rootPath })}
                            </div>
                        )}
                        {selectedToolpack.manifest.effects && selectedToolpack.manifest.effects.length > 0 && (
                            <div style={{ marginTop: '8px', fontSize: '12px' }}>
                                {t('toolpacks.effects', { effects: selectedToolpack.manifest.effects.join(', ') })}
                            </div>
                        )}
                        {selectedToolpack.manifest.tools && selectedToolpack.manifest.tools.length > 0 && (
                            <div style={{ marginTop: '4px', fontSize: '12px' }}>
                                {t('toolpacks.tools', { tools: selectedToolpack.manifest.tools.join(', ') })}
                            </div>
                        )}
                        <div style={{ marginTop: '8px' }}>
                            <button onClick={() => void removeToolpack(selectedToolpack.manifest.id)}>
                                {t('common.remove')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div>
                <h2>{t('skills.claudeSkills')}</h2>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <input
                        type="text"
                        value={skillPath}
                        onChange={(e) => setSkillPath(e.target.value)}
                        placeholder={t('skills.folderPlaceholder')}
                        style={{ flex: 1, padding: '8px' }}
                    />
                    <button onClick={installSkill} disabled={loading}>
                        {t('common.import')}
                    </button>
                </div>
                {skills.map((skill) => (
                    <div
                        key={skill.manifest.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '6px',
                            marginBottom: '6px',
                            cursor: 'pointer',
                            backgroundColor:
                                selectedSkillId === skill.manifest.id ? '#f5f5f5' : 'transparent',
                        }}
                        onClick={() => setSelectedSkillId(skill.manifest.id)}
                    >
                        <div>
                            <div style={{ fontWeight: 600 }}>
                                {skill.manifest.name}{' '}
                                <span style={{ color: '#666' }}>v{skill.manifest.version}</span>
                            </div>
                            {skill.manifest.description && (
                                <div style={{ fontSize: '12px', color: '#666' }}>
                                    {skill.manifest.description}
                                </div>
                            )}
                        </div>
                        <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                checked={skill.enabled}
                                onChange={(e) => void toggleSkill(skill.manifest.id, e.target.checked)}
                            />
                            {t('common.enabled')}
                        </label>
                    </div>
                ))}

                {selectedSkill && (
                    <div style={{ padding: '12px', border: '1px solid #ddd', borderRadius: '6px' }}>
                        <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                            {t('toolpacks.details', { name: selectedSkill.manifest.name })}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                            {t('toolpacks.idLabel', { id: selectedSkill.manifest.id })}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                            {t('toolpacks.sourceLabel', { source: selectedSkill.source })}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                            {t('toolpacks.pathLabel', { path: selectedSkill.rootPath })}
                        </div>
                        {selectedSkill.manifest.allowedTools && selectedSkill.manifest.allowedTools.length > 0 && (
                            <div style={{ marginTop: '8px', fontSize: '12px' }}>
                                {t('toolpacks.allowedTools', { tools: selectedSkill.manifest.allowedTools.join(', ') })}
                            </div>
                        )}
                        <div style={{ marginTop: '8px' }}>
                            <button onClick={() => void removeSkill(selectedSkill.manifest.id)}>
                                {t('common.remove')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={() => void refresh()} disabled={loading}>
                    {t('common.refresh')}
                </button>
                {loading && <span>{t('common.loading')}</span>}
                {error && <span style={{ color: 'red' }}>{error}</span>}
            </div>
        </div>
    );
}
