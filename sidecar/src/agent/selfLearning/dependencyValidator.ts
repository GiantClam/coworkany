/**
 * CoworkAny - Dependency Validator
 *
 * Validates skill dependencies before installation.
 * Detects issues like circular dependencies, missing dependencies,
 * version conflicts, and excessive dependency depth.
 */

import type { GeneratedSkill, SkillDependency } from './types';

// ============================================================================
// Types
// ============================================================================

export type ValidationIssueType =
    | 'circular_dependency'
    | 'missing_tool'
    | 'missing_skill'
    | 'excessive_depth'
    | 'version_conflict'
    | 'incompatible_requirement';

export interface ValidationIssue {
    type: ValidationIssueType;
    severity: 'error' | 'warning' | 'info';
    message: string;
    affectedSkills: string[];
    suggestion?: string;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    dependencyChain: string[];
    maxDepth: number;
    totalDependencies: number;
}

// ============================================================================
// DependencyValidator Class
// ============================================================================

export class DependencyValidator {
    private maxDepth: number;
    private skillLookup: (skillId: string) => GeneratedSkill['manifest'] | null;
    private toolExists: (toolId: string) => boolean;

    constructor(
        skillLookup: (skillId: string) => GeneratedSkill['manifest'] | null,
        toolExists: (toolId: string) => boolean,
        maxDepth: number = 5
    ) {
        this.skillLookup = skillLookup;
        this.toolExists = toolExists;
        this.maxDepth = maxDepth;
    }

    // ========================================================================
    // Main Validation
    // ========================================================================

    /**
     * Validate all dependencies for a skill
     */
    validate(skillId: string): ValidationResult {
        const issues: ValidationIssue[] = [];
        const visited = new Set<string>();
        const dependencyChain: string[] = [];
        let maxDepth = 0;
        let totalDependencies = 0;

        // Helper to track depth
        const validateRecursive = (
            currentSkillId: string,
            depth: number,
            path: string[]
        ): void => {
            // Update max depth
            if (depth > maxDepth) {
                maxDepth = depth;
            }

            // Check depth limit
            if (depth > this.maxDepth) {
                issues.push({
                    type: 'excessive_depth',
                    severity: 'warning',
                    message: `Dependency chain exceeds maximum depth of ${this.maxDepth}`,
                    affectedSkills: path,
                    suggestion: 'Consider flattening the dependency structure',
                });
                return;
            }

            // Check for circular dependency
            if (visited.has(currentSkillId)) {
                const cycleStart = path.indexOf(currentSkillId);
                const cycle = [...path.slice(cycleStart), currentSkillId];
                issues.push({
                    type: 'circular_dependency',
                    severity: 'error',
                    message: `Circular dependency detected: ${cycle.join(' → ')}`,
                    affectedSkills: cycle,
                    suggestion: 'Break the circular dependency by refactoring one of the skills',
                });
                return;
            }

            // Mark as visited
            visited.add(currentSkillId);
            const currentPath = [...path, currentSkillId];

            // Get skill manifest
            const manifest = this.skillLookup(currentSkillId);
            if (!manifest) {
                issues.push({
                    type: 'missing_skill',
                    severity: 'error',
                    message: `Skill '${currentSkillId}' not found`,
                    affectedSkills: [currentSkillId],
                    suggestion: 'Install the missing skill or remove the dependency',
                });
                return;
            }

            // Validate tool dependencies
            if (manifest.requires?.tools) {
                for (const toolId of manifest.requires.tools) {
                    totalDependencies++;
                    if (!this.toolExists(toolId)) {
                        issues.push({
                            type: 'missing_tool',
                            severity: 'error',
                            message: `Tool '${toolId}' required by '${currentSkillId}' is not available`,
                            affectedSkills: currentPath,
                            suggestion: `Ensure the tool '${toolId}' is registered`,
                        });
                    }
                }
            }

            // Validate skill dependencies recursively
            if (manifest.requires?.skills) {
                for (const depSkillId of manifest.requires.skills) {
                    totalDependencies++;
                    validateRecursive(depSkillId, depth + 1, currentPath);
                }
            }

            // Update dependency chain
            if (currentPath.length > dependencyChain.length) {
                dependencyChain.length = 0;
                dependencyChain.push(...currentPath);
            }
        };

        // Start validation
        validateRecursive(skillId, 0, []);

        return {
            valid: issues.filter(i => i.severity === 'error').length === 0,
            issues,
            dependencyChain,
            maxDepth,
            totalDependencies,
        };
    }

