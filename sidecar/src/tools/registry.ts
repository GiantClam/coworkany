import { ToolDefinition } from './standard';

/**
 * Tool Source - where the tool came from
 */
export type ToolSource = 'mcp' | 'builtin' | 'stub';

/**
 * Registered Tool Metadata
 */
export interface RegisteredTool {
    source: ToolSource;
    priority: number;  // Lower = higher priority
    definition: ToolDefinition;
}

/**
 * Tool Filter for querying tools
 */
export interface ToolFilter {
    enabledToolpacks?: string[];
    allowedEffects?: string[];
    excludeNames?: string[];
}

/**
 * Centralized Tool Registry
 * Manages tools from all sources with priority-based resolution
 */
export class ToolRegistry {
    private tools: Map<string, RegisteredTool[]> = new Map();

    // Priority order: MCP (1) > Builtin (2) > Stub (3)
    private static PRIORITY_MAP: Record<ToolSource, number> = {
        'mcp': 1,
        'builtin': 2,
        'stub': 3,
    };

    /**
     * Register tools from a specific source
     * Multiple tools with the same name are allowed; priority determines which is used
     */
    register(source: ToolSource, tools: ToolDefinition[]): void {
        const priority = ToolRegistry.PRIORITY_MAP[source];

        for (const tool of tools) {
            const existing = this.tools.get(tool.name) || [];
            existing.push({ source, priority, definition: tool });

            // Sort by priority (ascending - lower number = higher priority)
            existing.sort((a, b) => a.priority - b.priority);

            this.tools.set(tool.name, existing);
        }
    }

    /**
     * Unregister all tools from a specific source
     * Useful for hot-reloading MCP servers
     */
    unregisterBySource(source: ToolSource, toolNames?: string[]): void {
        if (toolNames) {
            // Unregister specific tools
            for (const name of toolNames) {
                const registered = this.tools.get(name);
                if (registered) {
                    const filtered = registered.filter(t => t.source !== source);
                    if (filtered.length > 0) {
                        this.tools.set(name, filtered);
                    } else {
                        this.tools.delete(name);
                    }
                }
            }
        } else {
            // Unregister all tools from this source
            for (const [name, registered] of this.tools.entries()) {
                const filtered = registered.filter(t => t.source !== source);
                if (filtered.length > 0) {
                    this.tools.set(name, filtered);
                } else {
                    this.tools.delete(name);
                }
            }
        }
    }

    /**
     * Get the highest-priority tool by name
     */
    getTool(name: string): ToolDefinition | undefined {
        const registered = this.tools.get(name);
        return registered?.[0]?.definition;  // First item has highest priority
    }

    /**
     * Check if a tool exists by name
     */
    hasTool(name: string): boolean {
        return this.tools.has(name) && this.tools.get(name)!.length > 0;
    }

    /**
     * Get all registered tools (returns highest-priority version of each)
     */
    getAllTools(): ToolDefinition[] {
        const result: ToolDefinition[] = [];
        for (const registered of this.tools.values()) {
            if (registered.length > 0) {
                result.push(registered[0].definition);
            }
        }
        return result;
    }

    /**
     * Get tools filtered by criteria
     * Used by getToolsForTask to filter tools based on enabled toolpacks and permissions
     */
    getFiltered(filter: ToolFilter): ToolDefinition[] {
        let result = this.getAllTools();

        // Filter by excluded names
        if (filter.excludeNames && filter.excludeNames.length > 0) {
            result = result.filter(tool => !filter.excludeNames!.includes(tool.name));
        }

        // Filter by allowed effects (if provided)
        if (filter.allowedEffects && filter.allowedEffects.length > 0) {
            result = result.filter(tool => {
                // Tool must have at least one allowed effect OR have no effects (safe)
                return tool.effects.length === 0 ||
                    tool.effects.some(effect => filter.allowedEffects!.includes(effect));
            });
        }

        return result;
    }

    /**
     * Get debug information about tool registration
     */
    getDebugInfo(toolName?: string): string {
        if (toolName) {
            const registered = this.tools.get(toolName);
            if (!registered) {
                return `Tool '${toolName}' not found`;
            }
            return registered.map(r =>
                `  [${r.source}] priority=${r.priority} effects={${r.definition.effects.join(', ')}}`
            ).join('\n');
        } else {
            const lines: string[] = [];
            for (const [name, registered] of this.tools.entries()) {
                lines.push(`${name}:`);
                for (const r of registered) {
                    lines.push(`  [${r.source}] priority=${r.priority} effects={${r.definition.effects.join(', ')}}`);
                }
            }
            return lines.join('\n');
        }
    }

    /**
     * Clear all registered tools
     * Useful for testing
     */
    clear(): void {
        this.tools.clear();
    }

    /**
     * Reload registry (alias for clear for now, semantic clarity)
     */
    reload(): void {
        console.log('[ToolRegistry] Clearing registry for reload...');
        this.clear();
    }
}

// Singleton instance for global access
export const globalToolRegistry = new ToolRegistry();
