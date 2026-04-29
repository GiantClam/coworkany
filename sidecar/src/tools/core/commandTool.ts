import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import {
    buildCommandRecoveryHints,
    getAlternativeCommands,
    type CommandRecoveryHints,
} from '../../utils/commandAlternatives';
import { checkCommand } from '../commandSandbox';
import {
    appendSudoFailureHint,
    buildSudoExecutionPlan,
    buildSudoFailureSuggestion,
    hasSudoFailure,
} from '../sudoExecution';
import { createVisibleTerminalMirrorSession } from '../visibleTerminalMirror';
import type { ToolDefinition } from './types';

type CommandErrorType = 'syntax' | 'runtime' | 'dependency' | 'permission' | 'timeout' | 'cancelled' | 'not_found' | 'unknown';
interface CommandErrorAnalysis {
    type: CommandErrorType;
    suggestion: string;
    alternatives?: string[];
    probeCommands?: string[];
    recoveryHints?: CommandRecoveryHints;
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
    if (hasSudoFailure(stderr)) {
        return {
            type: 'permission',
            suggestion: buildSudoFailureSuggestion({
                command: command ?? 'sudo command',
                usesPassword: false,
            }),
        };
    }
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
export const runCommandTool: ToolDefinition = {
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
        const sudoPlan = buildSudoExecutionPlan(args.command);
        if (!safetyCheck.allowed) {
            return `⛔ COMMAND BLOCKED: ${safetyCheck.reason}\n\nThe command "${args.command}" was blocked because it matches a dangerous pattern (risk: ${safetyCheck.riskLevel}).\n\nIf this command is absolutely necessary, you must execute it manually in your terminal.`;
        }
        if (safetyCheck.needsInteraction && !sudoPlan.isSudoCommand) {
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
        const terminalMirror = createVisibleTerminalMirrorSession({
            workspacePath: cwd,
            command: args.command,
        });
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
                terminalMirror?.close({
                    exitCode: typeof result.exit_code === 'number'
                        ? result.exit_code
                        : undefined,
                    reason: typeof result.error === 'string'
                        ? result.error
                        : undefined,
                });
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
                const timeoutStderr = appendSudoFailureHint({
                    command: sudoPlan.commandToRun,
                    stderr: stderr.trim(),
                    usesPassword: sudoPlan.usesPassword,
                });
                finalize({
                    command: args.command,
                    error: 'Command timed out',
                    stdout: stdout.trim(),
                    stderr: timeoutStderr,
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    error_type: 'timeout' as const,
                    suggested_fix: `Increase timeout (current: ${timeout}ms) or optimize the command`,
                    retry_command: retryCommand,
                    attempts: attemptRecords,
                    safety_warning: safetyWarning || undefined,
                });
            }, timeout);

            const runAttempt = (
                attemptCommand: string,
                isAutoRetry: boolean,
                attemptStdinData?: string,
                attemptUsesSudoPassword = false,
            ): void => {
                if (settled) {
                    return;
                }
                terminalMirror?.note(
                    isAutoRetry
                        ? `running retry command: ${attemptCommand}`
                        : `running command: ${attemptCommand}`,
                );
                if (!isAutoRetry && sudoPlan.transformed && sudoPlan.commandToRun !== args.command) {
                    terminalMirror?.note(`rewritten sudo command: ${sudoPlan.commandToRun}`);
                }
                const child = spawn(attemptCommand, {
                    shell: true,
                    cwd,
                    env: {
                        ...process.env,
                        PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE ?? '1',
                    },
                    stdio: [attemptStdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
                    detached: process.platform !== 'win32',
                });
                activeChild = child;
                if (attemptStdinData && child.stdin) {
                    try {
                        child.stdin.end(attemptStdinData);
                    } catch {
                    }
                }
                if (!child.stdout || !child.stderr) {
                    finalize({
                        command: args.command,
                        error: 'Command stream initialization failed',
                        exit_code: -1,
                        execution_time_ms: Date.now() - startTime,
                        error_type: 'runtime' as const,
                        retry_command: retryCommand,
                        attempts: attemptRecords,
                        safety_warning: safetyWarning || undefined,
                    });
                    return;
                }
                let attemptStdout = '';
                let attemptStderr = '';
                child.stdout.on('data', (data) => {
                    const chunk = data.toString();
                    stdout += chunk;
                    attemptStdout += chunk;
                    terminalMirror?.appendStdout(chunk);
                });
                child.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    stderr += chunk;
                    attemptStderr += chunk;
                    terminalMirror?.appendStderr(chunk);
                });
                child.on('close', (code, signal) => {
                    if (settled) return;
                    const normalizedAttemptStderr = appendSudoFailureHint({
                        command: attemptCommand,
                        stderr: attemptStderr.trim(),
                        usesPassword: attemptUsesSudoPassword,
                    });
                    attemptRecords.push({
                        command: attemptCommand,
                        exit_code: code,
                        stdout: attemptStdout.trim(),
                        stderr: normalizedAttemptStderr,
                        signal: signal ?? undefined,
                    });
                    const executionTime = Date.now() - startTime;
                    const attemptErrorAnalysis = code !== 0
                        ? analyzeCommandError(normalizedAttemptStderr, code ?? undefined, attemptCommand)
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
                        stderr: appendSudoFailureHint({
                            command: attemptCommand,
                            stderr: stderr.trim(),
                            usesPassword: attemptUsesSudoPassword,
                        }),
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
                    const normalizedAttemptStderr = appendSudoFailureHint({
                        command: attemptCommand,
                        stderr: attemptStderr.trim(),
                        usesPassword: attemptUsesSudoPassword,
                    });
                    const attemptErrorAnalysis = analyzeCommandError(
                        `${normalizedAttemptStderr}\n${err.message}`.trim(),
                        -1,
                        attemptCommand,
                    );
                    attemptRecords.push({
                        command: attemptCommand,
                        exit_code: -1,
                        stdout: attemptStdout.trim(),
                        stderr: normalizedAttemptStderr,
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

            runAttempt(
                sudoPlan.commandToRun,
                false,
                sudoPlan.stdinData,
                sudoPlan.usesPassword,
            );
        });
    },
};
