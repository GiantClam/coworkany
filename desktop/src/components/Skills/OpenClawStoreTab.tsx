import { useEffect, useState } from 'react';
import { useOpenClawSkillStore, type OpenClawStore } from '../../hooks/useOpenClawSkillStore';

interface OpenClawStoreTabProps {
    store: OpenClawStore;
    installedSkillIds: Set<string>;
    onInstallComplete?: () => void;
}

const STORE_LABELS: Record<OpenClawStore, string> = {
    clawhub: 'ClawHub',
};

const DEFAULT_QUERY = 'automation';
const FETCH_LIMIT = 120;

export function OpenClawStoreTab({ store, installedSkillIds, onInstallComplete }: OpenClawStoreTabProps) {
    const [query, setQuery] = useState(DEFAULT_QUERY);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(12);
    const [viewMode, setViewMode] = useState<'compact' | 'comfortable'>('compact');
    const { skills, loading, installingSkill, error, search, install } = useOpenClawSkillStore();

    useEffect(() => {
        void search(store, query.trim() || DEFAULT_QUERY, FETCH_LIMIT).then(() => setCurrentPage(1));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [store]);

    const onSearch = async () => {
        await search(store, query.trim() || DEFAULT_QUERY, FETCH_LIMIT);
        setCurrentPage(1);
    };

    const onInstall = async (skillName: string) => {
        const result = await install(store, skillName);
        if (!result.success) {
            window.alert(result.error ?? 'Install failed');
            return;
        }
        onInstallComplete?.();
    };

    const totalPages = Math.max(1, Math.ceil(skills.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const pageStart = (safePage - 1) * pageSize;
    const pageSkills = skills.slice(pageStart, pageStart + pageSize);

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
                    {skills.length} skills
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Page Size
                    </label>
                    <select
                        className="input-field"
                        value={String(pageSize)}
                        onChange={(event) => {
                            setPageSize(Number(event.target.value));
                            setCurrentPage(1);
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
            >
                {pageSkills.map((skill) => {
                    const installed = installedSkillIds.has(skill.name);
                    const installing = installingSkill === skill.name;
                    return (
                        <div
                            key={`${store}:${skill.name}`}
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
                                    <strong style={{ fontSize: '14px' }}>{skill.name}</strong>
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
                                </div>
                            </div>

                            <button
                                className="btn btn-primary"
                                disabled={installed || installing || loading}
                                onClick={() => void onInstall(skill.name)}
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
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <button
                    className="btn btn-secondary"
                    disabled={safePage <= 1 || loading}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                    Prev
                </button>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Page {safePage} / {totalPages}
                </div>
                <button
                    className="btn btn-secondary"
                    disabled={safePage >= totalPages || loading}
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                >
                    Next
                </button>
            </div>
        </div>
    );
}
