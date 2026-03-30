import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { getAlternativeCommands } from '../utils/commandAlternatives';
import { checkCommand } from './commandSandbox';
export type ToolEffect =
    | 'filesystem:read'
    | 'filesystem:write'
    | 'filesystem:delete'
    | 'network:outbound'
    | 'process:spawn'
    | 'ui:notify'
    | 'state:remember'
    | 'code:execute'
    | 'code:execute:sandbox'
    | 'knowledge:read'
    | 'knowledge:update';
export type ToolDefinition = {
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
    effects: ToolEffect[];
    handler: (args: any, context: ToolContext) => Promise<any>;
};
export type ToolContext = {
    workspacePath: string;
    taskId: string;
    onCancel?: (waiter: (reason: string) => void) => (() => void);
};
type CommandErrorType = 'syntax' | 'runtime' | 'dependency' | 'permission' | 'timeout' | 'cancelled' | 'not_found' | 'unknown';
interface CommandErrorAnalysis {
    type: CommandErrorType;
    suggestion: string;
    alternatives?: string[];
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
function analyzeCommandError(stderr: string, exitCode?: number, command?: string): CommandErrorAnalysis | null {
    const lowerStderr = stderr.toLowerCase();
    const alternatives = command ? getAlternativeCommands(command) : [];
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
    if (lowerStderr.includes('permission denied') || lowerStderr.includes('access denied')) {
        return {
            type: 'permission',
            suggestion: 'Permission denied. Check file/directory permissions or run with appropriate privileges.'
        };
    }
    if (lowerStderr.includes('no such file or directory') || lowerStderr.includes('cannot find')) {
        return {
            type: 'not_found',
            suggestion: 'File or directory not found. Check the path and ensure it exists.'
        };
    }
    if (lowerStderr.includes('syntax error') || lowerStderr.includes('unexpected token')) {
        return {
            type: 'syntax',
            suggestion: 'Syntax error in command. Check command syntax and quoting.'
        };
    }
    if (lowerStderr.includes('module not found') || lowerStderr.includes('cannot find module') ||
        lowerStderr.includes('no module named') || lowerStderr.includes('package not found')) {
        return {
            type: 'dependency',
            suggestion: 'Missing dependency. Install the required package first.'
        };
    }
    if (lowerStderr.includes('network') || lowerStderr.includes('connection refused') ||
        lowerStderr.includes('enotfound') || lowerStderr.includes('etimedout')) {
        return {
            type: 'runtime',
            suggestion: 'Network error. Check your internet connection or the target URL.'
        };
    }
    return null;
}
const listDir: ToolDefinition = {
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
const viewFile: ToolDefinition = {
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
const writeToFile: ToolDefinition = {
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
const replaceFileContent: ToolDefinition = {
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
const moveFile: ToolDefinition = {
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
const deletePath: ToolDefinition = {
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
const runCommand: ToolDefinition = {
    name: 'run_command',
    effects: ['process:spawn', 'code:execute'],
    input_schema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
            },
            cwd: {
                type: 'string',
            },
            timeout_ms: {
                type: 'integer',
            }
        },
        required: ['command'],
    },
    handler: async (args: { command: string; cwd?: string; timeout_ms?: number }, context) => {
        const safetyCheck = checkCommand(args.command);
        if (!safetyCheck.allowed) {
            return `⛔ COMMAND BLOCKED: ${safetyCheck.reason}\n\nThe command "${args.command}" was blocked because it matches a dangerous pattern (risk: ${safetyCheck.riskLevel}).\n\nIf this command is absolutely necessary, you must execute it manually in your terminal.`;
        }
        if (safetyCheck.needsInteraction) {
            const cwd = args.cwd
                ? path.resolve(context.workspacePath, args.cwd)
                : context.workspacePath;
            const platform = process.platform;
            let terminalCommand: string;
            if (platform === 'darwin') {
                terminalCommand = `osascript -e 'tell application "Terminal" to do script "cd '${cwd}' && ${args.command.replace(/'/g, "'\\''")}"'`;
            } else if (platform === 'linux') {
                terminalCommand = `which gnome-terminal >/dev/null 2>&1 && gnome-terminal -- bash -c "cd '${cwd}' && ${args.command}; exec bash" || which xterm >/dev/null 2>&1 && xterm -e "cd '${cwd}' && ${args.command}" || which konsole >/dev/null 2>&1 && konsole -e "cd '${cwd}' && ${args.command}" || ${args.command}`;
            } else if (platform === 'win32') {
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
                child.unref();
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
export const STANDARD_TOOLS: ToolDefinition[] = [
    listDir,
    viewFile,
    writeToFile,
    replaceFileContent,
    moveFile,
    deletePath,
    runCommand,
];