    // ========================================================================
    // Specific Validations
    // ========================================================================

    /**
     * Check if there are any circular dependencies
     */
    hasCircularDependencies(skillId: string): {
        hasCircular: boolean;
        cycles: string[][];
    } {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const detectCycle = (currentSkillId: string, path: string[]): void => {
            if (recursionStack.has(currentSkillId)) {
                // Found a cycle
                const cycleStart = path.indexOf(currentSkillId);
                const cycle = [...path.slice(cycleStart), currentSkillId];
                cycles.push(cycle);
                return;
            }

            if (visited.has(currentSkillId)) {
                return;
            }

            visited.add(currentSkillId);
            recursionStack.add(currentSkillId);

            const manifest = this.skillLookup(currentSkillId);
            if (manifest?.requires?.skills) {
                for (const depSkillId of manifest.requires.skills) {
                    detectCycle(depSkillId, [...path, currentSkillId]);
                }
            }

            recursionStack.delete(currentSkillId);
        };

        detectCycle(skillId, []);

        return {
            hasCircular: cycles.length > 0,
            cycles,
        };
    }

    /**
     * Find all missing dependencies
     */
    findMissingDependencies(skillId: string): {
        missingTools: string[];
        missingSkills: string[];
    } {
        const missingTools = new Set<string>();
        const missingSkills = new Set<string>();
        const visited = new Set<string>();

        const traverse = (currentSkillId: string): void => {
            if (visited.has(currentSkillId)) return;
            visited.add(currentSkillId);

            const manifest = this.skillLookup(currentSkillId);
            if (!manifest) {
                missingSkills.add(currentSkillId);
                return;
            }

            // Check tools
            if (manifest.requires?.tools) {
                for (const toolId of manifest.requires.tools) {
                    if (!this.toolExists(toolId)) {
                        missingTools.add(toolId);
                    }
                }
            }

            // Check skills
            if (manifest.requires?.skills) {
                for (const depSkillId of manifest.requires.skills) {
                    if (!this.skillLookup(depSkillId)) {
                        missingSkills.add(depSkillId);
                    } else {
                        traverse(depSkillId);
                    }
                }
            }
        };

        traverse(skillId);

        return {
            missingTools: [...missingTools],
            missingSkills: [...missingSkills],
        };
    }

    /**
     * Calculate dependency metrics
     */
    calculateMetrics(skillId: string): {
        directDependencies: number;
        totalDependencies: number;
        maxDepth: number;
        fanOut: number;  // Average number of dependencies per skill
        complexity: number;  // Overall complexity score
    } {
        let directDeps = 0;
        let totalDeps = 0;
        let maxDepth = 0;
        const skillDepCounts: number[] = [];
        const visited = new Set<string>();

        const traverse = (currentSkillId: string, depth: number, isRoot: boolean): void => {
            if (visited.has(currentSkillId)) return;
            visited.add(currentSkillId);

            if (depth > maxDepth) {
                maxDepth = depth;
            }

            const manifest = this.skillLookup(currentSkillId);
            if (!manifest) return;

            const depCount =
                (manifest.requires?.tools?.length || 0) +
                (manifest.requires?.skills?.length || 0);

            if (isRoot) {
                directDeps = depCount;
            }

            if (depCount > 0) {
                skillDepCounts.push(depCount);
                totalDeps += depCount;
            }

            // Traverse skill dependencies
            if (manifest.requires?.skills) {
                for (const depSkillId of manifest.requires.skills) {
                    traverse(depSkillId, depth + 1, false);
                }
            }
        };

        traverse(skillId, 0, true);

        const fanOut = skillDepCounts.length > 0
            ? skillDepCounts.reduce((a, b) => a + b, 0) / skillDepCounts.length
            : 0;

        // Complexity score: weighted combination of metrics
        const complexity = (
            totalDeps * 1.0 +
            maxDepth * 2.0 +
            fanOut * 1.5
        );

        return {
            directDependencies: directDeps,
            totalDependencies: totalDeps,
            maxDepth,
            fanOut: Math.round(fanOut * 10) / 10,
            complexity: Math.round(complexity * 10) / 10,
        };
    }

