import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { getAlternativeCommands, extractBaseCommand } from '../utils/commandAlternatives';
import {
    checkCommand,
    checkCommandWithBinaryPolicy,
    type CommandBinaryPolicy,
} from './commandSandbox';

// ============================================================================
// Types
// ============================================================================

/**
 * Standard effect categories for tool security and permission management
 * Used by PolicyBridge to enforce tool usage constraints
 */
export type ToolEffect =
    | 'filesystem:read'      // Read files/directories
    | 'filesystem:write'     // Write/modify files
    | 'filesystem:delete'    // Delete files/directories
    | 'network:outbound'     // Make external HTTP requests
    | 'process:spawn'        // Spawn child processes
    | 'ui:notify'            // Show notifications to user
    | 'state:remember'       // Persist data across sessions
    | 'code:execute'         // Execute arbitrary code
    | 'code:execute:sandbox' // Sandboxed code execution
    | 'knowledge:read'       // Read from knowledge base
    | 'knowledge:update';    // Update knowledge base

export type ToolDefinition = {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    effects: ToolEffect[];   // Security effects this tool can cause
    handler: (args: any, context: ToolContext) => Promise<any>;
};

export type ToolContext = {
    workspacePath: string;
    taskId: string;
    onCancel?: (waiter: (reason: string) => void) => (() => void);
    commandBinaryPolicy?: CommandBinaryPolicy;
};

// ============================================================================
// Error Analysis Helper
// ============================================================================

type CommandErrorType = 'syntax' | 'runtime' | 'dependency' | 'permission' | 'timeout' | 'cancelled' | 'not_found' | 'unknown';

interface CommandErrorAnalysis {
    type: CommandErrorType;
    suggestion: string;
    alternatives?: string[];  // Alternative commands to try
}

function resolveContextPath(workspacePath: string, candidate: string): string {
    return path.resolve(workspacePath, candidate);
}

function terminateChildProcessTree(child: ChildProcess): void {
    if (!child.pid) {
        return;
    }

    if (process.platform === 'win32') {
        try {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true,
            });
            killer.unref();
        } catch {
            try {
                child.kill('SIGKILL');
            } catch {
                // Ignore cleanup failures during cancellation.
            }
        }
        return;
    }

    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        try {
            child.kill('SIGKILL');
        } catch {
            // Ignore cleanup failures during cancellation.
        }
    }
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

/**
 * Analyze command error output and provide suggestions
 * Uses the unified commandAlternatives module for cross-platform support
 */
