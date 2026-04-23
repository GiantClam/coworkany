import { spawn } from 'child_process';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import {
    buildCommandRecoveryHints,
    type CommandRecoveryHints,
} from '../../utils/commandAlternatives';
import { checkCommand } from '../../tools/commandSandbox';
import {
    appendSudoFailureHint,
    buildSudoExecutionPlan,
} from '../../tools/sudoExecution';
import { createVisibleTerminalMirrorSession } from '../../tools/visibleTerminalMirror';
export const DANGEROUS_PATTERNS: RegExp[] = [
    /\brm\s+-rf\s+\/?\s*$/i,
    /\brm\s+-rf\s+~\//i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    />\s*\/dev\//i,
    /\bcurl\b[^\n|]*\|\s*(sh|bash)\b/i,
    /\bchmod\s+777\b/i,
];
export const APPROVAL_PATTERNS: RegExp[] = [
    /\bsudo\b/i,
    /\brm\s+-r(f)?\b/i,
    /\bmv\b/i,
    /\bcp\s+-r\b/i,
    /\bnpm\s+install\s+-g\b/i,
    /\bbrew\s+install\b/i,
    /\bpip\s+install\b/i,
];
export type BashExecutionResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    rejected: boolean;
    reason?: string;
    error_type?: 'not_found' | 'unknown';
    suggested_fix?: string;
    alternative_commands?: string[];
    probe_commands?: string[];
    command_recovery?: CommandRecoveryHints;
    retry_attempted?: boolean;
    retry_command?: string;
    resolved_by_retry?: boolean;
    attempts?: Array<{
        command: string;
        exitCode: number;
        stdout: string;
        stderr: string;
    }>;
};
export function isDangerousCommand(command: string): boolean {
    return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}
export function needsApprovalForCommand(command: string): boolean {
    return APPROVAL_PATTERNS.some((pattern) => pattern.test(command));
}

function attachCommandRecoveryHints(
    command: string,
    result: BashExecutionResult,
): BashExecutionResult {
    const recovery = buildCommandRecoveryHints({
        command,
        stderr: result.stderr,
        exitCode: result.exitCode,
    });
    if (!recovery) {
        return result;
    }
    const executableAlternatives = recovery.alternativeCommands;
    const resolvedAlternatives = buildAlternativeRetryCommands({
        command,
        alternatives: executableAlternatives,
    });
    return {
        ...result,
        error_type: 'not_found',
        suggested_fix: recovery.suggestion,
        alternative_commands: resolvedAlternatives,
        probe_commands: recovery.probeCommands,
        command_recovery: recovery,
    };
}

