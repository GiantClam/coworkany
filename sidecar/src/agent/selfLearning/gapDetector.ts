/**
 * CoworkAny - Gap Detector
 *
 * Detects capability gaps when user requests involve
 * tools, libraries, or knowledge that AI doesn't currently have.
 */

import * as crypto from 'crypto';
import type {
    CapabilityGap,
    GapDetectionResult,
    GapType,
    SelfLearningConfig,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ============================================================================
// Constants
// ============================================================================

// Common programming libraries and tools that might need learning
const KNOWN_LIBRARIES = new Set([
    // Python
    'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'plotly',
    'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'sklearn',
    'opencv', 'cv2', 'pillow', 'pil', 'requests', 'beautifulsoup',
    'selenium', 'playwright', 'scrapy', 'flask', 'django', 'fastapi',
    'sqlalchemy', 'pydantic', 'celery', 'redis', 'pymongo',
    // Databases and ORM
    'postgresql', 'postgres', 'mysql', 'mongodb', 'sqlite', 'sqlite3',
    'mariadb', 'mssql', 'oracledb', 'cassandra',
    'knex', 'drizzle', 'alembic', 'flyway', 'liquibase',
    // JavaScript/TypeScript
    'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'express',
    'nest', 'fastify', 'prisma', 'mongoose', 'sequelize', 'typeorm',
    'd3', 'three', 'pixi', 'phaser', 'gsap', 'framer-motion',
    // CLI tools
    'ffmpeg', 'imagemagick', 'graphviz', 'pandoc', 'latex', 'docker',
    'kubectl', 'terraform', 'ansible', 'aws', 'gcloud', 'azure',
    // Data formats
    'json', 'xml', 'yaml', 'csv', 'parquet', 'avro', 'protobuf',
]);

// Keywords indicating capability requirements
const CAPABILITY_KEYWORDS: Record<string, GapType> = {
    // Library indicators
    'library': 'library',
    'package': 'library',
    'module': 'library',
    'framework': 'library',
    'sdk': 'library',
    // Tool indicators
    'tool': 'tool',
    'command': 'tool',
    'cli': 'tool',
    'utility': 'tool',
    // Domain knowledge indicators
    'how to': 'domain_knowledge',
    'what is': 'domain_knowledge',
    'explain': 'domain_knowledge',
    'understand': 'domain_knowledge',
    // Procedure indicators
    'steps': 'procedure',
    'process': 'procedure',
    'workflow': 'procedure',
    'tutorial': 'procedure',
    'guide': 'procedure',
};

// ============================================================================
// Types
// ============================================================================

export interface GapDetectorDependencies {
    searchKnowledge: (query: string, category?: string) => Promise<Array<{
        path: string;
        title: string;
        content?: string;
        score: number;
    }>>;
    searchSkills: (query: string) => Array<{
        name: string;
        description?: string;
        triggers?: string[];
    }>;
}

// ============================================================================
// GapDetector Class
// ============================================================================

export class GapDetector {
    private config: SelfLearningConfig;
    private deps: GapDetectorDependencies;

    constructor(
        deps: GapDetectorDependencies,
        config?: Partial<SelfLearningConfig>
    ) {
        this.deps = deps;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Main Detection Methods
    // ========================================================================

    /**
     * Analyze user query and detect capability gaps
     */
    async detectGaps(
        userQuery: string,
        taskContext?: string
    ): Promise<GapDetectionResult> {
        // 1. Extract keywords and entities from query
        const extracted = this.extractEntities(userQuery);

        // 2. Search existing knowledge and skills
        const [knowledgeResults, skillResults] = await Promise.all([
            this.searchKnowledgeBase(userQuery, extracted.keywords),
            this.searchSkillBase(userQuery, extracted.keywords),
        ]);

        // 3. Identify gaps
        const gaps = this.identifyGaps(extracted, knowledgeResults, skillResults);

        // 4. Determine recommendation
        const recommendation = this.determineAction(gaps, knowledgeResults, skillResults);

        return {
            hasGap: gaps.length > 0,
            gaps,
            canProceedWithPartialKnowledge: knowledgeResults.length > 0 || skillResults.length > 0,
            recommendedAction: recommendation,
            matchedSkills: skillResults.map(s => s.name),
            matchedKnowledge: knowledgeResults.map(k => k.title),
        };
    }

    /**
     * Analyze a task failure to identify missing capabilities
     */
    async analyzeFailure(
        originalQuery: string,
        errorMessage: string,
        attemptCount: number
    ): Promise<CapabilityGap[]> {
        const gaps: CapabilityGap[] = [];

        // Extract potential missing capabilities from error
        const errorAnalysis = this.analyzeErrorMessage(errorMessage);

        for (const analysis of errorAnalysis) {
            // Check if we already have knowledge about this
            const existingKnowledge = await this.deps.searchKnowledge(
                analysis.keyword,
                'solutions'
            );

            if (existingKnowledge.length === 0 || existingKnowledge[0].score < 0.7) {
                gaps.push({
                    id: crypto.randomUUID(),
                    type: analysis.type,
                    description: analysis.description,
                    userQuery: originalQuery,
                    detectedAt: new Date().toISOString(),
                    confidence: Math.min(0.5 + attemptCount * 0.15, 0.9),
                    suggestedResearchQueries: analysis.researchQueries,
                    keywords: [analysis.keyword],
                });
            }
        }

        return gaps;
    }

    // ========================================================================
    // Entity Extraction
    // ========================================================================

    /**
     * Extract keywords, library names, and entities from query
     */
    private extractEntities(query: string): {
        keywords: string[];
        libraries: string[];
        tools: string[];
        gapTypes: GapType[];
    } {
        const lowerQuery = query.toLowerCase();
        const words = lowerQuery.split(/\s+/);

        const keywords: string[] = [];
        const libraries: string[] = [];
        const tools: string[] = [];
        const gapTypes: Set<GapType> = new Set();

        // Check for known libraries
        for (const word of words) {
            const cleanWord = word.replace(/[^\w]/g, '');
            if (KNOWN_LIBRARIES.has(cleanWord)) {
                libraries.push(cleanWord);
                keywords.push(cleanWord);
            }
        }

        // Check for capability keywords
        for (const [keyword, type] of Object.entries(CAPABILITY_KEYWORDS)) {
            if (lowerQuery.includes(keyword)) {
                gapTypes.add(type);
            }
        }

        // Extract potential tool names (often in backticks or after "using")
        const toolMatches = query.match(/`([^`]+)`|using\s+(\w+)|with\s+(\w+)/gi);
        if (toolMatches) {
            for (const match of toolMatches) {
                const tool = match.replace(/[`using with]/gi, '').trim();
                if (tool && tool.length > 1) {
                    tools.push(tool.toLowerCase());
                    keywords.push(tool.toLowerCase());
                }
            }
        }

        // Extract technical terms (words with special patterns)
        const technicalTerms = query.match(/\b[a-z]+[-_][a-z]+\b|\b[a-z]+\d+\b/gi);
        if (technicalTerms) {
            for (const term of technicalTerms) {
                keywords.push(term.toLowerCase());
            }
        }

        // Add common technical nouns
        const technicalNouns = this.extractTechnicalNouns(query);
        keywords.push(...technicalNouns);

        return {
            keywords: [...new Set(keywords)],
            libraries: [...new Set(libraries)],
            tools: [...new Set(tools)],
            gapTypes: [...gapTypes],
        };
    }

    /**
     * Extract technical nouns from query
     */
    private extractTechnicalNouns(query: string): string[] {
        const technicalPatterns = [
            /\b(video|audio|image|file|data|api|database|server|client)\b/gi,
            /\b(processing|conversion|analysis|generation|extraction)\b/gi,
            /\b(format|encoding|compression|streaming)\b/gi,
            /\b(scraping|crawling|automation|testing)\b/gi,
        ];

        const nouns: string[] = [];
        for (const pattern of technicalPatterns) {
            const matches = query.match(pattern);
            if (matches) {
                nouns.push(...matches.map(m => m.toLowerCase()));
            }
        }

        return nouns;
    }

    // ========================================================================
    // Knowledge & Skill Search
    // ========================================================================

    /**
     * Search knowledge base for relevant entries
     */
    private async searchKnowledgeBase(
        query: string,
        keywords: string[]
    ): Promise<Array<{ path: string; title: string; score: number }>> {
        const results: Array<{ path: string; title: string; score: number }> = [];

        try {
            // Search with main query
            const mainResults = await this.deps.searchKnowledge(query);
            results.push(...mainResults);

            // Search with individual keywords for better coverage
            for (const keyword of keywords.slice(0, 3)) {
                const keywordResults = await this.deps.searchKnowledge(keyword);
                results.push(...keywordResults);
            }

            // Deduplicate and sort by score
            const seen = new Set<string>();
            return results
                .filter(r => {
                    if (seen.has(r.path)) return false;
                    seen.add(r.path);
                    return true;
                })
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);
        } catch (error) {
            console.error('[GapDetector] Knowledge search failed:', error);
            return [];
        }
    }

    /**
     * Search skill base for relevant skills
     */
    private searchSkillBase(
        query: string,
        keywords: string[]
    ): Array<{ name: string; description?: string; triggers?: string[] }> {
        try {
            const allSkills = this.deps.searchSkills(query);

            // Filter skills that match query or keywords
            return allSkills.filter(skill => {
                const skillText = `${skill.name} ${skill.description || ''} ${(skill.triggers || []).join(' ')}`.toLowerCase();
                const lowerQuery = query.toLowerCase();

                // Check if skill matches query or any keyword
                if (skillText.includes(lowerQuery)) return true;
                for (const keyword of keywords) {
                    if (skillText.includes(keyword)) return true;
                }
                return false;
            });
        } catch (error) {
            console.error('[GapDetector] Skill search failed:', error);
            return [];
        }
    }

    // ========================================================================
    // Gap Identification
    // ========================================================================

    /**
     * Identify capability gaps based on extracted entities and search results
     */
    private identifyGaps(
        extracted: {
            keywords: string[];
            libraries: string[];
            tools: string[];
            gapTypes: GapType[];
        },
        knowledgeResults: Array<{ score: number; title: string }>,
        skillResults: Array<{ name: string }>
    ): CapabilityGap[] {
        const gaps: CapabilityGap[] = [];
        const highConfidenceThreshold = 0.7;

        // Check for library gaps
        for (const lib of extracted.libraries) {
            const hasKnowledge = knowledgeResults.some(
                k => k.title.toLowerCase().includes(lib) && k.score >= highConfidenceThreshold
            );
            const hasSkill = skillResults.some(
                s => s.name.toLowerCase().includes(lib)
            );

            if (!hasKnowledge && !hasSkill) {
                gaps.push(this.createGap(
                    'library',
                    `Missing knowledge about ${lib} library`,
                    [lib],
                    [
                        `${lib} tutorial getting started`,
                        `${lib} documentation`,
                        `${lib} examples code`,
                    ]
                ));
            }
        }

        // Check for tool gaps
        for (const tool of extracted.tools) {
            const hasKnowledge = knowledgeResults.some(
                k => k.title.toLowerCase().includes(tool) && k.score >= highConfidenceThreshold
            );

            if (!hasKnowledge) {
                gaps.push(this.createGap(
                    'tool',
                    `Missing knowledge about ${tool} tool`,
                    [tool],
                    [
                        `${tool} how to use`,
                        `${tool} command examples`,
                        `${tool} installation guide`,
                    ]
                ));
            }
        }

        // If no specific library/tool found but low knowledge match
        if (gaps.length === 0 && knowledgeResults.length > 0) {
            const bestMatch = knowledgeResults[0];
            if (bestMatch.score < 0.5) {
                // Low confidence match - might need to learn
                gaps.push(this.createGap(
                    extracted.gapTypes[0] || 'domain_knowledge',
                    `Insufficient knowledge for this task`,
                    extracted.keywords,
                    extracted.keywords.map(k => `${k} tutorial how to`)
                ));
            }
        }

        // If no knowledge at all
        if (gaps.length === 0 && knowledgeResults.length === 0 && skillResults.length === 0) {
            if (extracted.keywords.length > 0) {
                gaps.push(this.createGap(
                    extracted.gapTypes[0] || 'domain_knowledge',
                    `No existing knowledge found for this task`,
                    extracted.keywords,
                    extracted.keywords.map(k => `${k} tutorial beginner guide`)
                ));
            }
        }

        return gaps;
    }

    /**
     * Create a capability gap object
     */
    private createGap(
        type: GapType,
        description: string,
        keywords: string[],
        researchQueries: string[]
    ): CapabilityGap {
        return {
            id: crypto.randomUUID(),
            type,
            description,
            userQuery: '',  // Will be filled by caller
            detectedAt: new Date().toISOString(),
            confidence: 0.7,
            suggestedResearchQueries: researchQueries,
            keywords,
        };
    }

    // ========================================================================
    // Error Analysis
    // ========================================================================

    /**
     * Analyze error message to identify potential missing capabilities
     */
    private analyzeErrorMessage(error: string): Array<{
        keyword: string;
        type: GapType;
        description: string;
        researchQueries: string[];
    }> {
        const results: Array<{
            keyword: string;
            type: GapType;
            description: string;
            researchQueries: string[];
        }> = [];

        const lowerError = error.toLowerCase();

        // Module not found
        const moduleMatch = error.match(/no module named ['"]([^'"]+)['"]/i) ||
            error.match(/cannot find module ['"]([^'"]+)['"]/i) ||
            error.match(/import error.*['"]([^'"]+)['"]/i);

        if (moduleMatch) {
            const module = moduleMatch[1].split('.')[0];
            results.push({
                keyword: module,
                type: 'library',
                description: `Missing module: ${module}`,
                researchQueries: [
                    `${module} python library installation`,
                    `${module} tutorial getting started`,
                    `how to install ${module}`,
                ],
            });
        }

        // Command not found
        const cmdMatch = error.match(/command not found.*['"]?(\w+)['"]?/i) ||
            error.match(/['"](\w+)['"].*is not recognized/i);

        if (cmdMatch) {
            const cmd = cmdMatch[1];
            results.push({
                keyword: cmd,
                type: 'tool',
                description: `Missing command: ${cmd}`,
                researchQueries: [
                    `${cmd} installation guide`,
                    `how to install ${cmd}`,
                    `${cmd} command line tool`,
                ],
            });
        }

        // API/method errors
        if (lowerError.includes('attributeerror') || lowerError.includes('typeerror')) {
            const attrMatch = error.match(/has no attribute ['"]([^'"]+)['"]/i) ||
                error.match(/object has no attribute ['"]([^'"]+)['"]/i);

            if (attrMatch) {
                results.push({
                    keyword: attrMatch[1],
                    type: 'domain_knowledge',
                    description: `Unknown attribute/method: ${attrMatch[1]}`,
                    researchQueries: [
                        `${attrMatch[1]} method python`,
                        `how to use ${attrMatch[1]}`,
                    ],
                });
            }
        }

        return results;
    }

    // ========================================================================
    // Decision Making
    // ========================================================================

    /**
     * Determine recommended action based on gaps and available resources
     */
    private determineAction(
        gaps: CapabilityGap[],
        knowledgeResults: Array<{ score: number }>,
        skillResults: Array<{ name: string }>
    ): 'learn' | 'ask_user' | 'proceed' | 'delegate' {
        // No gaps - proceed normally
        if (gaps.length === 0) {
            return 'proceed';
        }

        // High confidence knowledge available - can proceed with caution
        if (knowledgeResults.length > 0 && knowledgeResults[0].score >= 0.8) {
            return 'proceed';
        }

        // Matching skill available - delegate to skill
        if (skillResults.length > 0) {
            return 'delegate';
        }

        // Multiple significant gaps - ask user first
        if (gaps.length > 2 || gaps.some(g => g.type === 'procedure')) {
            return 'ask_user';
        }

        // Single gap with clear type - learn
        return 'learn';
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Generate research queries for a gap
     */
    generateResearchQueries(gap: CapabilityGap): string[] {
        const queries: string[] = [...gap.suggestedResearchQueries];

        // Add variations based on gap type
        switch (gap.type) {
            case 'library':
                queries.push(`${gap.keywords[0]} python/javascript library`);
                queries.push(`${gap.keywords[0]} API reference`);
                break;
            case 'tool':
                queries.push(`${gap.keywords[0]} CLI usage examples`);
                queries.push(`${gap.keywords[0]} common commands`);
                break;
            case 'procedure':
                queries.push(`${gap.keywords.join(' ')} step by step guide`);
                queries.push(`${gap.keywords.join(' ')} best practices`);
                break;
            case 'domain_knowledge':
                queries.push(`${gap.keywords.join(' ')} explained`);
                queries.push(`${gap.keywords.join(' ')} concepts`);
                break;
        }

        return [...new Set(queries)].slice(0, 5);
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createGapDetector(
    deps: GapDetectorDependencies,
    config?: Partial<SelfLearningConfig>
): GapDetector {
    return new GapDetector(deps, config);
}
