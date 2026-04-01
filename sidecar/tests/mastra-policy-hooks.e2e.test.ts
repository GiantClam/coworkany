import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type JsonMessage = Record<string, unknown>;

const PROVIDER_KEY_ENVS = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'XAI_API_KEY',
    'GROQ_API_KEY',
    'DEEPSEEK_API_KEY',
    'MISTRAL_API_KEY',
    'OPENROUTER_API_KEY',
];

function resolveSidecarCwd(): string {
    const nested = path.join(process.cwd(), 'sidecar', 'src', 'main.ts');
    if (fs.existsSync(nested)) {
        return path.join(process.cwd(), 'sidecar');
    }
    return process.cwd();
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

class MastraStdioSession {
    private proc: Subprocess | null = null;
    private stdoutBuffer = '';
    private stderrBuffer = '';
    readonly messages: JsonMessage[] = [];
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;

    constructor(options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
        this.cwd = options?.cwd ?? resolveSidecarCwd();
        this.env = {
            ...process.env,
            ...(options?.env ?? {}),
        };
    }

    async start(): Promise<void> {
        this.proc = spawn({
            cmd: ['bun', 'run', 'src/main.ts'],
            cwd: this.cwd,
            env: this.env,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
        });
        this.readStdout();
        this.readStderr();
        await this.waitFor(0, (message) => message.type === 'ready' && message.runtime === 'mastra', 20_000);
    }

    private readStdout(): void {
        if (!this.proc) {
            return;
        }
        (async () => {
            try {
                for await (const chunk of this.proc!.stdout) {
                    this.stdoutBuffer += new TextDecoder().decode(chunk);
                    const lines = this.stdoutBuffer.split('\n');
                    this.stdoutBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.trim()) {
                            continue;
                        }
                        try {
                            this.messages.push(toRecord(JSON.parse(line) as unknown));
                        } catch {
                            // ignore non-json output
                        }
                    }
                }
            } catch {
                // stream closed
            }
        })();
    }

    private readStderr(): void {
        if (!this.proc) {
            return;
        }
        (async () => {
            try {
                for await (const chunk of this.proc!.stderr) {
                    this.stderrBuffer += new TextDecoder().decode(chunk);
                }
            } catch {
                // stream closed
            }
        })();
    }

    mark(): number {
        return this.messages.length;
    }

    send(message: JsonMessage): void {
        if (!this.proc?.stdin) {
            throw new Error('sidecar stdin unavailable');
        }
        this.proc.stdin.write(`${JSON.stringify(message)}\n`);
        this.proc.stdin.flush();
    }

    async waitFor(
        fromIndex: number,
        predicate: (message: JsonMessage) => boolean,
        timeoutMs: number,
    ): Promise<JsonMessage> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const hit = this.messages.slice(fromIndex).find((message) => predicate(message));
            if (hit) {
                return hit;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(
            `waitFor timed out after ${timeoutMs}ms. recent=${JSON.stringify(this.messages.slice(-10))} stderr=${this.stderrBuffer.slice(-500)}`,
        );
    }

    stop(): void {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
    }
}

let session: MastraStdioSession | null = null;
let appDataDirInTest: string | null = null;

afterEach(() => {
    session?.stop();
    session = null;
    if (appDataDirInTest && fs.existsSync(appDataDirInTest)) {
        fs.rmSync(appDataDirInTest, { recursive: true, force: true });
    }
    appDataDirInTest = null;
});

describe('mastra policy + hooks e2e', () => {
    test('records policy decisions and hook events, and enforces deny list for forwarded commands', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-policy-hooks-'));
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            COWORKANY_APP_DATA_DIR: appDataDirInTest,
            COWORKANY_MODEL: 'anthropic/claude-sonnet-4-5',
            COWORKANY_POLICY_DENY_FORWARD_COMMANDS: 'read_file',
        };
        for (const key of PROVIDER_KEY_ENVS) {
            delete env[key];
        }

        session = new MastraStdioSession({ env });
        await session.start();

        const taskId = `task-policy-hook-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: 'cmd-policy-hook-start',
            type: 'start_task',
            timestamp: new Date().toISOString(),
            payload: {
                taskId,
                userQuery: 'run a task to generate hooks',
                context: {
                    workspacePath: '/tmp/policy-hook-ws',
                },
            },
        });

        await session.waitFor(
            startFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === 'cmd-policy-hook-start',
            8_000,
        );
        await session.waitFor(
            startFromIndex,
            (message) => message.type === 'TASK_FAILED' && message.taskId === taskId,
            8_000,
        );

        const forwardFromIndex = session.mark();
        session.send({
            id: 'cmd-policy-denied-read',
            type: 'read_file',
            timestamp: new Date().toISOString(),
            payload: {
                path: '/tmp/forbidden.txt',
                taskId,
            },
        });

        const denied = await session.waitFor(
            forwardFromIndex,
            (message) => message.type === 'read_file_response' && message.commandId === 'cmd-policy-denied-read',
            8_000,
        );
        const deniedPayload = toRecord(denied.payload);
        expect(deniedPayload.success).toBe(false);
        expect(String(deniedPayload.error ?? '')).toContain('policy_denied:forward_command_blocked:read_file');

        const logFromIndex = session.mark();
        session.send({
            id: 'cmd-get-policy-log-e2e',
            type: 'get_policy_decision_log',
            timestamp: new Date().toISOString(),
            payload: {
                taskId,
            },
        });

        const logResponse = await session.waitFor(
            logFromIndex,
            (message) => message.type === 'get_policy_decision_log_response' && message.commandId === 'cmd-get-policy-log-e2e',
            8_000,
        );
        const logPayload = toRecord(logResponse.payload);
        const logEntries = Array.isArray(logPayload.entries)
            ? logPayload.entries.map((entry) => toRecord(entry))
            : [];
        expect(logEntries.some((entry) => entry.action === 'task_command')).toBe(true);
        expect(logEntries.some((entry) => entry.action === 'forward_command' && entry.allowed === false)).toBe(true);

        const hookFromIndex = session.mark();
        session.send({
            id: 'cmd-get-hook-events-e2e',
            type: 'get_hook_events',
            timestamp: new Date().toISOString(),
            payload: {
                taskId,
            },
        });

        const hookResponse = await session.waitFor(
            hookFromIndex,
            (message) => message.type === 'get_hook_events_response' && message.commandId === 'cmd-get-hook-events-e2e',
            8_000,
        );
        const hookPayload = toRecord(hookResponse.payload);
        const hookEntries = Array.isArray(hookPayload.entries)
            ? hookPayload.entries.map((entry) => toRecord(entry))
            : [];
        expect(hookEntries.some((entry) => entry.type === 'SessionStart')).toBe(true);
        expect(hookEntries.some((entry) => entry.type === 'TaskCreated')).toBe(true);
        expect(hookEntries.some((entry) => entry.type === 'PreCompact')).toBe(true);
        expect(hookEntries.some((entry) => entry.type === 'PostCompact')).toBe(true);
        expect(hookEntries.some((entry) => entry.type === 'TaskFailed')).toBe(true);

        const policyLogFile = path.join(appDataDirInTest, 'mastra-policy-decisions.json');
        const hookFile = path.join(appDataDirInTest, 'mastra-hook-events.json');
        expect(fs.existsSync(policyLogFile)).toBe(true);
        expect(fs.existsSync(hookFile)).toBe(true);
    }, 45_000);
});
