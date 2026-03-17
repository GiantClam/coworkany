import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const TEST_TIMEOUT_MS = 8 * 60 * 1000;
const AIBERM_MODEL = 'gpt-5.3-codex';
const AIBERM_BASE_URL = 'https://aiberm.com/v1';

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

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
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
            const { port } = address;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                return;
            }
        } catch {
            // keep polling
        }
        await wait(500);
    }
    throw new Error(`Timed out waiting for HTTP endpoint: ${url}`);
}

const INPUT_SELECTORS = [
    '.chat-input',
    'textarea.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="指令"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

async function findChatInput(page: Page): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible({ timeout: 1200 }).catch(() => false);
        if (visible) {
            return candidate;
        }
    }
    return null;
}

async function submitQuery(page: Page, query: string): Promise<void> {
    const input = await findChatInput(page);
    expect(input, 'desktop UI should expose chat input').not.toBeNull();
    await input!.fill(query);
    await input!.press('Enter');
    const submitButton = page.locator('button[type="submit"], .send-button').first();
    const canClick = await submitButton.isVisible({ timeout: 800 }).catch(() => false);
    if (canClick) {
        await submitButton.click({ timeout: 1500 }).catch(() => {});
    }
}

class OnboardingHarness {
    readonly desktopDir: string;
    readonly sidecarDir: string;
    readonly devServerPort: number;
    readonly devServerUrl: string;
    readonly appDataDir: string;
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
    private bridgeAttached = false;

    constructor(devServerPort: number, appDataDir: string) {
        this.desktopDir = process.cwd();
        this.sidecarDir = path.resolve(this.desktopDir, '..', 'sidecar');
        this.devServerPort = devServerPort;
        this.devServerUrl = `http://127.0.0.1:${devServerPort}/`;
        this.appDataDir = appDataDir;
        this.workspace = {
            id: 'onboarding-e2e-workspace',
            name: 'Onboarding E2E Workspace',
            path: this.desktopDir,
            createdAt: new Date().toISOString(),
            defaultSkills: [],
            defaultToolpacks: [],
        };
    }

