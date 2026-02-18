/**
 * Coding Tools
 *
 * Programming-specific tools - code quality, execution, GitHub integration
 */

import { ToolDefinition } from '../standard';

// Re-export code quality tools
export { CODE_QUALITY_TOOLS } from '../codeQuality';

// Re-export GitHub tools (from builtin.ts)
// Note: createIssueTool, createPrTool, listReposTool are in builtin.ts

export const CODING_TOOLS: ToolDefinition[] = [
    // Code quality tools exported separately via CODE_QUALITY_TOOLS
    // Code execution and GitHub tools are in builtin.ts
];
