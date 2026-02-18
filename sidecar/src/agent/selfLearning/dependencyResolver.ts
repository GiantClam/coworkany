/**
 * CoworkAny - Dependency Resolver
 *
 * Resolves skill dependencies by finding existing tools and skills
 * that can be reused. Implements the "compose over create" principle.
 *
 * Benefits:
 * - New skills automatically benefit from tool upgrades
 * - Consistent behavior across skills
 * - Reduced duplication
 * - Better permission management
 */

import type {
    SkillDependency,
    DependencyResolution,
    SkillGenerationStrategy,
    ToolCapabilityMapping,
    ProcessedKnowledge,
} from './types';
import { DEFAULT_SKILL_GENERATION_STRATEGY } from './types';

// ============================================================================
// Built-in Tool Capabilities Mapping
// ============================================================================

/**
 * Maps common capabilities to built-in tools.
 * When generating a skill that needs these capabilities,
 * prefer using these tools instead of inline code.
 */
const TOOL_CAPABILITY_MAP: ToolCapabilityMapping[] = [
    // File Operations
    {
        capability: 'read_file',
        tools: [
            { toolId: 'read_file', priority: 10 },
            { toolId: 'filesystem:read', priority: 8 },
        ],
    },
    {
        capability: 'write_file',
        tools: [
            { toolId: 'write_file', priority: 10 },
            { toolId: 'filesystem:write', priority: 8 },
        ],
    },
    {
        capability: 'list_directory',
        tools: [
            { toolId: 'list_directory', priority: 10 },
            { toolId: 'execute_bash', priority: 5, conditions: ['unix'] },
        ],
    },

    // Code Execution
    {
        capability: 'execute_code',
        tools: [
            { toolId: 'execute_code', priority: 10 },
            { toolId: 'run_python', priority: 8, conditions: ['python'] },
            { toolId: 'run_node', priority: 8, conditions: ['javascript', 'typescript'] },
        ],
    },
    {
        capability: 'execute_bash',
        tools: [
            { toolId: 'execute_bash', priority: 10 },
            { toolId: 'run_command', priority: 8 },
        ],
    },

    // Web Operations
    {
        capability: 'web_search',
        tools: [
            { toolId: 'web_search', priority: 10 },
            { toolId: 'search_internet', priority: 8 },
        ],
    },
    {
        capability: 'fetch_url',
        tools: [
            { toolId: 'fetch_url', priority: 10 },
            { toolId: 'web_fetch', priority: 8 },
            { toolId: 'browser_navigate', priority: 5 },
        ],
    },
    {
        capability: 'browser_automation',
        tools: [
            { toolId: 'browser_connect', priority: 10 },
            { toolId: 'browser_navigate', priority: 9 },
            { toolId: 'browser_click', priority: 9 },
            { toolId: 'browser_fill', priority: 9 },
        ],
    },

    // Data Processing
    {
        capability: 'json_parse',
        tools: [
            { toolId: 'parse_json', priority: 10 },
        ],
    },
    {
        capability: 'text_extract',
        tools: [
            { toolId: 'extract_text', priority: 10 },
            { toolId: 'regex_match', priority: 8 },
        ],
    },

    // Memory/Knowledge
    {
        capability: 'remember',
        tools: [
            { toolId: 'add_to_memory', priority: 10 },
            { toolId: 'update_knowledge', priority: 8 },
        ],
    },
    {
        capability: 'recall',
        tools: [
            { toolId: 'search_memory', priority: 10 },
            { toolId: 'find_learned_capability', priority: 8 },
        ],
    },
];

/**
 * Maps common operations to existing skill patterns.
 * These are operations that are better handled by skills than raw code.
 */
const SKILL_CAPABILITY_MAP: Record<string, string[]> = {
    'video_processing': ['video-convert', 'video-compress', 'ffmpeg-helper'],
    'image_processing': ['image-resize', 'image-convert', 'pillow-helper'],
    'pdf_operations': ['pdf-merge', 'pdf-extract', 'pdf-to-text'],
    'data_analysis': ['pandas-helper', 'data-visualization', 'csv-processor'],
    'web_scraping': ['web-scraper', 'content-extractor', 'html-parser'],
    'api_integration': ['api-caller', 'rest-client', 'auth-helper'],
    'git_operations': ['git-commit', 'git-branch', 'git-helper'],
    'testing': ['test-runner', 'test-generator', 'coverage-reporter'],
};