    async start(page: Page): Promise<void> {
        this.page = page;
        ensureDir(this.appDataDir);
        if (!this.bridgeAttached) {
            await this.attachTauriBridge(page);
            this.bridgeAttached = true;
        }
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
            await this.terminateProcess(this.sidecarProc, 'SIGTERM');
            this.sidecarProc = null;
        }
        if (this.devServerProc) {
            await this.terminateProcess(this.devServerProc, 'SIGTERM');
            this.devServerProc = null;
        }
    }

    resetRuntimeState(): void {
        this.storeRids.clear();
        this.storePaths.clear();
        this.nextStoreRid = 1;
        this.stdoutBuffer = '';
        this.taskEvents = [];
    }

    async gotoApp(): Promise<void> {
        expect(this.page).not.toBeNull();
        await this.page!.goto(this.devServerUrl, { waitUntil: 'domcontentloaded' });
    }

    getTaskEvents(): SidecarEvent[] {
        return [...this.taskEvents];
    }

    getSessionsFilePath(): string {
        return path.join(this.appDataDir, 'sessions.json');
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

            (window as Window & { __codexEmit?: (eventName: string, payload: unknown) => void }).__codexEmit = (eventName, payload) => {
                const ids = Array.from(eventListeners.get(eventName) ?? []);
                for (const callbackId of ids) {
                    const entry = callbacks.get(callbackId);
                    if (!entry) continue;
                    entry.fn({ event: eventName, id: callbackId, payload });
                    if (entry.once) {
                        callbacks.delete(callbackId);
                        removeEventListenerId(eventName, callbackId);
                    }
                }
            };

            (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
                metadata: { currentWindow: { label: 'main' } },
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
                            if (ids.size === 0) eventListeners.delete(eventName);
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
                    return (window as Window & { __codexInvoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> }).__codexInvoke(cmd, args);
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
            for (const line of chunk.toString().split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[sidecar] ${line}\n`);
                }
            }
        });

        await wait(4000);
    }

    private async emitToPage(eventName: string, payload: unknown): Promise<void> {
        if (!this.page) return;
        await this.page.evaluate(
            ({ name, data }) => {
                (window as Window & { __codexEmit?: (eventName: string, payload: unknown) => void }).__codexEmit?.(name, data);
            },
            { name: eventName, data: payload }
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
                return this.storeSave(Number(args.rid));
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
                return { success: true, payload: this.readJson('llm-config.json', {}) };
            case 'save_llm_settings': {
                const input = args.input as Record<string, unknown>;
                this.writeJson('llm-config.json', input);
                return { success: true, payload: input, error: null };
            }
            case 'validate_llm_settings':
                return this.validateLlmSettings(args.input as Record<string, unknown>);
            case 'prepare_rag_embedding_model':
                return { success: true, payload: { message: 'RAG warmup skipped in E2E harness' } };
            case 'get_dependency_statuses':
                return {
                    success: true,
                    payload: {
                        runtimeContext: {
                            platform: 'darwin',
                            arch: process.arch,
                            appDataDir: this.appDataDir,
                            appDir: this.desktopDir,
                            shell: process.env.SHELL ?? '/bin/zsh',
                            sidecarLaunchMode: 'development',
                        },
                        dependencies: [
                            {
                                id: 'skillhub-cli',
                                name: 'Skillhub CLI',
                                description: 'Marketplace dependency',
                                installed: false,
                                ready: false,
                                bundled: false,
                                optional: false,
                            },
                            {
                                id: 'rag-service',
                                name: 'RAG Service',
                                description: 'Semantic memory indexing',
                                installed: true,
                                ready: false,
                                running: false,
                                bundled: true,
                                optional: false,
                            },
                            {
                                id: 'browser-use-service',
                                name: 'Browser Smart Mode',
                                description: 'Optional browser AI backend',
                                installed: true,
                                ready: false,
                                running: false,
                                bundled: true,
                                optional: true,
                            },
                        ],
                    },
                };
            case 'list_workspaces':
                return { success: true, payload: { workspaces: [this.workspace] } };
            case 'create_workspace':
                return { success: true, payload: { workspace: this.workspace } };
            case 'delete_workspace':
            case 'update_workspace':
                return { success: true, payload: { success: true } };
            case 'load_sessions':
                return this.loadSessions();
            case 'save_sessions':
                return this.saveSessions(args.input as Record<string, unknown>);
            case 'list_toolpacks':
                return { success: true, payload: { payload: { toolpacks: [] } } };
            case 'get_workspace_root':
                return this.desktopDir;
            case 'start_task':
                return this.handleStartTask(args.input as Record<string, unknown>);
            case 'send_task_message':
            case 'clear_task_history':
            case 'list_claude_skills':
            case 'set_claude_skill_enabled':
            case 'remove_claude_skill':
            case 'import_claude_skill':
                return this.forwardCommand(cmd, args.input as Record<string, unknown> | undefined);
            default:
                throw new Error(`Unsupported mocked Tauri command: ${cmd}`);
        }
    }

    private async validateLlmSettings(input: Record<string, unknown>): Promise<unknown> {
        const provider = String(input.provider ?? '');
        if (provider !== 'aiberm') {
            return { success: false, payload: { error: `Unsupported provider in harness: ${provider}` } };
        }

        const openai = input.openai as Record<string, unknown> | undefined;
        const apiKey = String(openai?.apiKey ?? '').trim();
        if (!apiKey) {
            return { success: false, payload: { error: 'Missing API key' } };
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
            const response = await fetch(`${AIBERM_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: AIBERM_MODEL,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'ping' }],
                }),
                signal: controller.signal,
            });

            if (response.ok) {
                return { success: true, payload: { message: 'Connection successful' } };
            }
            const errorText = await response.text();
            return {
                success: false,
                payload: { error: `Provider returned status ${response.status}: ${errorText}` },
            };
        } catch (error) {
            return {
                success: false,
                payload: { error: error instanceof Error ? error.message : String(error) },
            };
        } finally {
            clearTimeout(timer);
        }
    }

    private async handleStartTask(input: Record<string, unknown>): Promise<unknown> {
        const taskId = randomUUID();
        const response = await this.sendSidecarCommand('start_task', {
            taskId,
            title: String(input.title ?? ''),
            userQuery: String(input.userQuery ?? ''),
            context: {
                workspacePath: String(input.workspacePath ?? this.workspace.path),
                activeFile: input.activeFile ?? undefined,
            },
            config: input.config ?? {},
        });
        const payload = response.payload ?? {};
        return {
            success: Boolean(payload.success),
            taskId: String(payload.taskId ?? taskId),
            workspace: payload.workspace,
            error: typeof payload.error === 'string' ? payload.error : undefined,
        };
    }

    private async forwardCommand(cmd: string, input?: Record<string, unknown>): Promise<unknown> {
        const response = await this.sendSidecarCommand(cmd, input ?? {});
        return {
            success: true,
            payload: response,
        };
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
            }, 60_000);
            this.pending.set(commandId, { resolve, reject, timer });
        });

        this.sidecarProc.stdin.write(`${JSON.stringify(command)}\n`);
        return responsePromise;
    }

    private async terminateProcess(proc: ChildProcess, signal: NodeJS.Signals): Promise<void> {
        if (proc.killed || proc.exitCode !== null) {
            return;
        }

        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                } catch {
                    // ignore forced kill failures
                }
            }, 5_000);

            proc.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });

            try {
                proc.kill(signal);
            } catch {
                clearTimeout(timer);
                resolve();
            }
        });
    }

    private storeFilePath(storePath: string): string {
        return path.join(this.appDataDir, storePath);
    }

    private loadStore(storePath: string): number {
        const existing = this.storePaths.get(storePath);
        if (existing) return existing;

        const rid = this.nextStoreRid++;
        this.storePaths.set(storePath, rid);
        const initial = new Map<string, unknown>();
        const filePath = this.storeFilePath(storePath);
        try {
            if (fs.existsSync(filePath)) {
                const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
                for (const [key, value] of Object.entries(parsed)) {
                    initial.set(key, value);
                }
            }
        } catch {
            // ignore malformed store in harness
        }
        this.storeRids.set(rid, initial);
        return rid;
    }

    private getStoreMap(rid: number): Map<string, unknown> {
        const store = this.storeRids.get(rid);
        if (!store) throw new Error(`Unknown store resource id: ${rid}`);
        return store;
    }

    private persistStore(rid: number): null {
        const storePathEntry = Array.from(this.storePaths.entries()).find(([, value]) => value === rid);
        if (!storePathEntry) return null;
        const filePath = this.storeFilePath(storePathEntry[0]);
        ensureDir(path.dirname(filePath));
        const store = this.getStoreMap(rid);
        const serializable = Object.fromEntries(store.entries());
        fs.writeFileSync(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
        return null;
    }

    private storeGet(rid: number, key: string): [unknown, boolean] {
        const store = this.getStoreMap(rid);
        return [store.get(key), store.has(key)];
    }

    private storeSet(rid: number, key: string, value: unknown): null {
        const store = this.getStoreMap(rid);
        store.set(key, value);
        return this.persistStore(rid);
    }

    private storeDelete(rid: number, key: string): null {
        const store = this.getStoreMap(rid);
        store.delete(key);
        return this.persistStore(rid);
    }

    private storeSave(rid: number): null {
        return this.persistStore(rid);
    }

    private storeHas(rid: number, key: string): boolean {
        return this.getStoreMap(rid).has(key);
    }

    private storeClear(rid: number): null {
        this.getStoreMap(rid).clear();
        return this.persistStore(rid);
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

    private readJson(fileName: string, fallback: Record<string, unknown>): Record<string, unknown> {
        try {
            return JSON.parse(fs.readFileSync(path.join(this.appDataDir, fileName), 'utf-8')) as Record<string, unknown>;
        } catch {
            return fallback;
        }
    }

    private writeJson(fileName: string, value: Record<string, unknown>): void {
        ensureDir(this.appDataDir);
        fs.writeFileSync(path.join(this.appDataDir, fileName), JSON.stringify(value, null, 2), 'utf-8');
    }

    private loadSessions(): {
        success: boolean;
        payload: {
            sessions: Record<string, unknown>[];
            activeTaskId: string | null;
        };
        error: null;
    } {
        const snapshot = this.readJson('sessions.json', {
            sessions: [],
            activeTaskId: null,
        });
        return {
            success: true,
            payload: {
                sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions as Record<string, unknown>[] : [],
                activeTaskId: typeof snapshot.activeTaskId === 'string' ? snapshot.activeTaskId : null,
            },
            error: null,
        };
    }

    private saveSessions(input: Record<string, unknown>): {
        success: boolean;
        payload: {
            sessions: Record<string, unknown>[];
            activeTaskId: string | null;
        };
        error: null;
    } {
        const snapshot = {
            sessions: Array.isArray(input.sessions) ? input.sessions as Record<string, unknown>[] : [],
            activeTaskId: typeof input.activeTaskId === 'string' ? input.activeTaskId : null,
        };
        this.writeJson('sessions.json', snapshot);
        return {
            success: true,
            payload: snapshot,
            error: null,
        };
    }
}

test.describe('Desktop E2E - Clean machine onboarding', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('complete onboarding, open settings, and restore state after restart', async ({ page }) => {
        const apiKey = process.env.E2E_AIBERM_API_KEY?.trim();
        test.skip(!apiKey, 'E2E_AIBERM_API_KEY is required for onboarding connectivity validation.');

        const runId = Date.now().toString();
        const appDataDir = path.join(os.tmpdir(), 'coworkany-onboarding-e2e', runId, 'app-data');
        fs.rmSync(path.dirname(appDataDir), { recursive: true, force: true });
        ensureDir(appDataDir);

        const harness = new OnboardingHarness(await getFreePort(), appDataDir);
        await harness.start(page);

        try {
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            await expect(page.getByText(/Get Started|开始使用/).first()).toBeVisible({ timeout: 30_000 });
            await page.getByRole('button', { name: /Get Started|开始使用/ }).click();

            const providerSelect = page.locator('select').first();
            await providerSelect.waitFor({ state: 'visible', timeout: 15_000 });
            await providerSelect.selectOption('aiberm');

            const apiKeyInput = page.locator('input[type="password"]').first();
            await apiKeyInput.fill(apiKey!);

            await page.getByRole('button', { name: /Verify API Key|验证 API Key/ }).click();
            await expect(page.getByText(/Enable core capabilities|启用核心能力/).first()).toBeVisible({ timeout: 30_000 });

            await page.getByRole('button', { name: /Skip for now|稍后再说/ }).click();
            await expect(page.getByText(/You're All Set|一切就绪/i).first()).toBeVisible({ timeout: 30_000 });

            await page.getByRole('button', { name: /Start Using|开始使用/i }).click();

            const llmConfigPath = path.join(appDataDir, 'llm-config.json');
            const settingsPath = path.join(appDataDir, 'settings.json');
            await expect.poll(() => fs.existsSync(llmConfigPath), {
                timeout: 15_000,
                message: 'llm-config.json should be written during onboarding',
            }).toBe(true);
            await expect.poll(() => fs.existsSync(settingsPath), {
                timeout: 15_000,
                message: 'settings.json should persist setupCompleted',
            }).toBe(true);
            await expect.poll(() => fs.existsSync(harness.getSessionsFilePath()), {
                timeout: 15_000,
                message: 'sessions.json should be created after the first task starts',
            }).toBe(true);

            const llmConfig = JSON.parse(fs.readFileSync(llmConfigPath, 'utf-8')) as Record<string, unknown>;
            expect(llmConfig.provider).toBe('aiberm');
            expect(llmConfig.activeProfileId).toBeTruthy();

            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
            expect(settings.setupCompleted).toBe(true);
            expect((settings.llmConfig as Record<string, unknown>)?.provider).toBe('aiberm');

            await expect.poll(async () => Boolean(await findChatInput(page)), {
                timeout: 30_000,
                message: 'chat composer should be visible after onboarding completes',
            }).toBe(true);

            await submitQuery(page, '你好');

            await expect.poll(() => {
                return harness.getTaskEvents().some((event) => event.type === 'TASK_STARTED');
            }, {
                timeout: 30_000,
                message: 'first task should start after onboarding',
            }).toBe(true);

            await expect.poll(() => {
                return harness.getTaskEvents().some((event) => event.type === 'TEXT_DELTA' || event.type === 'TASK_FINISHED');
            }, {
                timeout: 60_000,
                message: 'first task should produce output after onboarding',
            }).toBe(true);

            await expect.poll(() => {
                const snapshot = JSON.parse(fs.readFileSync(harness.getSessionsFilePath(), 'utf-8')) as {
                    sessions?: Array<{
                        title?: string;
                        messages?: Array<{ role?: string; content?: string }>;
                    }>;
                    activeTaskId?: string | null;
                };
                const firstSession = snapshot.sessions?.[0];
                const hasUserMessage = firstSession?.messages?.some(
                    (message) => message.role === 'user' && message.content?.includes('你好')
                );
                const hasAssistantMessage = firstSession?.messages?.some(
                    (message) => message.role === 'assistant' && (message.content?.trim().length ?? 0) > 0
                );
                return Boolean(snapshot.activeTaskId && firstSession?.title === '你好' && hasUserMessage && hasAssistantMessage);
            }, {
                timeout: 30_000,
                message: 'sessions.json should persist the first conversation before restart',
            }).toBe(true);

            await page.locator('.sidebar-settings-btn').click();
            await expect(page.getByText(/LLM Provider Settings|LLM 服务商设置/).first()).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(/Aiberm \(Setup\)/).first()).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(/Active|活跃/).first()).toBeVisible({ timeout: 15_000 });
            await page.getByRole('button', { name: /Close|关闭/ }).click();

            await harness.stop();
            harness.resetRuntimeState();

            await harness.start(page);
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');

            await expect.poll(async () => Boolean(await findChatInput(page)), {
                timeout: 30_000,
                message: 'chat composer should be restored after restart without showing onboarding again',
            }).toBe(true);
            await expect(page.getByRole('button', { name: /Get Started|开始使用/ })).toHaveCount(0);
            await expect(page.locator('.session-item', { hasText: '你好' }).first()).toBeVisible({ timeout: 30_000 });
            await expect(page.getByText('你好').first()).toBeVisible({ timeout: 30_000 });
            await expect(page.getByText(/Task interrupted by app restart/).first()).toBeVisible({ timeout: 30_000 });

            await page.locator('.sidebar-settings-btn').click();
            await expect(page.getByText(/LLM Provider Settings|LLM 服务商设置/).first()).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(/Aiberm \(Setup\)/).first()).toBeVisible({ timeout: 15_000 });
        } finally {
            await harness.stop();
        }
    });
});
