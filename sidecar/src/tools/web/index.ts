/**
 * Web Tools
 *
 * Browser automation, web search, content crawling
 */

import { ToolDefinition } from '../standard';

// Re-export browser tools
export { BROWSER_TOOLS } from '../browser';

// Re-export web search (from builtin.ts)
// Note: crawlUrlTool, extractContentTool, searchDocsTool are in builtin.ts
// We'll create proper web module structure later

export const WEB_TOOLS: ToolDefinition[] = [
    // Browser automation tools are exported separately via BROWSER_TOOLS
    // Web search and crawl tools will be properly organized in future refactor
];
