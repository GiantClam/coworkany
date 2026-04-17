import { spawn } from 'child_process';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import {
    buildCommandRecoveryHints,
    type CommandRecoveryHints,
} from '../../utils/commandAlternatives';
import { checkCommand } from '../../tools/commandSandbox';
export const DANGEROUS_PATTERNS: RegExp[] = [
    /\brm\s+-rf\s+\/?\s*$/i,
    /\brm\s+-rf\s+~\//i,
    /\bsudo\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    />\s*\/dev\//i,
    /\bcurl\b[^\n|]*\|\s*(sh|bash)\b/i,
    /\bchmod\s+777\b/i,
];
export const APPROVAL_PATTERNS: RegExp[] = [
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
    workdir?: string;
    timeout: number;
}): Promise<BashExecutionResult> {
    return await new Promise<BashExecutionResult>((resolve) => {
        const child = spawn(input.command, {
            cwd: input.workdir || process.cwd(),
            env: {
                ...process.env,
                LANG: 'en_US.UTF-8',
                PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE ?? '1',
            },
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result: BashExecutionResult): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish({
                stdout,
                stderr: stderr || `Command timed out after ${input.timeout}ms`,
                exitCode: 124,
                rejected: false,
                reason: 'timeout',
            });
        }, input.timeout);
        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
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
                stderr,
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
    const firstAttemptRaw = await executeSingleShellCommand({
        command: input.command,
        workdir: input.workdir,
        timeout: timeoutMs,
    });
    const firstAttempt = attachCommandRecoveryHints(input.command, firstAttemptRaw);
    const attempts: BashExecutionResult['attempts'] = [{
        command: input.command,
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
