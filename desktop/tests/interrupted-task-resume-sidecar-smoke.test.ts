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
    private taskEvents: SidecarEvent[] = [];
    private resumeResults: Array<{ success: boolean; taskId: string; error: string | null }> = [];

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
            this.stdoutBuffer += chunk.toString();
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
                    this.taskEvents.push(message);
                    void this.emitToPage('task-event', message);
                } catch {
                    process.stderr.write(`[sidecar-stdout] ${line}\n`);
                }
            }
        });

        this.sidecarProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
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

            const recoveryBanner = page.locator('.chat-recovery-banner').first();
            const continueButton = recoveryBanner.getByRole('button', { name: /Continue task/i });

            await expect(recoveryBanner).toBeVisible({ timeout: 20_000 });
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

            await expect(page.locator('.chat-recovery-banner')).toHaveCount(0);

            harness.seedPersistedRecoveryState();
            await harness.restartSidecar();

            const recoveryBanner = page.locator('.chat-recovery-banner').first();
            const continueButton = recoveryBanner.getByRole('button', { name: /Continue task/i });

            await expect(recoveryBanner).toBeVisible({ timeout: 20_000 });
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
});
