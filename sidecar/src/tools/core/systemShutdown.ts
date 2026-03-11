import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ToolDefinition, ToolContext } from '../standard';

type ShutdownState = {
    active: boolean;
    action: 'shutdown';
    delaySeconds: number;
    scheduledAt: string;
    requestedAt: string;
    command: string;
    reason?: string;
    source: 'system_shutdown_schedule';
};

type ParsedSchedule = {
    delaySeconds: number;
    scheduledAt: Date;
    source: 'delaySeconds' | 'relative' | 'absolute';
};

function getStateFilePath(workspacePath: string): string {
    const coworkanyDir = path.join(workspacePath, '.coworkany');
    if (!fs.existsSync(coworkanyDir)) {
        fs.mkdirSync(coworkanyDir, { recursive: true });
    }
    return path.join(coworkanyDir, 'system-shutdown.json');
}

function loadState(workspacePath: string): ShutdownState | null {
    const filePath = getStateFilePath(workspacePath);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ShutdownState>;
        if (!parsed || parsed.active !== true || parsed.action !== 'shutdown' || typeof parsed.scheduledAt !== 'string') {
            return null;
        }
        return {
            active: true,
            action: 'shutdown',
            delaySeconds: Number(parsed.delaySeconds || 0),
            scheduledAt: parsed.scheduledAt,
            requestedAt: typeof parsed.requestedAt === 'string' ? parsed.requestedAt : new Date().toISOString(),
            command: typeof parsed.command === 'string' ? parsed.command : '',
            reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
            source: 'system_shutdown_schedule',
        };
    } catch {
        return null;
    }
}

function saveState(workspacePath: string, state: ShutdownState): void {
    fs.writeFileSync(getStateFilePath(workspacePath), JSON.stringify(state, null, 2), 'utf-8');
}

function clearState(workspacePath: string): void {
    const filePath = getStateFilePath(workspacePath);
    if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
    }
}

function parseAbsoluteTime(input: string, now: Date): Date | null {
    const normalized = input.trim().replace(/[：]/g, ':').replace(/\s+/g, ' ');
    const todayMatch = normalized.match(/^(今天|今日)\s*(\d{1,2}):(\d{2})$/);
    const tomorrowMatch = normalized.match(/^(明天)\s*(\d{1,2}):(\d{2})$/);
    const timeOnlyMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);

    const buildDate = (base: Date, hourText: string, minuteText: string): Date => {
        const result = new Date(base);
        result.setHours(Number(hourText), Number(minuteText), 0, 0);
        return result;
    };

    if (todayMatch) {
        return buildDate(now, todayMatch[2], todayMatch[3]);
    }

    if (tomorrowMatch) {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        return buildDate(tomorrow, tomorrowMatch[2], tomorrowMatch[3]);
    }

    if (timeOnlyMatch) {
        const candidate = buildDate(now, timeOnlyMatch[1], timeOnlyMatch[2]);
        if (candidate.getTime() <= now.getTime()) {
            candidate.setDate(candidate.getDate() + 1);
        }
        return candidate;
    }

    return null;
}

function parseRelativeDelay(input: string): number | null {
    const normalized = input.trim().replace(/\s+/g, '');
    const minuteMatch = normalized.match(/^(\d+)\s*(分钟后|分后)$/);
    if (minuteMatch) {
        return Number(minuteMatch[1]) * 60;
    }

    const hourMatch = normalized.match(/^(\d+)\s*(小时后|个小时后)$/);
    if (hourMatch) {
        return Number(hourMatch[1]) * 3600;
    }

    return null;
}

function parseSchedule(args: Record<string, unknown>, now = new Date()): ParsedSchedule {
    const delaySeconds = Number(args.delaySeconds);
    if (Number.isFinite(delaySeconds) && delaySeconds > 0) {
        return {
            delaySeconds: Math.round(delaySeconds),
            scheduledAt: new Date(now.getTime() + Math.round(delaySeconds) * 1000),
            source: 'delaySeconds',
        };
    }

    const when = typeof args.when === 'string' ? args.when.trim() : '';
    if (!when) {
        throw new Error('Provide either delaySeconds or when.');
    }

    const relativeSeconds = parseRelativeDelay(when);
    if (relativeSeconds && relativeSeconds > 0) {
        return {
            delaySeconds: relativeSeconds,
            scheduledAt: new Date(now.getTime() + relativeSeconds * 1000),
            source: 'relative',
        };
    }

    const absoluteTime = parseAbsoluteTime(when, now);
    if (!absoluteTime) {
        throw new Error(`Unsupported time format: ${when}`);
    }

    const diffMs = absoluteTime.getTime() - now.getTime();
    if (diffMs <= 0) {
        throw new Error(`Target time has already passed: ${when}`);
    }

    return {
        delaySeconds: Math.ceil(diffMs / 1000),
        scheduledAt: absoluteTime,
        source: 'absolute',
    };
}