    // ========================================================================
    // Validation Reports
    // ========================================================================

    /**
     * Generate a human-readable validation report
     */
    generateReport(skillId: string): string {
        const result = this.validate(skillId);
        const metrics = this.calculateMetrics(skillId);
        const lines: string[] = [];

        lines.push(`# Dependency Validation Report: ${skillId}`);
        lines.push('');

        // Overall status
        if (result.valid) {
            lines.push('✓ **Status**: VALID');
        } else {
            lines.push('✗ **Status**: INVALID');
        }
        lines.push('');

        // Metrics
        lines.push('## Metrics');
        lines.push('');
        lines.push(`- Direct Dependencies: ${metrics.directDependencies}`);
        lines.push(`- Total Dependencies: ${metrics.totalDependencies}`);
        lines.push(`- Max Depth: ${metrics.maxDepth}`);
        lines.push(`- Average Fan-out: ${metrics.fanOut}`);
        lines.push(`- Complexity Score: ${metrics.complexity}`);
        lines.push('');

        // Dependency chain
        if (result.dependencyChain.length > 0) {
            lines.push('## Longest Dependency Chain');
            lines.push('');
            lines.push('```');
            lines.push(result.dependencyChain.join(' → '));
            lines.push('```');
            lines.push('');
        }

        // Issues
        if (result.issues.length > 0) {
            lines.push('## Issues');
            lines.push('');

            const errors = result.issues.filter(i => i.severity === 'error');
            const warnings = result.issues.filter(i => i.severity === 'warning');
            const infos = result.issues.filter(i => i.severity === 'info');

            if (errors.length > 0) {
                lines.push('### Errors');
                lines.push('');
                for (const issue of errors) {
                    lines.push(`- **${issue.type}**: ${issue.message}`);
                    if (issue.suggestion) {
                        lines.push(`  - *Suggestion*: ${issue.suggestion}`);
                    }
                }
                lines.push('');
            }

            if (warnings.length > 0) {
                lines.push('### Warnings');
                lines.push('');
                for (const issue of warnings) {
                    lines.push(`- **${issue.type}**: ${issue.message}`);
                    if (issue.suggestion) {
                        lines.push(`  - *Suggestion*: ${issue.suggestion}`);
                    }
                }
                lines.push('');
            }

            if (infos.length > 0) {
                lines.push('### Info');
                lines.push('');
                for (const issue of infos) {
                    lines.push(`- **${issue.type}**: ${issue.message}`);
                }
                lines.push('');
            }
        } else {
            lines.push('## Issues');
            lines.push('');
            lines.push('No issues found.');
            lines.push('');
        }

        return lines.join('\n');
    }

    // ========================================================================
    // Batch Validation
    // ========================================================================

    /**
     * Validate multiple skills at once
     */
    validateBatch(skillIds: string[]): Map<string, ValidationResult> {
        const results = new Map<string, ValidationResult>();

        for (const skillId of skillIds) {
            results.set(skillId, this.validate(skillId));
        }

        return results;
    }

    /**
     * Find all skills with validation issues
     */
    findProblematicSkills(skillIds: string[]): Array<{
        skillId: string;
        errorCount: number;
        warningCount: number;
        issues: ValidationIssue[];
    }> {
        const problematic: Array<{
            skillId: string;
            errorCount: number;
            warningCount: number;
            issues: ValidationIssue[];
        }> = [];

        for (const skillId of skillIds) {
            const result = this.validate(skillId);
            const errorCount = result.issues.filter(i => i.severity === 'error').length;
            const warningCount = result.issues.filter(i => i.severity === 'warning').length;

            if (errorCount > 0 || warningCount > 0) {
                problematic.push({
                    skillId,
                    errorCount,
                    warningCount,
                    issues: result.issues,
                });
            }
        }

        return problematic.sort((a, b) => b.errorCount - a.errorCount);
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createDependencyValidator(
    skillLookup: (skillId: string) => GeneratedSkill['manifest'] | null,
    toolExists: (toolId: string) => boolean,
    maxDepth?: number
): DependencyValidator {
    return new DependencyValidator(skillLookup, toolExists, maxDepth);
}
