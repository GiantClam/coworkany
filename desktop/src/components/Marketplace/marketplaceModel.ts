import type { MarketplaceItem, MarketplaceItemType } from '../../hooks/useMarketplaceSearch';

export type MarketplaceFilterType = MarketplaceItemType | 'all';
export type MarketplaceSortOption = 'popular' | 'newest' | 'rating';

export const SAMPLE_ITEMS: MarketplaceItem[] = [
    {
        id: 'sample:skill:starter-workflow',
        name: 'Starter Workflow Pack',
        description: 'Common automation and coding helper skills.',
        source: 'sample:starter-workflow',
        path: '/samples/starter-workflow',
        runtime: 'node',
        type: 'skill',
    },
    {
        id: 'sample:mcp:file-ops',
        name: 'File Ops MCP',
        description: 'MCP server for advanced local file operations.',
        source: 'sample:file-ops-mcp',
        path: '/samples/file-ops-mcp',
        runtime: 'python',
        type: 'mcp',
    },
];

export function resolveMarketplaceItems(items: MarketplaceItem[]): MarketplaceItem[] {
    return items.length > 0 ? items : SAMPLE_ITEMS;
}

export function filterMarketplaceItems(
    items: MarketplaceItem[],
    searchQuery: string,
    category: MarketplaceFilterType
): MarketplaceItem[] {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
        if (category !== 'all' && item.type !== category) return false;
        if (!normalizedQuery) return true;
        return (
            item.name.toLowerCase().includes(normalizedQuery) ||
            item.description.toLowerCase().includes(normalizedQuery) ||
            item.source.toLowerCase().includes(normalizedQuery)
        );
    });
}

export function sortMarketplaceItems(
    items: MarketplaceItem[],
    sortBy: MarketplaceSortOption
): MarketplaceItem[] {
    return [...items].sort((a, b) => {
        if (sortBy === 'newest') {
            return b.id.localeCompare(a.id);
        }
        if (sortBy === 'rating') {
            return (b.runtime?.length ?? 0) - (a.runtime?.length ?? 0);
        }
        const bySource = a.source.localeCompare(b.source);
        if (bySource !== 0) return bySource;
        return a.name.localeCompare(b.name);
    });
}

export function buildMarketplaceViewItems(
    items: MarketplaceItem[],
    searchQuery: string,
    category: MarketplaceFilterType,
    sortBy: MarketplaceSortOption
): MarketplaceItem[] {
    const resolvedItems = resolveMarketplaceItems(items);
    const filteredItems = filterMarketplaceItems(resolvedItems, searchQuery, category);
    return sortMarketplaceItems(filteredItems, sortBy);
}

export type InstallButtonState = 'installed' | 'installing' | 'install';

export function deriveInstallButtonState(
    item: MarketplaceItem,
    installedSources: Set<string> | undefined,
    installingId: string | null
): InstallButtonState {
    if (installedSources?.has(item.source)) return 'installed';
    if (installingId === item.id) return 'installing';
    return 'install';
}

