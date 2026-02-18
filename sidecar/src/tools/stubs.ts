/**
 * Stub Tool Definitions
 *
 * These stubs are DEPRECATED and kept only for backward compatibility.
 * All tools now have real implementations in builtin.ts.
 *
 * If you see these stubs being used, it means the builtin tools
 * were not properly registered.
 */

import { ToolDefinition } from './standard';

// Helper to create stub handler that indicates the tool should have real implementation
const createStubHandler = (toolName: string, _mcpName: string) => async () => {
    console.warn(`[STUB WARNING] Tool '${toolName}' is using stub handler. The builtin implementation should be used instead.`);
    return {
        error: `Tool '${toolName}' stub called. This shouldn't happen - builtin implementation should be registered. Check tool registration in main.ts.`,
        suggestion: 'Ensure BUILTIN_TOOLS is properly imported and registered.',
    };
};

/**
 * Context7 Stubs (Documentation Search)
 * Note: search_docs and get_doc_page are now implemented in builtin.ts
 */
export const context7Stubs: ToolDefinition[] = [
    {
        name: 'search_docs_stub',
        description: '[STUB] Search documentation - use search_docs instead.',
        effects: ['network:outbound'],
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                library: { type: 'string' },
            },
            required: ['query'],
        },
        handler: createStubHandler('search_docs', 'context7'),
    },
];

/**
 * All Stubs Combined
 *
 * NOTE: This array should be empty or contain only truly optional stubs.
 * All core tools (memory, github, webcrawl, thinking, docs) are now
 * implemented as builtins in builtin.ts.
 */
export const STUB_TOOLS: ToolDefinition[] = [
    // Stubs are deprecated - all tools have real implementations now
    // Keeping this array for backward compatibility with any code that references it
];
