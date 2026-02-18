/**
 * Tool Chain Registry
 *
 * Manages available tool chains and provides lookup functionality
 */

import type { ToolChain, ChainRegistryEntry } from './types';
import { BUILTIN_CHAINS } from './builtinChains';

export class ChainRegistry {
    private chains: Map<string, ChainRegistryEntry> = new Map();

    constructor() {
        // Register built-in chains
        for (const chain of BUILTIN_CHAINS) {
            this.registerChain(chain, 'builtin');
        }
    }

    /**
     * Register a new chain
     */
    registerChain(chain: ToolChain, category: 'builtin' | 'user' | 'auto'): void {
        this.chains.set(chain.id, {
            chain,
            category,
            usage: 0
        });
        console.log(`[ChainRegistry] Registered chain: ${chain.id} (${category})`);
    }

    /**
     * Get a chain by ID
     */
    getChain(chainId: string): ToolChain | null {
        const entry = this.chains.get(chainId);
        if (!entry) {
            return null;
        }

        // Update usage
        entry.usage++;
        entry.lastUsed = Date.now();

        return entry.chain;
    }

    /**
     * Find chains by tags
     */
    findByTags(tags: string[]): ToolChain[] {
        const results: ToolChain[] = [];

        for (const entry of this.chains.values()) {
            const chain = entry.chain;
            const matchCount = tags.filter(tag => chain.tags.includes(tag)).length;

            if (matchCount > 0) {
                results.push(chain);
            }
        }

        // Sort by number of matching tags (descending)
        results.sort((a, b) => {
            const aMatches = tags.filter(tag => a.tags.includes(tag)).length;
            const bMatches = tags.filter(tag => b.tags.includes(tag)).length;
            return bMatches - aMatches;
        });

        return results;
    }

    /**
     * Search chains by description or name
     */
    search(query: string): ToolChain[] {
        const lowerQuery = query.toLowerCase();
        const results: ToolChain[] = [];

        for (const entry of this.chains.values()) {
            const chain = entry.chain;
            const nameMatch = chain.name.toLowerCase().includes(lowerQuery);
            const descMatch = chain.description.toLowerCase().includes(lowerQuery);

            if (nameMatch || descMatch) {
                results.push(chain);
            }
        }

        return results;
    }

    /**
     * Recommend a chain based on context
     */
    recommend(context: {
        intent?: string;
        recentErrors?: string[];
        keywords?: string[];
    }): ToolChain | null {
        // Map intent to tags
        const tags: string[] = [];

        if (context.intent) {
            const intentTagMap: Record<string, string[]> = {
                'bug_fix': ['bug-fix', 'testing'],
                'feature_add': ['feature', 'testing'],
                'refactor': ['refactor', 'testing', 'quality'],
                'deploy': ['deploy', 'build'],
                'test': ['testing']
            };

            const intentTags = intentTagMap[context.intent];
            if (intentTags) {
                tags.push(...intentTags);
            }
        }

        // Add tags based on keywords
        if (context.keywords) {
            for (const keyword of context.keywords) {
                if (keyword.includes('test')) tags.push('testing');
                if (keyword.includes('fix')) tags.push('bug-fix');
                if (keyword.includes('deploy')) tags.push('deploy');
                if (keyword.includes('refactor')) tags.push('refactor');
                if (keyword.includes('quality')) tags.push('quality');
            }
        }

        // Add tags based on recent errors
        if (context.recentErrors && context.recentErrors.length > 0) {
            tags.push('bug-fix');
        }

        // Find matching chains
        if (tags.length === 0) {
            return null;
        }

        const matches = this.findByTags(tags);
        return matches.length > 0 ? matches[0] : null;
    }

    /**
     * Get all chains
     */
    getAllChains(): ToolChain[] {
        return Array.from(this.chains.values()).map(entry => entry.chain);
    }

    /**
     * Get chain statistics
     */
    getStats(): {
        totalChains: number;
        builtinChains: number;
        userChains: number;
        autoChains: number;
        mostUsed: { chainId: string; usage: number }[];
    } {
        const entries = Array.from(this.chains.values());

        return {
            totalChains: entries.length,
            builtinChains: entries.filter(e => e.category === 'builtin').length,
            userChains: entries.filter(e => e.category === 'user').length,
            autoChains: entries.filter(e => e.category === 'auto').length,
            mostUsed: entries
                .sort((a, b) => b.usage - a.usage)
                .slice(0, 5)
                .map(e => ({ chainId: e.chain.id, usage: e.usage }))
        };
    }
}

/**
 * Singleton instance
 */
let registry: ChainRegistry | null = null;

export function getChainRegistry(): ChainRegistry {
    if (!registry) {
        registry = new ChainRegistry();
    }
    return registry;
}
