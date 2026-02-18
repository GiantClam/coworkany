/**
 * CoworkAny - Skill Dependency Loader
 *
 * Loads and validates skill dependencies at runtime.
 * Ensures dependencies are available before executing a skill.
 * Detects circular dependencies and missing dependencies.
 */

import type { GeneratedSkill, SkillDependency } from './types';

// ============================================================================
// Types
// ============================================================================

export interface LoadedSkill {
    id: string;
    name: string;
    version: string;
    manifest: GeneratedSkill['manifest'];
    path: string;
    loaded: boolean;
}

export interface DependencyLoadResult {
    success: boolean;
    loadedSkills: LoadedSkill[];
    missingTools: string[];
    missingSkills: string[];
    circularDependencies: string[][];
    errors: string[];
}

export interface SkillRegistry {
    /**
     * Get a skill by ID
     */
    getSkill: (skillId: string) => LoadedSkill | null;

    /**
     * Check if a skill is loaded
     */
    hasSkill: (skillId: string) => boolean;

    /**
     * List all loaded skills
     */
    listSkills: () => LoadedSkill[];
}

export interface ToolRegistry {
    /**
     * Check if a tool is available
     */
    hasTool: (toolId: string) => boolean;

    /**
     * List all available tools
     */
    listTools: () => Array<{ id: string; name: string }>;
}

// ============================================================================
// SkillDependencyLoader Class
// ============================================================================

export class SkillDependencyLoader {
    private skillRegistry: SkillRegistry;
    private toolRegistry: ToolRegistry;
    private loadingStack: Set<string>; // Track currently loading skills for cycle detection
    private loadedCache: Map<string, DependencyLoadResult>;

    constructor(skillRegistry: SkillRegistry, toolRegistry: ToolRegistry) {
        this.skillRegistry = skillRegistry;
        this.toolRegistry = toolRegistry;
        this.loadingStack = new Set();
        this.loadedCache = new Map();
    }

    // ========================================================================
    // Dependency Loading
    // ========================================================================

    /**
     * Load all dependencies for a skill
     * Returns validation result and list of loaded dependencies
     */
    async loadDependencies(skillId: string): Promise<DependencyLoadResult> {
        // Check cache first
        if (this.loadedCache.has(skillId)) {
            return this.loadedCache.get(skillId)!;
        }

        // Initialize result
        const result: DependencyLoadResult = {
            success: true,
            loadedSkills: [],
            missingTools: [],
            missingSkills: [],
            circularDependencies: [],
            errors: [],
        };

        // Get the skill
        const skill = this.skillRegistry.getSkill(skillId);
        if (!skill) {
            result.success = false;
            result.errors.push(`Skill not found: ${skillId}`);
            return result;
        }

        // Check for circular dependency
        if (this.loadingStack.has(skillId)) {
            const cycle = [...this.loadingStack, skillId];
            result.success = false;
            result.circularDependencies.push(cycle);
            result.errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
            return result;
        }

        // Add to loading stack
        this.loadingStack.add(skillId);

        try {
            // Load tool dependencies
            if (skill.manifest.requires?.tools) {
                for (const toolId of skill.manifest.requires.tools) {
                    if (!this.toolRegistry.hasTool(toolId)) {
                        result.missingTools.push(toolId);
                        result.errors.push(`Required tool not available: ${toolId}`);
                        result.success = false;
                    }
                }
            }

            // Load skill dependencies recursively
            if (skill.manifest.requires?.skills) {
                for (const dependentSkillId of skill.manifest.requires.skills) {
                    // Check if skill exists
                    if (!this.skillRegistry.hasSkill(dependentSkillId)) {
                        result.missingSkills.push(dependentSkillId);
                        result.errors.push(`Required skill not available: ${dependentSkillId}`);
                        result.success = false;
                        continue;
                    }

                    // Recursively load dependencies
                    const depResult = await this.loadDependencies(dependentSkillId);

                    // Merge results
                    result.loadedSkills.push(...depResult.loadedSkills);
                    result.missingTools.push(...depResult.missingTools);
                    result.missingSkills.push(...depResult.missingSkills);
                    result.circularDependencies.push(...depResult.circularDependencies);
                    result.errors.push(...depResult.errors);

                    if (!depResult.success) {
                        result.success = false;
                    }
                }
            }

            // Add current skill to loaded list
            result.loadedSkills.push(skill);

            // Deduplicate
            result.missingTools = [...new Set(result.missingTools)];
            result.missingSkills = [...new Set(result.missingSkills)];
            result.errors = [...new Set(result.errors)];

        } finally {
            // Remove from loading stack
            this.loadingStack.delete(skillId);
        }

        // Cache result
        this.loadedCache.set(skillId, result);

        return result;
    }

    /**
     * Validate dependencies for a skill without loading
     */
    async validateDependencies(skillId: string): Promise<{
        valid: boolean;
        issues: Array<{
            type: 'missing_tool' | 'missing_skill' | 'circular_dependency' | 'version_conflict';
            message: string;
            dependency?: string;
        }>;
    }> {
        const result = await this.loadDependencies(skillId);

        const issues: Array<{
            type: 'missing_tool' | 'missing_skill' | 'circular_dependency' | 'version_conflict';
            message: string;
            dependency?: string;
        }> = [];

        // Report missing tools
        for (const tool of result.missingTools) {
            issues.push({
                type: 'missing_tool',
                message: `Tool '${tool}' is required but not available`,
                dependency: tool,
            });
        }

        // Report missing skills
        for (const skill of result.missingSkills) {
            issues.push({
                type: 'missing_skill',
                message: `Skill '${skill}' is required but not installed`,
                dependency: skill,
            });
        }

        // Report circular dependencies
        for (const cycle of result.circularDependencies) {
            issues.push({
                type: 'circular_dependency',
                message: `Circular dependency: ${cycle.join(' → ')}`,
            });
        }

        return {
            valid: result.success,
            issues,
        };
    }

