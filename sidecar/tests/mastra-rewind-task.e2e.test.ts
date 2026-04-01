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
        const stdoutStream = this.proc.stdout;
        (async () => {
            try {
                for await (const chunk of stdoutStream) {
                    this.stdoutBuffer += new TextDecoder().decode(chunk);
                    const lines = this.stdoutBuffer.split('\n');
                    this.stdoutBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.trim()) continue;
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
        const stderrStream = this.proc.stderr;
        (async () => {
            try {
                for await (const chunk of stderrStream) {
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

function buildNoProviderKeyEnv(appDataDir: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        COWORKANY_APP_DATA_DIR: appDataDir,
        COWORKANY_MODEL: 'anthropic/claude-sonnet-4-5',
        COWORKANY_RUNTIME_MODE: 'mastra',
    };
    for (const key of PROVIDER_KEY_ENVS) {
        delete env[key];
    }
    return env;
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

describe('mastra rewind task e2e', () => {
    test('rewind_task rewinds transcript and resets thread for the task', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-rewind-task-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const taskId = `task-rewind-${randomUUID()}`;
        const workspacePath = '/tmp/rewind-e2e';

        const startFrom = session.mark();
        const startId = `cmd-start-${randomUUID()}`;
        session.send({
            id: startId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                userQuery: 'first turn',
                context: {
                    workspacePath,
                },
            },
        });
        await session.waitFor(startFrom, (message) => message.type === 'start_task_response' && message.commandId === startId, 10_000);
        await session.waitFor(startFrom, (message) => message.type === 'TASK_FAILED' && message.taskId === taskId, 10_000);

        const followupFrom = session.mark();
        const followupId = `cmd-followup-${randomUUID()}`;
        session.send({
            id: followupId,
            timestamp: new Date().toISOString(),
            type: 'send_task_message',
            payload: {
                taskId,
                content: 'second turn',
            },
        });
        await session.waitFor(followupFrom, (message) => message.type === 'send_task_message_response' && message.commandId === followupId, 10_000);
        await session.waitFor(followupFrom, (message) => message.type === 'TASK_FAILED' && message.taskId === taskId, 10_000);

        const transcriptBeforeFrom = session.mark();
        const transcriptBeforeId = `cmd-transcript-before-${randomUUID()}`;
        session.send({
            id: transcriptBeforeId,
            timestamp: new Date().toISOString(),
            type: 'get_task_transcript',
            payload: {
                taskId,
            },
        });
        const transcriptBefore = await session.waitFor(
            transcriptBeforeFrom,
            (message) => message.type === 'get_task_transcript_response' && message.commandId === transcriptBeforeId,
            8_000,
        );
        const beforeEntries = Array.isArray(toRecord(transcriptBefore.payload).entries)
            ? (toRecord(transcriptBefore.payload).entries as Array<Record<string, unknown>>)
            : [];
        const beforeUserContents = beforeEntries
            .filter((entry) => entry.role === 'user')
            .map((entry) => String(entry.content));
        expect(beforeUserContents).toContain('first turn');
        expect(beforeUserContents).toContain('second turn');

        const rewindFrom = session.mark();
        const rewindId = `cmd-rewind-${randomUUID()}`;
        session.send({
            id: rewindId,
            timestamp: new Date().toISOString(),
            type: 'rewind_task',
            payload: {
                taskId,
                userTurns: 1,
            },
        });
        const rewindResponse = await session.waitFor(
            rewindFrom,
            (message) => message.type === 'rewind_task_response' && message.commandId === rewindId,
            8_000,
        );
        const rewindPayload = toRecord(rewindResponse.payload);
        expect(rewindPayload.success).toBe(true);
        expect(String(rewindPayload.newThreadId ?? '')).toContain(`${taskId}-rewind-`);

        const transcriptAfterFrom = session.mark();
        const transcriptAfterId = `cmd-transcript-after-${randomUUID()}`;
        session.send({
            id: transcriptAfterId,
            timestamp: new Date().toISOString(),
            type: 'get_task_transcript',
            payload: {
                taskId,
            },
        });
        const transcriptAfter = await session.waitFor(
            transcriptAfterFrom,
            (message) => message.type === 'get_task_transcript_response' && message.commandId === transcriptAfterId,
            8_000,
        );
        const afterEntries = Array.isArray(toRecord(transcriptAfter.payload).entries)
            ? (toRecord(transcriptAfter.payload).entries as Array<Record<string, unknown>>)
            : [];
        const afterUserContents = afterEntries
            .filter((entry) => entry.role === 'user')
            .map((entry) => String(entry.content));
        expect(afterUserContents).toContain('first turn');
        expect(afterUserContents).not.toContain('second turn');
    }, 40_000);
});
