
import {
    type HandlerContext,
    type HandlerResult,
} from './identity_security';
import { ReloadToolsCommand, ReloadToolsResponse } from '../protocol';
import { globalToolRegistry } from '../tools/registry';
import { SkillStore } from '../storage';
import { BUILTIN_TOOLS, BROWSER_TOOLS } from '../tools/builtin';
import { STANDARD_TOOLS } from '../tools/standard';
import { CODE_EXECUTION_TOOLS } from '../tools/codeExecution';
import { KNOWLEDGE_TOOLS } from '../agent/knowledgeUpdater';
import type { ToolDefinition } from '../tools/standard';
import { webSearchTool } from '../tools/websearch';
import { STUB_TOOLS } from '../tools/stubs';

export function handleReloadTools(
    command: ReloadToolsCommand,
    ctx: HandlerContext,
    deps: {
        skillStore: SkillStore;
        enhancedBrowserTools?: ToolDefinition[];
        selfLearningTools?: ToolDefinition[];
        databaseTools?: ToolDefinition[];
        generatedRuntimeTools?: ToolDefinition[];
    }
): HandlerResult<ReloadToolsResponse> {
    console.log('[ReloadTools] processing reload request...');

    try {
        // 1. Clear Tool Registry
        globalToolRegistry.reload();

        // 2. Clear Require Cache for builtin tools to pick up code changes
        // This is tricky in ESM/Bun/Ts-Node, but we can try removing from require.cache if running in Node
        if (typeof require !== 'undefined' && require.cache) {
            Object.keys(require.cache).forEach(key => {
                if (key.includes('builtin.ts') || key.includes('src/tools/')) {
                    console.log(`[ReloadTools] Clearing cache for: ${key}`);
                    delete require.cache[key];
                }
            });
        }

        // 3. Re-import builtin tools (dynamic import might be needed or just re-registering if cache cleared)
        // In a real hot-reload scenario, we'd need to re-import the module.
        // For now, let's assume the Registry reload + re-register will at least reset state.
        // To truly reload code, we might need a more aggressive strategy or a process restart helper.
        // However, invalidating cache and re-registering BUILTIN_TOOLS is a start.

        // Re-register all tools (same as main.ts initialization)
        globalToolRegistry.register('builtin', STANDARD_TOOLS);
        globalToolRegistry.register('builtin', [webSearchTool]);
        globalToolRegistry.register('builtin', BUILTIN_TOOLS);
        globalToolRegistry.register('builtin', CODE_EXECUTION_TOOLS);
        globalToolRegistry.register('builtin', KNOWLEDGE_TOOLS);
        globalToolRegistry.register('builtin', deps.databaseTools || []);
        globalToolRegistry.register('builtin', deps.enhancedBrowserTools || BROWSER_TOOLS);
        globalToolRegistry.register('builtin', deps.selfLearningTools || []);
        globalToolRegistry.register('builtin', deps.generatedRuntimeTools || []);
        globalToolRegistry.register('stub', STUB_TOOLS);

        // 4. Reload Skills
        deps.skillStore.reload();

        // 5. Get counts
        const toolCount = globalToolRegistry.getAllTools().length;
        const skillCount = deps.skillStore.list().length;

        const response: ReloadToolsResponse = {
            commandId: command.id,
            timestamp: new Date().toISOString(),
            type: 'reload_tools_response',
            payload: {
                success: true,
                toolCount,
                skillCount
            }
        };

        return {
            response,
            events: []
        };

    } catch (error) {
        console.error('[ReloadTools] Failed:', error);
        return {
            response: {
                commandId: command.id,
                timestamp: new Date().toISOString(),
                type: 'reload_tools_response',
                payload: {
                    success: false,
                    toolCount: 0,
                    skillCount: 0,
                    error: String(error)
                }
            },
            events: []
        };
    }
}