    // ========================================================================
    // Dependency Graph
    // ========================================================================

    /**
     * Build dependency graph for a skill
     */
    buildDependencyGraph(skillId: string): {
        nodes: Array<{ id: string; type: 'skill' | 'tool'; label: string }>;
        edges: Array<{ from: string; to: string; label?: string }>;
    } {
        const nodes: Array<{ id: string; type: 'skill' | 'tool'; label: string }> = [];
        const edges: Array<{ from: string; to: string; label?: string }> = [];
        const visited = new Set<string>();

        const traverse = (currentSkillId: string) => {
            if (visited.has(currentSkillId)) return;
            visited.add(currentSkillId);

            const skill = this.skillRegistry.getSkill(currentSkillId);
            if (!skill) return;

            // Add skill node
            nodes.push({
                id: currentSkillId,
                type: 'skill',
                label: skill.name,
            });

            // Add tool dependencies
            if (skill.manifest.requires?.tools) {
                for (const toolId of skill.manifest.requires.tools) {
                    // Add tool node if not exists
                    if (!nodes.find(n => n.id === toolId)) {
                        nodes.push({
                            id: toolId,
                            type: 'tool',
                            label: toolId,
                        });
                    }

                    // Add edge
                    edges.push({
                        from: currentSkillId,
                        to: toolId,
                        label: 'uses',
                    });
                }
            }

            // Add skill dependencies
            if (skill.manifest.requires?.skills) {
                for (const depSkillId of skill.manifest.requires.skills) {
                    // Add edge
                    edges.push({
                        from: currentSkillId,
                        to: depSkillId,
                        label: 'depends on',
                    });

                    // Recursively traverse
                    traverse(depSkillId);
                }
            }
        };

        traverse(skillId);

        return { nodes, edges };
    }

    /**
     * Get dependency tree as text
     */
    getDependencyTree(skillId: string, indent: number = 0): string {
        const skill = this.skillRegistry.getSkill(skillId);
        if (!skill) {
            return `${'  '.repeat(indent)}[NOT FOUND] ${skillId}`;
        }

        const lines: string[] = [];
        const prefix = '  '.repeat(indent);

        // Current skill
        lines.push(`${prefix}${skill.name} (${skill.version})`);

        // Tool dependencies
        if (skill.manifest.requires?.tools && skill.manifest.requires.tools.length > 0) {
            lines.push(`${prefix}  Tools:`);
            for (const toolId of skill.manifest.requires.tools) {
                const available = this.toolRegistry.hasTool(toolId) ? '✓' : '✗';
                lines.push(`${prefix}    ${available} ${toolId}`);
            }
        }

        // Skill dependencies
        if (skill.manifest.requires?.skills && skill.manifest.requires.skills.length > 0) {
            lines.push(`${prefix}  Skills:`);
            for (const depSkillId of skill.manifest.requires.skills) {
                lines.push(this.getDependencyTree(depSkillId, indent + 2));
            }
        }

        return lines.join('\n');
    }

    // ========================================================================
    // Dependency Resolution Strategies
    // ========================================================================

    /**
     * Find alternative skills that can replace a missing dependency
     */
    findAlternativeSkills(missingSkillId: string): LoadedSkill[] {
        const allSkills = this.skillRegistry.listSkills();
        const alternatives: LoadedSkill[] = [];

        // Extract keywords from missing skill ID
        const keywords = missingSkillId.toLowerCase().split(/[-_]/);

        for (const skill of allSkills) {
            if (skill.id === missingSkillId) continue;

            // Check if skill has similar tags or name
            const skillKeywords = [
                ...skill.name.toLowerCase().split(/[-_\s]/),
                ...(skill.manifest.tags || []).map(t => t.toLowerCase()),
            ];

            const overlap = keywords.filter(k => skillKeywords.includes(k)).length;
            if (overlap >= Math.min(keywords.length * 0.5, 2)) {
                alternatives.push(skill);
            }
        }

        return alternatives;
    }

    /**
     * Suggest tools that can replace missing skill functionality
     */
    suggestToolAlternatives(missingSkillId: string): string[] {
        const allTools = this.toolRegistry.listTools();
        const suggestions: string[] = [];

        // Extract keywords from missing skill ID
        const keywords = missingSkillId.toLowerCase().split(/[-_]/);

        for (const tool of allTools) {
            const toolKeywords = tool.id.toLowerCase().split(/[-_]/);
            const overlap = keywords.filter(k => toolKeywords.includes(k)).length;

            if (overlap >= 1) {
                suggestions.push(tool.id);
            }
        }

        return suggestions;
    }

    // ========================================================================
    // Cache Management
    // ========================================================================

    /**
     * Clear dependency cache
     */
    clearCache(): void {
        this.loadedCache.clear();
    }

    /**
     * Clear cache for specific skill
     */
    clearSkillCache(skillId: string): void {
        this.loadedCache.delete(skillId);
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): {
        cachedSkills: number;
        totalValidations: number;
    } {
        return {
            cachedSkills: this.loadedCache.size,
            totalValidations: this.loadedCache.size,
        };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSkillDependencyLoader(
    skillRegistry: SkillRegistry,
    toolRegistry: ToolRegistry
): SkillDependencyLoader {
    return new SkillDependencyLoader(skillRegistry, toolRegistry);
}
