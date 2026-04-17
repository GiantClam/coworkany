import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import {
    buildCommandRecoveryHints,
    getAlternativeCommands,
    type CommandRecoveryHints,
} from '../utils/commandAlternatives';
import { checkCommand } from './commandSandbox';
import { voiceSpeakTool } from './core/voice';
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
    probeCommands?: string[];
    recoveryHints?: CommandRecoveryHints;
}
type MemoryEntry = {
    key: string;
    value: string;
    category?: string;
    timestamp: string;
};

function normalizeMemorySearchText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeMemorySearchText(value: string): string[] {
    return normalizeMemorySearchText(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

function memoryTokensLooselyMatch(queryToken: string, corpusToken: string): boolean {
    if (queryToken === corpusToken) {
        return true;
    }
    if (
        (queryToken === 'language' && corpusToken === 'lang')
        || (queryToken === 'lang' && corpusToken === 'language')
    ) {
        return true;
    }
    if (queryToken.length >= 4 && corpusToken.startsWith(queryToken.slice(0, 4))) {
        return true;
    }
    if (corpusToken.length >= 4 && queryToken.startsWith(corpusToken.slice(0, 4))) {
        return true;
    }
    return false;
}

function resolveContextPath(workspacePath: string, candidate: string): string {
    return path.resolve(workspacePath, candidate);
}

function resolveMemoryFilePath(workspacePath: string): string {
    return path.join(workspacePath, '.coworkany', 'memory.json');
}

async function loadMemoryEntries(workspacePath: string): Promise<MemoryEntry[]> {
    const memoryPath = resolveMemoryFilePath(workspacePath);
    if (!fs.existsSync(memoryPath)) {
        return [];
    }
    try {
        const raw = await fs.promises.readFile(memoryPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
            .map((item) => {
                const key = typeof item.key === 'string' ? item.key.trim() : '';
                const value = typeof item.value === 'string' ? item.value : '';
                const category = typeof item.category === 'string' && item.category.trim().length > 0
                    ? item.category.trim()
                    : undefined;
                const timestamp = typeof item.timestamp === 'string' && item.timestamp.trim().length > 0
                    ? item.timestamp
                    : new Date().toISOString();
                return {
                    key,
                    value,
                    category,
                    timestamp,
                };
            })
            .filter((item) => item.key.length > 0 && item.value.length > 0);
    } catch {
        return [];
    }
}

async function saveMemoryEntries(workspacePath: string, entries: MemoryEntry[]): Promise<void> {
    const memoryPath = resolveMemoryFilePath(workspacePath);
    await fs.promises.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.promises.writeFile(memoryPath, JSON.stringify(entries, null, 2), 'utf-8');
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

function buildAlternativeRetryCommands(input: {
    command?: string;
    alternatives: string[];
}): string[] {
    const rawCommand = typeof input.command === 'string' ? input.command.trim() : '';
    if (rawCommand.length === 0) {
        return input.alternatives;
    }
    // Keep rewrites conservative for plain commands only.
    if (/[|&;<>`\n]/.test(rawCommand)) {
        return input.alternatives;
    }
    const firstSpace = rawCommand.search(/\s/u);
    const base = firstSpace >= 0 ? rawCommand.slice(0, firstSpace).trim() : rawCommand;
    const rest = firstSpace >= 0 ? rawCommand.slice(firstSpace + 1).trim() : '';
    if (base.length === 0) {
        return input.alternatives;
    }
    const candidates = input.alternatives
        .map((alternative) => alternative.trim())
        .filter((alternative) => alternative.length > 0)
        .map((alternative) => (rest.length > 0 ? `${alternative} ${rest}` : alternative));
    const deduped = Array.from(new Set(candidates));
    return deduped.length > 0 ? deduped : input.alternatives;
}

function pickAutomaticRetryCommand(input: {
    originalCommand?: string;
    alternatives?: string[];
}): string | null {
    const original = typeof input.originalCommand === 'string' ? input.originalCommand.trim() : '';
    const candidates = Array.isArray(input.alternatives) ? input.alternatives : [];
    for (const rawCandidate of candidates) {
        const candidate = typeof rawCandidate === 'string' ? rawCandidate.trim() : '';
        if (candidate.length === 0 || candidate === original) {
            continue;
        }
        const safety = checkCommand(candidate);
        if (!safety.allowed || safety.needsInteraction) {
            continue;
        }
        return candidate;
    }
    return null;
}

function analyzeCommandError(stderr: string, exitCode?: number, command?: string): CommandErrorAnalysis | null {
    const lowerStderr = stderr.toLowerCase();
    const alternatives = command ? getAlternativeCommands(command) : [];
    if (exitCode === 9009) {
        const baseCmd = command?.trim().split(/\s+/)[0] || 'command';
        const recoveryHints = buildCommandRecoveryHints({
            command: command ?? baseCmd,
            stderr,
            exitCode,
        });
        const resolvedAlternatives = recoveryHints?.alternativeCommands ?? alternatives;
        const resolvedRetryCommands = buildAlternativeRetryCommands({
            command,
            alternatives: resolvedAlternatives,
        });
        return {
            type: 'not_found',
            suggestion: recoveryHints?.suggestion ?? (
                resolvedRetryCommands.length > 0
                    ? `Command '${baseCmd}' not found (Windows error 9009). Try alternatives: ${resolvedRetryCommands.join(', ')}`
                    : `Command '${baseCmd}' not found (Windows error 9009). Install it or check system PATH.`
            ),
            alternatives: resolvedRetryCommands,
            probeCommands: recoveryHints?.probeCommands,
            recoveryHints: recoveryHints ?? undefined,
        };
    }
    if (lowerStderr.includes('command not found') || lowerStderr.includes('is not recognized')) {
        const cmdMatch = stderr.match(/['"]?(\S+)['"]?:?\s*(?:command not found|is not recognized)/i);
        const failedCmd = cmdMatch?.[1] || command?.trim().split(/\s+/)[0];
        const cmdAlts = failedCmd ? getAlternativeCommands(failedCmd) : alternatives;
        const recoveryHints = buildCommandRecoveryHints({
            command: command ?? (failedCmd ? `${failedCmd}` : 'command'),
            stderr,
            exitCode,
        });
        const resolvedAlternatives = recoveryHints?.alternativeCommands ?? cmdAlts;
        const resolvedRetryCommands = buildAlternativeRetryCommands({
            command,
            alternatives: resolvedAlternatives,
        });
        return {
            type: 'not_found',
            suggestion: recoveryHints?.suggestion ?? (
                resolvedRetryCommands.length > 0
                    ? `Command '${failedCmd}' not found. Try alternatives: ${resolvedRetryCommands.join(', ')}`
                    : `Command '${failedCmd || 'unknown'}' not found. Install it or check if it's in PATH.`
            ),
            alternatives: resolvedRetryCommands,
            probeCommands: recoveryHints?.probeCommands,
            recoveryHints: recoveryHints ?? undefined,
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
            let stdout = '';
            let stderr = '';
            let settled = false;
            let activeChild: ChildProcess | null = null;
            let retryCommand: string | undefined;
            const attemptRecords: Array<Record<string, unknown>> = [];
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
                if (activeChild) {
                    terminateChildProcessTree(activeChild);
                }
                finalize({
                    command: args.command,
                    error: reason || 'Task cancelled by user',
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    error_type: 'cancelled' as const,
                    cancelled: true,
                    retry_command: retryCommand,
                    attempts: attemptRecords,
                    safety_warning: safetyWarning || undefined,
                });
            });
            const timer = setTimeout(() => {
                if (activeChild) {
                    terminateChildProcessTree(activeChild);
                }
                finalize({
                    command: args.command,
                    error: 'Command timed out',
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    error_type: 'timeout' as const,
                    suggested_fix: `Increase timeout (current: ${timeout}ms) or optimize the command`,
                    retry_command: retryCommand,
                    attempts: attemptRecords,
                    safety_warning: safetyWarning || undefined,
                });
            }, timeout);

            const runAttempt = (attemptCommand: string, isAutoRetry: boolean): void => {
                if (settled) {
                    return;
                }
                const child = spawn(attemptCommand, {
                    shell: true,
                    cwd,
                    env: {
                        ...process.env,
                        PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE ?? '1',
                    },
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: process.platform !== 'win32',
                });
                activeChild = child;
                let attemptStdout = '';
                let attemptStderr = '';
                child.stdout.on('data', (data) => {
                    const chunk = data.toString();
                    stdout += chunk;
                    attemptStdout += chunk;
                });
                child.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    stderr += chunk;
                    attemptStderr += chunk;
                });
                child.on('close', (code, signal) => {
                    if (settled) return;
                    attemptRecords.push({
                        command: attemptCommand,
                        exit_code: code,
                        stdout: attemptStdout.trim(),
                        stderr: attemptStderr.trim(),
                        signal: signal ?? undefined,
                    });
                    const executionTime = Date.now() - startTime;
                    const attemptErrorAnalysis = code !== 0
                        ? analyzeCommandError(attemptStderr, code ?? undefined, attemptCommand)
                        : null;
                    if (!isAutoRetry && code !== 0 && attemptErrorAnalysis?.type === 'not_found') {
                        const fallback = pickAutomaticRetryCommand({
                            originalCommand: attemptCommand,
                            alternatives: attemptErrorAnalysis.alternatives,
                        });
                        if (fallback) {
                            retryCommand = fallback;
                            runAttempt(fallback, true);
                            return;
                        }
                    }

                    const result: Record<string, unknown> = {
                        command: args.command,
                        exit_code: code,
                        stdout: stdout.trim(),
                        stderr: stderr.trim(),
                        execution_time_ms: executionTime,
                        retry_command: retryCommand,
                        attempts: attemptRecords,
                    };
                    if (signal) {
                        result.signal = signal;
                    }
                    if (isAutoRetry) {
                        result.retry_attempted = true;
                        result.resolved_by_retry = code === 0;
                    }
                    if (code !== 0 && attemptErrorAnalysis) {
                        result.error_type = attemptErrorAnalysis.type;
                        result.suggested_fix = attemptErrorAnalysis.suggestion;
                        if (attemptErrorAnalysis.alternatives?.length) {
                            result.alternative_commands = attemptErrorAnalysis.alternatives;
                        }
                        if (attemptErrorAnalysis.probeCommands?.length) {
                            result.probe_commands = attemptErrorAnalysis.probeCommands;
                        }
                        if (attemptErrorAnalysis.recoveryHints) {
                            result.command_recovery = attemptErrorAnalysis.recoveryHints;
                        }
                    }
                    if (safetyWarning) {
                        result.safety_warning = safetyWarning;
                    }
                    finalize(result);
                });
                child.on('error', (err) => {
                    const attemptErrorAnalysis = analyzeCommandError(err.message, -1, attemptCommand);
                    attemptRecords.push({
                        command: attemptCommand,
                        exit_code: -1,
                        stdout: attemptStdout.trim(),
                        stderr: attemptStderr.trim(),
                        error: err.message,
                    });
                    finalize({
                        command: args.command,
                        error: err.message,
                        exit_code: -1,
                        execution_time_ms: Date.now() - startTime,
                        error_type: attemptErrorAnalysis?.type || 'unknown',
                        alternative_commands: attemptErrorAnalysis?.alternatives,
                        probe_commands: attemptErrorAnalysis?.probeCommands,
                        command_recovery: attemptErrorAnalysis?.recoveryHints,
                        suggested_fix: attemptErrorAnalysis?.suggestion || 'Check the command syntax and permissions',
                        retry_command: retryCommand,
                        attempts: attemptRecords,
                        safety_warning: safetyWarning || undefined,
                    });
                });
            };

            runAttempt(args.command, false);
        });
    },
};