// ============================================================================
// DependencyResolver Class
// ============================================================================

export interface DependencyResolverDeps {
    /**
     * Get list of available tools
     */
    listTools: () => Array<{ id: string; name: string; description?: string }>;

    /**
     * Get list of available skills
     */
    listSkills: () => Array<{ id: string; name: string; triggers?: string[]; tags?: string[] }>;

    /**
     * Check if a tool is available
     */
    hasTool: (toolId: string) => boolean;

    /**
     * Check if a skill is available
     */
    hasSkill: (skillId: string) => boolean;
}

export class DependencyResolver {
    private deps: DependencyResolverDeps;
    private strategy: SkillGenerationStrategy;
    private toolCache: Map<string, boolean>;
    private skillCache: Map<string, boolean>;

    constructor(
        deps: DependencyResolverDeps,
        strategy?: Partial<SkillGenerationStrategy>
    ) {
        this.deps = deps;
        this.strategy = { ...DEFAULT_SKILL_GENERATION_STRATEGY, ...strategy };
        this.toolCache = new Map();
        this.skillCache = new Map();
    }

    // ========================================================================
    // Capability Analysis
    // ========================================================================

    /**
     * Analyze what capabilities a piece of knowledge needs
     */
    analyzeRequiredCapabilities(knowledge: ProcessedKnowledge): string[] {
        const capabilities: Set<string> = new Set();
        const content = [
            knowledge.summary,
            knowledge.detailedContent,
            knowledge.codeTemplate || '',
            ...(knowledge.steps || []),
        ].join(' ').toLowerCase();

        // File operations
        if (/read.*file|open.*file|load.*file/i.test(content)) {
            capabilities.add('read_file');
        }
        if (/write.*file|save.*file|create.*file/i.test(content)) {
            capabilities.add('write_file');
        }
        if (/list.*dir|directory.*content|ls /i.test(content)) {
            capabilities.add('list_directory');
        }

        // Code execution
        if (/python|\.py|import /i.test(content)) {
            capabilities.add('execute_code');
        }
        if (/bash|shell|command|terminal/i.test(content)) {
            capabilities.add('execute_bash');
        }

        // Web operations
        if (/search.*web|google|internet/i.test(content)) {
            capabilities.add('web_search');
        }
        if (/fetch|request|http|url|api/i.test(content)) {
            capabilities.add('fetch_url');
        }
        if (/browser|selenium|playwright|click|fill.*form/i.test(content)) {
            capabilities.add('browser_automation');
        }

        // Data processing
        if (/json|parse|serialize/i.test(content)) {
            capabilities.add('json_parse');
        }
        if (/regex|extract|pattern/i.test(content)) {
            capabilities.add('text_extract');
        }

        // Domain-specific
        if (/video|mp4|ffmpeg|convert.*video/i.test(content)) {
            capabilities.add('video_processing');
        }
        if (/image|png|jpg|resize|crop/i.test(content)) {
            capabilities.add('image_processing');
        }
        if (/pdf|document/i.test(content)) {
            capabilities.add('pdf_operations');
        }
        if (/pandas|dataframe|csv|excel/i.test(content)) {
            capabilities.add('data_analysis');
        }

        return [...capabilities];
    }

    // ========================================================================
    // Dependency Resolution
    // ========================================================================