function buildAlternativeRetryCommands(input: {
    command: string;
    alternatives: string[];
}): string[] {
    const rawCommand = input.command.trim();
    if (rawCommand.length === 0) {
        return input.alternatives;
    }
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
    originalCommand: string;
    alternatives?: string[];
}): string | null {
    const original = input.originalCommand.trim();
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

async function executeSingleShellCommand(input: {
    command: string;
    stdinData?: string;
    usesSudoPassword?: boolean;
    displayCommand?: string;
    workdir?: string;
    timeout: number;
}): Promise<BashExecutionResult> {
    const cwd = input.workdir || process.cwd();
    const terminalMirror = createVisibleTerminalMirrorSession({
        workspacePath: cwd,
        command: input.displayCommand ?? input.command,
    });
    return await new Promise<BashExecutionResult>((resolve) => {
        const child = spawn(input.command, {
            cwd,
            env: {
                ...process.env,
                LANG: 'en_US.UTF-8',
                PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE ?? '1',
            },
            shell: true,
            stdio: [input.stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        if (input.stdinData && child.stdin) {
            try {
                child.stdin.end(input.stdinData);
            } catch {
            }
        }
        const finish = (result: BashExecutionResult): void => {
            if (settled) {
                return;
            }
            settled = true;
            terminalMirror?.close({
                exitCode: result.exitCode,
                reason: result.reason,
            });
            resolve(result);
        };
        terminalMirror?.note(`running command: ${input.command}`);
        if (input.displayCommand && input.displayCommand !== input.command) {
            terminalMirror?.note(`rewritten sudo command: ${input.command}`);
        }
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish({
                stdout,
                stderr: appendSudoFailureHint({
                    command: input.command,
                    stderr: stderr || `Command timed out after ${input.timeout}ms`,
                    usesPassword: input.usesSudoPassword === true,
                }),
                exitCode: 124,
                rejected: false,
                reason: 'timeout',
            });
        }, input.timeout);
        if (!child.stdout || !child.stderr) {
            clearTimeout(timer);
            finish({
                stdout,
                stderr: appendSudoFailureHint({
                    command: input.command,
                    stderr: 'Command stream initialization failed',
                    usesPassword: input.usesSudoPassword === true,
                }),
                exitCode: 1,
                rejected: false,
                reason: 'spawn_error',
            });
            return;
        }
        child.stdout.on('data', (chunk: Buffer | string) => {
            const text = chunk.toString();
            stdout += text;
            terminalMirror?.appendStdout(text);
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
            const text = chunk.toString();
            stderr += text;
            terminalMirror?.appendStderr(text);
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            finish({
                stdout,
                stderr: `${stderr}\n${String(error)}`.trim(),
                exitCode: 1,
                rejected: false,
                reason: 'spawn_error',
            });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            finish({
                stdout,
                stderr: appendSudoFailureHint({
                    command: input.command,
                    stderr,
                    usesPassword: input.usesSudoPassword === true,
                }),
                exitCode: code ?? 1,
                rejected: false,
            });
        });
    });
}

async function executeShellCommand(input: {
    command: string;
    workdir?: string;
    timeout?: number;
}): Promise<BashExecutionResult> {
    const timeoutMs = Math.max(100, input.timeout ?? 30_000);
    const startedAt = Date.now();
    const sudoPlan = buildSudoExecutionPlan(input.command);
    const firstAttemptRaw = await executeSingleShellCommand({
        command: sudoPlan.commandToRun,
        stdinData: sudoPlan.stdinData,
        usesSudoPassword: sudoPlan.usesPassword,
        displayCommand: input.command,
        workdir: input.workdir,
        timeout: timeoutMs,
    });
    const firstAttempt = attachCommandRecoveryHints(sudoPlan.commandToRun, firstAttemptRaw);
    const attempts: BashExecutionResult['attempts'] = [{
        command: sudoPlan.commandToRun,
        exitCode: firstAttempt.exitCode,
        stdout: firstAttempt.stdout,
        stderr: firstAttempt.stderr,
    }];
    if (firstAttempt.exitCode === 0 || firstAttempt.rejected || firstAttempt.error_type !== 'not_found') {
        return {
            ...firstAttempt,
            attempts,
        };
    }
    const retryCommand = pickAutomaticRetryCommand({
        originalCommand: input.command,
        alternatives: firstAttempt.alternative_commands,
    });
    if (!retryCommand) {
        return {
            ...firstAttempt,
            attempts,
        };
    }
    const elapsed = Date.now() - startedAt;
    const remainingTimeout = Math.max(100, timeoutMs - elapsed);
    const retryAttemptRaw = await executeSingleShellCommand({
        command: retryCommand,
        workdir: input.workdir,
        timeout: remainingTimeout,
    });
    const retryAttempt = attachCommandRecoveryHints(retryCommand, retryAttemptRaw);
    attempts.push({
        command: retryCommand,
        exitCode: retryAttempt.exitCode,
        stdout: retryAttempt.stdout,
        stderr: retryAttempt.stderr,
    });
    return {
        ...retryAttempt,
        retry_attempted: true,
        retry_command: retryCommand,
        resolved_by_retry: retryAttempt.exitCode === 0,
        attempts,
    };
}
const bashInputSchema = z.object({
    command: z.string().min(1),
    workdir: z.string().optional(),
    timeout: z.number().int().positive().max(300_000).optional(),
});
const bashOutputSchema = z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    rejected: z.boolean(),
    reason: z.string().optional(),
    error_type: z.enum(['not_found', 'unknown']).optional(),
    suggested_fix: z.string().optional(),
    alternative_commands: z.array(z.string()).optional(),
    probe_commands: z.array(z.string()).optional(),
    retry_attempted: z.boolean().optional(),
    retry_command: z.string().optional(),
    resolved_by_retry: z.boolean().optional(),
    attempts: z.array(z.object({
        command: z.string(),
        exitCode: z.number(),
        stdout: z.string(),
        stderr: z.string(),
    })).optional(),
    command_recovery: z.object({
        failedCommand: z.string(),
        baseCommand: z.string(),
        platform: z.enum(['windows', 'macos', 'linux']),
        alternativeCommands: z.array(z.string()),
        staticAlternatives: z.array(z.string()),
        discoveredCommands: z.array(z.string()),
        probeCommands: z.array(z.string()),
        suggestion: z.string(),
    }).optional(),
});
export const bashTool = createTool({
    id: 'bash',
    description: 'Execute safe shell commands for read and low-risk operations.',
    inputSchema: bashInputSchema,
    outputSchema: bashOutputSchema,
    execute: async (inputData) => {
        if (isDangerousCommand(inputData.command)) {
            return {
                stdout: '',
                stderr: 'Command rejected by policy (dangerous pattern detected).',
                exitCode: 126,
                rejected: true,
                reason: 'dangerous_command',
            };
        }
        if (needsApprovalForCommand(inputData.command)) {
            return {
                stdout: '',
                stderr: 'This command requires approval. Please use bash_approval tool.',
                exitCode: 125,
                rejected: true,
                reason: 'approval_required',
            };
        }
        return await executeShellCommand(inputData);
    },
});
export const bashApprovalTool = createTool({
    id: 'bash_approval',
    description: 'Execute potentially mutating shell commands. Always requires user approval.',
    inputSchema: bashInputSchema,
    outputSchema: bashOutputSchema,
    requireApproval: true,
    execute: async (inputData) => {
        if (isDangerousCommand(inputData.command)) {
            return {
                stdout: '',
                stderr: 'Command rejected by policy (dangerous pattern detected).',
                exitCode: 126,
                rejected: true,
                reason: 'dangerous_command',
            };
        }
        return await executeShellCommand(inputData);
    },
});