function analyzeCommandError(stderr: string, exitCode?: number, command?: string): CommandErrorAnalysis | null {
    const lowerStderr = stderr.toLowerCase();
    const alternatives = command ? getAlternativeCommands(command) : [];

    // Windows exit code 9009 = command not found (even with empty stderr!)
    if (exitCode === 9009) {
        const baseCmd = command?.trim().split(/\s+/)[0] || 'command';
        return {
            type: 'not_found',
            suggestion: alternatives.length > 0
                ? `Command '${baseCmd}' not found (Windows error 9009). Try alternatives: ${alternatives.join(', ')}`
                : `Command '${baseCmd}' not found (Windows error 9009). Install it or check system PATH.`,
            alternatives
        };
    }

    // Command not found
    if (lowerStderr.includes('command not found') || lowerStderr.includes('is not recognized')) {
        const cmdMatch = stderr.match(/['"]?(\S+)['"]?:?\s*(?:command not found|is not recognized)/i);
        const failedCmd = cmdMatch?.[1] || command?.trim().split(/\s+/)[0];
        const cmdAlts = failedCmd ? getAlternativeCommands(failedCmd) : alternatives;
        return {
            type: 'not_found',
            suggestion: cmdAlts.length > 0
                ? `Command '${failedCmd}' not found. Try alternatives: ${cmdAlts.join(', ')}`
                : `Command '${failedCmd || 'unknown'}' not found. Install it or check if it's in PATH.`,
            alternatives: cmdAlts
        };
    }

    // Permission denied
    if (lowerStderr.includes('permission denied') || lowerStderr.includes('access denied')) {
        return {
            type: 'permission',
            suggestion: 'Permission denied. Check file/directory permissions or run with appropriate privileges.'
        };
    }

    // File/directory not found
    if (lowerStderr.includes('no such file or directory') || lowerStderr.includes('cannot find')) {
        return {
            type: 'not_found',
            suggestion: 'File or directory not found. Check the path and ensure it exists.'
        };
    }

    // Syntax errors
    if (lowerStderr.includes('syntax error') || lowerStderr.includes('unexpected token')) {
        return {
            type: 'syntax',
            suggestion: 'Syntax error in command. Check command syntax and quoting.'
        };
    }

    // Module/dependency errors (npm, pip, etc.)
    if (lowerStderr.includes('module not found') || lowerStderr.includes('cannot find module') ||
        lowerStderr.includes('no module named') || lowerStderr.includes('package not found')) {
        return {
            type: 'dependency',
            suggestion: 'Missing dependency. Install the required package first.'
        };
    }

    // Network errors
    if (lowerStderr.includes('network') || lowerStderr.includes('connection refused') ||
        lowerStderr.includes('enotfound') || lowerStderr.includes('etimedout')) {
        return {
            type: 'runtime',
            suggestion: 'Network error. Check your internet connection or the target URL.'
        };
    }

    return null;
}

// ============================================================================
// File System Tools
// ============================================================================

/**
 * List directory contents
 */
const listDir: ToolDefinition = {
    name: 'list_dir',
    description: 'List files and directories in the given path. The path must be relative to the workspace root or absolute.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The directory path to list. If omitted, lists the workspace root.',
            },
            recursive: {
                type: 'boolean',
                description: 'Whether to recursively list descendant files and directories.',
            },
            max_depth: {
                type: 'integer',
                description: 'Optional maximum recursion depth when recursive=true. Depth 1 means direct children only.',
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

/**
 * View file content
 */
const viewFile: ToolDefinition = {
    name: 'view_file',
    description: 'Read the contents of a file. Supports reading specific line ranges.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to read.',
            },
            start_line: {
                type: 'integer',
                description: 'The line number to start reading from (1-indexed).',
            },
            end_line: {
                type: 'integer',
                description: 'The line number to stop reading at (inclusive).',
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

/**
 * Write to file (Create or Overwrite)
 */
const writeToFile: ToolDefinition = {
    name: 'write_to_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites it if it does. Supports creating intermediate directories.',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to write to.',
            },
            content: {
                type: 'string',
                description: 'The content to write.',
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

/**
 * Replace file content (Patch)
 * Note: A simple string replacement for now. `replace_file_content` often implies a more smart block replacement in some agent contexts,
 * but here we implement strict string replacement or full overwrite if needed.
 * For "Apply Patch" functionalities, we usually rely on `apply_patch` specialized command, but let's
 * provide a simple text replacement tool as per agent-tools spec.
 */
const replaceFileContent: ToolDefinition = {
    name: 'replace_file_content',
    description: 'Replace a specific block of text in a file with new content.',
    effects: ['filesystem:read', 'filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to modify.',
            },
            target_content: {
                type: 'string',
                description: 'The exact string to look for and replace.',
            },
            replacement_content: {
                type: 'string',
                description: 'The new content to insert in place of target_content.',
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

const createDirectory: ToolDefinition = {
    name: 'create_directory',
    description: 'Create a directory if it does not exist. Supports absolute paths and intermediate directories.',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The directory path to create.',
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

const computeFileHash: ToolDefinition = {
    name: 'compute_file_hash',
    description: 'Compute a content hash for a file. Useful for deterministic duplicate detection.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The file path to hash.',
            },
            algorithm: {
                type: 'string',
                description: 'The hash algorithm to use. Defaults to sha256.',
            },
        },
        required: ['path'],
    },
    handler: async (args: { path: string; algorithm?: string }, context) => {
        const targetPath = resolveContextPath(context.workspacePath, args.path);
        const algorithm = args.algorithm || 'sha256';

        try {
            const hash = createHash(algorithm);
            const buffer = await fs.promises.readFile(targetPath);
            hash.update(buffer);
            return {
                success: true,
                path: targetPath,
                algorithm,
                hash: hash.digest('hex'),
            };
        } catch (error: any) {
            return { error: `Failed to compute file hash: ${error.message}` };
        }
    },
};

const moveFile: ToolDefinition = {
    name: 'move_file',
    description: 'Move or rename a file. Creates destination directories if needed.',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            source_path: {
                type: 'string',
                description: 'The source file path.',
            },
            destination_path: {
                type: 'string',
                description: 'The destination file path.',
            },
            overwrite: {
                type: 'boolean',
                description: 'Whether to overwrite the destination file if it exists.',
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

const deletePath: ToolDefinition = {
    name: 'delete_path',
    description: 'Delete a file or directory. Directories require recursive=true.',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The file or directory path to delete.',
            },
            recursive: {
                type: 'boolean',
                description: 'Required when deleting a directory.',
            },
            force: {
                type: 'boolean',
                description: 'Ignore missing files and force deletion.',
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

const batchMoveFiles: ToolDefinition = {
    name: 'batch_move_files',
    description: 'Move multiple files in one structured operation. Creates destination directories as needed.',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            moves: {
                type: 'array',
                description: 'A list of move operations to execute.',
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
        context
    ) => {
        const results: Array<Record<string, unknown>> = [];

        for (const move of args.moves ?? []) {
            const sourcePath = resolveContextPath(context.workspacePath, move.source_path);
            const destinationPath = resolveContextPath(context.workspacePath, move.destination_path);

            try {
                if (!move.overwrite) {
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
                results.push({
                    success: true,
                    source_path: sourcePath,
                    destination_path: destinationPath,
                });
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
            results,
        };
    },
};

const batchDeletePaths: ToolDefinition = {
    name: 'batch_delete_paths',
    description: 'Delete multiple files or directories in one structured operation.',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            deletes: {
                type: 'array',
                description: 'A list of delete operations to execute.',
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
        context
    ) => {
        const results: Array<Record<string, unknown>> = [];

        for (const deletion of args.deletes ?? []) {
            const targetPath = resolveContextPath(context.workspacePath, deletion.path);

            try {
                await fs.promises.rm(targetPath, {
                    recursive: deletion.recursive ?? false,
                    force: deletion.force ?? false,
                });
                results.push({
                    success: true,
                    path: targetPath,
                });
            } catch (error: any) {
                results.push({
                    success: false,
                    path: targetPath,
                    error: error.message,
                });
            }
        }

        return {
            success: results.every((result) => result.success === true),
            results,
        };
    },
};


// ============================================================================
// Command Tools
// ============================================================================

/**
 * Run Command
 */
const runCommand: ToolDefinition = {
    name: 'run_command',
    description: 'Execute a shell command in the context of the workspace.',
    effects: ['process:spawn', 'code:execute'],
    input_schema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The command line to execute.',
            },
            cwd: {
                type: 'string',
                description: 'The directory to execute the command in (relative to workspace root).',
            },
            timeout_ms: {
                type: 'integer',
                description: 'Timeout in milliseconds (default: 30000).',
            }
        },
        required: ['command'],
    },
    handler: async (args: { command: string; cwd?: string; timeout_ms?: number }, context) => {
        // Command sandbox: check for dangerous patterns before execution
        const safetyCheck = context.commandBinaryPolicy
            ? checkCommandWithBinaryPolicy(args.command, context.commandBinaryPolicy)
            : checkCommand(args.command);
        
        // BLOCKED commands - never execute, return instructions
        if (!safetyCheck.allowed) {
            return `⛔ COMMAND BLOCKED: ${safetyCheck.reason}\n\nThe command "${args.command}" was blocked because it matches a dangerous pattern (risk: ${safetyCheck.riskLevel}).\n\nIf this command is absolutely necessary, you must execute it manually in your terminal.`;
        }

        // Commands needing user interaction - open in terminal for user input
        if (safetyCheck.needsInteraction) {
            const cwd = args.cwd
                ? path.resolve(context.workspacePath, args.cwd)
                : context.workspacePath;
            const platform = process.platform;
            
            // Open in system terminal for interactive commands
            // This allows user to enter passwords, confirm actions, etc.
            let terminalCommand: string;
            
            if (platform === 'darwin') {
                // macOS: Open Terminal.app with the command
                terminalCommand = `osascript -e 'tell application "Terminal" to do script "cd '${cwd}' && ${args.command.replace(/'/g, "'\\''")}"'`;
            } else if (platform === 'linux') {
                // Linux: Try common terminal emulators
                terminalCommand = `which gnome-terminal >/dev/null 2>&1 && gnome-terminal -- bash -c "cd '${cwd}' && ${args.command}; exec bash" || which xterm >/dev/null 2>&1 && xterm -e "cd '${cwd}' && ${args.command}" || which konsole >/dev/null 2>&1 && konsole -e "cd '${cwd}' && ${args.command}" || ${args.command}`;
            } else if (platform === 'win32') {
                // Windows: Open cmd window
                terminalCommand = `start cmd /k "cd /d ${cwd} && ${args.command}"`;
            } else {
                terminalCommand = args.command;
            }

            return new Promise((resolve) => {
                const child = spawn(terminalCommand, {
                    shell: true,
                    cwd,
                    stdio: 'ignore',
                    detached: true,  // Detach so terminal stays open
                });

                // Unref the child to allow parent to continue
                child.unref();

                // Return immediately - the terminal window handles the rest
                resolve({
                    command: args.command,
                    status: 'opened_in_terminal',
                    message: `✅ 已在终端中打开命令，请在终端窗口中输入密码或进行操作。`,
                    interaction_hint: safetyCheck.interactionHint,
                    platform: platform,
                    cwd: cwd,
                    instructions: [
                        `1. 终端窗口已打开`,
                        `2. 如果需要密码，请在终端中输入`,
                        `3. 命令执行完成后，终端窗口会保持打开`,
                    ],
                    exit_code: 0,
                });
            });
        }

        let safetyWarning = '';
        if (safetyCheck.riskLevel === 'high' || safetyCheck.riskLevel === 'medium') {
            safetyWarning = `\n⚠️ Safety Warning: ${safetyCheck.reason} (risk: ${safetyCheck.riskLevel})\n`;
        }

        const cwd = args.cwd
            ? path.resolve(context.workspacePath, args.cwd)
            : context.workspacePath;
        const timeout = args.timeout_ms || 30000;
        const startTime = Date.now();

        return new Promise((resolve) => {
            const child = spawn(args.command, {
                shell: true,
                cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: process.platform !== 'win32',
            });

            let stdout = '';
            let stderr = '';
            let settled = false;

            const finalize = (result: Record<string, unknown>) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                disposeCancellation?.();
                resolve(result);
            };

            const disposeCancellation = context.onCancel?.((reason) => {
                terminateChildProcessTree(child);
                finalize({
                    command: args.command,
                    error: reason || 'Task cancelled by user',
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    error_type: 'cancelled' as const,
                    cancelled: true,
                    safety_warning: safetyWarning || undefined,
                });
            });

            const timer = setTimeout(() => {
                terminateChildProcessTree(child);
                finalize({
                    command: args.command,
                    error: 'Command timed out',
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    error_type: 'timeout' as const,
                    suggested_fix: `Increase timeout (current: ${timeout}ms) or optimize the command`,
                    safety_warning: safetyWarning || undefined,
                });
            }, timeout);

            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });

            child.on('close', (code, signal) => {
                if (settled) return;

                const executionTime = Date.now() - startTime;
                const result: Record<string, unknown> = {
                    command: args.command,
                    exit_code: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    execution_time_ms: executionTime,
                };

                if (signal) {
                    result.signal = signal;
                }

                // Add error analysis if command failed
                // Note: Also check exit_code even if stderr is empty (e.g., Windows 9009)
                if (code !== 0) {
                    const errorAnalysis = analyzeCommandError(stderr, code ?? undefined, args.command);
                    if (errorAnalysis) {
                        result.error_type = errorAnalysis.type;
                        result.suggested_fix = errorAnalysis.suggestion;
                        if (errorAnalysis.alternatives?.length) {
                            result.alternative_commands = errorAnalysis.alternatives;
                        }
                    }
                }

                // Append safety warning if command matched a risky pattern
                if (safetyWarning) {
                    result.safety_warning = safetyWarning;
                }

                finalize(result);
            });

            child.on('error', (err) => {
                const errorAnalysis = analyzeCommandError(err.message, -1, args.command);
                finalize({
                    command: args.command,
                    error: err.message,
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    error_type: errorAnalysis?.type || 'unknown',
                    alternative_commands: errorAnalysis?.alternatives,
                    suggested_fix: errorAnalysis?.suggestion || 'Check the command syntax and permissions',
                    safety_warning: safetyWarning || undefined,
                });
            });
        });
    },
};

// ============================================================================
// Export
// ============================================================================

export const STANDARD_TOOLS: ToolDefinition[] = [
    listDir,
    viewFile,
    writeToFile,
    replaceFileContent,
    createDirectory,
    computeFileHash,
    moveFile,
    deletePath,
    batchMoveFiles,
    batchDeletePaths,
    runCommand,
];
