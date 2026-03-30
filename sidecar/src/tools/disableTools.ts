type NamedTool = {
    name?: unknown;
};

export function applyDisabledToolFilter<T extends NamedTool>(
    tools: T[],
    disabledTools?: string[],
): T[] {
    if (!Array.isArray(disabledTools) || disabledTools.length === 0) {
        return tools;
    }

    const blocked = new Set(
        disabledTools
            .filter((toolName): toolName is string => typeof toolName === 'string')
            .map((toolName) => toolName.trim())
            .filter((toolName) => toolName.length > 0),
    );

    if (blocked.size === 0) {
        return tools;
    }

    return tools.filter((tool) => {
        const toolName = typeof tool?.name === 'string' ? tool.name : '';
        return !blocked.has(toolName);
    });
}
