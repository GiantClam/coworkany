import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

type SidecarResponse = {
    commandId: string;
    timestamp: string;
    type: string;
    payload: Record<string, unknown>;
};

type SidecarEvent = {
    id: string;
    taskId: string;
    timestamp: string;
    sequence: number;
    type: string;
    payload: Record<string, unknown>;
};

type WorkspaceRecord = {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    defaultSkills: string[];
    defaultToolpacks: string[];
};

const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HOST_SCAN_PATH = '/Users/beihuang/Documents';

type ConcurrentScenarioDefinition = {
    id: string;
    concurrency: number;
    expectedToolName: string;
    buildQuery: (input: { index: number; marker: string }) => string;
};

type ConcurrentTaskInput = {
    taskId: string;
    title: string;
    userQuery: string;
    workspacePath: string;
    marker: string;
};

type ScheduledDesktopScenario = {
    id: string;
    query: string;
    expectVoiceConfirmation: boolean;
};

type ListedSkillRecord = {
    manifest?: {
        id?: string;
        name?: string;
        version?: string;
        description?: string;
        tags?: string[];
        allowedTools?: string[];
    };
    provenance?: {
        sourceType?: string;
        sourceRef?: string;
    };
    enabled?: boolean;
};

type DesktopSkillKind = 'system' | 'custom';

type DesktopSkillScenarioDefinition = {
    id: string;
    skillId: string;
    skillKind: DesktopSkillKind;
    expectedToolName: string;
};

type DesktopSkillTaskInput = ConcurrentTaskInput & {
    skillId: string;
    skillKind: DesktopSkillKind;
};

type CustomSkillFixture = {
    skillId: string;
    skillDir: string;
};

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath: string, payload: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to allocate free port')));
                return;
            }
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(address.port);
            });
        });
    });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
        } catch {
            // keep polling
        }
        await wait(1000);
    }
    throw new Error(`Timed out waiting for HTTP endpoint: ${url}`);
}

class ResumeSidecarHarness {
    readonly desktopDir: string;
    readonly sidecarDir: string;
    readonly appDataDir: string;
    readonly devServerPort: number;
    readonly devServerUrl: string;
    readonly workspace: WorkspaceRecord;

    private page: Page | null = null;
    private devServerProc: ChildProcess | null = null;
    private sidecarProc: ChildProcess | null = null;
    private pending = new Map<string, {
        resolve: (value: SidecarResponse) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
    }>();
    private storeRids = new Map<number, Map<string, unknown>>();
    private storePaths = new Map<string, number>();
    private nextStoreRid = 1;
    private stdoutBuffer = '';
    private sidecarLogBuffer = '';
    private taskEvents: SidecarEvent[] = [];
    private resumeResults: Array<{ success: boolean; taskId: string; error: string | null }> = [];
    private awaitingEffectByTask = new Map<string, number>();

    constructor(devServerPort: number, appDataDir: string) {
        this.desktopDir = process.cwd();
        this.sidecarDir = path.resolve(this.desktopDir, '..', 'sidecar');
        this.appDataDir = appDataDir;
        this.devServerPort = devServerPort;
        this.devServerUrl = `http://127.0.0.1:${devServerPort}/`;
        this.workspace = {
            id: 'resume-sidecar-smoke-workspace',
            name: 'Resume Sidecar Smoke Workspace',
            path: this.desktopDir,
            createdAt: new Date().toISOString(),
            defaultSkills: [],
            defaultToolpacks: [],
        };

        const settingsStore = new Map<string, unknown>();
        settingsStore.set('setupCompleted', true);
        settingsStore.set('activeWorkspaceId', this.workspace.id);
        this.storeRids.set(this.nextStoreRid, settingsStore);
        this.storePaths.set('settings.json', this.nextStoreRid);
        this.nextStoreRid += 1;
    }

    seedPersistedRecoveryState(): void {
        const now = new Date().toISOString();
        writeJsonFile(path.join(this.appDataDir, 'sessions.json'), {
            sessions: [
                {
                    taskId: TASK_ID,
                    status: 'running',
                    title: 'Resume smoke task',
                    planSteps: [],
                    toolCalls: [],
                    effects: [],
                    patches: [],
                    messages: [],
                    events: [],
                    createdAt: now,
                    updatedAt: now,
                    workspacePath: this.workspace.path,
                },
            ],
            activeTaskId: TASK_ID,
        });

        writeJsonFile(path.join(this.appDataDir, 'task-runtime.json'), [
            {
                taskId: TASK_ID,
                title: 'Resume smoke task',
                workspacePath: this.workspace.path,
                createdAt: now,
                updatedAt: now,
                status: 'interrupted',
                conversation: [
                    {
                        role: 'user',
                        content: 'Continue the saved smoke test task from the existing context.',
                    },
                    {
                        role: 'assistant',
                        content: 'Saved context is available.',
                    },
                ],
                config: {
                    workspacePath: this.workspace.path,
                    enabledToolpacks: [],
                    enabledClaudeSkills: [],
                    enabledSkills: [],
                },
                historyLimit: 50,
                artifactsCreated: [],
            },
        ]);
    }

    async start(page: Page): Promise<void> {
        this.page = page;
        await this.attachTauriBridge(page);
        await this.startDevServer();
        await this.startSidecar();
    }

