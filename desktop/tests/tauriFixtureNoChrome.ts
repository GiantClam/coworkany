/**
 * Tauri Playwright fixture (no pre-launched Chrome).
 *
 * - Non-macOS: connect to real Tauri WebView via CDP (existing behavior).
 * - macOS: WKWebView has no Chromium CDP endpoint in this environment, so we
 *   run a browser mirror with an injected Tauri bridge backed by a real sidecar.
 */

import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { TauriLogCollector } from './tauriFixture';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

const CDP_PORT = 9945;
const DESKTOP_DIR = path.resolve(__dirname_local, '..');
const SIDECAR_DIR = path.resolve(DESKTOP_DIR, '..', 'sidecar');
const CDP_READY_TIMEOUT_MS = 120_000;
const CDP_POLL_MS = 2000;

const INPUT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_SHARED_CDP_PORT = 9224;

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) return defaultValue;
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveSharedCdpPort(): number {
    const raw = Number(process.env.COWORKANY_TEST_SHARED_CDP_PORT ?? DEFAULT_SHARED_CDP_PORT);
    if (!Number.isFinite(raw) || raw <= 0) {
        return DEFAULT_SHARED_CDP_PORT;
    }
    return Math.floor(raw);
}

function resolveDarwinChromeExecutable(): string | null {
    const explicitPath = process.env.COWORKANY_TEST_CHROME_PATH?.trim();
    if (explicitPath && fs.existsSync(explicitPath)) {
        return explicitPath;
    }

    const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
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

async function waitForCdp(port: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (res.ok) {
                const data = await res.json() as Record<string, string>;
                console.log(`[Fixture-NoChrome] CDP ready on port ${port}: ${data['Browser'] || 'unknown'}`);
                return true;
            }
        } catch {
            // Not ready yet
        }
        await new Promise(r => setTimeout(r, CDP_POLL_MS));
    }
    return false;
}

type SidecarResponse = {
    commandId: string;
    timestamp: string;
    type: string;
    payload: Record<string, unknown>;
};

type SidecarEvent = {
    id: string;
    taskId?: string;
    timestamp?: string;
    sequence?: number;
    type: string;
    payload?: Record<string, unknown>;
};

type WorkspaceRecord = {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    defaultSkills: string[];
    defaultToolpacks: string[];
};

class DarwinBrowserHarness {
    readonly desktopDir: string;
    readonly sidecarDir: string;
    readonly appDataDir: string;
    readonly workspace: WorkspaceRecord;
    readonly devServerPort: number;
    readonly devServerUrl: string;
    readonly skillhubPath: string;
    readonly disabledTools: string[];

    private readonly logs: TauriLogCollector;
    private readonly workerIndex: number;
    private page: Page | null = null;
    private devServerProc: childProcess.ChildProcess | null = null;
    private sidecarProc: childProcess.ChildProcess | null = null;
    private sharedChromeProc: childProcess.ChildProcess | null = null;
    private sharedChromePort: number | null = null;
    private pending = new Map<string, {
        resolve: (value: SidecarResponse) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
    }>();
    private storeRids = new Map<number, Map<string, unknown>>();
    private storePaths = new Map<string, number>();
    private nextStoreRid = 1;
    private stdoutBuffer = '';
    private autoApprovedPlanTaskIds = new Set<string>();
    private cleanupAppDataOnStop = false;
    private sessionsSnapshot: { sessions: Array<Record<string, unknown>>; activeTaskId: string | null } = {
        sessions: [],
        activeTaskId: null,
    };

