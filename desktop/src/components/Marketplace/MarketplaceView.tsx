import { useEffect, useMemo, useState } from 'react';
import { useMarketplaceSearch, type MarketplaceItem, type MarketplaceItemType } from '../../hooks/useMarketplaceSearch';
import {
    buildMarketplaceViewItems,
    deriveInstallButtonState,
    type MarketplaceFilterType,
    type MarketplaceSortOption,
    SAMPLE_ITEMS,
} from './marketplaceModel';

interface MarketplaceViewProps {
    defaultSource?: string;
    initialType?: MarketplaceItemType | 'all';
    installedSources?: Set<string>;
    onInstallComplete?: () => void;
}

type FilterType = MarketplaceFilterType;
type SortOption = MarketplaceSortOption;
const MARKETPLACE_TYPE_OPTIONS: Array<{ type: MarketplaceItemType; label: string }> = [
    { type: 'skill', label: 'Skills' },
    { type: 'mcp', label: 'MCP' },
];

export function MarketplaceView({
    defaultSource = 'github:openai',
    initialType = 'all',
    installedSources,
    onInstallComplete,
}: MarketplaceViewProps) {
    const [source, setSource] = useState(defaultSource);
    const [searchQuery, setSearchQuery] = useState('');
    const [category, setCategory] = useState<FilterType>(initialType);
    const [sortBy, setSortBy] = useState<SortOption>('popular');
    const [installingId, setInstallingId] = useState<string | null>(null);
    const { items, loading, error, stats, scanDefault, scanSource, installItem } = useMarketplaceSearch();
    const hasFallbackSamples = items.length === 0 && SAMPLE_ITEMS.length > 0;

    useEffect(() => {
        void scanDefault();
    }, [scanDefault]);

    const filtered = useMemo(() => {
        return buildMarketplaceViewItems(items, searchQuery, category, sortBy);
    }, [items, searchQuery, category, sortBy]);

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
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter results"
                    className="input-field"
                    style={{ flex: 1 }}
                />
                <select value={category} onChange={(e) => setCategory(e.target.value as FilterType)} className="input-field" style={{ width: 120 }}>
                    <option value="all">All</option>
                    {MARKETPLACE_TYPE_OPTIONS.map((option) => (
                        <option key={option.type} value={option.type}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="input-field" style={{ width: 120 }}>
                    <option value="popular">popular</option>
                    <option value="newest">newest</option>
                    <option value="rating">rating</option>
                </select>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    S:{stats.skillCount} M:{stats.mcpCount}
                </span>
            </div>

            {error && (
                <div style={{ color: 'var(--status-error)', fontSize: 13 }}>{error}</div>
            )}
            {hasFallbackSamples && !loading && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    Showing built-in sample marketplace items.
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map((item) => {
                    const buttonState = deriveInstallButtonState(item, installedSources, installingId);
                    const installed = buttonState === 'installed';
                    const busy = buttonState === 'installing';
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
                                {buttonState === 'installed' ? 'Installed' : buttonState === 'installing' ? 'Installing' : 'Install'}
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
