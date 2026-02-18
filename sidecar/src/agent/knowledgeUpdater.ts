/**
 * CoworkAny - Knowledge Updater
 *
 * Provides tools for AI-driven active knowledge management.
 * Implements OpenClaw-style "Memory Writing" capability.
 */

import type { ToolDefinition, ToolContext, ToolEffect } from '../tools/standard';
import { getVaultManager, getRagBridge, VaultManager } from '../memory';

// ============================================================================
// Types
// ============================================================================

export type KnowledgeCategory =
    | 'solutions'
    | 'patterns'
    | 'errors'
    | 'preferences'
    | 'facts'
    | 'learnings'
    | 'projects';

export interface KnowledgeEntry {
    id: string;
    title: string;
    content: string;
    category: KnowledgeCategory;
    tags: string[];
    confidence: number;
    source: string;
    createdAt: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
}

export interface ErrorSolution {
    errorType: string;
    errorPattern: string;
    solution: string;
    context: string;
    successCount: number;
    lastUsed: string;
}

export interface SuccessPattern {
    name: string;
    description: string;
    steps: string[];
    applicableTo: string[];
    successCount: number;
}

export interface LearningExtraction {
    facts: Array<{
        content: string;
        category: KnowledgeCategory;
        confidence: number;
        tags?: string[];
    }>;
    shouldSave: boolean;
    summary?: string;
}

// ============================================================================
// Category Mapping
// ============================================================================

const CATEGORY_TO_VAULT_PATH: Record<KnowledgeCategory, string> = {
    solutions: 'learnings/solutions',
    patterns: 'learnings/patterns',
    errors: 'learnings/errors',
    preferences: 'preferences',
    facts: 'learnings/facts',
    learnings: 'learnings',
    projects: 'projects',
};

// ============================================================================
// Knowledge Updater Class
// ============================================================================

export class KnowledgeUpdater {
    private vaultManager: VaultManager;

    constructor(vaultManager?: VaultManager) {
        this.vaultManager = vaultManager || getVaultManager();
    }