    /**
     * Resolve dependencies for a set of capabilities
     */
    async resolveDependencies(
        capabilities: string[]
    ): Promise<DependencyResolution> {
        const resolved: DependencyResolution['resolved'] = [];
        const missing: DependencyResolution['missing'] = [];

        for (const capability of capabilities) {
            const resolution = await this.resolveCapability(capability);

            if (resolution.found) {
                resolved.push({
                    dependency: {
                        type: resolution.type as 'tool' | 'skill' | 'builtin',
                        id: resolution.id,
                        name: resolution.name,
                        purpose: `Provides ${capability} capability`,
                        required: true,
                    },
                    resolvedTo: resolution.id,
                    version: resolution.version,
                });
            } else {
                missing.push({
                    dependency: {
                        type: 'tool',
                        id: capability,
                        name: capability,
                        purpose: `Provides ${capability} capability`,
                        required: !this.strategy.allowInlineFallback,
                        fallback: this.strategy.allowInlineFallback ? {
                            type: 'inline',
                        } : { type: 'error' },
                    },
                    reason: resolution.reason || 'No matching tool or skill found',
                    suggestedAlternatives: resolution.alternatives,
                });
            }
        }

        // Check dependency depth
        const canProceed = missing.filter(m => m.dependency.required).length === 0;

        return { resolved, missing, canProceed };
    }

    /**
     * Resolve a single capability to a tool or skill
     */
    private async resolveCapability(capability: string): Promise<{
        found: boolean;
        type?: string;
        id: string;
        name: string;
        version?: string;
        reason?: string;
        alternatives?: string[];
    }> {
        // 1. Try to find a matching tool first (if preferExistingTools)
        if (this.strategy.preferExistingTools) {
            const toolMatch = await this.findMatchingTool(capability);
            if (toolMatch) {
                return {
                    found: true,
                    type: 'tool',
                    id: toolMatch.id,
                    name: toolMatch.name,
                };
            }
        }

        // 2. Try to find a matching skill (if preferExistingSkills)
        if (this.strategy.preferExistingSkills) {
            const skillMatch = await this.findMatchingSkill(capability);
            if (skillMatch) {
                return {
                    found: true,
                    type: 'skill',
                    id: skillMatch.id,
                    name: skillMatch.name,
                };
            }
        }

        // 3. Not found
        const alternatives = this.suggestAlternatives(capability);
        return {
            found: false,
            id: capability,
            name: capability,
            reason: `No tool or skill found for capability: ${capability}`,
            alternatives,
        };
    }

    /**
     * Find a matching tool for a capability
     */
    private async findMatchingTool(capability: string): Promise<{
        id: string;
        name: string;
    } | null> {
        // Check capability map
        const mapping = TOOL_CAPABILITY_MAP.find(m => m.capability === capability);
        if (mapping) {
            // Try each tool in priority order
            for (const tool of mapping.tools.sort((a, b) => b.priority - a.priority)) {
                if (this.isToolAvailable(tool.toolId)) {
                    return { id: tool.toolId, name: tool.toolId };
                }
            }
        }

        // Fallback: check all available tools for name match
        const tools = this.deps.listTools();
        const match = tools.find(t =>
            t.id.toLowerCase().includes(capability.replace(/_/g, '')) ||
            t.name.toLowerCase().includes(capability.replace(/_/g, ' '))
        );

        if (match && this.isToolAvailable(match.id)) {
            return { id: match.id, name: match.name };
        }

        return null;
    }

    /**
     * Find a matching skill for a capability
     */
    private async findMatchingSkill(capability: string): Promise<{
        id: string;
        name: string;
    } | null> {
        // Check skill capability map
        const skillIds = SKILL_CAPABILITY_MAP[capability];
        if (skillIds) {
            for (const skillId of skillIds) {
                if (this.isSkillAvailable(skillId)) {
                    return { id: skillId, name: skillId };
                }
            }
        }

        // Fallback: check all available skills
        const skills = this.deps.listSkills();
        const match = skills.find(s =>
            s.id.toLowerCase().includes(capability.replace(/_/g, '-')) ||
            s.name.toLowerCase().includes(capability.replace(/_/g, ' ')) ||
            s.tags?.some(t => t.toLowerCase().includes(capability))
        );

        if (match && this.isSkillAvailable(match.id)) {
            return { id: match.id, name: match.name };
        }

        return null;
    }