    async stop(): Promise<void> {
        for (const [, waiter] of this.pending) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('Harness shutdown'));
        }
        this.pending.clear();

        if (this.sidecarProc) {
            this.sidecarProc.kill('SIGTERM');
            this.sidecarProc = null;
        }
        if (this.devServerProc) {
            this.devServerProc.kill('SIGTERM');
            this.devServerProc = null;
        }
    }

    async restartSidecar(): Promise<void> {
        await this.emitToPage('sidecar-disconnected', null);
        if (this.sidecarProc) {
            this.sidecarProc.kill('SIGTERM');
            this.sidecarProc = null;
        }
        await this.startSidecar();
        await this.emitToPage('sidecar-reconnected', null);
    }

    async gotoApp(): Promise<void> {
        expect(this.page).not.toBeNull();
        await this.page!.goto(this.devServerUrl, { waitUntil: 'domcontentloaded' });
    }

    getTaskEvents(): SidecarEvent[] {
        return [...this.taskEvents];
    }

    getResumeResults(): Array<{ success: boolean; taskId: string; error: string | null }> {
        return [...this.resumeResults];
    }

    getAwaitingEffectCount(taskId: string): number {
        return this.awaitingEffectByTask.get(taskId) ?? 0;
    }

    getSidecarLogCursor(): number {
        return this.sidecarLogBuffer.length;
    }

    getSidecarLogsSince(cursor: number): string {
        return this.sidecarLogBuffer.slice(Math.max(0, cursor));
    }

    async startTask(input: {
        taskId: string;
        title: string;
        userQuery: string;
        workspacePath?: string;
        activeFile?: string;
        enabledClaudeSkills?: string[];
        enabledSkills?: string[];
        enabledToolpacks?: string[];
    }): Promise<{ success: boolean; taskId: string; error: string | null }> {
        const response = await this.sendSidecarCommand('start_task', {
            taskId: input.taskId,
            title: input.title,
            userQuery: input.userQuery,
            context: {
                workspacePath: input.workspacePath ?? this.workspace.path,
                activeFile: input.activeFile,
            },
            config: {
                enabledClaudeSkills: input.enabledClaudeSkills ?? [],
                enabledSkills: input.enabledSkills ?? [],
                enabledToolpacks: input.enabledToolpacks ?? [],
            },
        });
        const payload = response.payload ?? {};
        return {
            success: Boolean(payload.success),
            taskId: String(payload.taskId ?? input.taskId),
            error: typeof payload.error === 'string' ? payload.error : null,
        };
    }

    async sendTaskMessage(input: {
        taskId: string;
        content: string;
        enabledClaudeSkills?: string[];
        enabledSkills?: string[];
        enabledToolpacks?: string[];
    }): Promise<{ success: boolean; taskId: string; error: string | null }> {
        const response = await this.sendSidecarCommand('send_task_message', {
            taskId: input.taskId,
            content: input.content,
            config: {
                enabledClaudeSkills: input.enabledClaudeSkills ?? [],
                enabledSkills: input.enabledSkills ?? [],
                enabledToolpacks: input.enabledToolpacks ?? [],
            },
        });
        const payload = response.payload ?? {};
        return {
            success: Boolean(payload.success),
            taskId: String(payload.taskId ?? input.taskId),
            error: typeof payload.error === 'string' ? payload.error : null,
        };
    }

    async cancelTask(input: {
        taskId: string;
        reason?: string;
    }): Promise<{ success: boolean; taskId: string; error: string | null }> {
        const response = await this.sendSidecarCommand('cancel_task', {
            taskId: input.taskId,
            reason: input.reason,
        });
        const payload = response.payload ?? {};
        return {
            success: Boolean(payload.success),
            taskId: String(payload.taskId ?? input.taskId),
            error: typeof payload.error === 'string' ? payload.error : null,
        };
    }

    async listClaudeSkills(): Promise<ListedSkillRecord[]> {
        const response = await this.sendSidecarCommand('list_claude_skills', {
            includeDisabled: true,
        });
        const payload = response.payload as Record<string, unknown> | undefined;
        const raw = Array.isArray(payload?.skills)
            ? payload.skills
            : [];
        return raw as ListedSkillRecord[];
    }

    async importClaudeSkill(inputPath: string): Promise<{ success: boolean; skillId: string | null; error: string | null }> {
        const response = await this.sendSidecarCommand('import_claude_skill', {
            source: 'local_folder',
            path: inputPath,
            autoInstallDependencies: false,
            approvePermissionExpansion: true,
        });
        const payload = response.payload as Record<string, unknown> | undefined;
        return {
            success: Boolean(payload?.success),
            skillId: typeof payload?.skillId === 'string' ? payload.skillId : null,
            error: typeof payload?.error === 'string' ? payload.error : null,
        };
    }

    private async attachTauriBridge(page: Page): Promise<void> {
        await page.exposeBinding('__codexInvoke', async (_source, cmd: string, args: Record<string, unknown> | undefined) => {
            return this.invoke(cmd, args ?? {});
        });

        await page.addInitScript(() => {
            const callbacks = new Map<number, { fn: (payload: unknown) => void; once: boolean }>();
            const eventListeners = new Map<string, Set<number>>();
            let nextCallbackId = 1;

            const removeEventListenerId = (eventName: string, callbackId: number) => {
                const ids = eventListeners.get(eventName);
                if (!ids) return;
                ids.delete(callbackId);
                if (ids.size === 0) {
                    eventListeners.delete(eventName);
                }
            };

            (window as Window & { __codexEmit?: (eventName: string, payload: unknown) => void }).__codexEmit = (eventName: string, payload: unknown) => {
                const ids = Array.from(eventListeners.get(eventName) ?? []);
                for (const callbackId of ids) {
                    const entry = callbacks.get(callbackId);
                    if (!entry) continue;
                    entry.fn({
                        event: eventName,
                        id: callbackId,
                        payload,
                    });
                    if (entry.once) {
                        callbacks.delete(callbackId);
                        removeEventListenerId(eventName, callbackId);
                    }
                }
            };

            (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
                metadata: {
                    currentWindow: { label: 'main' },
                },
                transformCallback(callback: (payload: unknown) => void, once = false) {
                    const callbackId = nextCallbackId++;
                    callbacks.set(callbackId, { fn: callback, once });
                    return callbackId;
                },
                unregisterCallback(callbackId: number) {
                    callbacks.delete(callbackId);
                    for (const [eventName, ids] of eventListeners.entries()) {
                        if (ids.has(callbackId)) {
                            ids.delete(callbackId);
                            if (ids.size === 0) {
                                eventListeners.delete(eventName);
                            }
                        }
                    }
                },
                async invoke(cmd: string, args: Record<string, unknown> = {}) {
                    if (cmd === 'plugin:event|listen') {
                        const eventName = String(args.event ?? '');
                        const callbackId = Number(args.handler ?? 0);
                        if (!eventListeners.has(eventName)) {
                            eventListeners.set(eventName, new Set());
                        }
                        eventListeners.get(eventName)!.add(callbackId);
                        return callbackId;
                    }
                    if (cmd === 'plugin:event|unlisten') {
                        removeEventListenerId(String(args.event ?? ''), Number(args.eventId ?? 0));
                        return null;
                    }
                    if (cmd === 'plugin:event|emit') {
                        (window as Window & { __codexEmit?: (eventName: string, payload: unknown) => void }).__codexEmit?.(String(args.event ?? ''), args.payload);
                        return null;
                    }
                    return (window as Window & {
                        __codexInvoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
                    }).__codexInvoke(cmd, args);
                },
            };

            (window as Window & { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
                unregisterListener(eventName: string, callbackId: number) {
                    removeEventListenerId(eventName, callbackId);
                },
            };

            (window as Window & { __TAURI__?: unknown }).__TAURI__ = {};
        });
    }

    private async startDevServer(): Promise<void> {
        this.devServerProc = spawn('npx', [
            'vite',
            '--host', '127.0.0.1',
            '--port', String(this.devServerPort),
            '--strictPort',
        ], {
            cwd: this.desktopDir,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
        });

        this.devServerProc.stdout?.on('data', (chunk: Buffer) => {
            process.stderr.write(`[desktop-dev] ${chunk.toString()}`);
        });
        this.devServerProc.stderr?.on('data', (chunk: Buffer) => {
            process.stderr.write(`[desktop-dev-err] ${chunk.toString()}`);
        });

        await waitForHttp(this.devServerUrl, 120_000);
    }

    private async startSidecar(): Promise<void> {
        this.sidecarProc = spawn('bun', ['run', 'src/main.ts'], {
            cwd: this.sidecarDir,
            env: {
                ...process.env,
                COWORKANY_APP_DATA_DIR: this.appDataDir,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
        });

        this.sidecarProc.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            this.sidecarLogBuffer += text;
            this.stdoutBuffer += text;
            const lines = this.stdoutBuffer.split('\n');
            this.stdoutBuffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const message = JSON.parse(line) as SidecarResponse | SidecarEvent;
                    if ('commandId' in message) {
                        const waiter = this.pending.get(message.commandId);
                        if (waiter) {
                            clearTimeout(waiter.timer);
                            this.pending.delete(message.commandId);
                            waiter.resolve(message);
                        }
                        continue;
                    }
                    if ((message as any).type === 'request_effect' && typeof (message as any).id === 'string') {
                        void this.handleRequestEffectCommand(message as any);
                        continue;
                    }
                    this.taskEvents.push(message);
                    void this.emitToPage('task-event', message);
                } catch {
                    process.stderr.write(`[sidecar-stdout] ${line}\n`);
                }
            }
        });

        this.sidecarProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            this.sidecarLogBuffer += text;
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[sidecar] ${line}\n`);
                }
            }
        });

        await wait(5000);
        await this.sendSidecarCommand('bootstrap_runtime_context', {
            runtimeContext: {
                platform: process.platform,
                arch: process.arch,
                appDir: this.desktopDir,
                appDataDir: this.appDataDir,
                shell: process.env.SHELL || '/bin/zsh',
                sidecarLaunchMode: 'development',
                python: {
                    available: false,
                },
                skillhub: {
                    available: false,
                },
                managedServices: [],
            },
        });
    }

    private async emitToPage(eventName: string, payload: unknown): Promise<void> {
        if (!this.page) return;
        await this.page.evaluate(
            ({ name, data }) => {
                (window as Window & { __codexEmit?: (eventName: string, payload: unknown) => void }).__codexEmit?.(name, data);
            },
            { name: eventName, data: payload },
        ).catch(() => {});
    }

    private async handleRequestEffectCommand(message: {
        id: string;
        payload?: {
            request?: {
                id?: string;
                effectType?: string;
                context?: {
                    taskId?: string;
                };
            };
        };
    }): Promise<void> {
        const request = message.payload?.request;
        const taskId = request?.context?.taskId;
        if (typeof taskId === 'string' && taskId.trim().length > 0) {
            this.awaitingEffectByTask.set(taskId, (this.awaitingEffectByTask.get(taskId) ?? 0) + 1);
        }

        const effectResponse = {
            requestId: String(request?.id ?? randomUUID()),
            timestamp: new Date().toISOString(),
            approved: false,
            approvalType: null,
            expiresAt: null,
            denialReason: 'awaiting_confirmation',
            denialCode: null,
            modifiedScope: null,
        };

        const ipcResponse: SidecarResponse = {
            commandId: message.id,
            timestamp: new Date().toISOString(),
            type: 'request_effect_response',
            payload: {
                response: effectResponse,
                taskId,
                effectType: request?.effectType ?? 'unknown',
            },
        };

        await this.emitToPage('ipc-response', ipcResponse);
        if (this.sidecarProc?.stdin) {
            this.sidecarProc.stdin.write(`${JSON.stringify(ipcResponse)}\n`);
        }
    }

    private async invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
        switch (cmd) {
            case 'plugin:store|load':
                return this.loadStore(String(args.path ?? 'settings.json'));
            case 'plugin:store|get_store':
                return this.storePaths.get(String(args.path ?? 'settings.json')) ?? null;
            case 'plugin:store|get':
                return this.storeGet(Number(args.rid), String(args.key ?? ''));
            case 'plugin:store|set':
                return this.storeSet(Number(args.rid), String(args.key ?? ''), args.value);
            case 'plugin:store|delete':
                return this.storeDelete(Number(args.rid), String(args.key ?? ''));
            case 'plugin:store|save':
            case 'plugin:store|reload':
                return null;
            case 'plugin:store|has':
                return this.storeHas(Number(args.rid), String(args.key ?? ''));
            case 'plugin:store|clear':
                return this.storeClear(Number(args.rid));
            case 'plugin:store|keys':
                return this.storeKeys(Number(args.rid));
            case 'plugin:store|values':
                return this.storeValues(Number(args.rid));
            case 'plugin:store|entries':
                return this.storeEntries(Number(args.rid));
            case 'plugin:store|length':
                return this.storeLength(Number(args.rid));
            case 'plugin:resources|close':
                return null;
            case 'get_llm_settings':
                return { success: true, payload: {} };
            case 'get_startup_measurement_config':
                return { enabled: false, profile: 'optimized', runLabel: '' };
            case 'record_startup_metric':
                return null;
            case 'list_workspaces':
                return { success: true, payload: { workspaces: [this.workspace] } };
            case 'create_workspace':
                return { success: true, payload: { workspace: this.workspace } };
            case 'delete_workspace':
            case 'update_workspace':
                return { success: true, payload: { success: true } };
            case 'load_sessions':
                return {
                    success: true,
                    payload: JSON.parse(fs.readFileSync(path.join(this.appDataDir, 'sessions.json'), 'utf-8')) as Record<string, unknown>,
                };
            case 'save_sessions': {
                const snapshot = args.input as Record<string, unknown>;
                writeJsonFile(path.join(this.appDataDir, 'sessions.json'), snapshot);
                return { success: true, payload: snapshot };
            }
            case 'list_toolpacks':
                return { success: true, payload: { payload: { toolpacks: [] } } };
            case 'list_claude_skills':
                return { success: true, payload: { payload: { skills: [] } } };
            case 'scan_default_repos':
                return { success: true, payload: { skills: [], mcpServers: [] } };
            case 'scan_skills':
                return { success: true, payload: { skills: [] } };
            case 'scan_mcp_servers':
                return { success: true, payload: { servers: [] } };
            case 'get_workspace_root':
                return this.desktopDir;
            case 'get_voice_state':
                return {
                    success: true,
                    payload: {
                        success: true,
                        state: {
                            isSpeaking: false,
                            canStop: false,
                        },
                    },
                };
            case 'resume_interrupted_task': {
                const response = await this.sendSidecarCommand('resume_interrupted_task', args.input as Record<string, unknown>);
                const payload = response.payload ?? {};
                const result = {
                    success: Boolean(payload.success),
                    taskId: String(payload.taskId ?? ''),
                    error: typeof payload.error === 'string' ? payload.error : null,
                };
                this.resumeResults.push(result);
                return result;
            }
            case 'cancel_task': {
                const response = await this.sendSidecarCommand('cancel_task', args.input as Record<string, unknown>);
                const payload = response.payload ?? {};
                return {
                    success: Boolean(payload.success),
                    taskId: String(payload.taskId ?? ''),
                    error: typeof payload.error === 'string' ? payload.error : null,
                };
            }
            default:
                throw new Error(`Unsupported mocked Tauri command: ${cmd}`);
        }
    }

    private async sendSidecarCommand(type: string, payload: Record<string, unknown>): Promise<SidecarResponse> {
        if (!this.sidecarProc?.stdin) {
            throw new Error('Sidecar process is not running');
        }

        const commandId = randomUUID();
        const command = {
            id: commandId,
            timestamp: new Date().toISOString(),
            type,
            payload,
        };

        const responsePromise = new Promise<SidecarResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(commandId);
                reject(new Error(`Timed out waiting for sidecar response: ${type}`));
            }, 20_000);
            this.pending.set(commandId, { resolve, reject, timer });
        });

        this.sidecarProc.stdin.write(`${JSON.stringify(command)}\n`);
        return responsePromise;
    }

    private loadStore(storePath: string): number {
        const existing = this.storePaths.get(storePath);
        if (existing) {
            return existing;
        }
        const rid = this.nextStoreRid++;
        this.storePaths.set(storePath, rid);
        this.storeRids.set(rid, new Map<string, unknown>());
        return rid;
    }

    private getStoreMap(rid: number): Map<string, unknown> {
        const store = this.storeRids.get(rid);
        if (!store) {
            throw new Error(`Unknown store resource id: ${rid}`);
        }
        return store;
    }

    private storeGet(rid: number, key: string): [unknown, boolean] {
        const store = this.getStoreMap(rid);
        return [store.get(key), store.has(key)];
    }

    private storeSet(rid: number, key: string, value: unknown): null {
        this.getStoreMap(rid).set(key, value);
        return null;
    }

    private storeDelete(rid: number, key: string): null {
        this.getStoreMap(rid).delete(key);
        return null;
    }

    private storeHas(rid: number, key: string): boolean {
        return this.getStoreMap(rid).has(key);
    }

    private storeClear(rid: number): null {
        this.getStoreMap(rid).clear();
        return null;
    }

    private storeKeys(rid: number): string[] {
        return Array.from(this.getStoreMap(rid).keys());
    }

    private storeValues(rid: number): unknown[] {
        return Array.from(this.getStoreMap(rid).values());
    }

    private storeEntries(rid: number): Array<[string, unknown]> {
        return Array.from(this.getStoreMap(rid).entries());
    }

    private storeLength(rid: number): number {
        return this.getStoreMap(rid).size;
    }
}

function readRuntimeStatus(appDataDir: string): string | null {
    const records = JSON.parse(
        fs.readFileSync(path.join(appDataDir, 'task-runtime.json'), 'utf-8'),
    ) as Array<{ taskId?: string; status?: string }>;

    const record = records.find((entry) => entry.taskId === TASK_ID);
    return typeof record?.status === 'string' ? record.status : null;
}

type PersistedRuntimeRecord = {
    taskId?: string;
    status?: string;
    conversation?: Array<{
        role?: string;
        content?: string;
    }>;
};

type PersistedScheduledTaskRecord = {
    id?: string;
    sourceTaskId?: string;
    workRequestId?: string;
    title?: string;
    taskQuery?: string;
    executeAt?: string;
    status?: string;
    stageIndex?: number;
    frozenWorkRequest?: {
        schedule?: {
            recurrence?: {
                kind?: string;
                value?: string;
            } | null;
        };
    };
};

function readPersistedRuntimeRecords(appDataDir: string): PersistedRuntimeRecord[] {
    const runtimePath = path.join(appDataDir, 'task-runtime.json');
    if (!fs.existsSync(runtimePath)) {
        return [];
    }
    const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? parsed as PersistedRuntimeRecord[] : [];
}

function getPersistedConversationText(record: PersistedRuntimeRecord): string {
    return (record.conversation ?? [])
        .map((item) => (typeof item.content === 'string' ? item.content : ''))
        .join('\n');
}

function readPersistedScheduledTaskRecords(appDataDir: string): PersistedScheduledTaskRecord[] {
    const scheduledPath = path.join(appDataDir, 'scheduled-tasks.json');
    if (!fs.existsSync(scheduledPath)) {
        return [];
    }
    const parsed = JSON.parse(fs.readFileSync(scheduledPath, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? parsed as PersistedScheduledTaskRecord[] : [];
}

function getEventsSince(events: SidecarEvent[], cursor: number): SidecarEvent[] {
    return events.slice(Math.max(0, cursor));
}

function isScheduledStartedNoticeEvent(event: SidecarEvent, sourceTaskId: string): boolean {
    if (event.taskId !== sourceTaskId || event.type !== 'CHAT_MESSAGE') {
        return false;
    }
    const content = String((event.payload as Record<string, unknown>)?.content ?? '');
    return content.includes('已开始执行');
}

async function waitForTaskRuntimeRecords(
    appDataDir: string,
    taskIds: string[],
    timeoutMs: number
): Promise<void> {
    await expect.poll(() => {
        const records = readPersistedRuntimeRecords(appDataDir);
        const recordTaskIds = new Set(records.map((record) => String(record.taskId ?? '')));
        return taskIds.map((taskId) => recordTaskIds.has(taskId));
    }, {
        timeout: timeoutMs,
        message: 'started task ids should appear in persisted task runtime records',
    }).toEqual(taskIds.map(() => true));
}

function assertNoCrossTaskMarkerInterferenceInRuntime(
    appDataDir: string,
    batchId: string,
    taskInputs: DesktopSkillTaskInput[]
): void {
    const records = readPersistedRuntimeRecords(appDataDir);
    for (const task of taskInputs) {
        const record = records.find((entry) => entry.taskId === task.taskId);
        expect(record, `batch ${batchId} should persist runtime record for ${task.taskId}`).toBeDefined();
        const conversation = getPersistedConversationText(record ?? {});
        expect(conversation, `batch ${batchId} task ${task.taskId} should include own marker in persisted conversation`).toContain(task.marker);

        const foreignMarkers = taskInputs
            .filter((candidate) => candidate.taskId !== task.taskId)
            .filter((candidate) => conversation.includes(candidate.marker))
            .map((candidate) => candidate.marker);
        expect(
            foreignMarkers,
            `batch ${batchId} task ${task.taskId} should not include foreign markers in persisted conversation`,
        ).toEqual([]);
    }
}

function buildConcurrentScenarioMatrix(): ConcurrentScenarioDefinition[] {
    return [
        {
            id: 'triple-host-scan',
            concurrency: 3,
            expectedToolName: 'list_dir',
            buildQuery: ({ marker }) =>
                `扫描${HOST_SCAN_PATH}/目录下的文件夹，给出分类列表即可。最终回复附带标记：${marker}`,
        },
        {
            id: 'quad-host-scan-stress',
            concurrency: 4,
            expectedToolName: 'list_dir',
            buildQuery: ({ index, marker }) =>
                `并发校验任务${index}：仅列出${HOST_SCAN_PATH}下一级目录名称，末尾附带标记：${marker}`,
        },
    ];
}

function buildConcurrentTaskInputs(
    scenario: ConcurrentScenarioDefinition,
    workspacePath: string
): ConcurrentTaskInput[] {
    return Array.from({ length: scenario.concurrency }, (_, idx) => {
        const index = idx + 1;
        const marker = `CONCURRENT_${scenario.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${index}`;
        return {
            taskId: randomUUID(),
            title: `Concurrent scenario ${scenario.id} task ${index}`,
            userQuery: scenario.buildQuery({ index, marker }),
            workspacePath,
            marker,
        };
    });
}

function collectTaskEvents(events: SidecarEvent[], taskId: string): SidecarEvent[] {
    return events.filter((event) => event.taskId === taskId);
}

function isTaskCollaborationEvent(event: SidecarEvent): boolean {
    return event.type === 'TASK_CLARIFICATION_REQUIRED' || event.type === 'TASK_USER_ACTION_REQUIRED';
}

function getStartedDescription(taskEvents: SidecarEvent[]): string {
    const startedEvent = taskEvents.find((event) => event.type === 'TASK_STARTED');
    if (!startedEvent) {
        return '';
    }
    const payload = startedEvent.payload as Record<string, unknown> | undefined;
    const description = payload?.description;
    return typeof description === 'string' ? description : '';
}

async function waitForConcurrentScenarioReadiness(
    harness: ResumeSidecarHarness,
    scenario: ConcurrentScenarioDefinition,
    taskInputs: ConcurrentTaskInput[]
): Promise<void> {
    await expect.poll(() => {
        const events = harness.getTaskEvents();
        return taskInputs.map((task) => {
            const taskEvents = collectTaskEvents(events, task.taskId);
            const started = taskEvents.some((event) => event.type === 'TASK_STARTED');
            const description = getStartedDescription(taskEvents);
            const hasOwnMarker = description.includes(task.marker);
            const hasPlanProgress = taskEvents.some((event) =>
                event.type === 'PLAN_UPDATED'
                && typeof event.payload?.summary === 'string'
                && event.payload.summary.includes('In progress:')
            );
            const hasToolCall = taskEvents.some((event) =>
                event.type === 'TOOL_CALL'
                && String(event.payload?.name ?? '').includes(scenario.expectedToolName)
            );
            const hasFailure = taskEvents.some((event) => event.type === 'TASK_FAILED');
            return started && hasOwnMarker && hasPlanProgress && hasToolCall && !hasFailure;
        });
    }, {
        timeout: 40_000,
        message: `scenario ${scenario.id} should emit started/progress/${scenario.expectedToolName} without task failure`,
    }).toEqual(taskInputs.map(() => true));

    await expect.poll(() => {
        return taskInputs.map((task) => harness.getAwaitingEffectCount(task.taskId) > 0);
    }, {
        timeout: 40_000,
        message: `scenario ${scenario.id} should drive each task into awaiting_confirmation`,
    }).toEqual(taskInputs.map(() => true));
}

function assertNoCrossTaskMarkerInterference(
    harness: ResumeSidecarHarness,
    scenario: ConcurrentScenarioDefinition,
    taskInputs: ConcurrentTaskInput[]
): void {
    const events = harness.getTaskEvents();
    for (const task of taskInputs) {
        const description = getStartedDescription(collectTaskEvents(events, task.taskId));
        expect(description, `scenario ${scenario.id} task ${task.taskId} should include its own marker`).toContain(task.marker);

        const foreignMarkers = taskInputs
            .filter((candidate) => candidate.taskId !== task.taskId)
            .filter((candidate) => description.includes(candidate.marker))
            .map((candidate) => candidate.marker);

        expect(
            foreignMarkers,
            `scenario ${scenario.id} task ${task.taskId} should not contain foreign markers`,
        ).toEqual([]);
    }
}

const SKILL_BATCH_SIZE = 4;
const SKILL_ARTIFACT_DIR = path.resolve(process.cwd(), '..', 'artifacts', 'desktop-skill-scenarios');

function normalizeListedSkills(skills: ListedSkillRecord[]): Array<{
    skillId: string;
    name: string;
    sourceType: string;
    enabled: boolean;
}> {
    return skills
        .map((skill) => {
            const skillId = String(skill.manifest?.name ?? skill.manifest?.id ?? '').trim();
            return {
                skillId,
                name: String(skill.manifest?.name ?? skill.manifest?.id ?? '').trim(),
                sourceType: String(skill.provenance?.sourceType ?? 'unknown'),
                enabled: Boolean(skill.enabled),
            };
        })
        .filter((skill) => skill.skillId.length > 0);
}

function buildCustomSkillFixtures(rootDir: string): CustomSkillFixture[] {
    const fixtures: Array<{ skillId: string; description: string }> = [
        {
            skillId: 'custom-desktop-qa-guard',
            description: 'Custom QA guard skill for desktop scenario validation.',
        },
        {
            skillId: 'custom-desktop-release-check',
            description: 'Custom release check skill for desktop scenario validation.',
        },
        {
            skillId: 'custom-desktop-runbook',
            description: 'Custom runbook skill for desktop scenario validation.',
        },
    ];

    return fixtures.map((fixture) => {
        const skillDir = path.join(rootDir, fixture.skillId);
        ensureDir(skillDir);
        const skillContent = [
            '---',
            `name: ${fixture.skillId}`,
            'version: 1.0.0',
            `description: ${fixture.description}`,
            'tags:',
            '  - custom',
            '  - desktop-test',
            'allowed-tools:',
            '  - list_dir',
            'triggers:',
            `  - ${fixture.skillId}`,
            '---',
            '',
            '# Custom Desktop Skill Fixture',
            '',
            'This fixture skill is used by desktop concurrency scenario tests.',
            'When selected, prioritize deterministic execution with list_dir only.',
            '',
        ].join('\n');
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
        return {
            skillId: fixture.skillId,
            skillDir,
        };
    });
}

async function installCustomSkillFixtures(
    harness: ResumeSidecarHarness,
    fixtures: CustomSkillFixture[]
): Promise<Array<{ skillId: string; success: boolean; error: string | null }>> {
    const results: Array<{ skillId: string; success: boolean; error: string | null }> = [];
    for (const fixture of fixtures) {
        const imported = await harness.importClaudeSkill(fixture.skillDir);
        results.push({
            skillId: fixture.skillId,
            success: imported.success && imported.skillId === fixture.skillId,
            error: imported.error,
        });
    }
    return results;
}

function partitionInBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let cursor = 0; cursor < items.length; cursor += batchSize) {
        batches.push(items.slice(cursor, cursor + batchSize));
    }
    return batches;
}

function buildSkillScenarioDefinitions(
    skillIds: string[],
    skillKind: DesktopSkillKind
): DesktopSkillScenarioDefinition[] {
    return skillIds.map((skillId) => ({
        id: `${skillKind}-${skillId.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`,
        skillId,
        skillKind,
        expectedToolName: 'list_dir',
    }));
}

function buildSkillScenarioQuery(input: { index: number; marker: string }): string {
    return `并发校验任务${input.index}：仅列出${HOST_SCAN_PATH}下一级目录名称，末尾附带标记：${input.marker}`;
}

function buildSkillTaskInputs(
    scenarios: DesktopSkillScenarioDefinition[],
    batchIndex: number,
    workspacePath: string
): DesktopSkillTaskInput[] {
    return scenarios.map((scenario, index) => {
        const taskIndex = index + 1;
        const marker = `SKILL_${scenario.skillKind.toUpperCase()}_${batchIndex + 1}_${index + 1}_${scenario.skillId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
        return {
            taskId: randomUUID(),
            title: `Skill scenario ${scenario.id}`,
            userQuery: buildSkillScenarioQuery({ index: taskIndex, marker }),
            workspacePath,
            marker,
            skillId: scenario.skillId,
            skillKind: scenario.skillKind,
        };
    });
}

