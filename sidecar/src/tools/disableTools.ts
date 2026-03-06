import type { ToolDefinition } from './standard';

/**
 * Remove disabled tools by exact tool name.
 */
export function applyDisabledToolFilter(
    tools: ToolDefinition[],
    disabledTools?: string[]
): ToolDefinition[] {
    if (!disabledTools || disabledTools.length === 0) {
        return tools;
    }

    const disabledSet = new Set(disabledTools.filter(Boolean));
    return tools.filter((tool) => !disabledSet.has(tool.name));
}
