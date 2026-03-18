import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMarketplaceSearch, type MarketplaceItem, type MarketplaceItemType } from '../../hooks/useMarketplaceSearch';
import { useDependencyManager } from '../../hooks/useDependencyManager';
import { toast } from '../Common/ToastProvider';
import {
    extractSkillImportFeedback,
    type SkillImportFeedback,
} from '../../lib/skillImport';

interface MarketplaceViewProps {
    defaultSource?: string;
    initialType?: MarketplaceItemType | 'all';
    installedSources?: Set<string>;
    onInstallComplete?: (feedback?: SkillImportFeedback) => void | Promise<void>;
}

type FilterType = MarketplaceItemType | 'all';
type MarketplaceCategory =
    | 'all'
    | 'development'
    | 'productivity'
    | 'data'
    | 'communication'
    | 'automation';
type MarketplaceSort = 'popular' | 'newest' | 'rating';

type MarketplaceMetadata = {
    category: Exclude<MarketplaceCategory, 'all'>;
    installs: number;
    rating: number;
    addedAt: string;
};

const SAMPLE_ITEMS: MarketplaceItem[] = [
    {
        id: 'sample-skill-codex',
        name: 'Codex Workflow Kit',
        description: 'Reusable coding workflows, checks, and automation helpers.',
        source: 'github:openai/codex',
        path: 'skills/codex-workflow-kit',
        runtime: 'Node.js',
        tools: ['code-review', 'verification-before-completion'],
        hasScripts: true,
        type: 'skill',
    },
    {
        id: 'sample-skill-research',
        name: 'Research Brief Builder',
        description: 'Turns open web findings into structured decision briefs.',
        source: 'github:giantclam/research-briefs',
        path: 'skills/research-brief-builder',
        runtime: 'Node.js',
        tools: ['web-search', 'summarize'],
        hasScripts: false,
        type: 'skill',
    },
    {
        id: 'sample-mcp-github',
        name: 'GitHub MCP Server',
        description: 'Browse repositories, issues, and pull requests from GitHub.',
        source: 'github:modelcontextprotocol/servers/src/github',
        path: 'servers/github',
        runtime: 'Node.js',
        tools: ['list_repos', 'create_issue', 'create_pr'],
        hasScripts: true,
        type: 'mcp',
    },
    {
        id: 'sample-mcp-browser',
        name: 'Browser Automation MCP',
        description: 'Drive browser tasks with navigation, scraping, and form fill tools.',
        source: 'github:modelcontextprotocol/servers/src/playwright',
        path: 'servers/playwright',
        runtime: 'Node.js',
        tools: ['navigate', 'click', 'extract'],
        hasScripts: true,
        type: 'mcp',
    },
];

const SAMPLE_METADATA: Record<string, MarketplaceMetadata> = {
    'github:openai/codex': {
        category: 'development',
        installs: 12840,
        rating: 4.9,
        addedAt: '2026-02-10',
    },
    'github:giantclam/research-briefs': {
        category: 'productivity',
        installs: 7210,
        rating: 4.7,
        addedAt: '2026-03-01',
    },
    'github:modelcontextprotocol/servers/src/github': {
        category: 'communication',
        installs: 16320,
        rating: 4.8,
        addedAt: '2026-01-28',
    },
    'github:modelcontextprotocol/servers/src/playwright': {
        category: 'automation',
        installs: 14350,
        rating: 4.8,
        addedAt: '2026-02-24',
    },
};

function getMarketplaceMetadata(item: MarketplaceItem): MarketplaceMetadata {
    const known = SAMPLE_METADATA[item.source];
    if (known) return known;

    return {
        category: item.type === 'mcp' ? 'automation' : 'development',
        installs: item.type === 'mcp' ? 5200 : 3400,
        rating: item.type === 'mcp' ? 4.6 : 4.5,
        addedAt: '2026-01-01',
    };
}