function buildSkillLoadToken(skillKind: DesktopSkillKind, skillId: string): string {
    if (skillKind === 'system') {
        return `[Skill] Loaded builtin: ${skillId}`;
    }
    return `[Skill] Loaded from filesystem: ${skillId}`;
}

async function waitForSkillScenarioBatchReadiness(
    harness: ResumeSidecarHarness,
    batchId: string,
    taskInputs: DesktopSkillTaskInput[],
    sidecarLogCursor: number
): Promise<void> {
    await expect.poll(() => {
        const events = harness.getTaskEvents();
        const logs = harness.getSidecarLogsSince(sidecarLogCursor);
        return taskInputs.map((task) => {
            const taskEvents = collectTaskEvents(events, task.taskId);
            const description = getStartedDescription(taskEvents);
            const started = taskEvents.some((event) => event.type === 'TASK_STARTED');
            const hasOwnMarker = description.includes(task.marker);
            const hasPlanProgress = taskEvents.some((event) =>
                event.type === 'PLAN_UPDATED'
                && typeof event.payload?.summary === 'string'
                && event.payload.summary.includes('In progress:')
            );
            const hasFailure = taskEvents.some((event) => event.type === 'TASK_FAILED');
            const hasSkillLoadLog = logs.includes(buildSkillLoadToken(task.skillKind, task.skillId));
            return started && hasOwnMarker && hasPlanProgress && hasSkillLoadLog && !hasFailure;
        });
    }, {
        timeout: 35_000,
        message: `skill batch ${batchId} should emit started/progress, load expected skills, and avoid failures`,
    }).toEqual(taskInputs.map(() => true));
}

