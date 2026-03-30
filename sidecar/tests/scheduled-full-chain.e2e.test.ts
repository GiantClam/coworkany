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

function toString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function parseScheduledStore(filePath: string): Array<Record<string, unknown>> {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
        return Array.isArray(parsed)
            ? parsed.map((item) => toRecord(item))
            : [];
    } catch {
        return [];
    }
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
        await this.waitFor(
            0,
            (message) => message.type === 'ready' && message.runtime === 'mastra',
            20_000,
        );
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
                        if (!line.trim()) {
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(line) as unknown;
                            this.messages.push(toRecord(parsed));
                        } catch {
                            // ignore non-json lines
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
            `waitFor timed out after ${timeoutMs}ms. fromIndex=${fromIndex} recent=${JSON.stringify(this.messages.slice(-10))} stderr=${this.stderrBuffer.slice(-600)}`,
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

describe('scheduled full-chain e2e', () => {
    test('routed chinese absolute-time task takes scheduled path even when provider keys are absent', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const commandId = `cmd-scheduled-${randomUUID()}`;
        const taskId = `task-scheduled-${randomUUID()}`;
        const fromIndex = session.mark();
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'shutdown-task',
                userQuery: '原始任务：早上3点关机\n用户路由：chat',
                context: {
                    workspacePath: '/tmp/scheduled-fullchain',
                },
            },
        });

        const startResponse = await session.waitFor(
            fromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === commandId,
            10_000,
        );
        expect(toRecord(startResponse.payload).success).toBe(true);

        const started = await session.waitFor(
            fromIndex,
            (message) => message.type === 'TASK_STARTED' && message.taskId === taskId,
            10_000,
        );
        const startedContext = toRecord(toRecord(started.payload).context);
        expect(startedContext.scheduled).toBe(true);

        const finished = await session.waitFor(
            fromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );
        const summary = toString(toRecord(finished.payload).summary);
        expect(summary).toContain('已安排在');

        const sinceStart = session.messages.slice(fromIndex);
        const missingKeyFailure = sinceStart.find((message) =>
            message.type === 'TASK_FAILED'
            && message.taskId === taskId
            && toString(toRecord(message.payload).error).includes('missing_api_key'),
        );
        expect(missingKeyFailure).toBeUndefined();

        const listCommandId = `cmd-get-tasks-${randomUUID()}`;
        const listFromIndex = session.mark();
        session.send({
            id: listCommandId,
            timestamp: new Date().toISOString(),
            type: 'get_tasks',
            payload: {
                workspacePath: '/tmp/scheduled-fullchain',
            },
        });
        const listResponse = await session.waitFor(
            listFromIndex,
            (message) => message.type === 'get_tasks_response' && message.commandId === listCommandId,
            8_000,
        );
        const listPayload = toRecord(listResponse.payload);
        expect(listPayload.success).toBe(true);
        const tasks = Array.isArray(listPayload.tasks) ? listPayload.tasks.map((task) => toRecord(task)) : [];
        expect(tasks.some((task) => task.taskId === taskId && task.status === 'scheduled')).toBe(true);

        const scheduledStorePath = path.join(appDataDirInTest, 'scheduled-tasks.json');
        const records = parseScheduledStore(scheduledStorePath);
        const record = records.find((item) => toString(item.sourceTaskId) === taskId);
        expect(record).toBeDefined();
        expect(toString(record?.status)).toBe('scheduled');
        expect(toString(record?.taskQuery)).toBe('关机');
    }, 30_000);

    test('recurring schedule query persists recurrence metadata through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-recurring-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const commandId = `cmd-recurring-${randomUUID()}`;
        const taskId = `task-recurring-${randomUUID()}`;
        const fromIndex = session.mark();
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'stand-up-reminder',
                userQuery: 'every 2 hours remind me to stand up',
                context: {
                    workspacePath: '/tmp/scheduled-recurring',
                },
            },
        });

        await session.waitFor(
            fromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === commandId,
            10_000,
        );
        await session.waitFor(
            fromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );

        const scheduledStorePath = path.join(appDataDirInTest, 'scheduled-tasks.json');
        const records = parseScheduledStore(scheduledStorePath);
        const record = records.find((item) => toString(item.sourceTaskId) === taskId);
        expect(record).toBeDefined();
        const schedulerMeta = toRecord(toRecord(record?.config).__mastraSchedulerMeta);
        const recurrence = toRecord(schedulerMeta.recurrence);
        expect(toString(recurrence.kind)).toBe('rrule');
        expect(toString(recurrence.value)).toBe('FREQ=HOURLY;INTERVAL=2');
    }, 30_000);

    test('chained schedule query emits chain summary and stores stage metadata through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-chain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const commandId = `cmd-chain-${randomUUID()}`;
        const taskId = `task-chain-${randomUUID()}`;
        const fromIndex = session.mark();
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'chain-task',
                userQuery: '10分钟后检查日志，然后20分钟后发总结',
                context: {
                    workspacePath: '/tmp/scheduled-chain',
                },
            },
        });

        await session.waitFor(
            fromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === commandId,
            10_000,
        );
        const finished = await session.waitFor(
            fromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );
        expect(toString(toRecord(finished.payload).summary)).toContain('已拆解为 2 个链式阶段任务');

        const scheduledStorePath = path.join(appDataDirInTest, 'scheduled-tasks.json');
        const records = parseScheduledStore(scheduledStorePath);
        const record = records.find((item) => toString(item.sourceTaskId) === taskId);
        expect(record).toBeDefined();
        expect(Number(record?.totalStages)).toBe(2);
        expect(Number(record?.stageIndex)).toBe(0);
        const schedulerMeta = toRecord(toRecord(record?.config).__mastraSchedulerMeta);
        const chained = Array.isArray(schedulerMeta.chainedStages) ? schedulerMeta.chainedStages : [];
        expect(chained.length).toBe(1);
    }, 30_000);

    test('duplicate scheduled creation is suppressed in full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-duplicate-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const taskId = `task-duplicate-${randomUUID()}`;
        const firstCommandId = `cmd-duplicate-a-${randomUUID()}`;
        const firstFromIndex = session.mark();
        session.send({
            id: firstCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'dup-schedule',
                userQuery: '10分钟后提醒我喝水',
                context: {
                    workspacePath: '/tmp/scheduled-duplicate',
                },
            },
        });
        await session.waitFor(
            firstFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === firstCommandId,
            10_000,
        );
        await session.waitFor(
            firstFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );

        const secondCommandId = `cmd-duplicate-b-${randomUUID()}`;
        const secondFromIndex = session.mark();
        session.send({
            id: secondCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'dup-schedule',
                userQuery: '10分钟后提醒我喝水',
                context: {
                    workspacePath: '/tmp/scheduled-duplicate',
                },
            },
        });
        await session.waitFor(
            secondFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === secondCommandId,
            10_000,
        );
        const secondFinished = await session.waitFor(
            secondFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );
        expect(toString(toRecord(secondFinished.payload).summary)).toContain('检测到重复的定时创建请求');

        const scheduledStorePath = path.join(appDataDirInTest, 'scheduled-tasks.json');
        const records = parseScheduledStore(scheduledStorePath);
        const activeRecords = records.filter((item) =>
            toString(item.sourceTaskId) === taskId
            && toString(item.status) === 'scheduled',
        );
        expect(activeRecords.length).toBe(1);
    }, 30_000);

    test('cancel scheduled task path updates scheduler store status to cancelled', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-cancel-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const taskId = `task-cancel-${randomUUID()}`;
        const startCommandId = `cmd-start-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'hydration-task',
                userQuery: '10分钟后提醒我喝水',
                context: {
                    workspacePath: '/tmp/scheduled-cancel',
                },
            },
        });
        await session.waitFor(
            startFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === startCommandId,
            10_000,
        );
        await session.waitFor(
            startFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );

        const cancelCommandId = `cmd-cancel-${randomUUID()}`;
        const cancelFromIndex = session.mark();
        session.send({
            id: cancelCommandId,
            timestamp: new Date().toISOString(),
            type: 'send_task_message',
            payload: {
                taskId,
                content: '取消这个定时任务',
            },
        });

        const cancelResponse = await session.waitFor(
            cancelFromIndex,
            (message) => message.type === 'send_task_message_response' && message.commandId === cancelCommandId,
            10_000,
        );
        expect(toRecord(cancelResponse.payload).success).toBe(true);

        const cancelledFinished = await session.waitFor(
            cancelFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled_cancel',
            10_000,
        );
        const cancelledSummary = toString(toRecord(cancelledFinished.payload).summary);
        expect(cancelledSummary).toContain('已取消');

        const scheduledStorePath = path.join(appDataDirInTest, 'scheduled-tasks.json');
        const records = parseScheduledStore(scheduledStorePath);
        const cancelled = records.find((item) =>
            toString(item.sourceTaskId) === taskId
            && toString(item.status) === 'cancelled',
        );
        expect(cancelled).toBeDefined();
    }, 30_000);

    test('cancel_task command cancels scheduled records and returns cancelledScheduledCount', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-cancel-command-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const taskId = `task-cancel-command-${randomUUID()}`;
        const startCommandId = `cmd-start-command-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'cancel-task-command',
                userQuery: '10分钟后提醒我提交日报',
                context: {
                    workspacePath: '/tmp/scheduled-cancel-command',
                },
            },
        });
        await session.waitFor(
            startFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === startCommandId,
            10_000,
        );
        await session.waitFor(
            startFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );

        const cancelCommandId = `cmd-cancel-command-${randomUUID()}`;
        const cancelFromIndex = session.mark();
        session.send({
            id: cancelCommandId,
            timestamp: new Date().toISOString(),
            type: 'cancel_task',
            payload: {
                taskId,
            },
        });
        const cancelResponse = await session.waitFor(
            cancelFromIndex,
            (message) => message.type === 'cancel_task_response' && message.commandId === cancelCommandId,
            10_000,
        );
        const cancelPayload = toRecord(cancelResponse.payload);
        expect(cancelPayload.success).toBe(true);
        expect(Number(cancelPayload.cancelledScheduledCount)).toBeGreaterThan(0);

        const scheduledStorePath = path.join(appDataDirInTest, 'scheduled-tasks.json');
        const records = parseScheduledStore(scheduledStorePath);
        const cancelled = records.find((item) =>
            toString(item.sourceTaskId) === taskId
            && toString(item.status) === 'cancelled',
        );
        expect(cancelled).toBeDefined();
    }, 30_000);

    test('get_tasks status filter returns only scheduled tasks in full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-gettasks-filter-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const taskId = `task-filter-${randomUUID()}`;
        const startCommandId = `cmd-filter-start-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'filter-task',
                userQuery: '10分钟后提醒我喝水',
                context: {
                    workspacePath: '/tmp/scheduled-filter',
                },
            },
        });
        await session.waitFor(
            startFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === startCommandId,
            10_000,
        );
        await session.waitFor(
            startFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );

        const listCommandId = `cmd-filter-list-${randomUUID()}`;
        const listFromIndex = session.mark();
        session.send({
            id: listCommandId,
            timestamp: new Date().toISOString(),
            type: 'get_tasks',
            payload: {
                workspacePath: '/tmp/scheduled-filter',
                status: ['scheduled'],
                limit: 10,
            },
        });
        const listResponse = await session.waitFor(
            listFromIndex,
            (message) => message.type === 'get_tasks_response' && message.commandId === listCommandId,
            10_000,
        );
        const payload = toRecord(listResponse.payload);
        expect(payload.success).toBe(true);
        const tasks = Array.isArray(payload.tasks) ? payload.tasks.map((item) => toRecord(item)) : [];
        expect(tasks.length).toBe(1);
        expect(toString(tasks[0]?.taskId)).toBe(taskId);
        expect(toString(tasks[0]?.status)).toBe('scheduled');
    }, 30_000);

    test('non-scheduled query still fails with missing_api_key when provider keys are absent', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-missing-key-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const commandId = `cmd-chat-${randomUUID()}`;
        const taskId = `task-chat-${randomUUID()}`;
        const fromIndex = session.mark();
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'chat-task',
                userQuery: '你好',
                context: {
                    workspacePath: '/tmp/non-scheduled-fullchain',
                },
            },
        });

        const startResponse = await session.waitFor(
            fromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === commandId,
            10_000,
        );
        expect(toRecord(startResponse.payload).success).toBe(true);

        const failed = await session.waitFor(
            fromIndex,
            (message) =>
                message.type === 'TASK_FAILED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).error).includes('missing_api_key'),
            12_000,
        );
        expect(failed).toBeDefined();
    }, 30_000);
});
