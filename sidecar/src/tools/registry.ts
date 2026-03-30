import { ToolDefinition } from './standard';
export type ToolSource = 'mcp' | 'builtin' | 'stub';
export interface RegisteredTool {
    source: ToolSource;
    priority: number;  // Lower = higher priority
    definition: ToolDefinition;
}
export interface ToolFilter {
    enabledToolpacks?: string[];
    allowedEffects?: string[];
    excludeNames?: string[];
}
export class ToolRegistry {
    private tools: Map<string, RegisteredTool[]> = new Map();
    private static PRIORITY_MAP: Record<ToolSource, number> = {
        'mcp': 1,
        'builtin': 2,
        'stub': 3,
    };
    register(source: ToolSource, tools: ToolDefinition[]): void {
        const priority = ToolRegistry.PRIORITY_MAP[source];
        for (const tool of tools) {
            const existing = this.tools.get(tool.name) || [];
            existing.push({ source, priority, definition: tool });
            existing.sort((a, b) => a.priority - b.priority);
            this.tools.set(tool.name, existing);
        }
    }
    unregisterBySource(source: ToolSource, toolNames?: string[]): void {
        if (toolNames) {
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
    getTool(name: string): ToolDefinition | undefined {
        const registered = this.tools.get(name);
        return registered?.[0]?.definition;  // First item has highest priority
    }
    hasTool(name: string): boolean {
        return this.tools.has(name) && this.tools.get(name)!.length > 0;
    }
    getAllTools(): ToolDefinition[] {
        const result: ToolDefinition[] = [];
        for (const registered of this.tools.values()) {
            if (registered.length > 0) {
                result.push(registered[0].definition);
            }
        }
        return result;
    }
    getFiltered(filter: ToolFilter): ToolDefinition[] {
        let result = this.getAllTools();
        if (filter.excludeNames && filter.excludeNames.length > 0) {
            result = result.filter(tool => !filter.excludeNames!.includes(tool.name));
        }
        if (filter.allowedEffects && filter.allowedEffects.length > 0) {
            result = result.filter(tool => {
                return tool.effects.length === 0 ||
                    tool.effects.some(effect => filter.allowedEffects!.includes(effect));
            });
        }
        return result;
    }
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
    clear(): void {
        this.tools.clear();
    }
    reload(): void {
        console.log('[ToolRegistry] Clearing registry for reload...');
        this.clear();
    }
}
export const globalToolRegistry = new ToolRegistry();