const SCHEDULED_DESKTOP_SCENARIOS: ScheduledDesktopScenario[] = [
    // Use an intentionally ambiguous follow-up objective so scheduled execution
    // reaches deterministic clarification flow without external web research.
    // This keeps desktop E2E stable in offline/limited-network environments.
    //
    // (The scheduling parser coverage here is focused on time-expression support
    // and speak_result parsing, not downstream task-domain logic.)

    // Chinese relative time support
    { id: 'zh-seconds-之后', query: '3秒之后，继续处理这个', expectVoiceConfirmation: false },
    { id: 'zh-minutes-以后', query: '0分钟以后，继续处理这个', expectVoiceConfirmation: false },
    { id: 'zh-short-minute-之后', query: '0分之后，继续处理这个', expectVoiceConfirmation: false },
    { id: 'zh-hours-之后', query: '0小时之后，继续处理这个', expectVoiceConfirmation: false },
    { id: 'zh-ge-xiaoshi-之后', query: '0个小时之后，继续处理这个', expectVoiceConfirmation: false },
    { id: 'zh-days-之后', query: '0天之后，继续处理这个', expectVoiceConfirmation: false },

    // English relative time support
    { id: 'en-seconds', query: 'in 3 seconds, 继续处理这个', expectVoiceConfirmation: false },
    { id: 'en-minutes', query: 'in 0 minutes, 继续处理这个', expectVoiceConfirmation: false },
    { id: 'en-hours', query: 'in 0 hours, 继续处理这个', expectVoiceConfirmation: false },
    { id: 'en-days', query: 'in 0 days, 继续处理这个', expectVoiceConfirmation: false },

    // Voice-readback variants (speak_result)
    {
        id: 'zh-voice-broadcast',
        query: '0秒之后，继续处理这个，并将结果用语音播报给我',
        expectVoiceConfirmation: true,
    },
    {
        id: 'en-voice-read-aloud',
        query: 'in 0 seconds, 继续处理这个, and read the result aloud to me',
        expectVoiceConfirmation: true,
    },
];

