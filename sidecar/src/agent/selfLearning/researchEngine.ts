/**
 * CoworkAny - Research Engine
 *
 * Searches the internet for learning materials when AI needs
 * to acquire new capabilities. Integrates with web search
 * and browser automation tools.
 */

import type {
    CapabilityGap,
    ResearchResult,
    ResearchSource,
    ResearchQuery,
    CodeExample,
    SourceType,
    SelfLearningConfig,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ============================================================================
// Constants
// ============================================================================

// Source reliability scores by domain pattern
const SOURCE_RELIABILITY: Record<string, number> = {
    // Official documentation (highest reliability)
    'docs.python.org': 0.95,
    'nodejs.org': 0.95,
    'developer.mozilla.org': 0.95,
    'reactjs.org': 0.95,
    'vuejs.org': 0.95,
    'angular.io': 0.95,
    'typescriptlang.org': 0.95,
    'rust-lang.org': 0.95,
    'golang.org': 0.95,

    // High quality resources
    'github.com': 0.85,
    'stackoverflow.com': 0.80,
    'dev.to': 0.75,
    'medium.com': 0.70,
    'geeksforgeeks.org': 0.75,
    'tutorialspoint.com': 0.70,
    'w3schools.com': 0.70,
    'realpython.com': 0.85,
    'freecodecamp.org': 0.80,

    // Package documentation
    'pypi.org': 0.90,
    'npmjs.com': 0.90,
    'crates.io': 0.90,
    'pkg.go.dev': 0.90,

    // Default for unknown sources
    'default': 0.50,
};

// Patterns to identify source types
const SOURCE_TYPE_PATTERNS: Array<{ pattern: RegExp; type: SourceType }> = [
    { pattern: /docs\.|documentation|api-reference/i, type: 'official_docs' },
    { pattern: /github\.com/i, type: 'github' },
    { pattern: /stackoverflow\.com/i, type: 'stackoverflow' },
    { pattern: /tutorial|guide|how-to|learn/i, type: 'tutorial' },
    { pattern: /medium\.com|dev\.to|blog/i, type: 'blog' },
];

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface PageContent {
    url: string;
    title: string;
    content: string;
    codeBlocks: string[];
}

export interface ResearchEngineDependencies {
    webSearch: (query: string) => Promise<SearchResult[]>;
    fetchPage?: (url: string) => Promise<PageContent>;
}

// ============================================================================
// ResearchEngine Class
// ============================================================================

export class ResearchEngine {
    private config: SelfLearningConfig;
    private deps: ResearchEngineDependencies;
    private cache: Map<string, { result: ResearchResult; timestamp: number }>;

    constructor(
        deps: ResearchEngineDependencies,
        config?: Partial<SelfLearningConfig>
    ) {
        this.deps = deps;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.cache = new Map();
    }

    // ========================================================================
    // Main Research Method
    // ========================================================================

    /**
     * Execute research for a capability gap
     */
    async research(gap: CapabilityGap): Promise<ResearchResult> {
        const startTime = Date.now();

        // Check cache first
        const cacheKey = gap.id;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
            return cached.result;
        }

        // Generate research queries based on gap type and depth
        const queries = this.generateQueries(gap);

        // Execute searches in parallel (with limit)
        const searchResults = await this.executeSearches(queries);

        // Rank and filter sources
        const rankedSources = this.rankSources(searchResults);

        // Deep fetch top sources if enabled
        const enrichedSources = await this.enrichSources(rankedSources);

        // Extract code examples
        const codeExamples = this.extractCodeExamples(enrichedSources);

        // Extract dependencies
        const dependencies = this.extractDependencies(enrichedSources, codeExamples);

        // Calculate overall confidence
        const confidence = this.calculateConfidence(enrichedSources);

        const result: ResearchResult = {
            gap,
            sources: enrichedSources,
            codeExamples,
            dependencies,
            researchTimeMs: Date.now() - startTime,
            confidence,
        };

        // Cache result
        this.cache.set(cacheKey, { result, timestamp: Date.now() });

        return result;
    }

    // ========================================================================
    // Query Generation
    // ========================================================================

    /**
     * Generate search queries based on gap and research depth
     */
    private generateQueries(gap: CapabilityGap): ResearchQuery[] {
        const queries: ResearchQuery[] = [];
        const keywords = gap.keywords.join(' ');

        // Start with suggested queries
        for (let i = 0; i < gap.suggestedResearchQueries.length; i++) {
            queries.push({
                query: gap.suggestedResearchQueries[i],
                queryType: i === 0 ? 'documentation' : 'tutorial',
                priority: 10 - i,
            });
        }

        // Add gap-type specific queries
        switch (gap.type) {
            case 'library':
                queries.push(
                    { query: `${keywords} official documentation`, queryType: 'documentation', priority: 9 },
                    { query: `${keywords} getting started tutorial`, queryType: 'tutorial', priority: 8 },
                    { query: `${keywords} examples github`, queryType: 'example_code', priority: 7 },
                    { query: `${keywords} installation pip npm`, queryType: 'documentation', priority: 6 }
                );
                break;

            case 'tool':
                queries.push(
                    { query: `${keywords} command line usage`, queryType: 'documentation', priority: 9 },
                    { query: `${keywords} common commands examples`, queryType: 'example_code', priority: 8 },
                    { query: `${keywords} installation guide`, queryType: 'tutorial', priority: 7 }
                );
                break;

            case 'procedure':
                queries.push(
                    { query: `${keywords} step by step guide`, queryType: 'tutorial', priority: 9 },
                    { query: `${keywords} best practices`, queryType: 'tutorial', priority: 8 },
                    { query: `${keywords} complete workflow`, queryType: 'tutorial', priority: 7 }
                );
                break;

            case 'domain_knowledge':
                queries.push(
                    { query: `${keywords} explained beginner`, queryType: 'tutorial', priority: 9 },
                    { query: `${keywords} concepts overview`, queryType: 'documentation', priority: 8 },
                    { query: `${keywords} practical examples`, queryType: 'example_code', priority: 7 }
                );
                break;
        }

        // Limit based on research depth
        const maxQueries = {
            shallow: 3,
            medium: 5,
            deep: 8,
        }[this.config.researchDepth];

        return queries
            .sort((a, b) => b.priority - a.priority)
            .slice(0, maxQueries);
    }

    // ========================================================================
    // Search Execution
    // ========================================================================

    /**
     * Execute searches for all queries
     */
    private async executeSearches(queries: ResearchQuery[]): Promise<ResearchSource[]> {
        const sources: ResearchSource[] = [];
        const seenUrls = new Set<string>();

        // Execute searches with timeout
        const searchPromises = queries.map(async (query) => {
            try {
                const results = await Promise.race([
                    this.deps.webSearch(query.query),
                    new Promise<SearchResult[]>((_, reject) =>
                        setTimeout(() => reject(new Error('Search timeout')), 10000)
                    ),
                ]);

                for (const result of results) {
                    if (seenUrls.has(result.url)) continue;
                    seenUrls.add(result.url);

                    sources.push({
                        url: result.url,
                        title: result.title,
                        sourceType: this.detectSourceType(result.url, result.title),
                        contentSnippet: result.snippet,
                        reliability: this.calculateReliability(result.url),
                        fetchedAt: new Date().toISOString(),
                    });
                }
            } catch (error) {
                console.warn(`[ResearchEngine] Search failed for "${query.query}":`, error);
            }
        });

        await Promise.all(searchPromises);

        return sources;
    }

    // ========================================================================
    // Source Ranking
    // ========================================================================

    /**
     * Rank sources by reliability and relevance
     */
    private rankSources(sources: ResearchSource[]): ResearchSource[] {
        return sources
            .sort((a, b) => {
                // Primary: reliability
                const reliabilityDiff = b.reliability - a.reliability;
                if (Math.abs(reliabilityDiff) > 0.1) return reliabilityDiff;

                // Secondary: source type preference
                const typeOrder: SourceType[] = ['official_docs', 'github', 'stackoverflow', 'tutorial', 'blog', 'other'];
                return typeOrder.indexOf(a.sourceType) - typeOrder.indexOf(b.sourceType);
            })
            .slice(0, 10);  // Keep top 10 sources
    }

    /**
     * Calculate reliability score for a URL
     */
    private calculateReliability(url: string): number {
        try {
            const hostname = new URL(url).hostname.replace('www.', '');

            // Check exact matches
            if (SOURCE_RELIABILITY[hostname]) {
                return SOURCE_RELIABILITY[hostname];
            }

            // Check partial matches
            for (const [domain, score] of Object.entries(SOURCE_RELIABILITY)) {
                if (hostname.includes(domain) || domain.includes(hostname)) {
                    return score;
                }
            }

            // Check for documentation patterns
            if (/docs\.|documentation|api|reference/i.test(url)) {
                return 0.85;
            }

            return SOURCE_RELIABILITY['default'];
        } catch {
            return SOURCE_RELIABILITY['default'];
        }
    }

    /**
     * Detect source type from URL and title
     */
    private detectSourceType(url: string, title: string): SourceType {
        const combined = `${url} ${title}`.toLowerCase();

        for (const { pattern, type } of SOURCE_TYPE_PATTERNS) {
            if (pattern.test(combined)) {
                return type;
            }
        }

        return 'other';
    }

    // ========================================================================
    // Source Enrichment
    // ========================================================================

    /**
     * Fetch full content for top sources if fetchPage is available
     */
    private async enrichSources(sources: ResearchSource[]): Promise<ResearchSource[]> {
        if (!this.deps.fetchPage) {
            return sources;
        }

        // Only fetch top sources based on depth
        const fetchCount = {
            shallow: 2,
            medium: 4,
            deep: 6,
        }[this.config.researchDepth];

        const toFetch = sources.slice(0, fetchCount);
        const enrichedSources = [...sources];

        const fetchPromises = toFetch.map(async (source, index) => {
            try {
                const content = await Promise.race([
                    this.deps.fetchPage!(source.url),
                    new Promise<PageContent>((_, reject) =>
                        setTimeout(() => reject(new Error('Fetch timeout')), 15000)
                    ),
                ]);

                enrichedSources[index] = {
                    ...source,
                    fullContent: content.content,
                };
            } catch (error) {
                console.warn(`[ResearchEngine] Failed to fetch ${source.url}:`, error);
            }
        });

        await Promise.all(fetchPromises);

        return enrichedSources;
    }

    // ========================================================================
    // Code Extraction
    // ========================================================================

    /**
     * Extract code examples from sources
     */
    private extractCodeExamples(sources: ResearchSource[]): CodeExample[] {
        const examples: CodeExample[] = [];
        const seenCode = new Set<string>();

        for (const source of sources) {
            const content = source.fullContent || source.contentSnippet;
            const codeBlocks = this.extractCodeBlocks(content);

            for (const block of codeBlocks) {
                // Skip duplicates
                const normalized = block.code.replace(/\s+/g, ' ').trim();
                if (seenCode.has(normalized)) continue;
                seenCode.add(normalized);

                // Skip very short or very long blocks
                if (block.code.length < 20 || block.code.length > 5000) continue;

                examples.push({
                    language: block.language,
                    code: block.code,
                    source: source.url,
                    description: this.generateCodeDescription(block.code, source.title),
                    dependencies: this.extractDependenciesFromCode(block.code, block.language),
                });
            }
        }

        return examples.slice(0, 10);  // Limit to 10 examples
    }

    /**
     * Extract code blocks from text
     */
    private extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
        const blocks: Array<{ language: string; code: string }> = [];

        // Markdown code blocks
        const mdPattern = /```(\w*)\n?([\s\S]*?)```/g;
        let match;
        while ((match = mdPattern.exec(text)) !== null) {
            blocks.push({
                language: match[1] || 'unknown',
                code: match[2].trim(),
            });
        }

        // Inline code that looks like commands
        const cmdPattern = /`([^`]+)`/g;
        while ((match = cmdPattern.exec(text)) !== null) {
            const code = match[1].trim();
            if (code.includes(' ') && (code.startsWith('pip ') || code.startsWith('npm ') ||
                code.startsWith('python ') || code.startsWith('node '))) {
                blocks.push({
                    language: 'shell',
                    code,
                });
            }
        }

        return blocks;
    }

    /**
     * Generate a description for a code example
     */
    private generateCodeDescription(code: string, sourceTitle: string): string {
        // Try to extract description from comments
        const commentMatch = code.match(/^(?:#|\/\/)\s*(.+)$/m);
        if (commentMatch) {
            return commentMatch[1];
        }

        // Use source title as fallback
        return `Code example from: ${sourceTitle}`;
    }

    // ========================================================================
    // Dependency Extraction
    // ========================================================================

    /**
     * Extract dependencies from sources and code examples
     */
    private extractDependencies(
        sources: ResearchSource[],
        codeExamples: CodeExample[]
    ): string[] {
        const deps = new Set<string>();

        // From code examples
        for (const example of codeExamples) {
            if (example.dependencies) {
                example.dependencies.forEach(d => deps.add(d));
            }
        }

        // From source content
        for (const source of sources) {
            const content = source.fullContent || source.contentSnippet;
            const extracted = this.extractDependenciesFromText(content);
            extracted.forEach(d => deps.add(d));
        }

        return [...deps];
    }

    /**
     * Extract dependencies from code
     */
    private extractDependenciesFromCode(code: string, language: string): string[] {
        const deps: string[] = [];

        if (language === 'python' || code.includes('import ')) {
            // Python imports
            const importPattern = /(?:from\s+(\w+)|import\s+(\w+))/g;
            let match;
            while ((match = importPattern.exec(code)) !== null) {
                const pkg = match[1] || match[2];
                if (pkg && !this.isStdLib(pkg, 'python')) {
                    deps.push(pkg);
                }
            }
        }

        if (language === 'javascript' || language === 'typescript' || code.includes('require(')) {
            // JavaScript requires/imports
            const jsPattern = /(?:require\(['"]([^'"]+)['"]\)|from\s+['"]([^'"]+)['"])/g;
            let match;
            while ((match = jsPattern.exec(code)) !== null) {
                const pkg = (match[1] || match[2]).split('/')[0];
                if (pkg && !pkg.startsWith('.') && !this.isStdLib(pkg, 'javascript')) {
                    deps.push(pkg);
                }
            }
        }

        if (language === 'shell' || code.includes('pip install') || code.includes('npm install')) {
            // Shell install commands
            const pipPattern = /pip3?\s+install\s+([^\s]+)/g;
            const npmPattern = /npm\s+install\s+([^\s]+)/g;

            let match;
            while ((match = pipPattern.exec(code)) !== null) {
                deps.push(match[1].replace(/['"]/g, ''));
            }
            while ((match = npmPattern.exec(code)) !== null) {
                deps.push(match[1].replace(/['"]/g, ''));
            }
        }

        return deps;
    }

    /**
     * Extract dependencies from text content
     */
    private extractDependenciesFromText(text: string): string[] {
        const deps: string[] = [];

        // pip install commands
        const pipPattern = /pip3?\s+install\s+([^\s\n]+)/gi;
        let match;
        while ((match = pipPattern.exec(text)) !== null) {
            deps.push(match[1].replace(/['"`,]/g, ''));
        }

        // npm install commands
        const npmPattern = /npm\s+install\s+([^\s\n]+)/gi;
        while ((match = npmPattern.exec(text)) !== null) {
            deps.push(match[1].replace(/['"`,]/g, ''));
        }

        return deps;
    }

    /**
     * Check if a package is part of standard library
     */
    private isStdLib(pkg: string, language: string): boolean {
        const pythonStdLib = new Set([
            'os', 'sys', 'json', 'time', 'datetime', 're', 'math', 'random',
            'collections', 'itertools', 'functools', 'typing', 'pathlib',
            'subprocess', 'threading', 'multiprocessing', 'asyncio', 'io',
            'logging', 'unittest', 'argparse', 'configparser', 'csv', 'xml',
            'html', 'urllib', 'http', 'email', 'base64', 'hashlib', 'secrets',
        ]);

        const jsBuiltins = new Set([
            'fs', 'path', 'os', 'http', 'https', 'url', 'crypto', 'stream',
            'events', 'util', 'buffer', 'child_process', 'cluster', 'dgram',
            'dns', 'net', 'readline', 'tls', 'tty', 'vm', 'zlib',
        ]);

        if (language === 'python') return pythonStdLib.has(pkg);
        if (language === 'javascript') return jsBuiltins.has(pkg);
        return false;
    }

    // ========================================================================
    // Confidence Calculation
    // ========================================================================

    /**
     * Calculate overall confidence in research results
     */
    private calculateConfidence(sources: ResearchSource[]): number {
        if (sources.length === 0) return 0;

        // Weighted average of source reliability
        let totalWeight = 0;
        let weightedSum = 0;

        for (let i = 0; i < sources.length; i++) {
            const weight = 1 / (i + 1);  // Earlier sources count more
            weightedSum += sources[i].reliability * weight;
            totalWeight += weight;
        }

        const avgReliability = weightedSum / totalWeight;

        // Bonus for multiple high-quality sources
        const highQualitySources = sources.filter(s => s.reliability >= 0.8).length;
        const diversityBonus = Math.min(highQualitySources * 0.05, 0.15);

        // Bonus for official docs
        const hasOfficialDocs = sources.some(s => s.sourceType === 'official_docs');
        const officialBonus = hasOfficialDocs ? 0.1 : 0;

        return Math.min(avgReliability + diversityBonus + officialBonus, 1.0);
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Clear research cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; oldestEntry: number | null } {
        let oldest: number | null = null;
        for (const entry of this.cache.values()) {
            if (oldest === null || entry.timestamp < oldest) {
                oldest = entry.timestamp;
            }
        }
        return {
            size: this.cache.size,
            oldestEntry: oldest,
        };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createResearchEngine(
    deps: ResearchEngineDependencies,
    config?: Partial<SelfLearningConfig>
): ResearchEngine {
    return new ResearchEngine(deps, config);
}