const remember: ToolDefinition = {
    name: 'remember',
    effects: ['state:remember', 'knowledge:update'],
    input_schema: {
        type: 'object',
        properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            content: { type: 'string' },
            category: { type: 'string' },
        },
    },
    handler: async (
        args: { key?: string; value?: unknown; content?: string; category?: string },
        context,
    ) => {
        const key = typeof args.key === 'string' && args.key.trim().length > 0
            ? args.key.trim()
            : `memory-${Date.now()}`;
        const rawValue = args.value ?? args.content;
        if (rawValue === undefined || rawValue === null) {
            return { error: 'remember requires value/content.' };
        }
        const value = typeof rawValue === 'string'
            ? rawValue
            : JSON.stringify(rawValue);
        const category = typeof args.category === 'string' && args.category.trim().length > 0
            ? args.category.trim()
            : undefined;
        const timestamp = new Date().toISOString();
        const entries = await loadMemoryEntries(context.workspacePath);
        entries.push({
            key,
            value,
            category,
            timestamp,
        });
        await saveMemoryEntries(context.workspacePath, entries);
        return {
            success: true,
            key,
            value,
            category,
            timestamp,
            total: entries.length,
        };
    },
};

const recall: ToolDefinition = {
    name: 'recall',
    effects: ['state:remember', 'knowledge:read'],
    input_schema: {
        type: 'object',
        properties: {
            key: { type: 'string' },
            query: { type: 'string' },
            limit: { type: 'integer' },
        },
    },
    handler: async (
        args: { key?: string; query?: string; limit?: number },
        context,
    ) => {
        const key = typeof args.key === 'string' ? args.key.trim() : '';
        const normalizedKey = normalizeMemorySearchText(key);
        const keyTokens = tokenizeMemorySearchText(key);
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const normalizedQuery = normalizeMemorySearchText(query);
        const queryTokens = tokenizeMemorySearchText(query);
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
            ? Math.floor(args.limit)
            : 10;
        const entries = await loadMemoryEntries(context.workspacePath);
        const scored = entries.map((entry) => {
            const corpusRaw = `${entry.key} ${entry.value} ${entry.category ?? ''}`;
            let score = 0;

            if (key.length > 0) {
                if (entry.key === key) {
                    score = Math.max(score, 120);
                } else if (normalizedKey.length > 0) {
                    const normalizedEntryKey = normalizeMemorySearchText(entry.key);
                    if (normalizedEntryKey === normalizedKey) {
                        score = Math.max(score, 100);
                    } else if (
                        normalizedEntryKey.includes(normalizedKey)
                        || normalizedKey.includes(normalizedEntryKey)
                    ) {
                        score = Math.max(score, 80);
                    } else if (keyTokens.length > 0) {
                        const entryKeyTokens = tokenizeMemorySearchText(entry.key);
                        let keyOverlap = 0;
                        for (const keyToken of keyTokens) {
                            if (entryKeyTokens.some((entryToken) => memoryTokensLooselyMatch(keyToken, entryToken))) {
                                keyOverlap += 1;
                            }
                        }
                        if (keyOverlap > 0) {
                            score = Math.max(score, 40 + keyOverlap);
                        }
                    }
                }
            }

            if (normalizedQuery.length === 0) {
                if (key.length === 0) {
                    score = Math.max(score, 1);
                }
                return { entry, score };
            }

            const normalizedCorpus = normalizeMemorySearchText(corpusRaw);
            if (normalizedCorpus.includes(normalizedQuery)) {
                score = Math.max(score, 80);
                return { entry, score };
            }

            if (queryTokens.length === 0) {
                return { entry, score };
            }

            const corpusTokens = tokenizeMemorySearchText(corpusRaw);
            let overlap = 0;
            for (const queryToken of queryTokens) {
                if (corpusTokens.some((corpusToken) => memoryTokensLooselyMatch(queryToken, corpusToken))) {
                    overlap += 1;
                }
            }
            score = Math.max(score, overlap);
            return { entry, score };
        });

        let matched = scored
            .filter((item) => item.score > 0)
            .sort((a, b) => a.score - b.score)
            .map((item) => item.entry)
            .slice(-limit)
            .reverse();

        if ((key.length > 0 || normalizedQuery.length > 0) && matched.length === 0) {
            matched = entries.slice(-limit).reverse();
        }
        return {
            success: true,
            count: matched.length,
            items: matched,
        };
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
    remember,
    recall,
    voiceSpeakTool,
];
