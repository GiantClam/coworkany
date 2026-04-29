import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ToolDefinition } from './types';

function resolveContextPath(workspacePath: string, candidate: string): string {
    return path.resolve(workspacePath, candidate);
}

async function movePath(sourcePath: string, destinationPath: string): Promise<void> {
    try {
        await fs.promises.rename(sourcePath, destinationPath);
    } catch (error: any) {
        if (error?.code !== 'EXDEV') {
            throw error;
        }
        await fs.promises.copyFile(sourcePath, destinationPath);
        await fs.promises.unlink(sourcePath);
    }
}

export const listDirTool: ToolDefinition = {
    name: 'list_dir',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
            },
            recursive: {
                type: 'boolean',
            },
            max_depth: {
                type: 'integer',
            },
        },
    },
    handler: async (args: { path?: string; recursive?: boolean; max_depth?: number }, context) => {
        const targetPath = args.path
            ? resolveContextPath(context.workspacePath, args.path)
            : context.workspacePath;
        try {
            const recursive = args.recursive === true;
            const maxDepth = typeof args.max_depth === 'number' && args.max_depth > 0
                ? Math.floor(args.max_depth)
                : undefined;
            const collectEntries = async (currentPath: string, relativeBase: string, depth: number): Promise<Array<Record<string, unknown>>> => {
                const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
                const results: Array<Record<string, unknown>> = [];
                for (const entry of entries) {
                    const entryRelativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
                    const entryAbsolutePath = path.join(currentPath, entry.name);
                    results.push({
                        name: entry.name,
                        path: entryRelativePath,
                        isDir: entry.isDirectory(),
                        size: entry.isFile() ? fs.statSync(entryAbsolutePath).size : undefined,
                    });
                    const canDescend = recursive &&
                        entry.isDirectory() &&
                        (maxDepth === undefined || depth < maxDepth);
                    if (canDescend) {
                        results.push(...await collectEntries(entryAbsolutePath, entryRelativePath, depth + 1));
                    }
                }
                return results;
            };
            const result = await collectEntries(targetPath, '', 1);
            return result;
        } catch (error: any) {
            return { error: `Failed to list directory: ${error.message}` };
        }
    },
};
export const viewFileTool: ToolDefinition = {
    name: 'view_file',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
            },
            start_line: {
                type: 'integer',
            },
            end_line: {
                type: 'integer',
            },
        },
        required: ['path'],
    },
    handler: async (args: { path: string; start_line?: number; end_line?: number }, context) => {
        const targetPath = resolveContextPath(context.workspacePath, args.path);
        try {
            const content = await fs.promises.readFile(targetPath, 'utf-8');
            if (args.start_line === undefined && args.end_line === undefined) {
                return content;
            }
            const lines = content.split('\n');
            const start = (args.start_line || 1) - 1;
            const end = args.end_line || lines.length;
            return lines.slice(start, end).join('\n');
        } catch (error: any) {
            return { error: `Failed to read file: ${error.message}` };
        }
    },
};
export const writeToFileTool: ToolDefinition = {
    name: 'write_to_file',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
            },
            content: {
                type: 'string',
            },
        },
        required: ['path', 'content'],
    },
    handler: async (args: { path: string; content: string }, context) => {
        const targetPath = resolveContextPath(context.workspacePath, args.path);
        try {
            await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.promises.writeFile(targetPath, args.content, 'utf-8');
            return { success: true, path: targetPath, size: args.content.length };
        } catch (error: any) {
            return { error: `Failed to write file: ${error.message}` };
        }
    },
};
export const replaceFileContentTool: ToolDefinition = {
    name: 'replace_file_content',
    effects: ['filesystem:read', 'filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
            },
            target_content: {
                type: 'string',
            },
            replacement_content: {
                type: 'string',
            },
        },
        required: ['path', 'target_content', 'replacement_content'],
    },
    handler: async (args: { path: string; target_content: string; replacement_content: string }, context) => {
        const targetPath = resolveContextPath(context.workspacePath, args.path);
        try {
            const content = await fs.promises.readFile(targetPath, 'utf-8');
            if (!content.includes(args.target_content)) {
                return { error: 'Target content not found in file.' };
            }
            const newContent = content.replace(args.target_content, args.replacement_content);
            await fs.promises.writeFile(targetPath, newContent, 'utf-8');
            return { success: true, path: targetPath };
        } catch (error: any) {
            return { error: `Failed to replace content: ${error.message}` };
        }
    },
};
export const moveFileTool: ToolDefinition = {
    name: 'move_file',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            source_path: {
                type: 'string',
            },
            destination_path: {
                type: 'string',
            },
            overwrite: {
                type: 'boolean',
            },
        },
        required: ['source_path', 'destination_path'],
    },
    handler: async (args: { source_path: string; destination_path: string; overwrite?: boolean }, context) => {
        const sourcePath = resolveContextPath(context.workspacePath, args.source_path);
        const destinationPath = resolveContextPath(context.workspacePath, args.destination_path);
        try {
            if (!args.overwrite) {
                const exists = await fs.promises
                    .access(destinationPath, fs.constants.F_OK)
                    .then(() => true)
                    .catch(() => false);
                if (exists) {
                    return { error: `Destination already exists: ${destinationPath}` };
                }
            }
            await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
            await movePath(sourcePath, destinationPath);
            return { success: true, source_path: sourcePath, destination_path: destinationPath };
        } catch (error: any) {
            return { error: `Failed to move file: ${error.message}` };
        }
    },
};
export const deletePathTool: ToolDefinition = {
    name: 'delete_path',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
            },
            recursive: {
                type: 'boolean',
            },
            force: {
                type: 'boolean',
            },
        },
        required: ['path'],
    },
    handler: async (args: { path: string; recursive?: boolean; force?: boolean }, context) => {
        const targetPath = resolveContextPath(context.workspacePath, args.path);
        try {
            await fs.promises.rm(targetPath, {
                recursive: args.recursive ?? false,
                force: args.force ?? false,
            });
            return { success: true, path: targetPath };
        } catch (error: any) {
            return { error: `Failed to delete path: ${error.message}` };
        }
    },
};
export const createDirectoryTool: ToolDefinition = {
    name: 'create_directory',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
            },
        },
        required: ['path'],
    },
    handler: async (args: { path: string }, context) => {
        const targetPath = resolveContextPath(context.workspacePath, args.path);
        try {
            await fs.promises.mkdir(targetPath, { recursive: true });
            return { success: true, path: targetPath };
        } catch (error: any) {
            return { error: `Failed to create directory: ${error.message}` };
        }
    },
};
export const computeFileHashTool: ToolDefinition = {
    name: 'compute_file_hash',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
            },
            algorithm: {
                type: 'string',
            },
        },
        required: ['path'],
    },
    handler: async (args: { path: string; algorithm?: string }, context) => {
        const targetPath = resolveContextPath(context.workspacePath, args.path);
        const algorithm = typeof args.algorithm === 'string' && args.algorithm.trim().length > 0
            ? args.algorithm.trim()
            : 'sha256';
        try {
            const hash = createHash(algorithm);
            const content = await fs.promises.readFile(targetPath);
            hash.update(content);
            return {
                success: true,
                path: targetPath,
                algorithm,
                hash: hash.digest('hex'),
                size: content.byteLength,
            };
        } catch (error: any) {
            return { error: `Failed to compute file hash: ${error.message}` };
        }
    },
};
export const batchDeletePathsTool: ToolDefinition = {
    name: 'batch_delete_paths',
    effects: ['filesystem:delete'],
    input_schema: {
        type: 'object',
        properties: {
            deletes: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        recursive: { type: 'boolean' },
                        force: { type: 'boolean' },
                    },
                    required: ['path'],
                },
            },
        },
        required: ['deletes'],
    },
    handler: async (
        args: { deletes: Array<{ path: string; recursive?: boolean; force?: boolean }> },
        context,
    ) => {
        const results: Array<Record<string, unknown>> = [];
        for (const item of args.deletes ?? []) {
            const targetPath = resolveContextPath(context.workspacePath, item.path);
            try {
                await fs.promises.rm(targetPath, {
                    recursive: item.recursive ?? false,
                    force: item.force ?? false,
                });
                results.push({ success: true, path: targetPath });
            } catch (error: any) {
                results.push({ success: false, path: targetPath, error: error.message });
            }
        }
        return {
            success: results.every((result) => result.success === true),
            count: results.length,
            results,
        };
    },
};
export const batchMoveFilesTool: ToolDefinition = {
    name: 'batch_move_files',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            moves: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        source_path: { type: 'string' },
                        destination_path: { type: 'string' },
                        overwrite: { type: 'boolean' },
                    },
                    required: ['source_path', 'destination_path'],
                },
            },
        },
        required: ['moves'],
    },
    handler: async (
        args: { moves: Array<{ source_path: string; destination_path: string; overwrite?: boolean }> },
        context,
    ) => {
        const results: Array<Record<string, unknown>> = [];
        for (const item of args.moves ?? []) {
            const sourcePath = resolveContextPath(context.workspacePath, item.source_path);
            const destinationPath = resolveContextPath(context.workspacePath, item.destination_path);
            try {
                if (!item.overwrite) {
                    const exists = await fs.promises
                        .access(destinationPath, fs.constants.F_OK)
                        .then(() => true)
                        .catch(() => false);
                    if (exists) {
                        results.push({
                            success: false,
                            source_path: sourcePath,
                            destination_path: destinationPath,
                            error: `Destination already exists: ${destinationPath}`,
                        });
                        continue;
                    }
                }
                await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
                await movePath(sourcePath, destinationPath);
                results.push({ success: true, source_path: sourcePath, destination_path: destinationPath });
            } catch (error: any) {
                results.push({
                    success: false,
                    source_path: sourcePath,
                    destination_path: destinationPath,
                    error: error.message,
                });
            }
        }
        return {
            success: results.every((result) => result.success === true),
            count: results.length,
            results,
        };
    },
};
