import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';

const TASK_ID = '11111111-1111-4111-8111-111111111111';

type SessionsSnapshot = {
    sessions: Array<Record<string, unknown>>;
    activeTaskId: string | null;
};

type WorkspaceRecord = {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    defaultSkills: string[];
    defaultToolpacks: string[];
};

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
            // keep polling until Vite is ready
        }
        await wait(1000);
    }
    throw new Error(`Timed out waiting for HTTP endpoint: ${url}`);
}

class MockDesktopHarness {
    readonly desktopDir: string;
    readonly devServerPort: number;
    readonly devServerUrl: string;
    readonly workspace: WorkspaceRecord;

    private page: Page | null = null;
    private devServerProc: ChildProcess | null = null;
    private nextStoreRid = 1;
    private storeRids = new Map<number, Map<string, unknown>>();
    private storePaths = new Map<string, number>();
    private invokeLog: string[] = [];
    private sessionsSnapshot: SessionsSnapshot = { sessions: [], activeTaskId: null };

    constructor(devServerPort: number) {
        this.desktopDir = process.cwd();
        this.devServerPort = devServerPort;
        this.devServerUrl = `http://127.0.0.1:${devServerPort}/`;
        this.workspace = {
            id: 'resume-e2e-workspace',
            name: 'Resume E2E Workspace',
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

    async start(page: Page): Promise<void> {
        this.page = page;
        await this.attachTauriBridge(page);
        await this.startDevServer();
    }

    async stop(): Promise<void> {
        if (this.devServerProc) {
            this.devServerProc.kill('SIGTERM');
            this.devServerProc = null;
        }
    }

    async gotoApp(): Promise<void> {
        expect(this.page).not.toBeNull();
        await this.page!.goto(this.devServerUrl, { waitUntil: 'domcontentloaded' });
    }

    getInvokeLog(): string[] {
        return [...this.invokeLog];
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

    private async invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
        this.invokeLog.push(cmd);

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
                return { payload: this.sessionsSnapshot };
            case 'save_sessions':
                this.sessionsSnapshot = {
                    sessions: Array.isArray((args.input as { sessions?: unknown[] } | undefined)?.sessions)
                        ? ((args.input as { sessions: Array<Record<string, unknown>> }).sessions)
                        : [],
                    activeTaskId: typeof (args.input as { activeTaskId?: unknown } | undefined)?.activeTaskId === 'string'
                        ? String((args.input as { activeTaskId: string }).activeTaskId)
                        : null,
                };
                return { success: true, payload: this.sessionsSnapshot };
            case 'list_toolpacks':
                return { success: true, payload: { payload: { toolpacks: [] } } };
            case 'list_claude_skills':
                return { success: true, payload: { payload: { skills: [] } } };
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
            case 'resume_interrupted_task':
                return {
                    success: true,
                    taskId: String((args.input as { taskId?: string } | undefined)?.taskId ?? ''),
                    error: null,
                };
            default:
                throw new Error(`Unsupported mocked Tauri command: ${cmd}`);
        }
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

test.describe('Desktop GUI E2E - interrupted task recovery', () => {
    test.setTimeout(120_000);

    test('shows continue button for interrupted sessions and invokes resume_interrupted_task', async ({ page }) => {
        const harness = new MockDesktopHarness(await getFreePort());
        await harness.start(page);

        try {
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(3000);

            await page.evaluate(async ({ taskId, now }) => {
                const tauri = (window as Window & {
                    __TAURI_INTERNALS__: {
                        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
                    };
                }).__TAURI_INTERNALS__;

                await tauri.invoke('save_sessions', {
                    input: {
                        sessions: [
                            {
                                taskId,
                                status: 'running',
                                title: 'Interrupted recovery test',
                                planSteps: [],
                                toolCalls: [],
                                effects: [],
                                patches: [],
                                messages: [],
                                events: [],
                                createdAt: now,
                                updatedAt: now,
                            },
                        ],
                        activeTaskId: taskId,
                    },
                });
            }, { taskId: TASK_ID, now: new Date().toISOString() });

            await page.reload({ waitUntil: 'domcontentloaded' });

            const recoveryBanner = page.locator('.chat-recovery-banner').first();
            const continueButton = recoveryBanner.getByRole('button', { name: /Continue task/i });

            await expect(recoveryBanner).toBeVisible({ timeout: 20_000 });
            await expect(recoveryBanner).toContainText('Task interrupted');
            await expect(recoveryBanner).toContainText('Resume the task');
            await expect(continueButton).toBeVisible({ timeout: 20_000 });

            const beforeClickCount = harness.getInvokeLog().length;
            await continueButton.click();

            await expect.poll(() => {
                return harness.getInvokeLog().slice(beforeClickCount);
            }, {
                timeout: 10_000,
                message: 'resume action should invoke the dedicated resume command',
            }).toContain('resume_interrupted_task');

            expect(
                harness.getInvokeLog().slice(beforeClickCount).includes('send_task_message'),
                'continue button should not fall back to send_task_message',
            ).toBe(false);
        } finally {
            await harness.stop();
        }
    });
});
