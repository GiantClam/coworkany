import { spawn } from 'child_process';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

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
};

export function isDangerousCommand(command: string): boolean {
    return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

export function needsApprovalForCommand(command: string): boolean {
    return APPROVAL_PATTERNS.some((pattern) => pattern.test(command));
}

async function executeShellCommand(input: {
    command: string;
    workdir?: string;
    timeout?: number;
}): Promise<BashExecutionResult> {
    const timeoutMs = Math.max(100, input.timeout ?? 30_000);

    return await new Promise<BashExecutionResult>((resolve) => {
        const child = spawn(input.command, {
            cwd: input.workdir || process.cwd(),
            env: {
                ...process.env,
                LANG: 'en_US.UTF-8',
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
                stderr: stderr || `Command timed out after ${timeoutMs}ms`,
                exitCode: 124,
                rejected: false,
                reason: 'timeout',
            });
        }, timeoutMs);

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