    /**
     * Save a new knowledge entry
     */
    async saveKnowledge(entry: Omit<KnowledgeEntry, 'id' | 'createdAt'>): Promise<{
        success: boolean;
        path?: string;
        error?: string;
    }> {
        try {
            const categoryPath = CATEGORY_TO_VAULT_PATH[entry.category] || 'learnings';
            const filename = this.sanitizeFilename(entry.title);
            const relativePath = `${categoryPath}/${filename}.md`;

            // Format content as markdown
            const markdown = this.formatAsMarkdown(entry);

            // Save to vault
            await this.vaultManager.writeDocument(relativePath, markdown);

            // Try to index in RAG
            try {
                const ragBridge = getRagBridge();
                if (await ragBridge.isAvailable()) {
                    await ragBridge.indexDocument({
                        path: relativePath,
                        content: entry.content,
                        metadata: {
                            title: entry.title,
                            category: entry.category,
                            tags: entry.tags,
                            confidence: entry.confidence,
                            source: entry.source,
                            ...entry.metadata,
                        },
                    });
                }
            } catch (ragError) {
                console.warn('[KnowledgeUpdater] RAG indexing failed:', ragError);
                // Continue even if RAG fails
            }

            return { success: true, path: relativePath };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Save an error-solution pair
     */
    async saveErrorSolution(errorSolution: ErrorSolution): Promise<{
        success: boolean;
        path?: string;
        error?: string;
    }> {
        const content = `## Error Pattern
\`\`\`
${errorSolution.errorPattern}
\`\`\`

## Error Type
${errorSolution.errorType}

## Solution
${errorSolution.solution}

## Context
${errorSolution.context}

## Statistics
- Success Count: ${errorSolution.successCount}
- Last Used: ${errorSolution.lastUsed}
`;

        return this.saveKnowledge({
            title: `Solution: ${errorSolution.errorType}`,
            content,
            category: 'solutions',
            tags: ['error-solution', 'auto-extracted', errorSolution.errorType],
            confidence: Math.min(0.5 + errorSolution.successCount * 0.1, 0.95),
            source: 'self-correction',
            metadata: {
                errorType: errorSolution.errorType,
                successCount: errorSolution.successCount,
            },
        });
    }

    /**
     * Save a success pattern
     */
    async saveSuccessPattern(pattern: SuccessPattern): Promise<{
        success: boolean;
        path?: string;
        error?: string;
    }> {
        const content = `## Description
${pattern.description}

## Steps
${pattern.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

## Applicable To
${pattern.applicableTo.map((item) => `- ${item}`).join('\n')}

## Statistics
- Success Count: ${pattern.successCount}
`;

        return this.saveKnowledge({
            title: `Pattern: ${pattern.name}`,
            content,
            category: 'patterns',
            tags: ['success-pattern', 'auto-extracted', ...pattern.applicableTo],
            confidence: Math.min(0.5 + pattern.successCount * 0.1, 0.95),
            source: 'autonomous-agent',
            metadata: {
                successCount: pattern.successCount,
            },
        });
    }

    /**
     * Search for similar knowledge entries
     */
    async searchSimilar(query: string, category?: KnowledgeCategory): Promise<{
        results: Array<{
            path: string;
            title: string;
            content?: string;
            score: number;
        }>;
        error?: string;
    }> {
        try {
            const ragBridge = getRagBridge();
            if (!(await ragBridge.isAvailable())) {
                // Fallback to vault search (returns SearchResponse)
                const vaultResponse = await this.vaultManager.search(query, 5);
                return {
                    results: vaultResponse.results.map((r) => ({
                        path: r.path,
                        title: r.title,
                        content: r.content,
                        score: r.score,
                    })),
                };
            }

            const response = await ragBridge.search({
                query,
                topK: 5,
                filterCategory: category,
                includeContent: true,
            });

            return {
                results: response.results.map((r) => ({
                    path: r.path,
                    title: r.title,
                    content: r.content,
                    score: r.score,
                })),
            };
        } catch (error) {
            return {
                results: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Format entry as markdown document
     */
    private formatAsMarkdown(
        entry: Omit<KnowledgeEntry, 'id' | 'createdAt'>
    ): string {
        const frontmatter = [
            '---',
            `title: "${entry.title}"`,
            `category: ${entry.category}`,
            `tags: [${entry.tags.map((t) => `"${t}"`).join(', ')}]`,
            `confidence: ${entry.confidence}`,
            `source: ${entry.source}`,
            `created: ${new Date().toISOString()}`,
            '---',
            '',
        ];

        return frontmatter.join('\n') + entry.content;
    }

    /**
     * Sanitize filename for safe storage
     */
    private sanitizeFilename(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 50);
    }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Tool for AI to actively update knowledge base
 */
export const updateKnowledgeTool: ToolDefinition = {
    name: 'update_knowledge',
    description: `Save useful discoveries, solutions, or patterns to the knowledge base for future reference.
Use this when you:
- Solve a problem that might recur
- Discover a useful pattern or approach
- Learn user preferences
- Find important facts about the project

The knowledge will be searchable in future conversations.`,
    effects: ['state:remember', 'filesystem:write'] as ToolEffect[],
    input_schema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'A descriptive title for this knowledge entry',
            },
            content: {
                type: 'string',
                description: 'The knowledge content in markdown format',
            },
            category: {
                type: 'string',
                enum: ['solutions', 'patterns', 'errors', 'preferences', 'facts'],
                description:
                    'Category of knowledge: solutions (error fixes), patterns (successful approaches), errors (common problems), preferences (user preferences), facts (project information)',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for easier searching (e.g., ["python", "pandas", "csv"])',
            },
            confidence: {
                type: 'number',
                description:
                    'Confidence level 0.0-1.0 (how sure you are this is correct/useful)',
            },
            source: {
                type: 'string',
                description: 'Where this knowledge came from (e.g., "user-request", "error-resolution", "observation")',
            },
        },
        required: ['title', 'content', 'category'],
    },
    handler: async (
        args: {
            title: string;
            content: string;
            category: KnowledgeCategory;
            tags?: string[];
            confidence?: number;
            source?: string;
        },
        context: ToolContext
    ) => {
        const updater = new KnowledgeUpdater();
        const result = await updater.saveKnowledge({
            title: args.title,
            content: args.content,
            category: args.category,
            tags: args.tags || [],
            confidence: args.confidence || 0.7,
            source: args.source || 'ai-agent',
        });

        if (result.success) {
            return `Knowledge saved successfully to: ${result.path}\n\nThis information will be available for future reference.`;
        } else {
            return `Failed to save knowledge: ${result.error}`;
        }
    },
};

/**
 * Tool for AI to extract and save learnings from completed tasks
 */
export const learnFromTaskTool: ToolDefinition = {
    name: 'learn_from_task',
    description: `Analyze a completed task and extract learnings to remember.
Call this after successfully completing a complex task to save:
- Solutions that worked
- Patterns that were effective
- Any errors encountered and how they were resolved

This helps improve future performance on similar tasks.`,
    effects: ['state:remember', 'filesystem:write'] as ToolEffect[],
    input_schema: {
        type: 'object',
        properties: {
            task_description: {
                type: 'string',
                description: 'Brief description of the completed task',
            },
            outcome: {
                type: 'string',
                enum: ['success', 'partial', 'failure'],
                description: 'How the task ended',
            },
            learnings: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['solution', 'pattern', 'error', 'preference'],
                        },
                        title: { type: 'string' },
                        content: { type: 'string' },
                        confidence: { type: 'number' },
                    },
                    required: ['type', 'title', 'content'],
                },
                description: 'List of learnings to save',
            },
            summary: {
                type: 'string',
                description: 'Overall summary of what was learned',
            },
        },
        required: ['task_description', 'outcome', 'learnings'],
    },
    handler: async (
        args: {
            task_description: string;
            outcome: 'success' | 'partial' | 'failure';
            learnings: Array<{
                type: 'solution' | 'pattern' | 'error' | 'preference';
                title: string;
                content: string;
                confidence?: number;
            }>;
            summary?: string;
        },
        context: ToolContext
    ) => {
        const updater = new KnowledgeUpdater();
        const results: string[] = [];

        for (const learning of args.learnings) {
            const categoryMap: Record<string, KnowledgeCategory> = {
                solution: 'solutions',
                pattern: 'patterns',
                error: 'errors',
                preference: 'preferences',
            };

            const result = await updater.saveKnowledge({
                title: learning.title,
                content: `## Task Context\n${args.task_description}\n\n## Outcome\n${args.outcome}\n\n## Learning\n${learning.content}`,
                category: categoryMap[learning.type],
                tags: ['task-learning', `outcome:${args.outcome}`, learning.type],
                confidence: learning.confidence || (args.outcome === 'success' ? 0.8 : 0.6),
                source: 'learn-from-task',
            });

            if (result.success) {
                results.push(`✓ Saved: ${learning.title}`);
            } else {
                results.push(`✗ Failed: ${learning.title} - ${result.error}`);
            }
        }

        let output = `Extracted ${args.learnings.length} learnings from task:\n`;
        output += results.join('\n');

        if (args.summary) {
            output += `\n\nSummary: ${args.summary}`;
        }

        return output;
    },
};