export function MarketplaceView({
    defaultSource = 'github:openai',
    initialType = 'all',
    installedSources,
    onInstallComplete,
}: MarketplaceViewProps) {
    const { t } = useTranslation();
    const [source, setSource] = useState(defaultSource);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<FilterType>(initialType);
    const [category, setCategory] = useState<MarketplaceCategory>('all');
    const [sortBy, setSortBy] = useState<MarketplaceSort>('popular');
    const [installingId, setInstallingId] = useState<string | null>(null);
    const { items, loading, error, stats, scanDefault, scanSource, installItem } = useMarketplaceSearch();
    const { dependencies, runtimeContext, installSkillhub, activeAction } = useDependencyManager();

    const skillhubReady = dependencies.find((item) => item.id === 'skillhub-cli')?.ready ?? false;

    useEffect(() => {
        void scanDefault();
    }, [scanDefault]);

    const visibleItems = items.length > 0 ? items : SAMPLE_ITEMS;

    const filtered = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        return visibleItems
            .filter((item) => {
                const meta = getMarketplaceMetadata(item);

                if (filterType !== 'all' && item.type !== filterType) return false;
                if (category !== 'all' && meta.category !== category) return false;
                if (!normalizedQuery) return true;
                return (
                    item.name.toLowerCase().includes(normalizedQuery) ||
                    item.description.toLowerCase().includes(normalizedQuery) ||
                    item.source.toLowerCase().includes(normalizedQuery) ||
                    meta.category.toLowerCase().includes(normalizedQuery)
                );
            })
            .sort((left, right) => {
                const leftMeta = getMarketplaceMetadata(left);
                const rightMeta = getMarketplaceMetadata(right);

                if (sortBy === 'rating') return rightMeta.rating - leftMeta.rating;
                if (sortBy === 'newest') {
                    return (
                        new Date(rightMeta.addedAt).getTime() - new Date(leftMeta.addedAt).getTime()
                    );
                }
                return rightMeta.installs - leftMeta.installs;
            });
    }, [visibleItems, searchQuery, filterType, category, sortBy]);

    const handleSearch = async () => {
        await scanSource(source);
    };

    const handleInstall = async (item: MarketplaceItem) => {
        if (installedSources?.has(item.source)) return;
        setInstallingId(item.id);
        try {
            const payload = await installItem(item);
            await onInstallComplete?.(item.type === 'skill' ? extractSkillImportFeedback(payload) ?? undefined : undefined);
        } catch (err) {
            window.alert(String(err));
        } finally {
            setInstallingId(null);
        }
    };

    const handleInstallSkillhub = async () => {
        try {
            await installSkillhub();
            toast.success('Skillhub CLI ready');
        } catch (err) {
            toast.error('Skillhub install failed', err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                    <h3 style={{ margin: 0 }}>{t('marketplace.title')}</h3>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        {t('marketplace.categories')}
                    </div>
                    {runtimeContext && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            {runtimeContext.platform}/{runtimeContext.arch} · {runtimeContext.sidecarLaunchMode ?? 'unknown'}
                        </div>
                    )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    S:{stats.skillCount || visibleItems.filter((item) => item.type === 'skill').length} M:{stats.mcpCount || visibleItems.filter((item) => item.type === 'mcp').length}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="skillhub keyword or github:owner/repo"
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
                    placeholder={t('marketplace.searchPlaceholder')}
                    className="input-field"
                    style={{ flex: 1 }}
                />
                <select value={filterType} onChange={(e) => setFilterType(e.target.value as FilterType)} className="input-field" style={{ width: 120 }}>
                    <option value="all">{t('marketplace.allCategories')}</option>
                    <option value="skill">Skills</option>
                    <option value="mcp">MCP</option>
                </select>
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as MarketplaceSort)}
                    className="input-field"
                    style={{ width: 140 }}
                >
                    <option value="popular">{t('marketplace.popular')}</option>
                    <option value="newest">{t('marketplace.newest')}</option>
                    <option value="rating">{t('marketplace.rating')}</option>
                </select>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(
                    [
                        ['all', t('marketplace.allCategories')],
                        ['development', t('marketplace.development')],
                        ['productivity', t('marketplace.productivity')],
                        ['data', t('marketplace.data')],
                        ['communication', t('marketplace.communication')],
                        ['automation', t('marketplace.automation')],
                    ] as const
                ).map(([value, label]) => (
                    <button
                        key={value}
                        className="btn btn-secondary"
                        onClick={() => setCategory(value)}
                        style={{
                            opacity: category === value ? 1 : 0.7,
                            borderColor:
                                category === value ? 'var(--status-info)' : 'var(--border-subtle)',
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {error && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ color: 'var(--status-error)', fontSize: 13 }}>{error}</div>
                    {!skillhubReady && error.toLowerCase().includes('skillhub cli not found') && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void handleInstallSkillhub()}
                            disabled={activeAction === 'skillhub-cli'}
                            style={{ alignSelf: 'flex-start' }}
                        >
                            Install Skillhub CLI
                        </button>
                    )}
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map((item) => {
                    const installed = installedSources?.has(item.source);
                    const busy = installingId === item.id;
                    const meta = getMarketplaceMetadata(item);
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
                                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)', marginTop: 6, flexWrap: 'wrap' }}>
                                    <span>{t('marketplace.installs', { count: meta.installs })}</span>
                                    <span>{t('marketplace.rating')}: {meta.rating.toFixed(1)}</span>
                                    <span>{t(`marketplace.${meta.category}`)}</span>
                                </div>
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
