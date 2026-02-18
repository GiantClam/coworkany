import { ToolDefinition, ToolContext } from '../standard';

/**
 * Quick Note Tool - Integrated with Vault System
 *
 * Saves notes to the memory vault with automatic title generation
 */
export const quickNoteTool: ToolDefinition = {
    name: 'quick_note',
    description: 'Quickly save a note, thought, or idea to the memory vault. Use when user wants to remember or save something.',
    effects: ['filesystem:write', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            content: {
                type: 'string',
                description: 'Note content (supports markdown formatting)',
            },
            title: {
                type: 'string',
                description: 'Optional title (auto-generated from content if omitted)',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags for organization and searchability',
            },
            category: {
                type: 'string',
                enum: ['learnings', 'preferences', 'projects'],
                description: 'Category for organization (default: learnings)',
                default: 'learnings',
            },
        },
        required: ['content'],
    },
    handler: async (
        args: {
            content: string;
            title?: string;
            tags?: string[];
            category?: 'learnings' | 'preferences' | 'projects';
        },
        context: ToolContext
    ) => {
        const { content, title, tags = [], category = 'learnings' } = args;

        try {
            // Auto-generate title if not provided
            const autoTitle = title || generateTitleFromContent(content);

            console.error(`[QuickNote] Saving note: "${autoTitle}"`);

            // Use existing Vault system (from builtin.ts)
            const { getVaultManager } = await import('../../memory');

            const vault = getVaultManager();

            // Add 'quick-note' tag automatically
            const allTags = ['quick-note', ...tags];

            const relativePath = await vault.saveMemory(autoTitle, content, {
                category,
                tags: allTags,
            });

            console.error(`[QuickNote] Note saved to: ${relativePath}`);

            return {
                success: true,
                title: autoTitle,
                path: relativePath,
                category,
                tags: allTags,
                message: `Note saved: "${autoTitle}"`,
                searchable: true,
            };
        } catch (error) {
            console.error('[QuickNote] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                suggestion: 'Make sure the vault directory is accessible',
            };
        }
    },
};

/**
 * Generate title from note content
 */
function generateTitleFromContent(content: string): string {
    // Clean the content
    const cleaned = content.trim();

    // Try to extract from first line
    const firstLine = cleaned.split('\n')[0].trim();

    // Remove markdown heading markers
    const withoutHeadings = firstLine.replace(/^#+\s*/, '');

    // If first line is reasonable length, use it
    if (withoutHeadings.length > 0 && withoutHeadings.length <= 60) {
        return withoutHeadings;
    }

    // Otherwise, truncate first 50 characters
    const truncated = cleaned.slice(0, 50).trim();

    // Try to end at a word boundary
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 30) {
        return truncated.slice(0, lastSpace) + '...';
    }

    return truncated + (cleaned.length > 50 ? '...' : '');
}

/**
 * Extract potential tags from content
 * (Helper function for future enhancement)
 */
function extractTagsFromContent(content: string): string[] {
    const tags: string[] = [];

    // Extract hashtags
    const hashtagRegex = /#(\w+)/g;
    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
        tags.push(match[1].toLowerCase());
    }

    // Extract @mentions (could be used as tags)
    const mentionRegex = /@(\w+)/g;
    while ((match = mentionRegex.exec(content)) !== null) {
        tags.push(`mention-${match[1].toLowerCase()}`);
    }

    // Remove duplicates
    return Array.from(new Set(tags));
}
