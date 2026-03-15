import { useEffect, useState } from 'react';
import { useOpenClawSkillStore, type OpenClawStore } from '../../hooks/useOpenClawSkillStore';
import { injectSkillConfigPrompt } from '../../lib/skillConfigPrompts';
import { useTaskEventStore } from '../../stores/useTaskEventStore';

interface OpenClawStoreTabProps {
    store: OpenClawStore;
    installedSkillIds: Set<string>;
    onInstallComplete?: () => void;
}

const STORE_LABELS: Record<OpenClawStore, string> = {
    clawhub: 'ClawHub',
    tencent_skillhub: 'SkillHub',
};

const DEFAULT_QUERY = 'automation';
const FETCH_LIMIT = 100;
const SCROLL_LOAD_THRESHOLD_PX = 120;

export function OpenClawStoreTab({ store, installedSkillIds, onInstallComplete }: OpenClawStoreTabProps) {
    const activeTaskId = useTaskEventStore((state) => state.activeTaskId);
    const [query, setQuery] = useState(DEFAULT_QUERY);
    const [pageSize, setPageSize] = useState(12);
    const [visibleCount, setVisibleCount] = useState(12);
    const [viewMode, setViewMode] = useState<'compact' | 'comfortable'>('compact');
    const { skills, loading, installingSkill, error, search, install } = useOpenClawSkillStore();

    useEffect(() => {
        void search(store, query.trim() || DEFAULT_QUERY, FETCH_LIMIT).then(() => setVisibleCount(pageSize));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [store]);

    const onSearch = async () => {
        await search(store, query.trim() || DEFAULT_QUERY, FETCH_LIMIT);
        setVisibleCount(pageSize);
    };

    const onInstall = async (skillName: string) => {
        const result = await install(store, skillName);
        if (!result.success) {
            window.alert(result.error ?? 'Install failed');
            return;
        }
        onInstallComplete?.();
        if (result.skill && result.skill.requiredEnv.length > 0) {
            injectSkillConfigPrompt(activeTaskId, {
                skillId: result.skill.id,
                skillName: result.skill.name,
                requiredEnv: result.skill.requiredEnv,
                source: result.skill.source,
            });
        }
    };

    useEffect(() => {
        setVisibleCount((prev) => {
            if (skills.length === 0) {
                return pageSize;
            }
            if (prev > skills.length) {
                return skills.length;
            }
            if (prev < pageSize) {
                return pageSize;
            }
            return prev;
        });
    }, [skills.length, pageSize]);

    const hasMoreSkills = visibleCount < skills.length;
    const visibleSkills = skills.slice(0, visibleCount);

    const loadMoreSkills = () => {
        if (loading || !hasMoreSkills) {
            return;
        }
        setVisibleCount((prev) => Math.min(skills.length, prev + pageSize));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                    className="input-field"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            void onSearch();
                        }
                    }}
                    placeholder={`Search ${STORE_LABELS[store]} skills`}
                    style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" onClick={() => void onSearch()} disabled={loading}>
                    Search
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Showing {Math.min(visibleCount, skills.length)} of {skills.length} skills
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Load Step
                    </label>
                    <select
                        className="input-field"
                        value={String(pageSize)}
                        onChange={(event) => {
                            setPageSize(Number(event.target.value));
                        }}
                        style={{ width: '96px', height: '34px' }}
                    >
                        <option value="12">12</option>
                        <option value="24">24</option>
                        <option value="48">48</option>
                    </select>
                    <button
                        className="btn btn-secondary"
                        onClick={() => setViewMode('compact')}
                        style={{ opacity: viewMode === 'compact' ? 1 : 0.7 }}
                    >
                        Compact
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => setViewMode('comfortable')}
                        style={{ opacity: viewMode === 'comfortable' ? 1 : 0.7 }}
                    >
                        Comfortable
                    </button>
                </div>
            </div>

            {error && (
                <div style={{ color: 'var(--status-error)', fontSize: '13px' }}>{error}</div>
            )}

            <div
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    display: viewMode === 'compact' ? 'grid' : 'flex',
                    gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(240px, 1fr))' : undefined,
                    flexDirection: viewMode === 'compact' ? undefined : 'column',
                    gap: '8px',
                    alignContent: 'start',
                }}
                onScroll={(event) => {
                    const target = event.currentTarget;
                    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
                    if (remaining <= SCROLL_LOAD_THRESHOLD_PX) {
                        loadMoreSkills();
                    }
                }}
            >
                {visibleSkills.map((skill) => {
                    const installKey = skill.slug || skill.name;
                    const installed = installedSkillIds.has(skill.name) || installedSkillIds.has(installKey);
                    const installing = installingSkill === installKey;
                    return (
                        <div
                            key={`${store}:${installKey}`}
                            style={{
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-md)',
                                padding: '12px',
                                display: 'flex',
                                flexDirection: viewMode === 'compact' ? 'column' : 'row',
                                justifyContent: 'space-between',
                                gap: '12px',
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <strong style={{ fontSize: '14px' }}>{skill.displayName || skill.name}</strong>
                                    {skill.version && (
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>v{skill.version}</span>
                                    )}
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    {skill.description || 'No description'}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                                    {STORE_LABELS[store]}
                                    {skill.author ? ` - ${skill.author}` : ''}
                                    {typeof skill.downloads === 'number' ? ` - ${skill.downloads} downloads` : ''}
                                    {skill.slug && skill.slug !== skill.name ? ` - ${skill.slug}` : ''}
                                </div>
                            </div>

                            <button
                                className="btn btn-primary"
                                disabled={installed || installing || loading}
                                onClick={() => void onInstall(installKey)}
                                style={{ minWidth: '100px', alignSelf: viewMode === 'compact' ? 'flex-end' : 'auto' }}
                            >
                                {installed ? 'Installed' : installing ? 'Installing' : 'Install'}
                            </button>
                        </div>
                    );
                })}

                {!loading && skills.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '24px' }}>
                        No skills found.
                    </div>
                )}

                {skills.length > 0 && hasMoreSkills && (
                    <div
                        style={{
                            gridColumn: viewMode === 'compact' ? '1 / -1' : undefined,
                            display: 'flex',
                            justifyContent: 'center',
                            padding: '12px 0 4px',
                        }}
                    >
                        <button className="btn btn-secondary" onClick={loadMoreSkills} disabled={loading}>
                            Load more
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