    constructor(logs: TauriLogCollector, workerIndex: number, devServerPort: number) {
        this.logs = logs;
        this.workerIndex = workerIndex;
        this.desktopDir = DESKTOP_DIR;
        this.sidecarDir = SIDECAR_DIR;
        const primaryAppDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'com.coworkany.desktop');
        const isolatedAppDataEnabled = readBooleanEnv('COWORKANY_TEST_ISOLATE_APP_DATA', false);
        if (isolatedAppDataEnabled) {
            this.appDataDir = path.join(
                fs.realpathSync(os.tmpdir()),
                `coworkany-nochrome-appdata-${workerIndex}`,
            );
            this.prepareIsolatedAppData(primaryAppDataDir, this.appDataDir);
            this.cleanupAppDataOnStop = true;
        } else {
            this.appDataDir = primaryAppDataDir;
        }
        this.devServerPort = devServerPort;
        this.devServerUrl = `http://127.0.0.1:${devServerPort}/`;
        this.skillhubPath = path.join(os.homedir(), '.local', 'bin', 'skillhub');
        this.disabledTools = [
            'install_coworkany_skill_from_marketplace',
            'search_coworkany_skill_marketplace',
        ];
        this.workspace = {
            id: 'desktop-test-workspace',
            name: 'Desktop Test Workspace',
            path: path.join(this.sidecarDir, '.coworkany', 'test-workspace'),
            createdAt: new Date().toISOString(),
            defaultSkills: [],
            defaultToolpacks: [],
        };

        fs.mkdirSync(this.workspace.path, { recursive: true });
        fs.mkdirSync(this.appDataDir, { recursive: true });

        const settingsStore = new Map<string, unknown>();
        settingsStore.set('setupCompleted', true);
        settingsStore.set('activeWorkspaceId', this.workspace.id);
        this.storeRids.set(this.nextStoreRid, settingsStore);
        this.storePaths.set('settings.json', this.nextStoreRid);
        this.nextStoreRid += 1;