    /**
     * Check if a tool is available (with caching)
     */
    private isToolAvailable(toolId: string): boolean {
        if (!this.toolCache.has(toolId)) {
            this.toolCache.set(toolId, this.deps.hasTool(toolId));
        }
        return this.toolCache.get(toolId) || false;
    }

    /**
     * Check if a skill is available (with caching)
     */
    private isSkillAvailable(skillId: string): boolean {
        if (!this.skillCache.has(skillId)) {
            this.skillCache.set(skillId, this.deps.hasSkill(skillId));
        }
        return this.skillCache.get(skillId) || false;
    }

    /**
     * Suggest alternatives for a missing capability
     */
    private suggestAlternatives(capability: string): string[] {
        const suggestions: string[] = [];

        // Check similar capabilities in tool map
        for (const mapping of TOOL_CAPABILITY_MAP) {
            if (this.isSimilar(capability, mapping.capability)) {
                for (const tool of mapping.tools) {
                    if (this.isToolAvailable(tool.toolId)) {
                        suggestions.push(`tool:${tool.toolId}`);
                    }
                }
            }
        }

        // Check similar skills
        for (const [cap, skillIds] of Object.entries(SKILL_CAPABILITY_MAP)) {
            if (this.isSimilar(capability, cap)) {
                for (const skillId of skillIds) {
                    if (this.isSkillAvailable(skillId)) {
                        suggestions.push(`skill:${skillId}`);
                    }
                }
            }
        }

        return [...new Set(suggestions)].slice(0, 5);
    }

    /**
     * Check if two capability names are similar
     */
    private isSimilar(a: string, b: string): boolean {
        const normalize = (s: string) => s.toLowerCase().replace(/[_-]/g, '');
        const na = normalize(a);
        const nb = normalize(b);

        // Exact match after normalization
        if (na === nb) return true;

        // One contains the other
        if (na.includes(nb) || nb.includes(na)) return true;

        // Word overlap
        const wordsA = a.toLowerCase().split(/[_-]/);
        const wordsB = b.toLowerCase().split(/[_-]/);
        const overlap = wordsA.filter(w => wordsB.includes(w)).length;
        return overlap >= Math.min(wordsA.length, wordsB.length) * 0.5;
    }

    // ========================================================================
    // Dependency Generation for Skills
    // ========================================================================

    /**
     * Generate dependency declarations for a skill
     */
    generateDependencyDeclarations(
        resolution: DependencyResolution
    ): {
        requires: {
            tools: string[];
            skills: string[];
        };
        allowedTools: string[];
        inlineCode: Record<string, string>;
    } {
        const toolDeps: string[] = [];
        const skillDeps: string[] = [];
        const allowedTools: string[] = [];
        const inlineCode: Record<string, string> = {};

        // Process resolved dependencies
        for (const r of resolution.resolved) {
            if (r.dependency.type === 'tool') {
                toolDeps.push(r.resolvedTo);
                allowedTools.push(r.resolvedTo);
            } else if (r.dependency.type === 'skill') {
                skillDeps.push(r.resolvedTo);
            }
        }

        // Process missing dependencies with fallbacks
        for (const m of resolution.missing) {
            if (m.dependency.fallback?.type === 'inline' && m.dependency.fallback.inlineCode) {
                inlineCode[m.dependency.id] = m.dependency.fallback.inlineCode;
            }
        }

        return {
            requires: {
                tools: [...new Set(toolDeps)],
                skills: [...new Set(skillDeps)],
            },
            allowedTools: [...new Set(allowedTools)],
            inlineCode,
        };
    }

    // ========================================================================
    // Cache Management
    // ========================================================================

    /**
     * Clear the resolution cache
     */
    clearCache(): void {
        this.toolCache.clear();
        this.skillCache.clear();
    }

    /**
     * Update strategy
     */
    updateStrategy(updates: Partial<SkillGenerationStrategy>): void {
        this.strategy = { ...this.strategy, ...updates };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createDependencyResolver(
    deps: DependencyResolverDeps,
    strategy?: Partial<SkillGenerationStrategy>
): DependencyResolver {
    return new DependencyResolver(deps, strategy);
}
