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

describe('additional commands full-chain e2e', () => {
    test('bootstrap_runtime_context enables doctor_preflight and runtime snapshot baseline', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-bootstrap-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const bootstrapCommandId = `cmd-bootstrap-${randomUUID()}`;
        const bootstrapFromIndex = session.mark();
        session.send({
            id: bootstrapCommandId,
            timestamp: new Date().toISOString(),
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    appDataDir: appDataDirInTest,
                    appDir: '/tmp/fullchain-app',
                    shell: '/bin/zsh',
                    resourceId: 'employee-bootstrap',
                },
            },
        });
        const bootstrapResponse = await session.waitFor(
            bootstrapFromIndex,
            (message) => message.type === 'bootstrap_runtime_context_response' && message.commandId === bootstrapCommandId,
            8_000,
        );
        expect(toRecord(bootstrapResponse.payload).success).toBe(true);

        const doctorCommandId = `cmd-doctor-${randomUUID()}`;
        const doctorFromIndex = session.mark();
        session.send({
            id: doctorCommandId,
            timestamp: new Date().toISOString(),
            type: 'doctor_preflight',
            payload: {},
        });
        const doctorResponse = await session.waitFor(
            doctorFromIndex,
            (message) => message.type === 'doctor_preflight_response' && message.commandId === doctorCommandId,
            8_000,
        );
        const doctorPayload = toRecord(doctorResponse.payload);
        expect(doctorPayload.success).toBe(true);
        const report = toRecord(doctorPayload.report);
        expect(report.runtime).toBe('mastra');
        expect(report.status).toBe('ok');
        expect(report.hasRuntimeContext).toBe(true);

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
        expect(Number(snapshot.count)).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(snapshot.tasks)).toBe(true);
    }, 30_000);

    test('scheduled start_task inherits bootstrap resourceId in runtime snapshot', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-resource-bootstrap-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const resourceId = `employee-bootstrap-${randomUUID()}`;
        const bootstrapCommandId = `cmd-bootstrap-${randomUUID()}`;
        const bootstrapFromIndex = session.mark();
        session.send({
            id: bootstrapCommandId,
            timestamp: new Date().toISOString(),
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    appDataDir: appDataDirInTest,
                    resourceId,
                },
            },
        });
        await session.waitFor(
            bootstrapFromIndex,
            (message) => message.type === 'bootstrap_runtime_context_response' && message.commandId === bootstrapCommandId,
            8_000,
        );

        const taskId = `task-resource-bootstrap-${randomUUID()}`;
        const startCommandId = `cmd-start-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'hydration-reminder',
                userQuery: '10分钟后提醒我喝水',
                context: {
                    workspacePath: '/tmp/resource-bootstrap-fullchain',
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
        const snapshot = toRecord(toRecord(snapshotResponse.payload).snapshot);
        const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.map((task) => toRecord(task)) : [];
        const task = tasks.find((item) => toString(item.taskId) === taskId);
        expect(task).toBeDefined();
        expect(toString(task?.status)).toBe('scheduled');
        expect(toString(task?.resourceId)).toBe(resourceId);
    }, 30_000);

    test('start_task resourceId override takes precedence over bootstrap resourceId', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-resource-override-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const bootstrapCommandId = `cmd-bootstrap-${randomUUID()}`;
        const bootstrapFromIndex = session.mark();
        session.send({
            id: bootstrapCommandId,
            timestamp: new Date().toISOString(),
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    appDataDir: appDataDirInTest,
                    resourceId: 'employee-bootstrap',
                },
            },
        });
        await session.waitFor(
            bootstrapFromIndex,
            (message) => message.type === 'bootstrap_runtime_context_response' && message.commandId === bootstrapCommandId,
            8_000,
        );

        const taskId = `task-resource-override-${randomUUID()}`;
        const resourceId = `employee-command-${randomUUID()}`;
        const startCommandId = `cmd-start-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'override-reminder',
                userQuery: '10分钟后提醒我站起来活动',
                resourceId,
                context: {
                    workspacePath: '/tmp/resource-override-fullchain',
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
        const snapshot = toRecord(toRecord(snapshotResponse.payload).snapshot);
        const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.map((task) => toRecord(task)) : [];
        const task = tasks.find((item) => toString(item.taskId) === taskId);
        expect(task).toBeDefined();
        expect(toString(task?.resourceId)).toBe(resourceId);
    }, 30_000);

    test('workspace lifecycle commands are handled through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-workspace-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const listBeforeId = `cmd-list-workspaces-before-${randomUUID()}`;
        const listBeforeIndex = session.mark();
        session.send({
            id: listBeforeId,
            timestamp: new Date().toISOString(),
            type: 'list_workspaces',
            payload: {},
        });
        const listBefore = await session.waitFor(
            listBeforeIndex,
            (message) => message.type === 'list_workspaces_response' && message.commandId === listBeforeId,
            8_000,
        );
        const initialWorkspaces = Array.isArray(toRecord(listBefore.payload).workspaces)
            ? toRecord(listBefore.payload).workspaces as unknown[]
            : [];
        expect(initialWorkspaces.length).toBe(0);

        const createId = `cmd-create-workspace-${randomUUID()}`;
        const createIndex = session.mark();
        session.send({
            id: createId,
            timestamp: new Date().toISOString(),
            type: 'create_workspace',
            payload: {
                name: 'Full Chain Workspace',
                path: 'default',
            },
        });
        const created = await session.waitFor(
            createIndex,
            (message) => message.type === 'create_workspace_response' && message.commandId === createId,
            8_000,
        );
        const createPayload = toRecord(created.payload);
        expect(createPayload.success).toBe(true);
        const workspace = toRecord(createPayload.workspace);
        const workspaceId = toString(workspace.id);
        expect(workspaceId).not.toBe('');
        expect(toString(workspace.path)).toContain(path.join(appDataDirInTest, 'workspaces'));

        const updateId = `cmd-update-workspace-${randomUUID()}`;
        const updateIndex = session.mark();
        session.send({
            id: updateId,
            timestamp: new Date().toISOString(),
            type: 'update_workspace',
            payload: {
                id: workspaceId,
                updates: {
                    name: 'Full Chain Workspace Updated',
                },
            },
        });
        const updated = await session.waitFor(
            updateIndex,
            (message) => message.type === 'update_workspace_response' && message.commandId === updateId,
            8_000,
        );
        expect(toRecord(updated.payload).success).toBe(true);
        expect(toString(toRecord(toRecord(updated.payload).workspace).name)).toBe('Full Chain Workspace Updated');

        const deleteId = `cmd-delete-workspace-${randomUUID()}`;
        const deleteIndex = session.mark();
        session.send({
            id: deleteId,
            timestamp: new Date().toISOString(),
            type: 'delete_workspace',
            payload: {
                id: workspaceId,
            },
        });
        const deleted = await session.waitFor(
            deleteIndex,
            (message) => message.type === 'delete_workspace_response' && message.commandId === deleteId,
            8_000,
        );
        expect(toRecord(deleted.payload).success).toBe(true);
    }, 30_000);

    test('capability and directive commands remain reachable in full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-capability-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const listToolpacksId = `cmd-list-toolkpacks-${randomUUID()}`;
        const listToolpacksIndex = session.mark();
        session.send({
            id: listToolpacksId,
            timestamp: new Date().toISOString(),
            type: 'list_toolpacks',
            payload: {
                includeDisabled: true,
            },
        });
        const toolpacksResponse = await session.waitFor(
            listToolpacksIndex,
            (message) => message.type === 'list_toolpacks_response' && message.commandId === listToolpacksId,
            8_000,
        );
        expect(Array.isArray(toRecord(toolpacksResponse.payload).toolpacks)).toBe(true);

        const listSkillsId = `cmd-list-skills-${randomUUID()}`;
        const listSkillsIndex = session.mark();
        session.send({
            id: listSkillsId,
            timestamp: new Date().toISOString(),
            type: 'list_claude_skills',
            payload: {
                includeDisabled: true,
            },
        });
        const skillsResponse = await session.waitFor(
            listSkillsIndex,
            (message) => message.type === 'list_claude_skills_response' && message.commandId === listSkillsId,
            8_000,
        );
        expect(Array.isArray(toRecord(skillsResponse.payload).skills)).toBe(true);

        const directiveId = `fullchain-directive-${randomUUID()}`;
        const upsertId = `cmd-upsert-directive-${randomUUID()}`;
        const upsertIndex = session.mark();
        session.send({
            id: upsertId,
            timestamp: new Date().toISOString(),
            type: 'upsert_directive',
            payload: {
                directive: {
                    id: directiveId,
                    name: 'Full Chain Directive',
                    content: 'content',
                    enabled: true,
                    priority: 10,
                },
            },
        });
        const upsertResponse = await session.waitFor(
            upsertIndex,
            (message) => message.type === 'upsert_directive_response' && message.commandId === upsertId,
            8_000,
        );
        expect(toRecord(upsertResponse.payload).success).toBe(true);

        const listDirectivesId = `cmd-list-directives-${randomUUID()}`;
        const listDirectivesIndex = session.mark();
        session.send({
            id: listDirectivesId,
            timestamp: new Date().toISOString(),
            type: 'list_directives',
            payload: {},
        });
        const listDirectivesResponse = await session.waitFor(
            listDirectivesIndex,
            (message) => message.type === 'list_directives_response' && message.commandId === listDirectivesId,
            8_000,
        );
        const directives = Array.isArray(toRecord(listDirectivesResponse.payload).directives)
            ? toRecord(listDirectivesResponse.payload).directives.map((item) => toRecord(item))
            : [];
        expect(directives.some((item) => toString(item.id) === directiveId)).toBe(true);

        const removeDirectiveId = `cmd-remove-directive-${randomUUID()}`;
        const removeDirectiveIndex = session.mark();
        session.send({
            id: removeDirectiveId,
            timestamp: new Date().toISOString(),
            type: 'remove_directive',
            payload: {
                directiveId,
            },
        });
        const removeDirectiveResponse = await session.waitFor(
            removeDirectiveIndex,
            (message) => message.type === 'remove_directive_response' && message.commandId === removeDirectiveId,
            8_000,
        );
        expect(toRecord(removeDirectiveResponse.payload).success).toBe(true);

        const unsupportedId = `cmd-governance-${randomUUID()}`;
        const unsupportedIndex = session.mark();
        session.send({
            id: unsupportedId,
            timestamp: new Date().toISOString(),
            type: 'approve_extension_governance',
            payload: {},
        });
        const unsupportedResponse = await session.waitFor(
            unsupportedIndex,
            (message) => message.type === 'approve_extension_governance_response' && message.commandId === unsupportedId,
            8_000,
        );
        const unsupportedPayload = toRecord(unsupportedResponse.payload);
        expect(unsupportedPayload.success).toBe(false);
        expect(unsupportedPayload.error).toBe('unsupported_in_single_path_runtime');
    }, 30_000);
});