const SCHEDULED_ACCEPTANCE_QUERIES = {
    oneTimeImmediate: '0秒之后，只回复：一次性立即执行',
    oneTimeDelayed: '3秒之后，只回复：一次性延迟执行',
    recurringImmediate: '创建定时任务，每5分钟只回复：喝水提醒',
    recurringDelayed: '创建定时任务，3秒后开始，每5分钟只回复：喝水提醒',
    chainedImmediate: '0秒之后，只回复：阶段1完成。然后再等1秒，只回复：阶段2完成。',
    cancellableLongRunning: `扫描${HOST_SCAN_PATH}/目录下的文件夹，给出分类列表即可`,
} as const;

async function waitForValue<T>(
    resolver: () => T | undefined,
    timeoutMs: number,
    message: string,
    pollMs = 300,
): Promise<T> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = resolver();
        if (value !== undefined) {
            return value;
        }
        await wait(pollMs);
    }
    throw new Error(message);
}

test.describe('Desktop GUI smoke - interrupted task recovery with real sidecar', () => {
    test.setTimeout(180_000);

    test('restores saved runtime and marks it running after Continue task', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-resume-sidecar-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);
        harness.seedPersistedRecoveryState();

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const resumeTitle = page.getByText(/Task interrupted, but the saved context is still available\./i).first();
            const continueButton = page.getByRole('button', { name: /Continue task/i }).first();

            await expect(resumeTitle).toBeVisible({ timeout: 20_000 });
            await expect(continueButton).toBeVisible({ timeout: 20_000 });

            await continueButton.click();

            await expect.poll(() => {
                return harness.getResumeResults().at(-1) ?? null;
            }, {
                timeout: 20_000,
                message: 'real sidecar should acknowledge resume_interrupted_task',
            }).toEqual({
                success: true,
                taskId: TASK_ID,
                error: null,
            });

            await expect.poll(() => readRuntimeStatus(appDataDir), {
                timeout: 20_000,
                message: 'real sidecar should persist the resumed runtime as running',
            }).toBe('running');
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('rehydrates interrupted task after sidecar reconnect and can continue it', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-reconnect-sidecar-'));
        writeJsonFile(path.join(appDataDir, 'sessions.json'), {
            sessions: [],
            activeTaskId: null,
        });
        writeJsonFile(path.join(appDataDir, 'task-runtime.json'), []);

        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            await expect(page.getByRole('button', { name: /Continue task/i })).toHaveCount(0);

            harness.seedPersistedRecoveryState();
            await harness.restartSidecar();

            const resumeTitle = page.getByText(/Task interrupted, but the saved context is still available\./i).first();
            const continueButton = page.getByRole('button', { name: /Continue task/i }).first();

            await expect(resumeTitle).toBeVisible({ timeout: 20_000 });
            await expect(continueButton).toBeVisible({ timeout: 20_000 });

            await continueButton.click();

            await expect.poll(() => {
                return harness.getResumeResults().at(-1) ?? null;
            }, {
                timeout: 20_000,
                message: 'reconnected sidecar should acknowledge resume_interrupted_task',
            }).toEqual({
                success: true,
                taskId: TASK_ID,
                error: null,
            });

            await expect.poll(() => readRuntimeStatus(appDataDir), {
                timeout: 20_000,
                message: 'reconnected sidecar should persist resumed runtime as running',
            }).toBe('running');
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    for (const scenario of buildConcurrentScenarioMatrix()) {
        test(`runs concurrent scenario batch (${scenario.id}) with isolation and continue-task recovery`, async ({ page }) => {
            const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `coworkany-concurrent-${scenario.id}-`));
            const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);
            harness.seedPersistedRecoveryState();

            try {
                await harness.start(page);
                await harness.gotoApp();
                await page.waitForLoadState('domcontentloaded');

                const resumeTitle = page.getByText(/Task interrupted, but the saved context is still available\./i).first();
                const continueButton = page.getByRole('button', { name: /Continue task/i }).first();
                await expect(resumeTitle).toBeVisible({ timeout: 20_000 });

                const taskInputs = buildConcurrentTaskInputs(scenario, harness.workspace.path);
                const startResults = await Promise.all(taskInputs.map((input) => harness.startTask(input)));
                expect(startResults.every((result) => result.success)).toBe(true);
                expect(startResults.map((result) => result.taskId)).toEqual(taskInputs.map((input) => input.taskId));

                await waitForConcurrentScenarioReadiness(harness, scenario, taskInputs);
                assertNoCrossTaskMarkerInterference(harness, scenario, taskInputs);

                await expect(continueButton).toBeVisible({ timeout: 20_000 });
                await continueButton.click();

                await expect.poll(() => {
                    return harness.getResumeResults().at(-1) ?? null;
                }, {
                    timeout: 20_000,
                    message: `scenario ${scenario.id} should keep continue-task recovery usable while concurrent tasks wait`,
                }).toEqual({
                    success: true,
                    taskId: TASK_ID,
                    error: null,
                });
            } finally {
                await harness.stop();
                fs.rmSync(appDataDir, { recursive: true, force: true });
            }
        });
    }

    test('inventories system and custom skills for desktop scenario generation', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-skill-inventory-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);
        ensureDir(SKILL_ARTIFACT_DIR);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const before = normalizeListedSkills(await harness.listClaudeSkills());
            const fixtures = buildCustomSkillFixtures(path.join(appDataDir, 'custom-skills'));
            const installResults = await installCustomSkillFixtures(harness, fixtures);
            const after = normalizeListedSkills(await harness.listClaudeSkills());

            const builtinSkills = after.filter((skill) => skill.sourceType === 'built_in');
            const customSkills = after.filter((skill) => skill.sourceType !== 'built_in');
            const fixtureSkillIds = new Set(fixtures.map((fixture) => fixture.skillId));
            const fixtureCustomSkills = customSkills.filter((skill) => fixtureSkillIds.has(skill.skillId));

            writeJsonFile(path.join(SKILL_ARTIFACT_DIR, 'skill-inventory.json'), {
                timestamp: new Date().toISOString(),
                before,
                after,
                installResults,
                counts: {
                    beforeTotal: before.length,
                    afterTotal: after.length,
                    builtin: builtinSkills.length,
                    custom: customSkills.length,
                    fixtureCustom: fixtureCustomSkills.length,
                },
            });

            expect(builtinSkills.length).toBeGreaterThan(0);
            expect(installResults.every((item) => item.success)).toBe(true);
            expect(fixtureCustomSkills.map((skill) => skill.skillId).sort()).toEqual(
                fixtures.map((fixture) => fixture.skillId).sort()
            );
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('runs all builtin system skill desktop scenarios in concurrent batches without interference', async ({ page }, testInfo) => {
        testInfo.setTimeout(8 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-system-skill-scenarios-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);
        ensureDir(SKILL_ARTIFACT_DIR);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const listedSkills = normalizeListedSkills(await harness.listClaudeSkills());
            const systemSkillIds = listedSkills
                .filter((skill) => skill.sourceType === 'built_in')
                .map((skill) => skill.skillId)
                .sort((left, right) => left.localeCompare(right));

            const scenarios = buildSkillScenarioDefinitions(systemSkillIds, 'system');
            const scenarioBatches = partitionInBatches(scenarios, SKILL_BATCH_SIZE);
            const batchReports: Array<{
                batchId: string;
                skillIds: string[];
                taskIds: string[];
                markers: string[];
            }> = [];

            for (const [batchIndex, batch] of scenarioBatches.entries()) {
                const batchId = `system-batch-${batchIndex + 1}`;
                const taskInputs = buildSkillTaskInputs(batch, batchIndex, harness.workspace.path);
                const startResults = await Promise.all(
                    taskInputs.map((input) =>
                        harness.startTask({
                            ...input,
                            enabledClaudeSkills: [input.skillId],
                        })
                    )
                );

                expect(startResults.every((result) => result.success)).toBe(true);
                expect(startResults.map((result) => result.taskId)).toEqual(taskInputs.map((input) => input.taskId));
                expect(new Set(taskInputs.map((input) => input.taskId)).size).toBe(taskInputs.length);
                expect(new Set(taskInputs.map((input) => input.marker)).size).toBe(taskInputs.length);
                await wait(1500);

                batchReports.push({
                    batchId,
                    skillIds: taskInputs.map((input) => input.skillId),
                    taskIds: taskInputs.map((input) => input.taskId),
                    markers: taskInputs.map((input) => input.marker),
                });
            }

            writeJsonFile(path.join(SKILL_ARTIFACT_DIR, 'system-skill-scenarios.json'), {
                timestamp: new Date().toISOString(),
                systemSkillCount: scenarios.length,
                batchSize: SKILL_BATCH_SIZE,
                batches: batchReports,
            });

            expect(scenarios.length).toBeGreaterThan(0);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('runs imported custom skill desktop scenarios in concurrent batches without interference', async ({ page }, testInfo) => {
        testInfo.setTimeout(6 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-custom-skill-scenarios-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);
        ensureDir(SKILL_ARTIFACT_DIR);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const fixtures = buildCustomSkillFixtures(path.join(appDataDir, 'custom-skills'));
            const installResults = await installCustomSkillFixtures(harness, fixtures);
            expect(installResults.every((item) => item.success)).toBe(true);

            const listedSkills = normalizeListedSkills(await harness.listClaudeSkills());
            const enabledCustomSkillIds = listedSkills
                .filter((skill) => skill.sourceType !== 'built_in' && skill.enabled)
                .map((skill) => skill.skillId)
                .sort((left, right) => left.localeCompare(right));
            const disabledCustomSkillIds = listedSkills
                .filter((skill) => skill.sourceType !== 'built_in' && !skill.enabled)
                .map((skill) => skill.skillId)
                .sort((left, right) => left.localeCompare(right));

            const fixtureSkillIds = new Set(fixtures.map((fixture) => fixture.skillId));
            const fixtureInstalledInEnabled = enabledCustomSkillIds.filter((skillId) => fixtureSkillIds.has(skillId));
            expect(fixtureInstalledInEnabled.sort()).toEqual(fixtures.map((fixture) => fixture.skillId).sort());

            const customSkillIds = enabledCustomSkillIds;
            const scenarios = buildSkillScenarioDefinitions(customSkillIds, 'custom');
            const scenarioBatches = partitionInBatches(scenarios, SKILL_BATCH_SIZE);
            const batchReports: Array<{
                batchId: string;
                skillIds: string[];
                taskIds: string[];
                markers: string[];
            }> = [];

            for (const [batchIndex, batch] of scenarioBatches.entries()) {
                const batchId = `custom-batch-${batchIndex + 1}`;
                const taskInputs = buildSkillTaskInputs(batch, batchIndex, harness.workspace.path);
                const startResults = await Promise.all(
                    taskInputs.map((input) =>
                        harness.startTask({
                            ...input,
                            enabledClaudeSkills: [input.skillId],
                        })
                    )
                );

                expect(startResults.every((result) => result.success)).toBe(true);
                expect(startResults.map((result) => result.taskId)).toEqual(taskInputs.map((input) => input.taskId));
                expect(new Set(taskInputs.map((input) => input.taskId)).size).toBe(taskInputs.length);
                expect(new Set(taskInputs.map((input) => input.marker)).size).toBe(taskInputs.length);
                await wait(1500);

                batchReports.push({
                    batchId,
                    skillIds: taskInputs.map((input) => input.skillId),
                    taskIds: taskInputs.map((input) => input.taskId),
                    markers: taskInputs.map((input) => input.marker),
                });
            }

            writeJsonFile(path.join(SKILL_ARTIFACT_DIR, 'custom-skill-scenarios.json'), {
                timestamp: new Date().toISOString(),
                customSkillCount: scenarios.length,
                enabledCustomSkillCount: enabledCustomSkillIds.length,
                disabledCustomSkillCount: disabledCustomSkillIds.length,
                disabledCustomSkillIds,
                batchSize: SKILL_BATCH_SIZE,
                installResults,
                batches: batchReports,
            });

            expect(scenarios.length).toBeGreaterThan(0);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('host-folder scan stays in awaiting-confirmation state without premature task failure', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-scan-awaiting-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const taskId = randomUUID();
            const startResult = await harness.startTask({
                taskId,
                title: 'Scan Documents',
                userQuery: '扫描/Users/beihuang/Documents/目录下的文件夹，给出分类列表即可',
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            await expect.poll(() => harness.getAwaitingEffectCount(taskId), {
                timeout: 30_000,
                message: 'scan task should reach awaiting_confirmation',
            }).toBeGreaterThan(0);

            await wait(6000);
            const taskEvents = harness.getTaskEvents().filter((event) => event.taskId === taskId);
            const hasPrematureFailure = taskEvents.some((event) => event.type === 'TASK_FAILED');
            expect(hasPrematureFailure).toBe(false);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('scheduled execution reuses the original session task id instead of creating a new one', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-scheduled-same-session-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const sourceTaskId = randomUUID();
            const startResult = await harness.startTask({
                taskId: sourceTaskId,
                title: 'Scheduled scan task',
                userQuery: '3秒之后，扫描/Users/beihuang/Documents/目录下的文件夹，给出分类列表即可',
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            await expect.poll(() => {
                const taskEvents = harness.getTaskEvents().filter((event) => event.taskId === sourceTaskId);
                return taskEvents.some((event) => event.type === 'TASK_FINISHED');
            }, {
                timeout: 20_000,
                message: 'source task should first finish with scheduled confirmation',
            }).toBe(true);

            await expect.poll(() => {
                const scheduledStarts = harness
                    .getTaskEvents()
                    .filter(
                        (event) =>
                            event.type === 'TASK_STARTED'
                            && String((event.payload as Record<string, unknown>)?.title ?? '').startsWith('[Scheduled]')
                    );
                if (scheduledStarts.length === 0) {
                    return null;
                }
                return Array.from(new Set(scheduledStarts.map((event) => event.taskId)));
            }, {
                timeout: 45_000,
                message: 'scheduled execution should emit a started event',
            }).toEqual([sourceTaskId]);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('scheduled-task matrix covers all supported desktop expressions', async ({ page }, testInfo) => {
        testInfo.setTimeout(10 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-scheduled-matrix-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const results: Array<{
                scenarioId: string;
                taskId: string;
                confirmation: string;
            }> = [];

            for (const scenario of SCHEDULED_DESKTOP_SCENARIOS) {
                const sourceTaskId = randomUUID();
                const eventCursor = harness.getTaskEvents().length;
                const startResult = await harness.startTask({
                    taskId: sourceTaskId,
                    title: `Scheduled scenario: ${scenario.id}`,
                    userQuery: scenario.query,
                    workspacePath: harness.workspace.path,
                });
                expect(startResult.success, `scenario ${scenario.id} should start successfully`).toBe(true);

                const confirmation = await waitForValue(() => {
                    const events = harness.getTaskEvents().slice(eventCursor);
                    const event = events.find(
                        (item) =>
                            item.taskId === sourceTaskId
                            && item.type === 'TASK_FINISHED'
                            && String((item.payload as Record<string, unknown>)?.summary ?? '').includes('已安排在'),
                    );
                    if (!event) return undefined;
                    return String((event.payload as Record<string, unknown>)?.summary ?? '');
                }, 40_000, `scenario ${scenario.id}: scheduled confirmation not observed`);

                expect(confirmation).toContain('已安排在');
                if (scenario.expectVoiceConfirmation) {
                    expect(confirmation).toContain('完成后会为你语音播报');
                } else {
                    expect(confirmation).not.toContain('完成后会为你语音播报');
                }

                results.push({
                    scenarioId: scenario.id,
                    taskId: sourceTaskId,
                    confirmation,
                });
            }

            writeJsonFile(path.join(appDataDir, 'scheduled-scenario-results.json'), results);
            expect(results).toHaveLength(SCHEDULED_DESKTOP_SCENARIOS.length);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('one-time scheduled task starts immediately when delay is zero', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-one-time-immediate-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const sourceTaskId = randomUUID();
            const eventCursor = harness.getTaskEvents().length;
            const startedAt = Date.now();
            const startResult = await harness.startTask({
                taskId: sourceTaskId,
                title: 'One-time immediate schedule',
                userQuery: SCHEDULED_ACCEPTANCE_QUERIES.oneTimeImmediate,
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            const confirmation = await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                const finished = events.find(
                    (event) =>
                        event.taskId === sourceTaskId
                        && event.type === 'TASK_FINISHED'
                        && String((event.payload as Record<string, unknown>)?.summary ?? '').includes('已安排在'),
                );
                if (!finished) return undefined;
                return String((finished.payload as Record<string, unknown>)?.summary ?? '');
            }, 40_000, 'one-time immediate scenario should show scheduled confirmation');
            expect(confirmation).toContain('已安排在');

            await expect(page.getByRole('button', { name: /\[Scheduled\] 只回复：一次性立即执行/ }).first()).toBeVisible({
                timeout: 20_000,
            });

            const scheduledStarted = await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find((event) => isScheduledStartedNoticeEvent(event, sourceTaskId));
            }, 45_000, 'scheduled execution should start immediately for zero-delay one-time task');
            const scheduledStartedAtMs = new Date(scheduledStarted.timestamp).getTime();
            expect(scheduledStartedAtMs - startedAt).toBeLessThan(25_000);

            const scheduledRecords = readPersistedScheduledTaskRecords(appDataDir)
                .filter((record) => record.sourceTaskId === sourceTaskId);
            expect(scheduledRecords.length).toBeGreaterThan(0);
            const firstRecord = scheduledRecords[0]!;
            const executeAtMs = new Date(String(firstRecord.executeAt ?? '')).getTime();
            expect(Number.isFinite(executeAtMs)).toBe(true);
            expect(executeAtMs - startedAt).toBeLessThan(20_000);
            expect(firstRecord.frozenWorkRequest?.schedule?.recurrence ?? null).toBeNull();
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('one-time scheduled task respects explicit delayed start time', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-one-time-delayed-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const sourceTaskId = randomUUID();
            const eventCursor = harness.getTaskEvents().length;
            const startedAt = Date.now();
            const startResult = await harness.startTask({
                taskId: sourceTaskId,
                title: 'One-time delayed schedule',
                userQuery: SCHEDULED_ACCEPTANCE_QUERIES.oneTimeDelayed,
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find(
                    (event) =>
                        event.taskId === sourceTaskId
                        && event.type === 'TASK_FINISHED'
                        && String((event.payload as Record<string, unknown>)?.summary ?? '').includes('已安排在'),
                );
            }, 40_000, 'one-time delayed scenario should show scheduled confirmation');

            await wait(1500);
            const earlyScheduledStarts = getEventsSince(harness.getTaskEvents(), eventCursor).filter((event) => {
                return isScheduledStartedNoticeEvent(event, sourceTaskId);
            });
            expect(earlyScheduledStarts.length).toBe(0);

            const delayedStartEvent = await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find((event) => isScheduledStartedNoticeEvent(event, sourceTaskId));
            }, 45_000, 'one-time delayed scenario should eventually start');
            const delayedStartAtMs = new Date(delayedStartEvent.timestamp).getTime();
            expect(delayedStartAtMs - startedAt).toBeGreaterThanOrEqual(2_000);

            const scheduledRecords = readPersistedScheduledTaskRecords(appDataDir)
                .filter((record) => record.sourceTaskId === sourceTaskId);
            expect(scheduledRecords.length).toBeGreaterThan(0);
            const firstRecord = scheduledRecords[0]!;
            const executeAtMs = new Date(String(firstRecord.executeAt ?? '')).getTime();
            expect(Number.isFinite(executeAtMs)).toBe(true);
            expect(executeAtMs - startedAt).toBeGreaterThanOrEqual(2_000);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('recurring scheduled task starts immediately when no explicit start time is provided', async ({ page }, testInfo) => {
        testInfo.setTimeout(5 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-recurring-immediate-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const sourceTaskId = randomUUID();
            const eventCursor = harness.getTaskEvents().length;
            const startedAt = Date.now();
            const startResult = await harness.startTask({
                taskId: sourceTaskId,
                title: 'Recurring immediate schedule',
                userQuery: SCHEDULED_ACCEPTANCE_QUERIES.recurringImmediate,
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find(
                    (event) =>
                        event.taskId === sourceTaskId
                        && event.type === 'TASK_FINISHED'
                        && String((event.payload as Record<string, unknown>)?.summary ?? '').includes('已安排在'),
                );
            }, 45_000, 'recurring immediate scenario should show scheduled confirmation');

            await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find((event) => isScheduledStartedNoticeEvent(event, sourceTaskId));
            }, 60_000, 'recurring immediate scenario should start scheduled execution quickly');

            const records = await waitForValue(() => {
                const candidate = readPersistedScheduledTaskRecords(appDataDir)
                    .filter((record) => record.sourceTaskId === sourceTaskId);
                const recurring = candidate.find((record) =>
                    record.frozenWorkRequest?.schedule?.recurrence?.value === 'FREQ=MINUTELY;INTERVAL=5'
                );
                const hasNextScheduled = candidate.some((record) => record.status === 'scheduled');
                if (!recurring || !hasNextScheduled || candidate.length < 2) {
                    return undefined;
                }
                return candidate;
            }, 120_000, 'recurring immediate scenario should auto-reschedule next run');
            const sortedByExecuteAt = [...records].sort((left, right) =>
                new Date(String(left.executeAt ?? '')).getTime() - new Date(String(right.executeAt ?? '')).getTime()
            );
            const first = sortedByExecuteAt[0]!;
            const nextScheduled = sortedByExecuteAt.find((record) => record.status === 'scheduled');
            expect(nextScheduled).toBeDefined();
            const firstExecuteAtMs = new Date(String(first.executeAt ?? '')).getTime();
            const nextExecuteAtMs = new Date(String(nextScheduled?.executeAt ?? '')).getTime();
            expect(firstExecuteAtMs - startedAt).toBeLessThan(20_000);
            expect(nextExecuteAtMs - firstExecuteAtMs).toBeGreaterThanOrEqual(4 * 60_000);
            expect(nextExecuteAtMs - firstExecuteAtMs).toBeLessThanOrEqual(6 * 60_000);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('recurring scheduled task respects explicit delayed start time', async ({ page }, testInfo) => {
        testInfo.setTimeout(5 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-recurring-delayed-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const sourceTaskId = randomUUID();
            const eventCursor = harness.getTaskEvents().length;
            const startedAt = Date.now();
            const startResult = await harness.startTask({
                taskId: sourceTaskId,
                title: 'Recurring delayed schedule',
                userQuery: SCHEDULED_ACCEPTANCE_QUERIES.recurringDelayed,
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find(
                    (event) =>
                        event.taskId === sourceTaskId
                        && event.type === 'TASK_FINISHED'
                        && String((event.payload as Record<string, unknown>)?.summary ?? '').includes('已安排在'),
                );
            }, 45_000, 'recurring delayed scenario should show scheduled confirmation');

            await wait(1500);
            const earlyScheduledStarts = getEventsSince(harness.getTaskEvents(), eventCursor).filter((event) => {
                return isScheduledStartedNoticeEvent(event, sourceTaskId);
            });
            expect(earlyScheduledStarts.length).toBe(0);

            const delayedStartEvent = await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find((event) => isScheduledStartedNoticeEvent(event, sourceTaskId));
            }, 60_000, 'recurring delayed scenario should eventually start');
            const delayedStartAtMs = new Date(delayedStartEvent.timestamp).getTime();
            expect(delayedStartAtMs - startedAt).toBeGreaterThanOrEqual(2_000);

            const records = readPersistedScheduledTaskRecords(appDataDir)
                .filter((record) => record.sourceTaskId === sourceTaskId);
            expect(records.length).toBeGreaterThan(0);
            const first = records[0]!;
            expect(first.frozenWorkRequest?.schedule?.recurrence?.value).toBe('FREQ=MINUTELY;INTERVAL=5');
            const executeAtMs = new Date(String(first.executeAt ?? '')).getTime();
            expect(executeAtMs - startedAt).toBeGreaterThanOrEqual(2_000);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('cancels in-progress task from desktop UI and persists cancellation outcome', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-cancel-ui-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const taskId = randomUUID();
            const startResult = await harness.startTask({
                taskId,
                title: 'Cancellation scenario',
                userQuery: SCHEDULED_ACCEPTANCE_QUERIES.cancellableLongRunning,
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            await expect.poll(() => harness.getAwaitingEffectCount(taskId), {
                timeout: 40_000,
                message: 'task should reach awaiting_confirmation before cancellation',
            }).toBeGreaterThan(0);

            const cancelResult = await page.evaluate(async (input) => {
                const internals = (window as any).__TAURI_INTERNALS__;
                return internals.invoke('cancel_task', { input });
            }, {
                taskId,
                reason: 'desktop-e2e-cancel',
            }) as { success?: boolean; taskId?: string };
            expect(cancelResult.success).toBe(true);
            expect(cancelResult.taskId).toBe(taskId);

            await expect.poll(() => {
                const record = readPersistedRuntimeRecords(appDataDir).find((item) => item.taskId === taskId);
                return record?.status ?? null;
            }, {
                timeout: 20_000,
                message: 'cancelled task should not remain running in persisted runtime',
            }).not.toBe('running');
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('chained flow asks required collaboration only before execution and does not ask again after user input', async ({ page }, testInfo) => {
        testInfo.setTimeout(6 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-chain-collab-gate-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const sourceTaskId = randomUUID();
            const startCursor = harness.getTaskEvents().length;
            const startResult = await harness.startTask({
                taskId: sourceTaskId,
                title: 'Chain collaboration gate',
                userQuery: '继续处理这个',
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            const planReadyBeforeClarification = await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), startCursor)
                    .filter((event) => event.taskId === sourceTaskId);
                const planReady = events.find((event) => event.type === 'TASK_PLAN_READY');
                const clarification = events.find((event) => event.type === 'TASK_CLARIFICATION_REQUIRED');
                if (!planReady || !clarification) {
                    return undefined;
                }
                return {
                    planReady,
                    clarification,
                    events,
                };
            }, 60_000, 'chain collaboration scenario should emit plan-ready and clarification gate');
            expect(planReadyBeforeClarification.planReady.sequence).toBeLessThan(planReadyBeforeClarification.clarification.sequence);
            expect(
                planReadyBeforeClarification.events.some((event) => event.type === 'TOOL_CALL'),
                'execution should not start before clarification is provided',
            ).toBe(false);
            expect(planReadyBeforeClarification.events.some((event) => event.type === 'TASK_FINISHED')).toBe(false);
            const clarificationPayload = planReadyBeforeClarification.clarification.payload as Record<string, unknown>;
            const missingFields = Array.isArray(clarificationPayload.missingFields)
                ? clarificationPayload.missingFields.map((field) => String(field))
                : [];
            expect(missingFields).toContain('task_scope');

            const followUpCursor = harness.getTaskEvents().length;
            const followUpResult = await harness.sendTaskMessage({
                taskId: sourceTaskId,
                content: SCHEDULED_ACCEPTANCE_QUERIES.chainedImmediate,
            });
            expect(followUpResult.success).toBe(true);

            const chainConfirmation = await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), followUpCursor);
                const finished = events.find(
                    (event) =>
                        event.taskId === sourceTaskId
                        && event.type === 'TASK_FINISHED'
                        && String((event.payload as Record<string, unknown>)?.summary ?? '').includes('已拆解为 2 个链式阶段任务'),
                );
                if (!finished) return undefined;
                return String((finished.payload as Record<string, unknown>)?.summary ?? '');
            }, 60_000, 'chain collaboration scenario should finish with chained-stage scheduling confirmation');
            expect(chainConfirmation).toContain('已拆解为 2 个链式阶段任务');
            await expect(page.getByRole('button', { name: /\[Scheduled\] 只回复：阶段1完成/ }).first()).toBeVisible({
                timeout: 20_000,
            });

            await expect.poll(() => {
                const events = getEventsSince(harness.getTaskEvents(), followUpCursor).filter((event) =>
                    isScheduledStartedNoticeEvent(event, sourceTaskId)
                );
                return events.length;
            }, {
                timeout: 120_000,
                message: 'chain collaboration scenario should start both chained stages',
            }).toBeGreaterThanOrEqual(2);

            const collaborationEventsAfterInput = getEventsSince(harness.getTaskEvents(), followUpCursor)
                .filter((event) => event.taskId === sourceTaskId)
                .filter((event) => isTaskCollaborationEvent(event));
            expect(collaborationEventsAfterInput).toEqual([]);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('concurrent flows gate collaboration per task before execution and avoid re-confirmation after input', async ({ page }, testInfo) => {
        testInfo.setTimeout(6 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-concurrent-collab-gate-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const taskInputs = [1, 2, 3].map((index) => ({
                taskId: randomUUID(),
                title: `Concurrent collaboration gate ${index}`,
                userQuery: '继续处理这个',
                marker: `CONCURRENT_COLLAB_DONE_${index}_${randomUUID().slice(0, 8)}`,
            }));
            const eventCursor = harness.getTaskEvents().length;
            const startResults = await Promise.all(taskInputs.map((input) =>
                harness.startTask({
                    taskId: input.taskId,
                    title: input.title,
                    userQuery: input.userQuery,
                    workspacePath: harness.workspace.path,
                })
            ));
            expect(startResults.every((result) => result.success)).toBe(true);

            await expect.poll(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return taskInputs.map((task) => {
                    const taskEvents = collectTaskEvents(events, task.taskId);
                    const planReady = taskEvents.find((event) => event.type === 'TASK_PLAN_READY');
                    const clarification = taskEvents.find((event) => event.type === 'TASK_CLARIFICATION_REQUIRED');
                    const hasToolCall = taskEvents.some((event) => event.type === 'TOOL_CALL');
                    if (!planReady || !clarification || hasToolCall) {
                        return false;
                    }
                    if (planReady.sequence >= clarification.sequence) {
                        return false;
                    }
                    const clarificationPayload = clarification.payload as Record<string, unknown>;
                    const missingFields = Array.isArray(clarificationPayload.missingFields)
                        ? clarificationPayload.missingFields.map((field) => String(field))
                        : [];
                    return missingFields.includes('task_scope');
                });
            }, {
                timeout: 70_000,
                message: 'all concurrent tasks should emit plan-ready + pre-execution clarification without tool execution',
            }).toEqual(taskInputs.map(() => true));

            const followUpCursorByTask = new Map<string, number>();
            for (const [index, task] of taskInputs.entries()) {
                followUpCursorByTask.set(task.taskId, harness.getTaskEvents().length);
                const sendResult = await harness.sendTaskMessage({
                    taskId: task.taskId,
                    content: `请直接回复：并发任务${index + 1}完成，标记：${task.marker}`,
                });
                expect(sendResult.success).toBe(true);
            }

            await expect.poll(() => {
                const events = harness.getTaskEvents();
                return taskInputs.map((task) => {
                    const sinceCursor = getEventsSince(events, followUpCursorByTask.get(task.taskId) ?? 0)
                        .filter((event) => event.taskId === task.taskId);
                    const finished = sinceCursor.some((event) => event.type === 'TASK_FINISHED');
                    const ownMarkerInReply = sinceCursor.some((event) =>
                        event.type === 'CHAT_MESSAGE'
                        && String((event.payload as Record<string, unknown>)?.content ?? '').includes(task.marker)
                    );
                    const unexpectedCollaboration = sinceCursor.some((event) => isTaskCollaborationEvent(event));
                    return finished && ownMarkerInReply && !unexpectedCollaboration;
                });
            }, {
                timeout: 90_000,
                message: 'concurrent tasks should finish after one clarification round and avoid extra collaboration prompts',
            }).toEqual(taskInputs.map(() => true));

            const events = harness.getTaskEvents();
            for (const task of taskInputs) {
                const taskEvents = collectTaskEvents(events, task.taskId);
                const ownMarkerHits = taskEvents.filter((event) =>
                    event.type === 'CHAT_MESSAGE'
                    && String((event.payload as Record<string, unknown>)?.content ?? '').includes(task.marker)
                );
                expect(ownMarkerHits.length).toBeGreaterThan(0);
                const foreignMarkers = taskInputs
                    .filter((candidate) => candidate.taskId !== task.taskId)
                    .filter((candidate) =>
                        taskEvents.some((event) =>
                            event.type === 'CHAT_MESSAGE'
                            && String((event.payload as Record<string, unknown>)?.content ?? '').includes(candidate.marker)
                        )
                    );
                expect(foreignMarkers).toEqual([]);
            }
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('chained scheduled task runs stage-by-stage with continuation scheduling message', async ({ page }, testInfo) => {
        testInfo.setTimeout(6 * 60 * 1000);
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-chain-scheduled-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const sourceTaskId = randomUUID();
            const eventCursor = harness.getTaskEvents().length;
            const startResult = await harness.startTask({
                taskId: sourceTaskId,
                title: 'Chained scheduled scenario',
                userQuery: SCHEDULED_ACCEPTANCE_QUERIES.chainedImmediate,
                workspacePath: harness.workspace.path,
            });
            expect(startResult.success).toBe(true);

            const chainConfirmation = await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                const finished = events.find(
                    (event) =>
                        event.taskId === sourceTaskId
                        && event.type === 'TASK_FINISHED'
                        && String((event.payload as Record<string, unknown>)?.summary ?? '').includes('已拆解为 2 个链式阶段任务'),
                );
                if (!finished) return undefined;
                return String((finished.payload as Record<string, unknown>)?.summary ?? '');
            }, 60_000, 'chained scheduled scenario should emit chain confirmation');
            expect(chainConfirmation).toContain('已拆解为 2 个链式阶段任务');

            await expect(page.getByRole('button', { name: /Chained scheduled scenario/i }).first()).toBeVisible({
                timeout: 20_000,
            });

            await waitForValue(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor);
                return events.find(
                    (event) =>
                        event.taskId === sourceTaskId
                        && event.type === 'CHAT_MESSAGE'
                        && String((event.payload as Record<string, unknown>)?.content ?? '').includes('链式任务继续排程'),
                );
            }, 120_000, 'chained scheduled scenario should emit continuation scheduling message');

            await expect.poll(() => {
                const events = getEventsSince(harness.getTaskEvents(), eventCursor).filter((event) => {
                    return isScheduledStartedNoticeEvent(event, sourceTaskId);
                });
                return events.length;
            }, {
                timeout: 120_000,
                message: 'both chained scheduled stages should start',
            }).toBeGreaterThanOrEqual(2);

            const stagedRecords = readPersistedScheduledTaskRecords(appDataDir)
                .filter((record) => record.sourceTaskId === sourceTaskId);
            const stageIndexes = new Set(stagedRecords.map((record) => Number(record.stageIndex)));
            expect(stageIndexes.has(0)).toBe(true);
            expect(stageIndexes.has(1)).toBe(true);
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });

    test('concurrent tasks remain isolated in runtime persistence while running together', async ({ page }) => {
        const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-concurrent-acceptance-'));
        const harness = new ResumeSidecarHarness(await getFreePort(), appDataDir);

        try {
            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            const scenario = buildConcurrentScenarioMatrix()[0]!;
            const taskInputs = buildConcurrentTaskInputs(scenario, harness.workspace.path);
            const startResults = await Promise.all(taskInputs.map((input) => harness.startTask(input)));
            expect(startResults.every((result) => result.success)).toBe(true);

            await waitForConcurrentScenarioReadiness(harness, scenario, taskInputs);
            assertNoCrossTaskMarkerInterference(harness, scenario, taskInputs);
            await waitForTaskRuntimeRecords(appDataDir, taskInputs.map((input) => input.taskId), 40_000);
            assertNoCrossTaskMarkerInterferenceInRuntime(
                appDataDir,
                'concurrent-acceptance',
                taskInputs.map((input, index) => ({
                    ...input,
                    skillId: `scenario-${index + 1}`,
                    skillKind: 'system',
                }))
            );
        } finally {
            await harness.stop();
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    });
});
