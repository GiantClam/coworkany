import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type JsonMessage = Record<string, unknown>;

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

describe('mastra context compression e2e', () => {
    test('records compressed context and MEMORY.md even when model preflight fails', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-context-compression-'));
        const workspacePath = path.join(appDataDirInTest, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });

        session = new MastraStdioSession({
            env: {
                ...process.env,
                COWORKANY_APP_DATA_DIR: appDataDirInTest,
                COWORKANY_MODEL: 'anthropic/claude-sonnet-4-5',
                ANTHROPIC_API_KEY: '',
            },
        });
        await session.start();

        const commandId = `cmd-context-${randomUUID()}`;
        const taskId = `task-context-${randomUUID()}`;
        const fromIndex = session.mark();
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'compression e2e',
                userQuery: '请先分析我的需求，再给出执行计划',
                context: {
                    workspacePath,
                },
            },
        });

        await session.waitFor(
            fromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === commandId,
            8_000,
        );
        await session.waitFor(
            fromIndex,
            (message) => message.type === 'TASK_FAILED' && message.taskId === taskId,
            8_000,
        );

        const contextStore = path.join(appDataDirInTest, 'mastra-context-state.json');
        expect(fs.existsSync(contextStore)).toBe(true);
        const contextRecords = JSON.parse(fs.readFileSync(contextStore, 'utf-8')) as Array<Record<string, unknown>>;
        const record = contextRecords.find((item) => item.taskId === taskId);
        expect(record).toBeDefined();
        expect(typeof record?.microSummary).toBe('string');
        expect(typeof record?.structuredSummary).toBe('string');

        const memoryFile = path.join(workspacePath, '.coworkany', 'MEMORY.md');
        expect(fs.existsSync(memoryFile)).toBe(true);
        const memoryContent = fs.readFileSync(memoryFile, 'utf-8');
        expect(memoryContent).toContain(taskId);
        expect(memoryContent).toContain('(memory/');

        const topicMemoryDir = path.join(workspacePath, '.coworkany', 'memory');
        expect(fs.existsSync(topicMemoryDir)).toBe(true);
        const topicFiles = fs.readdirSync(topicMemoryDir).filter((name) => name.endsWith('.md'));
        expect(topicFiles.length).toBeGreaterThan(0);
    }, 30_000);
});
