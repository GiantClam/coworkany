/**
 * MarketplaceView Component
 *
 * Skill & MCP Server marketplace with search, categories, and install.
 * Currently uses hardcoded sample data; can be connected to a registry API later.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface MarketplaceItem {
    id: string;
    name: string;
    description: string;
    author: string;
    category: string;
    type: 'skill' | 'mcp';
    installs: number;
    stars: number;
    verified: boolean;
    official: boolean;
    tags: string[];
}

// Sample marketplace data (would come from registry API)
const SAMPLE_ITEMS: MarketplaceItem[] = [
    { id: 'web-search', name: 'Web Search', description: 'Search the web using multiple providers (Serper, Tavily, Brave)', author: 'CoworkAny', category: 'productivity', type: 'skill', installs: 15200, stars: 48, verified: true, official: true, tags: ['search', 'web'] },
    { id: 'code-review', name: 'Code Review', description: 'Automated code review with quality scoring and best practice checks', author: 'CoworkAny', category: 'development', type: 'skill', installs: 8400, stars: 35, verified: true, official: true, tags: ['code', 'review'] },
    { id: 'github-mcp', name: 'GitHub MCP', description: 'GitHub integration - issues, PRs, repos, and actions', author: 'modelcontextprotocol', category: 'development', type: 'mcp', installs: 12100, stars: 89, verified: true, official: true, tags: ['github', 'git'] },
    { id: 'slack-mcp', name: 'Slack MCP', description: 'Send messages, read channels, manage Slack workspace', author: 'modelcontextprotocol', category: 'communication', type: 'mcp', installs: 6800, stars: 42, verified: true, official: false, tags: ['slack', 'chat'] },
    { id: 'postgres-mcp', name: 'PostgreSQL MCP', description: 'Query and manage PostgreSQL databases', author: 'modelcontextprotocol', category: 'data', type: 'mcp', installs: 5200, stars: 31, verified: true, official: true, tags: ['database', 'sql'] },
    { id: 'file-organizer', name: 'File Organizer', description: 'Automatically organize files by type, date, or custom rules', author: 'community', category: 'productivity', type: 'skill', installs: 3100, stars: 18, verified: false, official: false, tags: ['files', 'organize'] },
    { id: 'data-viz', name: 'Data Visualization', description: 'Create charts and graphs from data files (CSV, JSON, Excel)', author: 'community', category: 'data', type: 'skill', installs: 2800, stars: 22, verified: false, official: false, tags: ['charts', 'data'] },
    { id: 'email-mcp', name: 'Email MCP', description: 'Send and read emails via IMAP/SMTP', author: 'community', category: 'communication', type: 'mcp', installs: 4500, stars: 27, verified: false, official: false, tags: ['email', 'smtp'] },
    { id: 'docker-mcp', name: 'Docker MCP', description: 'Manage Docker containers, images, and compose stacks', author: 'community', category: 'development', type: 'mcp', installs: 3900, stars: 33, verified: true, official: false, tags: ['docker', 'containers'] },
    { id: 'scheduler', name: 'Task Scheduler', description: 'Schedule recurring tasks with cron-like expressions', author: 'CoworkAny', category: 'automation', type: 'skill', installs: 2100, stars: 15, verified: true, official: true, tags: ['schedule', 'cron'] },
];

const CATEGORIES = ['all', 'development', 'productivity', 'data', 'communication', 'automation'];

type SortOption = 'popular' | 'newest' | 'rating';

export function MarketplaceView() {
    const { t } = useTranslation();
    const [searchQuery, setSearchQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [sortBy, setSortBy] = useState<SortOption>('popular');
    const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

    const filteredItems = useMemo(() => {
        let items = SAMPLE_ITEMS;

        // Filter by category
        if (category !== 'all') {
            items = items.filter((item) => item.category === category);
        }

        // Filter by search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            items = items.filter(
                (item) =>
                    item.name.toLowerCase().includes(q) ||
                    item.description.toLowerCase().includes(q) ||
                    item.tags.some((tag) => tag.includes(q))
            );
        }

        // Sort
        switch (sortBy) {
            case 'popular':
                items = [...items].sort((a, b) => b.installs - a.installs);
                break;
            case 'rating':
                items = [...items].sort((a, b) => b.stars - a.stars);
                break;
            case 'newest':
                // In real implementation, would sort by date
                break;
        }

        return items;
    }, [searchQuery, category, sortBy]);

    const handleInstall = (id: string) => {
        setInstalledIds((prev) => new Set([...prev, id]));
    };

    const categoryLabelMap: Record<string, string> = {
        all: t('marketplace.allCategories'),
        development: t('marketplace.development'),
        productivity: t('marketplace.productivity'),
        data: t('marketplace.data'),
        communication: t('marketplace.communication'),
        automation: t('marketplace.automation'),
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16, fontFamily: 'var(--font-body)' }}>
            {/* Header */}
            <h2 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: 18 }}>
                {t('marketplace.title')}
            </h2>

            {/* Search */}
            <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('marketplace.searchPlaceholder')}
                style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md, 8px)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-size-sm, 13px)',
                    marginBottom: 12,
                    boxSizing: 'border-box',
                }}
            />

            {/* Categories + Sort */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {CATEGORIES.map((cat) => (
                        <button
                            key={cat}
                            onClick={() => setCategory(cat)}
                            style={{
                                padding: '4px 10px',
                                border: category === cat ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-sm, 6px)',
                                background: category === cat ? 'var(--accent-subtle)' : 'transparent',
                                color: category === cat ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-xs, 11px)',
                                fontWeight: category === cat ? 600 : 400,
                            }}
                        >
                            {categoryLabelMap[cat] || cat}
                        </button>
                    ))}
                </div>
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    style={{
                        padding: '4px 8px',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm, 6px)',
                        background: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--font-size-xs, 11px)',
                    }}
                >
                    <option value="popular">{t('marketplace.popular')}</option>
                    <option value="newest">{t('marketplace.newest')}</option>
                    <option value="rating">{t('marketplace.rating')}</option>
                </select>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {filteredItems.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                        {t('marketplace.noResults', { query: searchQuery })}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {filteredItems.map((item) => {
                            const isInstalled = installedIds.has(item.id);
                            return (
                                <div
                                    key={item.id}
                                    style={{
                                        padding: '12px 14px',
                                        border: '1px solid var(--border-subtle)',
                                        borderRadius: 'var(--radius-md, 8px)',
                                        background: 'var(--bg-panel)',
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 12,
                                    }}
                                >
                                    {/* Icon */}
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 8,
                                        background: item.type === 'skill' ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 16, flexShrink: 0,
                                    }}>
                                        {item.type === 'skill' ? '⚡' : '🔌'}
                                    </div>

                                    {/* Content */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--font-size-sm, 13px)' }}>
                                                {item.name}
                                            </span>
                                            {item.verified && (
                                                <span style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 }}>
                                                    {t('marketplace.verified')}
                                                </span>
                                            )}
                                            {item.official && (
                                                <span style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
                                                    {t('marketplace.official')}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 'var(--font-size-xs, 11px)', color: 'var(--text-secondary)', marginTop: 2 }}>
                                            {item.description}
                                        </div>
                                        <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 'var(--font-size-xs, 11px)', color: 'var(--text-tertiary)' }}>
                                            <span>{item.author}</span>
                                            <span>⬇ {item.installs.toLocaleString()}</span>
                                            <span>⭐ {item.stars}</span>
                                        </div>
                                    </div>

                                    {/* Install button */}
                                    <button
                                        onClick={() => handleInstall(item.id)}
                                        disabled={isInstalled}
                                        style={{
                                            padding: '5px 12px',
                                            border: isInstalled ? '1px solid var(--border-subtle)' : 'none',
                                            borderRadius: 'var(--radius-sm, 6px)',
                                            background: isInstalled ? 'transparent' : 'var(--accent-primary, #0066ff)',
                                            color: isInstalled ? 'var(--text-secondary)' : '#fff',
                                            cursor: isInstalled ? 'default' : 'pointer',
                                            fontSize: 'var(--font-size-xs, 11px)',
                                            fontWeight: 600,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {isInstalled ? t('marketplace.installed') : t('marketplace.installButton')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
