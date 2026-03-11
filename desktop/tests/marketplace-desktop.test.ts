import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import type { MarketplaceItem } from '../src/hooks/useMarketplaceSearch';
import {
    SAMPLE_ITEMS,
    buildMarketplaceViewItems,
    deriveInstallButtonState,
    filterMarketplaceItems,
    resolveMarketplaceItems,
    sortMarketplaceItems,
} from '../src/components/Marketplace/marketplaceModel';

const MARKETPLACE_VIEW_PATH = path.resolve(
    __dirname,
    '../src/components/Marketplace/MarketplaceView.tsx'
);

const FIXTURES: MarketplaceItem[] = [
    {
        id: 'repo:001',
        name: 'Alpha Skill',
        description: 'Data automation helper',
        source: 'github:alpha/skill',
        path: '/tmp/alpha',
        runtime: 'node',
        type: 'skill',
    },
    {
        id: 'repo:003',
        name: 'Beta MCP',
        description: 'Filesystem MCP connector',
        source: 'github:beta/mcp',
        path: '/tmp/beta',
        runtime: 'python',
        type: 'mcp',
    },
    {
        id: 'repo:002',
        name: 'Gamma Skill',
        description: 'Web research and ranking',
        source: 'github:gamma/skill',
        path: '/tmp/gamma',
        runtime: 'typescript',
        type: 'skill',
    },
];

describe('Marketplace Desktop - Functional Model', () => {
    test('uses sample items when marketplace scan has no results', () => {
        const resolved = resolveMarketplaceItems([]);
        expect(resolved.length).toBeGreaterThan(0);
        expect(resolved).toEqual(SAMPLE_ITEMS);
    });

    test('filters by query on name/description/source', () => {
        const byName = filterMarketplaceItems(FIXTURES, 'alpha', 'all');
        expect(byName.map((item) => item.name)).toEqual(['Alpha Skill']);

        const byDescription = filterMarketplaceItems(FIXTURES, 'filesystem', 'all');
        expect(byDescription.map((item) => item.name)).toEqual(['Beta MCP']);

        const bySource = filterMarketplaceItems(FIXTURES, 'gamma/skill', 'all');
        expect(bySource.map((item) => item.name)).toEqual(['Gamma Skill']);
    });

    test('filters by category skill/mcp', () => {
        const skills = filterMarketplaceItems(FIXTURES, '', 'skill');
        const mcps = filterMarketplaceItems(FIXTURES, '', 'mcp');
        expect(skills.every((item) => item.type === 'skill')).toBe(true);
        expect(mcps.every((item) => item.type === 'mcp')).toBe(true);
        expect(skills.length).toBe(2);
        expect(mcps.length).toBe(1);
    });

    test('sorts by popular/newest/rating', () => {
        const popular = sortMarketplaceItems(FIXTURES, 'popular');
        expect(popular.map((item) => item.source)).toEqual([
            'github:alpha/skill',
            'github:beta/mcp',
            'github:gamma/skill',
        ]);

        const newest = sortMarketplaceItems(FIXTURES, 'newest');
        expect(newest.map((item) => item.id)).toEqual(['repo:003', 'repo:002', 'repo:001']);

        const rating = sortMarketplaceItems(FIXTURES, 'rating');
        expect(rating[0].runtime).toBe('typescript');
    });

    test('builds end-to-end list with filter + category + sort', () => {
        const result = buildMarketplaceViewItems(FIXTURES, 'skill', 'skill', 'newest');
        expect(result.map((item) => item.name)).toEqual(['Gamma Skill', 'Alpha Skill']);
    });

    test('derives install button states', () => {
        const installed = new Set<string>(['github:alpha/skill']);
        expect(deriveInstallButtonState(FIXTURES[0], installed, null)).toBe('installed');
        expect(deriveInstallButtonState(FIXTURES[1], installed, FIXTURES[1].id)).toBe('installing');
        expect(deriveInstallButtonState(FIXTURES[2], installed, null)).toBe('install');
    });
});

describe('Marketplace Desktop - UI Contract', () => {
    test('MarketplaceView keeps required controls and labels', () => {
        const content = fs.readFileSync(MARKETPLACE_VIEW_PATH, 'utf-8');

        expect(content).toContain('placeholder="github:owner/repo"');
        expect(content).toContain('placeholder="Filter results"');
        expect(content).toContain('<option value="all">All</option>');
        expect(content).toContain('MARKETPLACE_TYPE_OPTIONS');
        expect(content).toContain("{ type: 'skill', label: 'Skills' }");
        expect(content).toContain("{ type: 'mcp', label: 'MCP' }");
        expect(content).toContain('<option value="popular">popular</option>');
        expect(content).toContain('<option value="newest">newest</option>');
        expect(content).toContain('<option value="rating">rating</option>');
        expect(content).toContain('Installed');
        expect(content).toContain('Installing');
        expect(content).toContain('Install');
    });

    test('MarketplaceView uses extracted model layer for deterministic behavior', () => {
        const content = fs.readFileSync(MARKETPLACE_VIEW_PATH, 'utf-8');
        expect(content).toContain('buildMarketplaceViewItems');
        expect(content).toContain('deriveInstallButtonState');
        expect(content).toContain('SAMPLE_ITEMS');
    });
});
