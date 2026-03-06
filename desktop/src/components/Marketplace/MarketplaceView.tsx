import { useEffect, useMemo, useState } from 'react';
import { useMarketplaceSearch, type MarketplaceItem, type MarketplaceItemType } from '../../hooks/useMarketplaceSearch';

interface MarketplaceViewProps {
    defaultSource?: string;
    initialType?: MarketplaceItemType | 'all';
    installedSources?: Set<string>;
    onInstallComplete?: () => void;
}

type FilterType = MarketplaceItemType | 'all';

export function MarketplaceView({
    defaultSource = 'github:openai',
    initialType = 'all',
    installedSources,
    onInstallComplete,
}: MarketplaceViewProps) {
    const [source, setSource] = useState(defaultSource);
    const [query, setQuery] = useState('');
    const [filterType, setFilterType] = useState<FilterType>(initialType);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const { items, loading, error, stats, scanDefault, scanSource, installItem } = useMarketplaceSearch();

    useEffect(() => {
        void scanDefault();
    }, [scanDefault]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return items.filter((item) => {
            if (filterType !== 'all' && item.type !== filterType) return false;
            if (!q) return true;
            return (
                item.name.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q) ||
                item.source.toLowerCase().includes(q)
            );
        });
    }, [items, query, filterType]);

    const handleSearch = async () => {
        await scanSource(source);
    };

    const handleInstall = async (item: MarketplaceItem) => {
        if (installedSources?.has(item.source)) return;
        setInstallingId(item.id);
        try {
            await installItem(item);
            onInstallComplete?.();
        } catch (err) {
            window.alert(String(err));
        } finally {
            setInstallingId(null);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="github:owner/repo"
                    style={{ flex: 1, minWidth: 220 }}
                    className="input-field"
                />
                <button className="btn btn-secondary" onClick={() => void handleSearch()} disabled={loading}>
                    Search
                </button>
                <button className="btn btn-secondary" onClick={() => void scanDefault()} disabled={loading}>
                    Default
                </button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter results"
                    className="input-field"
                    style={{ flex: 1 }}
                />
                <select value={filterType} onChange={(e) => setFilterType(e.target.value as FilterType)} className="input-field" style={{ width: 120 }}>
                    <option value="all">All</option>
                    <option value="skill">Skills</option>
                    <option value="mcp">MCP</option>
                </select>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    S:{stats.skillCount} M:{stats.mcpCount}
                </span>
            </div>

            {error && (
                <div style={{ color: 'var(--status-error)', fontSize: 13 }}>{error}</div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map((item) => {
                    const installed = installedSources?.has(item.source);
                    const busy = installingId === item.id;
                    return (
                        <div
                            key={item.id}
                            style={{
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 8,
                                padding: 10,
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 12,
                                alignItems: 'flex-start',
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                                    <strong style={{ fontSize: 14 }}>{item.name}</strong>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.type.toUpperCase()}</span>
                                    {item.runtime && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.runtime}</span>}
                                </div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.description || 'No description'}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{item.source}</div>
                            </div>
                            <button
                                className="btn btn-primary"
                                onClick={() => void handleInstall(item)}
                                disabled={Boolean(installed) || busy || loading}
                                style={{ minWidth: 92 }}
                            >
                                {installed ? 'Installed' : busy ? 'Installing' : 'Install'}
                            </button>
                        </div>
                    );
                })}

                {!loading && filtered.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
                        No results
                    </div>
                )}
            </div>
        </div>
    );
}