function runWindowsShutdown(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn('shutdown', args, {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => resolve({ exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
}

function buildStatusFromState(workspacePath: string): Record<string, unknown> {
    const current = loadState(workspacePath);
    if (!current) {
        return {
            success: true,
            scheduled: false,
            status: 'none',
            message: 'No pending CoworkAny-managed shutdown is recorded.',
        };
    }

    const scheduledAt = new Date(current.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        clearState(workspacePath);
        return {
            success: true,
            scheduled: false,
            status: 'expired',
            message: 'Previously recorded shutdown has expired or is no longer verifiable.',
        };
    }

    const remainingSeconds = Math.max(0, Math.ceil((scheduledAt.getTime() - Date.now()) / 1000));
    return {
        success: true,
        scheduled: true,
        status: 'scheduled',
        action: current.action,
        scheduledAt: current.scheduledAt,
        remainingSeconds,
        delaySeconds: current.delaySeconds,
        command: current.command,
        reason: current.reason,
        source: current.source,
        verification: 'CoworkAny tracked the shutdown request locally after the OS command succeeded.',
        message: `Shutdown is scheduled for ${current.scheduledAt}.`,
    };
}

export const systemShutdownScheduleTool: ToolDefinition = {
    name: 'system_shutdown_schedule',
    description: 'Schedule a one-time system shutdown on Windows. Use this instead of run_command when the user asks to shut down the computer at a specific time or after N minutes/hours.',
    effects: ['process:spawn', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            when: {
                type: 'string',
                description: 'Natural time like "今天14:00", "明天09:30", "10分钟后", or "2小时后".',
            },
            delaySeconds: {
                type: 'integer',
                description: 'Optional direct delay in seconds.',
            },
            reason: {
                type: 'string',
                description: 'Optional human-readable reason for the scheduled shutdown.',
            },
        },
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
        if (process.platform !== 'win32') {
            return {
                success: false,
                error: 'system_shutdown_schedule currently supports Windows only.',
            };
        }

        try {
            const parsed = parseSchedule(args);
            const commandArgs = ['/s', '/t', String(parsed.delaySeconds)];
            const command = `shutdown ${commandArgs.join(' ')}`;
            const result = await runWindowsShutdown(commandArgs);

            if (result.exitCode !== 0) {
                return {
                    success: false,
                    error: result.stderr || result.stdout || `shutdown exited with code ${result.exitCode}`,
                    command,
                    exitCode: result.exitCode,
                };
            }

            const state: ShutdownState = {
                active: true,
                action: 'shutdown',
                delaySeconds: parsed.delaySeconds,
                scheduledAt: parsed.scheduledAt.toISOString(),
                requestedAt: new Date().toISOString(),
                command,
                reason: typeof args.reason === 'string' ? args.reason : undefined,
                source: 'system_shutdown_schedule',
            };
            saveState(context.workspacePath, state);

            return {
                success: true,
                scheduled: true,
                action: 'shutdown',
                command,
                delaySeconds: parsed.delaySeconds,
                scheduledAt: state.scheduledAt,
                source: parsed.source,
                reason: state.reason,
                stdout: result.stdout,
                stderr: result.stderr,
                verification: 'Use system_shutdown_status to confirm the CoworkAny-managed pending shutdown state.',
                message: `Shutdown scheduled for ${state.scheduledAt}.`,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

export const systemShutdownStatusTool: ToolDefinition = {
    name: 'system_shutdown_status',
    description: 'Check whether CoworkAny currently tracks a pending system shutdown request in the active workspace.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {},
    },
    handler: async (_args: Record<string, unknown>, context: ToolContext) => {
        if (process.platform !== 'win32') {
            return {
                success: false,
                error: 'system_shutdown_status currently supports Windows only.',
            };
        }

        return buildStatusFromState(context.workspacePath);
    },
};

export const systemShutdownCancelTool: ToolDefinition = {
    name: 'system_shutdown_cancel',
    description: 'Cancel a previously scheduled Windows shutdown. Use this only when the user explicitly asks to cancel pending shutdown.',
    effects: ['process:spawn', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {},
    },
    handler: async (_args: Record<string, unknown>, context: ToolContext) => {
        if (process.platform !== 'win32') {
            return {
                success: false,
                error: 'system_shutdown_cancel currently supports Windows only.',
            };
        }

        const result = await runWindowsShutdown(['/a']);
        if (result.exitCode !== 0) {
            return {
                success: false,
                error: result.stderr || result.stdout || `shutdown /a exited with code ${result.exitCode}`,
                command: 'shutdown /a',
                exitCode: result.exitCode,
            };
        }

        clearState(context.workspacePath);
        return {
            success: true,
            scheduled: false,
            status: 'cancelled',
            command: 'shutdown /a',
            stdout: result.stdout,
            stderr: result.stderr,
            message: 'Pending shutdown cancelled.',
        };
    },
};

