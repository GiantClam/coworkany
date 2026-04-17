import * as path from 'path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import { STANDARD_TOOLS } from '../../tools/standard';

type StandardToolContext = {
    workspacePath: string;
    taskId: string;
};

function resolveWorkspacePath(workspacePath?: string): string {
    if (typeof workspacePath === 'string' && workspacePath.trim().length > 0) {
        return path.resolve(workspacePath.trim());
    }
    return process.cwd();
}

function findStandardTool(name: string) {
    return STANDARD_TOOLS.find((tool) => tool.name === name);
}

const rememberStandardTool = findStandardTool('remember');
const recallStandardTool = findStandardTool('recall');

export const rememberTool = createTool({
    id: 'remember',
    description: 'Persist a memory fact or preference for later recall.',
    inputSchema: z.object({
        key: z.string().optional(),
        value: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
        content: z.string().optional(),
        category: z.string().optional(),
        workspace_path: z.string().optional(),
    }),
    outputSchema: z.object({
        success: z.boolean().optional(),
        key: z.string().optional(),
        value: z.string().optional(),
        category: z.string().optional(),
        timestamp: z.string().optional(),
        total: z.number().optional(),
        error: z.string().optional(),
    }),
    execute: async (input) => {
        if (!rememberStandardTool) {
            return { error: 'remember_tool_unavailable' };
        }
        const context: StandardToolContext = {
            workspacePath: resolveWorkspacePath(input.workspace_path),
            taskId: 'mastra-memory-remember',
        };
        return await rememberStandardTool.handler({
            key: input.key,
            value: input.value,
            content: input.content,
            category: input.category,
        }, context);
    },
});

export const recallTool = createTool({
    id: 'recall',
    description: 'Recall previously remembered facts or preferences.',
    inputSchema: z.object({
        key: z.string().optional(),
        query: z.string().optional(),
        limit: z.union([
            z.number().int().min(1).max(100),
            z.string().trim().regex(/^\d+$/u),
        ]).optional(),
        workspace_path: z.string().optional(),
    }),
    outputSchema: z.object({
        success: z.boolean().optional(),
        count: z.number().optional(),
        items: z.array(z.object({
            key: z.string(),
            value: z.string(),
            category: z.string().optional(),
            timestamp: z.string(),
        })).optional(),
        error: z.string().optional(),
    }),
    execute: async (input) => {
        if (!recallStandardTool) {
            return { error: 'recall_tool_unavailable' };
        }
        const normalizedLimit = (() => {
            if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
                return Math.floor(input.limit);
            }
            if (typeof input.limit === 'string') {
                const parsed = Number.parseInt(input.limit, 10);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }
            return undefined;
        })();
        const context: StandardToolContext = {
            workspacePath: resolveWorkspacePath(input.workspace_path),
            taskId: 'mastra-memory-recall',
        };
        return await recallStandardTool.handler({
            key: input.key,
            query: input.query,
            limit: normalizedLimit,
        }, context);
    },
});
