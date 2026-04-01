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
            `waitFor timed out after ${timeoutMs}ms. fromIndex=${fromIndex} recent=${JSON.stringify(this.messages.slice(-10))} stderr=${this.stderrBuffer.slice(-500)}`,
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

describe('mastra task state persistence e2e', () => {
    test('restarts with persisted scheduled task state visible in runtime snapshot', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-task-state-'));
        const env = buildNoProviderKeyEnv(appDataDirInTest);
        const taskId = `task-persist-${randomUUID()}`;
        const workspacePath = '/tmp/mastra-state-persist';

        session = new MastraStdioSession({ env });
        await session.start();

        const startCommandId = `cmd-start-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: '持久化测试',
                userQuery: '10 分钟后提醒我喝水',
                context: {
                    workspacePath,
                },
            },
        });

        const startResponse = await session.waitFor(
            startFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === startCommandId,
            10_000,
        );
        expect(toRecord(startResponse.payload).success).toBe(true);

        await session.waitFor(
            startFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            10_000,
        );

        session.stop();
        session = null;

        const stateFile = path.join(appDataDirInTest, 'mastra-task-runtime-state.json');
        expect(fs.existsSync(stateFile)).toBe(true);
        const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Array<Record<string, unknown>>;
        expect(persisted.some((item) => toString(item.taskId) === taskId)).toBe(true);

        session = new MastraStdioSession({ env });
        await session.start();

        const snapshotCommandId = `cmd-snapshot-${randomUUID()}`;
        const snapshotFromIndex = session.mark();
        session.send({
            id: snapshotCommandId,
            timestamp: new Date().toISOString(),
            type: 'get_runtime_snapshot',
            payload: {},
        });

        const snapshotResponse = await session.waitFor(
            snapshotFromIndex,
            (message) => message.type === 'get_runtime_snapshot_response' && message.commandId === snapshotCommandId,
            8_000,
        );
        const snapshotPayload = toRecord(snapshotResponse.payload);
        expect(snapshotPayload.success).toBe(true);
        const snapshot = toRecord(snapshotPayload.snapshot);
        const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.map((item) => toRecord(item)) : [];
        const persistedTask = tasks.find((item) => toString(item.taskId) === taskId);

        expect(persistedTask).toBeDefined();
        expect(toString(persistedTask?.status)).toBe('scheduled');
        expect(toString(persistedTask?.workspacePath)).toBe(workspacePath);
    }, 40_000);

    test('restarts with persisted remote session bindings', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-remote-session-state-'));
        const env = buildNoProviderKeyEnv(appDataDirInTest);

        session = new MastraStdioSession({ env });
        await session.start();

        const openCommandId = `cmd-open-remote-${randomUUID()}`;
        const openFromIndex = session.mark();
        session.send({
            id: openCommandId,
            timestamp: new Date().toISOString(),
            type: 'open_remote_session',
            payload: {
                taskId: 'task-remote-persist',
                remoteSessionId: 'remote-persist-1',
                channel: 'slack',
            },
        });
        const openResponse = await session.waitFor(
            openFromIndex,
            (message) => message.type === 'open_remote_session_response' && message.commandId === openCommandId,
            8_000,
        );
        expect(toRecord(openResponse.payload).success).toBe(true);

        session.stop();
        session = null;

        const remoteSessionFile = path.join(appDataDirInTest, 'mastra-remote-sessions.json');
        expect(fs.existsSync(remoteSessionFile)).toBe(true);

        session = new MastraStdioSession({ env });
        await session.start();

        const listCommandId = `cmd-list-remote-${randomUUID()}`;
        const listFromIndex = session.mark();
        session.send({
            id: listCommandId,
            timestamp: new Date().toISOString(),
            type: 'list_remote_sessions',
            payload: {
                taskId: 'task-remote-persist',
            },
        });
        const listResponse = await session.waitFor(
            listFromIndex,
            (message) => message.type === 'list_remote_sessions_response' && message.commandId === listCommandId,
            8_000,
        );
        const listPayload = toRecord(listResponse.payload);
        const sessions = Array.isArray(listPayload.sessions)
            ? listPayload.sessions.map((item) => toRecord(item))
            : [];
        const target = sessions.find((item) => toString(item.remoteSessionId) === 'remote-persist-1');
        expect(target).toBeDefined();
        expect(toString(target?.taskId)).toBe('task-remote-persist');
    }, 40_000);

    test('restarts with persisted checkpoint runtime state', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-checkpoint-state-'));
        const env = buildNoProviderKeyEnv(appDataDirInTest);

        session = new MastraStdioSession({ env });
        await session.start();

        const setCheckpointId = `cmd-set-checkpoint-${randomUUID()}`;
        const setFromIndex = session.mark();
        session.send({
            id: setCheckpointId,
            timestamp: new Date().toISOString(),
            type: 'set_task_checkpoint',
            payload: {
                taskId: 'task-checkpoint-persist',
                checkpointId: 'cp-persist-1',
                label: 'Need review',
                reason: 'checkpoint',
            },
        });
        const setResponse = await session.waitFor(
            setFromIndex,
            (message) => message.type === 'set_task_checkpoint_response' && message.commandId === setCheckpointId,
            8_000,
        );
        expect(toRecord(setResponse.payload).success).toBe(true);

        const beforeStateId = `cmd-state-before-${randomUUID()}`;
        const beforeStateFrom = session.mark();
        session.send({
            id: beforeStateId,
            timestamp: new Date().toISOString(),
            type: 'get_task_runtime_state',
            payload: {
                taskId: 'task-checkpoint-persist',
            },
        });
        const beforeStateResponse = await session.waitFor(
            beforeStateFrom,
            (message) => message.type === 'get_task_runtime_state_response' && message.commandId === beforeStateId,
            8_000,
        );
        const beforeState = toRecord(toRecord(beforeStateResponse.payload).state);
        expect(toString(beforeState.status)).toBe('suspended');
        expect(toString(toRecord(beforeState.checkpoint).id)).toBe('cp-persist-1');

        session.stop();
        session = null;

        session = new MastraStdioSession({ env });
        await session.start();

        const afterStateId = `cmd-state-after-${randomUUID()}`;
        const afterStateFrom = session.mark();
        session.send({
            id: afterStateId,
            timestamp: new Date().toISOString(),
            type: 'get_task_runtime_state',
            payload: {
                taskId: 'task-checkpoint-persist',
            },
        });
        const afterStateResponse = await session.waitFor(
            afterStateFrom,
            (message) => message.type === 'get_task_runtime_state_response' && message.commandId === afterStateId,
            8_000,
        );
        const afterState = toRecord(toRecord(afterStateResponse.payload).state);
        expect(toString(afterState.status)).toBe('suspended');
        expect(toString(toRecord(afterState.checkpoint).id)).toBe('cp-persist-1');
    }, 40_000);

    test('restarts with persisted pending channel delivery events', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-channel-delivery-state-'));
        const env = buildNoProviderKeyEnv(appDataDirInTest);

        session = new MastraStdioSession({ env });
        await session.start();

        const bindId = `cmd-bind-delivery-${randomUUID()}`;
        const bindFrom = session.mark();
        session.send({
            id: bindId,
            timestamp: new Date().toISOString(),
            type: 'bind_remote_session',
            payload: {
                taskId: 'task-delivery-persist',
                remoteSessionId: 'remote-delivery-persist-1',
            },
        });
        await session.waitFor(
            bindFrom,
            (message) => message.type === 'bind_remote_session_response' && message.commandId === bindId,
            8_000,
        );

        const injectId = `cmd-inject-delivery-${randomUUID()}`;
        const injectFrom = session.mark();
        session.send({
            id: injectId,
            timestamp: new Date().toISOString(),
            type: 'inject_channel_event',
            payload: {
                remoteSessionId: 'remote-delivery-persist-1',
                channel: 'slack',
                eventType: 'mention',
                content: 'persist this delivery',
            },
        });
        const injectResponse = await session.waitFor(
            injectFrom,
            (message) => message.type === 'inject_channel_event_response' && message.commandId === injectId,
            8_000,
        );
        const deliveryId = toString(toRecord(toRecord(injectResponse.payload).delivery).id);
        expect(deliveryId).not.toBe('');

        session.stop();
        session = null;

        session = new MastraStdioSession({ env });
        await session.start();

        const listId = `cmd-list-delivery-${randomUUID()}`;
        const listFrom = session.mark();
        session.send({
            id: listId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-delivery-persist-1',
                status: 'pending',
            },
        });
        const listResponse = await session.waitFor(
            listFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === listId,
            8_000,
        );
        const events = Array.isArray(toRecord(listResponse.payload).events)
            ? (toRecord(listResponse.payload).events as unknown[]).map((item) => toRecord(item))
            : [];
        expect(events.some((event) => toString(event.id) === deliveryId)).toBe(true);
    }, 40_000);

    test('restarts and sync_remote_session can replay + ack persisted deliveries', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-remote-sync-state-'));
        const env = buildNoProviderKeyEnv(appDataDirInTest);

        session = new MastraStdioSession({ env });
        await session.start();

        const bindId = `cmd-bind-sync-${randomUUID()}`;
        const bindFrom = session.mark();
        session.send({
            id: bindId,
            timestamp: new Date().toISOString(),
            type: 'bind_remote_session',
            payload: {
                taskId: 'task-sync-persist',
                remoteSessionId: 'remote-sync-persist-1',
            },
        });
        await session.waitFor(
            bindFrom,
            (message) => message.type === 'bind_remote_session_response' && message.commandId === bindId,
            8_000,
        );

        const injectId = `cmd-inject-sync-${randomUUID()}`;
        const injectFrom = session.mark();
        session.send({
            id: injectId,
            timestamp: new Date().toISOString(),
            type: 'inject_channel_event',
            payload: {
                remoteSessionId: 'remote-sync-persist-1',
                channel: 'slack',
                eventType: 'mention',
                content: 'replay after restart',
                eventId: 'delivery-sync-persist-1',
            },
        });
        await session.waitFor(
            injectFrom,
            (message) => message.type === 'inject_channel_event_response' && message.commandId === injectId,
            8_000,
        );

        session.stop();
        session = null;

        session = new MastraStdioSession({ env });
        await session.start();

        const syncId = `cmd-sync-${randomUUID()}`;
        const syncFrom = session.mark();
        session.send({
            id: syncId,
            timestamp: new Date().toISOString(),
            type: 'sync_remote_session',
            payload: {
                remoteSessionId: 'remote-sync-persist-1',
                replayPending: true,
                ackReplayed: true,
            },
        });
        const syncResponse = await session.waitFor(
            syncFrom,
            (message) => message.type === 'sync_remote_session_response' && message.commandId === syncId,
            8_000,
        );
        const syncPayload = toRecord(syncResponse.payload);
        expect(syncPayload.success).toBe(true);
        expect(Number(syncPayload.replayedCount)).toBe(1);
        expect(Number(syncPayload.ackedCount)).toBe(1);

        await session.waitFor(
            syncFrom,
            (message) =>
                message.type === 'TASK_EVENT'
                && message.taskId === 'task-sync-persist'
                && toString(toRecord(message.payload).action) === 'replayed_on_sync'
                && toString(toRecord(message.payload).deliveryId) === 'delivery-sync-persist-1',
            8_000,
        );

        const ackedListId = `cmd-acked-list-${randomUUID()}`;
        const ackedListFrom = session.mark();
        session.send({
            id: ackedListId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-sync-persist-1',
                status: 'acked',
            },
        });
        const ackedListResponse = await session.waitFor(
            ackedListFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === ackedListId,
            8_000,
        );
        const ackedEvents = Array.isArray(toRecord(ackedListResponse.payload).events)
            ? (toRecord(ackedListResponse.payload).events as unknown[]).map((item) => toRecord(item))
            : [];
        expect(ackedEvents.some((event) => toString(event.id) === 'delivery-sync-persist-1')).toBe(true);
    }, 40_000);
});
