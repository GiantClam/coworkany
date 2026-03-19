import { randomUUID } from 'crypto';
import * as path from 'path';
import type { EffectRequest, EffectType } from '../protocol';
import { isPathInsideWorkspace } from '../system/wellKnownFolders';
import type { ToolDefinition, ToolContext } from './standard';

function resolveTargetPath(workspacePath: string, candidate: unknown): string | undefined {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        return undefined;
    }

    return path.resolve(workspacePath, candidate);
}

function inferEffectType(toolName: string): EffectType | undefined {
    switch (toolName) {
        case 'list_dir':
        case 'view_file':
        case 'compute_file_hash':
            return 'filesystem:read';
        case 'write_to_file':
        case 'replace_file_content':
        case 'create_directory':
        case 'move_file':
        case 'delete_path':
        case 'batch_move_files':
        case 'batch_delete_paths':
            return 'filesystem:write';
        case 'run_command':
            return 'shell:write';
        default:
            return undefined;
    }
}

function buildReasoning(toolName: string, targetPath: string | undefined, workspacePath: string): string {
    if (targetPath && !isPathInsideWorkspace(targetPath, workspacePath)) {
        return `Builtin tool ${toolName} needs access to host path ${targetPath} outside the workspace.`;
    }

    if (toolName === 'run_command') {
        return 'Builtin shell execution requires policy approval before the command runs.';
    }

    if (
        toolName === 'delete_path'
        || toolName === 'batch_delete_paths'
        || toolName === 'write_to_file'
        || toolName === 'replace_file_content'
        || toolName === 'create_directory'
        || toolName === 'move_file'
        || toolName === 'batch_move_files'
    ) {
        return `Builtin tool ${toolName} modifies local files and requires policy approval before execution.`;
    }

    return `Builtin tool ${toolName} requires policy evaluation before execution.`;
}

export function buildBuiltinEffectRequest(input: {
    tool: ToolDefinition;
    args: Record<string, unknown>;
    context: ToolContext;
}): EffectRequest | null {
    const { tool, args, context } = input;
    const effectType = inferEffectType(tool.name);
    if (!effectType) {
        return null;
    }

    const targetPath = resolveTargetPath(context.workspacePath, args.path ?? args.cwd);
    const alternateTargetPath = resolveTargetPath(
        context.workspacePath,
        args.destination_path ?? args.source_path
    );
    const batchTargetPath = Array.isArray(args.moves) && args.moves.length > 0
        ? resolveTargetPath(
            context.workspacePath,
            (args.moves[0] as Record<string, unknown>).destination_path
                ?? (args.moves[0] as Record<string, unknown>).source_path
        )
        : undefined;
    const batchDeleteTargetPath = Array.isArray(args.deletes) && args.deletes.length > 0
        ? resolveTargetPath(
            context.workspacePath,
            (args.deletes[0] as Record<string, unknown>).path
        )
        : undefined;
    const primaryTargetPath = targetPath ?? alternateTargetPath ?? batchTargetPath ?? batchDeleteTargetPath;
    const isOutsideWorkspace = primaryTargetPath
        ? !isPathInsideWorkspace(primaryTargetPath, context.workspacePath)
        : false;
    const needsApproval =
        isOutsideWorkspace
        || effectType === 'shell:write'
        || effectType === 'filesystem:write';

    if (!needsApproval) {
        return null;
    }

    return {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        effectType,
        source: 'agent',
        payload: {
            path: primaryTargetPath,
            operation: effectType.startsWith('filesystem:')
                ? (tool.name === 'list_dir' || tool.name === 'view_file' || tool.name === 'compute_file_hash'
                    ? 'read'
                    : tool.name === 'delete_path' || tool.name === 'batch_delete_paths'
                        ? 'delete'
                        : 'write')
                : undefined,
            command: typeof args.command === 'string' ? args.command : undefined,
            cwd: resolveTargetPath(context.workspacePath, args.cwd),
            description: `Builtin tool call: ${tool.name}`,
        },
        scope: primaryTargetPath
            ? {
                workspacePaths: [context.workspacePath],
            }
            : undefined,
        context: {
            taskId: context.taskId,
            toolName: tool.name,
            reasoning: buildReasoning(tool.name, primaryTargetPath, context.workspacePath),
        },
    };
}