        this.logs.push(`[Fixture-NoChrome] Darwin mirror harness initialized (port ${this.devServerPort})\n`);
    }

    async start(page: Page): Promise<void> {
        this.page = page;
        await this.attachTauriBridge(page);
        await this.startDevServer();
        await this.ensureSharedChromeCdpIfEnabled();
        await this.startSidecar();
        await this.page.goto(this.devServerUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(3000);
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
        if (this.sharedChromeProc?.pid) {
            try {
                process.kill(this.sharedChromeProc.pid, 'SIGTERM');
                this.logs.push(`[Fixture-NoChrome] Stopped shared Chrome (PID: ${this.sharedChromeProc.pid})\n`);
            } catch {
                // Ignore process shutdown failures.
            } finally {
                this.sharedChromeProc = null;
            }
        }
        if (this.cleanupAppDataOnStop) {
            try {
                fs.rmSync(this.appDataDir, { recursive: true, force: true });
                this.logs.push(`[Fixture-NoChrome] Removed isolated app data dir: ${this.appDataDir}\n`);
            } catch {
                // Ignore cleanup failures.
            }
        }

        // Keep real app data dir intact.
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
        this.devServerProc = childProcess.spawn('npx', [
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
            this.logs.push(chunk.toString());
        });
        this.devServerProc.stderr?.on('data', (chunk: Buffer) => {
            this.logs.push(chunk.toString());
        });

        await waitForHttp(this.devServerUrl, INPUT_READY_TIMEOUT_MS);
    }

    private prepareIsolatedAppData(sourceDir: string, targetDir: string): void {
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(targetDir, { recursive: true });

        const settingsPath = path.join(targetDir, 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify({ setupCompleted: true }, null, 2), 'utf-8');

        const sourceConfigPath = path.join(sourceDir, 'llm-config.json');
        if (!fs.existsSync(sourceConfigPath)) {
            this.logs.push(`[Fixture-NoChrome] No source llm-config.json found at ${sourceConfigPath}; isolated app data uses setup-only mode\n`);
            return;
        }

        try {
            const raw = fs.readFileSync(sourceConfigPath, 'utf-8');
            const config = JSON.parse(raw) as Record<string, unknown>;

            const existingProxy = (
                typeof config.proxy === 'object'
                && config.proxy !== null
            ) ? config.proxy as Record<string, unknown> : null;
            if (existingProxy && existingProxy.enabled === true && typeof existingProxy.url === 'string' && existingProxy.url.trim().length > 0) {
                const existingBypassRaw = typeof existingProxy.bypass === 'string'
                    ? existingProxy.bypass
                    : '';
                const requiredBypassEntries = ['localhost', '127.0.0.1', '::1'];
                const mergedBypass = Array.from(
                    new Set(
                        `${existingBypassRaw},${requiredBypassEntries.join(',')}`
                            .split(',')
                            .map((item) => item.trim())
                            .filter((item) => item.length > 0),
                    ),
                );
                config.proxy = {
                    ...existingProxy,
                    bypass: mergedBypass.join(','),
                };
            }

            const explicitServiceUrl = process.env.COWORKANY_TEST_BROWSER_USE_SERVICE_URL?.trim();
            const browserUsePort = Number(process.env.BROWSER_USE_PORT ?? 8100);
            const browserUseServiceUrl = explicitServiceUrl && explicitServiceUrl.length > 0
                ? explicitServiceUrl
                : `http://127.0.0.1:${Number.isFinite(browserUsePort) ? browserUsePort : 8100}`;

            const existingBrowserUse = (
                typeof config.browserUse === 'object'
                && config.browserUse !== null
            ) ? config.browserUse as Record<string, unknown> : {};

            config.browserUse = {
                ...existingBrowserUse,
                enabled: true,
                serviceUrl: browserUseServiceUrl,
            };

            const targetConfigPath = path.join(targetDir, 'llm-config.json');
            fs.writeFileSync(targetConfigPath, JSON.stringify(config, null, 2), 'utf-8');
            this.logs.push(`[Fixture-NoChrome] Isolated app data prepared with browser-use URL ${browserUseServiceUrl}\n`);
        } catch (error) {
            this.logs.push(`[Fixture-NoChrome] Failed to prepare isolated app data: ${error instanceof Error ? error.message : String(error)}\n`);
        }
    }

    private isSharedChromeCdpEnabled(): boolean {
        return readBooleanEnv('COWORKANY_TEST_ENABLE_BROWSER_SHARED_CDP', false);
    }

    private async ensureSharedChromeCdpIfEnabled(): Promise<void> {
        if (!this.isSharedChromeCdpEnabled()) {
            return;
        }

        const cdpPort = resolveSharedCdpPort();
        this.sharedChromePort = cdpPort;

        const alreadyReady = await waitForCdp(cdpPort, 3000);
        if (alreadyReady) {
            this.logs.push(`[Fixture-NoChrome] Shared CDP already available on port ${cdpPort}; reusing existing Chrome\n`);
            return;
        }

        const chromePath = resolveDarwinChromeExecutable();
        if (!chromePath) {
            this.logs.push(`[Fixture-NoChrome] Shared CDP requested but Chrome executable not found on macOS\n`);
            return;
        }

        const userDataDir = path.join(
            fs.realpathSync(os.tmpdir()),
            `coworkany-shared-cdp-chrome-${this.workerIndex}`,
        );
        fs.mkdirSync(userDataDir, { recursive: true });

        const chromeProc = childProcess.spawn(
            chromePath,
            [
                `--remote-debugging-port=${cdpPort}`,
                `--user-data-dir=${userDataDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                'about:blank',
            ],
            {
                detached: true,
                stdio: 'ignore',
            },
        );
        chromeProc.unref();
        this.sharedChromeProc = chromeProc;
        this.logs.push(`[Fixture-NoChrome] Starting shared CDP Chrome on port ${cdpPort} (PID: ${chromeProc.pid ?? 'unknown'})\n`);

        const ready = await waitForCdp(cdpPort, 30_000);
        if (!ready) {
            this.logs.push(`[Fixture-NoChrome] Shared CDP Chrome failed to open port ${cdpPort} within timeout\n`);
            return;
        }

        this.logs.push(`[Fixture-NoChrome] Shared CDP Chrome ready on port ${cdpPort}\n`);
    }

    private async startSidecar(): Promise<void> {
        const disableBrowserCdp = process.env.COWORKANY_DISABLE_BROWSER_CDP
            ?? (this.isSharedChromeCdpEnabled() ? 'false' : 'true');
        this.sidecarProc = childProcess.spawn('bun', ['run', 'src/main.ts'], {
            cwd: this.sidecarDir,
            env: {
                ...process.env,
                COWORKANY_APP_DATA_DIR: this.appDataDir,
                COWORKANY_DISABLE_BROWSER_CDP: disableBrowserCdp,
                PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
        });

        this.sidecarProc.stderr?.on('data', (chunk: Buffer) => {
            this.logs.push(chunk.toString());
        });

        this.sidecarProc.stdout?.on('data', (chunk: Buffer) => {
            this.stdoutBuffer += chunk.toString();
            const lines = this.stdoutBuffer.split('\n');
            this.stdoutBuffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const message = JSON.parse(line) as SidecarResponse | SidecarEvent;
                    this.logs.push(`Received from sidecar: ${JSON.stringify(message)}\n`);

                    if ('commandId' in message) {
                        const waiter = this.pending.get(message.commandId);
                        if (waiter) {
                            clearTimeout(waiter.timer);
                            this.pending.delete(message.commandId);
                            waiter.resolve(message);
                        }
                        continue;
                    }

                    if (message.type === 'request_effect' && typeof message.id === 'string') {
                        void this.handleRequestEffectCommand(message as SidecarEvent & {
                            payload?: {
                                request?: {
                                    id?: string;
                                };
                            };
                        });
                        continue;
                    }

                    if (
                        message.type === 'TASK_USER_ACTION_REQUIRED'
                        && typeof message.taskId === 'string'
                        && !this.autoApprovedPlanTaskIds.has(message.taskId)
                    ) {
                        const kind = String((message.payload as { kind?: unknown } | undefined)?.kind ?? '');
                        const executionPolicy = String((message.payload as { executionPolicy?: unknown } | undefined)?.executionPolicy ?? '');
                        if (kind === 'confirm_plan' || executionPolicy === 'review_required') {
                            this.autoApprovedPlanTaskIds.add(message.taskId);
                            void this.autoApprovePlanConfirmation(message.taskId);
                        }
                    }

                    void this.emitToPage('task-event', message);
                } catch {
                    this.logs.push(`${line}\n`);
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
                    available: true,
                    path: 'python3',
                    source: 'system',
                },
                skillhub: {
                    available: fs.existsSync(this.skillhubPath),
                    path: this.skillhubPath,
                    source: fs.existsSync(this.skillhubPath) ? 'path_lookup' : 'not_found',
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
            { name: eventName, data: payload }
        ).catch(() => {});
    }

    private async handleRequestEffectCommand(message: SidecarEvent & {
        payload?: {
            request?: {
                id?: string;
            };
        };
    }): Promise<void> {
        const requestId = String(message.payload?.request?.id ?? randomUUID());
        const effectResponse = {
            requestId,
            timestamp: new Date().toISOString(),
            approved: true,
            approvalType: 'once',
            expiresAt: null,
            denialReason: null,
            denialCode: null,
            modifiedScope: null,
        };

        const ipcResponse: SidecarResponse = {
            commandId: message.id,
            timestamp: new Date().toISOString(),
            type: 'request_effect_response',
            payload: {
                response: effectResponse,
            },
        };

        this.logs.push(`Sending to sidecar: ${JSON.stringify(ipcResponse)}\n`);
        await this.emitToPage('ipc-response', ipcResponse);
        this.sidecarProc?.stdin?.write(`${JSON.stringify(ipcResponse)}\n`);
    }

    private async autoApprovePlanConfirmation(taskId: string): Promise<void> {
        this.logs.push(`auto_approve_plan taskId=${taskId}\n`);
        await this.sendSidecarCommand('send_task_message', {
            taskId,
            content: '同意，继续执行',
            config: {
                enabledClaudeSkills: [],
                enabledToolpacks: [],
                enabledSkills: [],
                voiceProviderMode: 'auto',
                disabledTools: this.disabledTools,
            },
        }).catch((error) => {
            this.logs.push(`auto_approve_plan_failed taskId=${taskId} error=${String(error)}\n`);
        });
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
                return { payload: this.sessionsSnapshot };
            case 'save_sessions': {
                const input = args.input as { sessions?: Array<Record<string, unknown>>; activeTaskId?: string | null } | undefined;
                this.sessionsSnapshot = {
                    sessions: Array.isArray(input?.sessions) ? input.sessions : [],
                    activeTaskId: typeof input?.activeTaskId === 'string' ? input.activeTaskId : null,
                };
                return { success: true, payload: this.sessionsSnapshot };
            }
            case 'list_toolpacks':
                return { success: true, payload: { payload: { toolpacks: [] } } };
            case 'scan_default_repos':
                return { success: true, payload: { skills: [], mcpServers: [] } };
            case 'scan_skills':
                return { success: true, payload: { skills: [] } };
            case 'scan_mcp_servers':
                return { success: true, payload: { servers: [] } };
            case 'list_claude_skills':
                return { success: true, payload: { payload: { skills: [] } } };
            case 'get_workspace_root':
                return this.workspace.path;
            case 'get_default_workspace_path':
                return this.workspace.path;
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
            case 'send_task_message': {
                this.logs.push('send_task_message command received\n');
                const input = args.input as Record<string, unknown>;
                const config = (input?.config as Record<string, unknown> | undefined) ?? {};
                const existingDisabled = Array.isArray(config.disabledTools) ? config.disabledTools as string[] : [];
                const response = await this.sendSidecarCommand('send_task_message', {
                    ...input,
                    config: {
                        ...config,
                        disabledTools: Array.from(new Set([...existingDisabled, ...this.disabledTools])),
                    },
                });
                const payload = response.payload ?? {};
                return {
                    success: Boolean(payload.success),
                    taskId: String(payload.taskId ?? input?.taskId ?? ''),
                    error: typeof payload.error === 'string' ? payload.error : undefined,
                };
            }
            case 'start_task': {
                this.logs.push('start_task command received\n');
                // Some tests use this marker to confirm the message submission path.
                this.logs.push('send_task_message command received\n');
                const input = args.input as Record<string, unknown>;
                const taskId = randomUUID();
                const config = (input?.config as Record<string, unknown> | undefined) ?? {};
                const existingDisabled = Array.isArray(config.disabledTools) ? config.disabledTools as string[] : [];
                const response = await this.sendSidecarCommand('start_task', {
                    taskId,
                    title: String(input.title ?? ''),
                    userQuery: String(input.userQuery ?? ''),
                    context: {
                        workspacePath: String(input.workspacePath ?? this.workspace.path),
                        activeFile: input.activeFile ?? undefined,
                    },
                    config: {
                        ...config,
                        disabledTools: Array.from(new Set([...existingDisabled, ...this.disabledTools])),
                    },
                });
                const payload = response.payload ?? {};
                return {
                    success: Boolean(payload.success),
                    taskId: String(payload.taskId ?? taskId),
                    workspace: payload.workspace,
                    error: typeof payload.error === 'string' ? payload.error : undefined,
                };
            }
            case 'clear_task_history': {
                const input = args.input as Record<string, unknown>;
                const response = await this.sendSidecarCommand('clear_task_history', input ?? {});
                const payload = response.payload ?? {};
                return {
                    success: Boolean(payload.success),
                    taskId: String(payload.taskId ?? input?.taskId ?? ''),
                    error: typeof payload.error === 'string' ? payload.error : undefined,
                };
            }
            case 'resume_interrupted_task': {
                const input = args.input as Record<string, unknown>;
                const response = await this.sendSidecarCommand('resume_interrupted_task', input ?? {});
                const payload = response.payload ?? {};
                return {
                    success: Boolean(payload.success),
                    taskId: String(payload.taskId ?? input?.taskId ?? ''),
                    error: typeof payload.error === 'string' ? payload.error : undefined,
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
        this.logs.push(`Sending to sidecar: ${JSON.stringify(command)}\n`);

        const responsePromise = new Promise<SidecarResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(commandId);
                reject(new Error(`Timed out waiting for sidecar response: ${type}`));
            }, 180_000);
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

type TauriFixtures = {
    tauriProcess: childProcess.ChildProcess | null;
    tauriLogs: TauriLogCollector;
    page: Page;
    context: BrowserContext;
};

export const test = base.extend<TauriFixtures>({
    tauriLogs: [async ({}, use) => {
        const logs = new TauriLogCollector();
        await use(logs);
    }, { scope: 'test' }],

    tauriProcess: [async ({ tauriLogs }, use, testInfo) => {
        if (process.platform === 'darwin') {
            await use(null);
            return;
        }

        console.log('[Fixture-NoChrome] Starting Tauri app (NO Chrome)...');

        const env: Record<string, string> = { ...process.env };
        if (process.platform === 'win32') {
            env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${CDP_PORT}`;
            env.WEBVIEW2_USER_DATA_FOLDER = path.join(
                fs.realpathSync(os.tmpdir()),
                `coworkany-tts-test-${testInfo.workerIndex}`,
            );
        } else if (process.platform === 'darwin') {
            env.WEBKIT_INSPECTOR_SERVER = `localhost:${CDP_PORT}`;
        }

        const tauriProc = childProcess.spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['tauri', 'dev'],
            {
                cwd: DESKTOP_DIR,
                shell: true,
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        );

        console.log(`[Fixture-NoChrome] Tauri process spawned (PID: ${tauriProc.pid})`);

        tauriProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            tauriLogs.push(text);
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri] ${line}\n`);
                }
            }
        });

        tauriProc.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            tauriLogs.push(text);
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri-stdout] ${line}\n`);
                }
            }
        });

        await use(tauriProc);

        console.log(`[Fixture-NoChrome] Killing Tauri process tree (PID: ${tauriProc.pid})...`);
        try {
            if (process.platform === 'win32') {
                childProcess.execSync(`taskkill /PID ${tauriProc.pid} /T /F`, { stdio: 'ignore' });
            } else {
                tauriProc.kill('SIGTERM');
            }
        } catch {
            // Process may already be dead
        }
    }, { scope: 'test', timeout: 0 }],

    context: [async ({ playwright, tauriProcess: _proc }, use) => {
        if (process.platform === 'darwin') {
            const browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            await use(context);
            await context.close();
            await browser.close();
            return;
        }

        console.log(`[Fixture-NoChrome] Waiting for CDP on port ${CDP_PORT} (timeout: ${CDP_READY_TIMEOUT_MS / 1000}s)...`);
        const cdpReady = await waitForCdp(CDP_PORT, CDP_READY_TIMEOUT_MS);

        if (!cdpReady) {
            throw new Error(
                `CDP not available on port ${CDP_PORT} after ${CDP_READY_TIMEOUT_MS / 1000}s. ` +
                `Possible causes:\n` +
                `  1. First Cargo build is still in progress\n` +
                `  2. Tauri app failed to start\n` +
                `  3. WebView2 is not installed\n` +
                `  4. Port ${CDP_PORT} is already in use`
            );
        }

        console.log('[Fixture-NoChrome] Connecting Playwright to WebView via CDP...');
        const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const context = browser.contexts()[0];

        if (!context) {
            throw new Error('No browser context found after CDP connection.');
        }

        await use(context);
        await browser.close();
    }, { scope: 'test', timeout: 0 }],

    page: [async ({ context, tauriLogs }, use, testInfo) => {
        if (process.platform === 'darwin') {
            const port = await getFreePort();
            const page = await context.newPage();
            const harness = new DarwinBrowserHarness(tauriLogs, testInfo.workerIndex, port);
            await harness.start(page);
            await use(page);
            await harness.stop();
            return;
        }

        let pages = context.pages();
        console.log(`[Fixture-NoChrome] Found ${pages.length} pages:`);

        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            try {
                const title = await p.title();
                console.log(`[Fixture-NoChrome]   Page ${i}: title="${title}", url="${p.url()}"`);
            } catch {
                console.log(`[Fixture-NoChrome]   Page ${i}: url="${p.url()}" (title unavailable)`);
            }
        }

        for (const p of pages) {
            if (p.url() === 'about:blank' || !p.url().includes('localhost:5173')) {
                try {
                    await p.waitForURL('**/localhost:5173/**', { timeout: 20_000 });
                } catch {
                    // Skip
                }
            }
        }

        pages = context.pages();
        let page: Page | null = null;

        await new Promise(r => setTimeout(r, 5000));

        for (const p of pages) {
            try {
                const title = await p.title();
                const url = p.url();
                console.log(`[Fixture-NoChrome] Checking page: title="${title}", url="${url}"`);

                if (!url.includes('localhost:5173')) continue;

                const hasChatInput = await p.locator('.chat-input')
                    .isVisible({ timeout: 2_000 }).catch(() => false);

                if (hasChatInput) {
                    page = p;
                    console.log('[Fixture-NoChrome] Selected MAIN window (ChatInterface found)');
                    break;
                }

                const hasAppContainer = await p.locator('.bg-app')
                    .isVisible({ timeout: 2_000 }).catch(() => false);
                const hasDashboardOverlay = await p.locator('.fixed.inset-0.z-50')
                    .isVisible({ timeout: 1_000 }).catch(() => false);

                if (hasAppContainer && !hasDashboardOverlay) {
                    page = p;
                    console.log('[Fixture-NoChrome] Selected MAIN window (App container found)');
                    break;
                }

                if (title === 'CoworkAny' && !title.includes('Dashboard') && !title.includes('Settings')) {
                    const hasModelInput = await p.locator('input[placeholder*="Claude"], input[placeholder*="model"]')
                        .isVisible({ timeout: 1_000 }).catch(() => false);
                    if (!hasModelInput && !hasDashboardOverlay) {
                        page = p;
                        console.log(`[Fixture-NoChrome] Selected MAIN window by title: "${title}"`);
                        break;
                    }
                }
            } catch {
                continue;
            }
        }

        if (!page) {
            for (const p of pages) {
                if (!p.url().includes('localhost:5173')) continue;
                const hasDashboard = await p.locator('.fixed.inset-0.z-50').isVisible({ timeout: 1_000 }).catch(() => false);
                const hasModelInput = await p.locator('input[placeholder*="Claude"]').isVisible({ timeout: 1_000 }).catch(() => false);
                if (!hasDashboard && !hasModelInput) {
                    page = p;
                    console.log(`[Fixture-NoChrome] Fallback: selected page ${p.url()}`);
                    break;
                }
            }
        }

        if (!page) {
            const frontendPages = pages.filter(p => p.url().includes('localhost:5173'));
            if (frontendPages.length > 0) {
                page = frontendPages[0];
                console.log('[Fixture-NoChrome] Last resort: using first available page');
            } else {
                throw new Error('Could not find main CoworkAny page');
            }
        }

        console.log('[Fixture-NoChrome] Page selected, waiting for stabilization...');
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
            console.log('[Fixture-NoChrome] Page load warning:', e);
        }

        await use(page);
    }, { scope: 'test' }],
});

export { expect };