/**
 * Tool to search the knowledge base before attempting a task
 */
export const searchKnowledgeTool: ToolDefinition = {
    name: 'search_knowledge',
    description: `Search the knowledge base for relevant information before attempting a task.
Use this to:
- Find solutions to similar problems
- Check for known patterns
- Look up user preferences
- Retrieve project-specific information

This helps avoid repeating past mistakes and leverage previous learnings.`,
    effects: [] as ToolEffect[], // Read-only
    input_schema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What to search for',
            },
            category: {
                type: 'string',
                enum: ['solutions', 'patterns', 'errors', 'preferences', 'facts', 'all'],
                description: 'Limit search to specific category (optional)',
            },
            max_results: {
                type: 'integer',
                description: 'Maximum number of results (default: 5)',
            },
        },
        required: ['query'],
    },
    handler: async (
        args: {
            query: string;
            category?: KnowledgeCategory | 'all';
            max_results?: number;
        },
        context: ToolContext
    ) => {
        const updater = new KnowledgeUpdater();
        const category = args.category === 'all' ? undefined : args.category;

        const { results, error } = await updater.searchSimilar(args.query, category);

        if (error) {
            return `Search failed: ${error}`;
        }

        if (results.length === 0) {
            return 'No relevant knowledge found. This might be a new type of task.';
        }

        let output = `Found ${results.length} relevant knowledge entries:\n\n`;

        const maxResults = args.max_results || 5;
        for (let i = 0; i < Math.min(results.length, maxResults); i++) {
            const result = results[i];
            output += `### ${i + 1}. ${result.title}\n`;
            output += `Path: ${result.path}\n`;
            output += `Relevance: ${(result.score * 100).toFixed(0)}%\n`;
            if (result.content) {
                output += `Preview: ${result.content.slice(0, 200)}...\n`;
            }
            output += '\n';
        }

        return output;
    },
};

// ============================================================================
// Export
// ============================================================================

export const KNOWLEDGE_TOOLS: ToolDefinition[] = [
    updateKnowledgeTool,
    learnFromTaskTool,
    searchKnowledgeTool,
];

// Singleton
let globalUpdater: KnowledgeUpdater | null = null;

export function getKnowledgeUpdater(): KnowledgeUpdater {
    if (!globalUpdater) {
        globalUpdater = new KnowledgeUpdater();
    }
    return globalUpdater;
}

export default KnowledgeUpdater;
