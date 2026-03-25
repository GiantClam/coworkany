import { test, expect, type Page, type Locator } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const TEST_TIMEOUT_MS = 12 * 60 * 1000;
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

type ClaudeSkillRecord = {
    manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        allowedTools?: string[];
        tags?: string[];
    };
    rootPath: string;
    source: string;
    installedAt: string;
    enabled: boolean;
    permissions?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
    trust?: Record<string, unknown>;
};

type StartTaskResult = {
    success: boolean;
    taskId: string;
    error?: string;
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
        await wait(1000);
    }
    throw new Error(`Timed out waiting for HTTP endpoint: ${url}`);
}

function readJsonIfExists<T>(filePath: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch {
        return fallback;
    }
}

function writeJson(filePath: string, payload: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function buildSeededLlmConfigFromEnv(): Record<string, unknown> | null {
    const profileId = 'skillhub-e2e-profile';
    const modelId = process.env.TEST_MODEL_ID?.trim();
    const aibermApiKey = process.env.E2E_AIBERM_API_KEY?.trim();
    const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
    const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();

    if (aibermApiKey) {
        return {
            provider: 'aiberm',
            activeProfileId: profileId,
            maxHistoryMessages: 20,
            profiles: [
                {
                    id: profileId,
                    name: 'Aiberm Skillhub E2E',
                    provider: 'aiberm',
                    verified: true,
                    openai: {
                        apiKey: aibermApiKey,
                        baseUrl: process.env.E2E_AIBERM_BASE_URL?.trim() || 'https://aiberm.com/v1',
                        model: modelId || 'gpt-5.3-codex',
                    },
                },
            ],
        };
    }

    if (openAiApiKey) {
        return {
            provider: 'openai',
            activeProfileId: profileId,
            maxHistoryMessages: 20,
            profiles: [
                {
                    id: profileId,
                    name: 'OpenAI Skillhub E2E',
                    provider: 'openai',
                    verified: true,
                    openai: {
                        apiKey: openAiApiKey,
                        baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
                        model: modelId || 'gpt-4o',
                    },
                },
            ],
        };
    }

    if (openRouterApiKey) {
        return {
            provider: 'openrouter',
            activeProfileId: profileId,
            maxHistoryMessages: 20,
            profiles: [
                {
                    id: profileId,
                    name: 'OpenRouter Skillhub E2E',
                    provider: 'openrouter',
                    verified: true,
                    openrouter: {
                        apiKey: openRouterApiKey,
                        model: modelId || 'anthropic/claude-sonnet-4.5',
                    },
                },
            ],
        };
    }

    if (anthropicApiKey) {
        return {
            provider: 'anthropic',
            activeProfileId: profileId,
            maxHistoryMessages: 20,
            profiles: [
                {
                    id: profileId,
                    name: 'Anthropic Skillhub E2E',
                    provider: 'anthropic',
                    verified: true,
                    anthropic: {
                        apiKey: anthropicApiKey,
                        model: modelId || 'claude-sonnet-4-5',
                    },
                },
            ],
        };
    }

    return null;
}

function isValidLlmConfig(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const config = value as { activeProfileId?: unknown; profiles?: unknown };
    if (typeof config.activeProfileId !== 'string' || !config.activeProfileId.trim()) {
        return false;
    }
    if (!Array.isArray(config.profiles) || config.profiles.length === 0) {
        return false;
    }
    return true;
}

function seedHarnessAppData(appDataDir: string, defaultAppDataDir: string): void {
    ensureDir(appDataDir);
    const targetConfigPath = path.join(appDataDir, 'llm-config.json');
    if (fs.existsSync(targetConfigPath)) {
        return;
    }

    const envConfig = buildSeededLlmConfigFromEnv();
    if (envConfig) {
        writeJson(targetConfigPath, envConfig);
        return;
    }

    const defaultConfigPath = path.join(defaultAppDataDir, 'llm-config.json');
    const fallbackConfig = readJsonIfExists<Record<string, unknown> | null>(defaultConfigPath, null);
    if (isValidLlmConfig(fallbackConfig)) {
        writeJson(targetConfigPath, fallbackConfig);
    }
}

function sanitizeSkillhubName(slug: string, rawName?: string): string {
    const candidate = (rawName ?? '').trim();
    if (!candidate || candidate.startsWith('description:')) {
        return slug;
    }
    return candidate;
}

function countSlides(html: string): number {
    return (html.match(/class=["'][^"']*\bslide\b[^"']*["']/g) || []).length;
}

function extractFrontmatter(content: string): string | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return match?.[1] ?? null;
}

function hasOpenClawCompatibilitySignals(content: string): boolean {
    return /openclaw|clawdbot|clawdhub/i.test(content);
}

async function waitForValue<T>(
    resolver: () => T | undefined,
    timeoutMs: number,
    message: string,
): Promise<T> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = resolver();
        if (value !== undefined) {
            return value;
        }
        await wait(250);
    }
    throw new Error(message);
}

function isTaskTerminalEventType(type: string): boolean {
    return type === 'TASK_FINISHED' || type === 'TASK_FAILED' || type === 'TASK_CANCELLED';
}

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
    await page.waitForTimeout(1200);

    const submitButton = page.locator('button[type="submit"], .send-button').first();
    const canClick = await submitButton.isVisible({ timeout: 800 }).catch(() => false);
    if (canClick) {
        await submitButton.click({ timeout: 2000 }).catch(() => {});
    }
}

async function ensureComposerVisible(page: Page): Promise<void> {
    const existing = await findChatInput(page);
    if (existing) {
        return;
    }

    const startButton = page.locator('button').filter({ hasText: /^(Get Started|开始使用|新建任务|New Task)$/ }).first();
    const visible = await startButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (visible) {
        await startButton.click();
        await page.waitForTimeout(800);
    }
}

class BrowserDesktopHarness {
    readonly desktopDir: string;
    readonly sidecarDir: string;
    readonly appDataDir: string;
    readonly workspace: WorkspaceRecord;
    readonly devServerPort: number;
    readonly devServerUrl: string;

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
    private stderrBuffer = '';
    private taskEvents: SidecarEvent[] = [];

    constructor(devServerPort: number, appDataDir?: string) {
        this.desktopDir = process.cwd();
        this.sidecarDir = path.resolve(this.desktopDir, '..', 'sidecar');
        const defaultAppDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'com.coworkany.desktop');
        this.appDataDir = appDataDir ?? defaultAppDataDir;
        if (appDataDir) {
            seedHarnessAppData(this.appDataDir, defaultAppDataDir);
        }
        this.devServerPort = devServerPort;
        this.devServerUrl = `http://127.0.0.1:${devServerPort}/`;
        this.workspace = {
            id: 'desktop-test-workspace',
            name: 'Desktop Test Workspace',
            path: this.desktopDir,
            createdAt: new Date().toISOString(),
            defaultSkills: [],
            defaultToolpacks: [],
        };
        const defaultStore = new Map<string, unknown>();
        defaultStore.set('setupCompleted', true);
        defaultStore.set('activeWorkspaceId', this.workspace.id);
        this.storeRids.set(this.nextStoreRid, defaultStore);
        this.storePaths.set('settings.json', this.nextStoreRid);
        this.nextStoreRid += 1;
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

    getRawSidecarLogs(): string {
        return `${this.stderrBuffer}\n${this.taskEvents.map((event) => JSON.stringify(event)).join('\n')}`;
    }

    getTaskEvents(): SidecarEvent[] {
        return [...this.taskEvents];
    }

    async listSkills(includeDisabled = true): Promise<ClaudeSkillRecord[]> {
        const response = await this.sendSidecarCommand('list_claude_skills', { includeDisabled });
        const payload = response.payload ?? {};
        const skills = payload.skills;
        return Array.isArray(skills) ? (skills as ClaudeSkillRecord[]) : [];
    }

    async setSkillEnabled(skillId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
        const response = await this.sendSidecarCommand('set_claude_skill_enabled', { skillId, enabled });
        const payload = response.payload ?? {};
        return {
            success: Boolean(payload.success),
            error: typeof payload.error === 'string' ? payload.error : undefined,
        };
    }

    async removeSkill(skillId: string, deleteFiles = true): Promise<{ success: boolean; error?: string }> {
        const response = await this.sendSidecarCommand('remove_claude_skill', { skillId, deleteFiles });
        const payload = response.payload ?? {};
        return {
            success: Boolean(payload.success),
            error: typeof payload.error === 'string' ? payload.error : undefined,
        };
    }

    async startTask(input: {
        title: string;
        userQuery: string;
        workspacePath?: string;
        config?: Record<string, unknown>;
        taskId?: string;
    }): Promise<StartTaskResult> {
        const taskId = input.taskId ?? randomUUID();
        const response = await this.sendSidecarCommand('start_task', {
            taskId,
            title: input.title,
            userQuery: input.userQuery,
            context: {
                workspacePath: input.workspacePath ?? this.workspace.path,
            },
            config: input.config ?? {},
        });
        const payload = response.payload ?? {};
        return {
            success: Boolean(payload.success),
            taskId: String(payload.taskId ?? taskId),
            error: typeof payload.error === 'string' ? payload.error : undefined,
        };
    }

    async gotoApp(): Promise<void> {
        expect(this.page).not.toBeNull();
        await this.page!.goto(this.devServerUrl, { waitUntil: 'domcontentloaded' });
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
        const skillhubBinDir = path.join(os.homedir(), '.local', 'bin');
        const currentPath = process.env.PATH ?? '';
        const mergedPath = currentPath.includes(skillhubBinDir)
            ? currentPath
            : `${skillhubBinDir}:${currentPath}`;

        this.sidecarProc = spawn('bun', ['run', 'src/main.ts'], {
            cwd: this.sidecarDir,
            env: {
                ...process.env,
                COWORKANY_APP_DATA_DIR: this.appDataDir,
                PATH: mergedPath,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
        });

        this.sidecarProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            this.stderrBuffer += text;
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[sidecar] ${line}\n`);
                }
            }
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
            case 'get_llm_settings': {
                const configPath = path.join(this.appDataDir, 'llm-config.json');
                const config = readJsonIfExists(configPath, {});
                return { success: true, payload: config };
            }
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
                return { payload: { sessions: [], activeTaskId: null } };
            case 'save_sessions':
                return { success: true, payload: { success: true } };
            case 'list_toolpacks':
                return { success: true, payload: { payload: { toolpacks: [] } } };
            case 'scan_default_repos':
                return { success: true, payload: { skills: [], mcpServers: [] } };
            case 'scan_skills':
                return { success: true, payload: { skills: [] } };
            case 'scan_mcp_servers':
                return { success: true, payload: { servers: [] } };
            case 'get_workspace_root':
                return this.desktopDir;
            case 'list_claude_skills':
            case 'set_claude_skill_enabled':
            case 'remove_claude_skill':
            case 'import_claude_skill':
            case 'send_task_message':
            case 'clear_task_history':
                return this.forwardCommand(cmd, args.input as Record<string, unknown> | undefined);
            case 'start_task':
                return this.handleStartTask(args.input as Record<string, unknown>);
            case 'search_skillhub_skills':
                return this.searchSkillhub(args.input as Record<string, unknown>);
            case 'install_from_skillhub':
                return this.installFromSkillhub(args.input as Record<string, unknown>);
            default:
                throw new Error(`Unsupported mocked Tauri command: ${cmd}`);
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

    private async searchSkillhub(input: Record<string, unknown>): Promise<unknown> {
        const query = String(input.query ?? '').trim();
        const skillhub = path.join(os.homedir(), '.local', 'bin', 'skillhub');
        const args = ['--skip-self-upgrade', 'search', ...query.split(/\s+/).filter(Boolean), '--json'];
        const { stdout } = await this.runChild(skillhub, args, this.desktopDir);
        const raw = JSON.parse(stdout) as { results?: Array<Record<string, unknown>> };
        const skills = (raw.results ?? []).flatMap((entry) => {
            const slug = String(entry.slug ?? '').trim();
            if (!slug) return [];
            return [{
                name: sanitizeSkillhubName(slug, typeof entry.name === 'string' ? entry.name : undefined),
                description: String(entry.description ?? entry.summary ?? '').trim(),
                path: slug,
                source: `skillhub:${slug}`,
                runtime: 'unknown',
                hasScripts: false,
            }];
        });
        return {
            success: true,
            payload: {
                skills,
                source: 'skillhub',
            },
        };
    }

    private async installFromSkillhub(input: Record<string, unknown>): Promise<unknown> {
        const workspacePath = String(input.workspacePath ?? this.desktopDir);
        const slug = String(input.slug ?? '').trim();
        const installRoot = path.join(workspacePath, '.coworkany', 'skills');
        const skillDir = path.join(installRoot, slug);
        const skillhub = path.join(os.homedir(), '.local', 'bin', 'skillhub');
        ensureDir(installRoot);

        await this.runChild(skillhub, ['--skip-self-upgrade', '--dir', installRoot, 'install', slug], this.desktopDir);
        if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
            throw new Error(`Skill install missing SKILL.md: ${skillDir}`);
        }

        const sidecar = await this.sendSidecarCommand('import_claude_skill', {
            source: 'local_folder',
            path: skillDir,
            overwrite: true,
        });
        await this.emitToPage('skills-updated', null);

        return {
            success: true,
            payload: {
                success: true,
                slug,
                path: skillDir,
                sidecar,
            },
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

    private async runChild(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, {
                cwd,
                env: process.env,
                shell: process.platform === 'win32',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (chunk: Buffer) => {
                stdout += chunk.toString();
            });
            proc.stderr?.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
            });
            proc.on('exit', (code) => {
                if (code === 0) {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                    return;
                }
                reject(new Error(`Command failed (${command} ${args.join(' ')}):\n${stderr || stdout}`));
            });
        });
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
        const store = this.getStoreMap(rid);
        store.set(key, value);
        return null;
    }

    private storeDelete(rid: number, key: string): null {
        const store = this.getStoreMap(rid);
        store.delete(key);
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

test.describe('Desktop E2E - Skillhub ppt-generator', () => {
    test.setTimeout(TEST_TIMEOUT_MS + 180_000);

    test('install via Skillhub, generate HTML presentation artifact, then uninstall', async ({ page }) => {
        const harness = new BrowserDesktopHarness(await getFreePort());
        const skillDir = path.join(harness.desktopDir, '.coworkany', 'skills', 'ppt-generator');
        const outputDir = path.join(harness.desktopDir, 'test-results', 'skillhub-ppt-generator');
        const outputFile = path.join(outputDir, `skillhub-ppt-generator-${Date.now()}.html`);
        fs.rmSync(path.join(harness.desktopDir, '.coworkany', 'skills'), { recursive: true, force: true });
        ensureDir(outputDir);

        await harness.start(page);
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });

        try {
            await harness.gotoApp();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(4000);
            await ensureComposerVisible(page);

            const manageSkillsButton = page.locator('button[aria-label="管理技能"], button[aria-label="Manage Skills"]').first();
            const skillsVisible = await manageSkillsButton.isVisible({ timeout: 4000 }).catch(() => false);
            if (!skillsVisible) {
                await submitQuery(page, '你好');
                await manageSkillsButton.waitFor({ state: 'visible', timeout: 60_000 });
            }

            await manageSkillsButton.click();
            const dialog = page.locator('.modal-dialog-content').first();
            await dialog.waitFor({ state: 'visible', timeout: 30_000 });
            await dialog.locator('button').filter({ hasText: /^Market$/ }).first().click();

            const sourceInput = dialog.locator('input[placeholder="skillhub keyword or github:owner/repo"]').first();
            await sourceInput.waitFor({ state: 'visible', timeout: 10_000 });
            await sourceInput.fill('ppt-generator');
            await dialog.locator('button').filter({ hasText: /^Search$/ }).first().click();

            const resultSource = dialog.getByText('skillhub:ppt-generator', { exact: true });
            await resultSource.waitFor({ state: 'visible', timeout: 90_000 });
            await page.evaluate(async (workspacePath) => {
                const tauri = (window as Window & {
                    __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
                }).__TAURI_INTERNALS__;
                await tauri.invoke('install_from_skillhub', {
                    input: {
                        workspacePath,
                        slug: 'ppt-generator',
                    },
                });
            }, harness.desktopDir);

            await expect.poll(() => fs.existsSync(path.join(skillDir, 'SKILL.md')), {
                timeout: 120_000,
                message: 'ppt-generator should be installed into desktop workspace skill dir',
            }).toBe(true);

            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

            const generationPrompt = [
                '请严格使用已安装的 ppt-generator 技能生成演示稿。',
                `技能目录：${skillDir}`,
                `请先读取以下文件并按技能说明执行：${path.join(skillDir, 'SKILL.md')}、${path.join(skillDir, 'assets', 'template.html')}、${path.join(skillDir, 'references', 'slide-types.md')}、${path.join(skillDir, 'references', 'design-spec.md')}`,
                `输出必须是单个 HTML 文件，写入：${outputFile}`,
                '不要只在聊天里粘贴代码，必须把最终结果写到该文件，并自行检查文件存在。',
                '内容主题：2026 年 AI 协同办公平台产品发布会。',
                '讲稿要点：',
                '1. 开场提出传统办公协作的三大摩擦：信息割裂、会议低效、执行滞后。',
                '2. 展示 AI 助手如何贯穿会议前准备、会议中记录、会议后行动跟踪。',
                '3. 强调三项结果：决策速度提升、跨部门协同提升、交付质量提升。',
                '4. 结尾给出一句强行动号召。',
                '请生成 6 到 8 页的竖屏科技风演示稿。',
            ].join('\n');

            const startedTask = await page.evaluate(async ({ workspacePath, prompt }) => {
                const tauri = (window as Window & {
                    __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
                }).__TAURI_INTERNALS__;
                return tauri.invoke('start_task', {
                    input: {
                        title: 'ppt-generator e2e generation',
                        userQuery: prompt,
                        workspacePath,
                        config: {
                            enabledClaudeSkills: ['ppt-generator'],
                        },
                    },
                }) as Promise<{ success: boolean; taskId: string; error?: string }>;
            }, {
                workspacePath: harness.desktopDir,
                prompt: generationPrompt,
            });
            expect(startedTask.success).toBe(true);
            expect(startedTask.taskId).toBeTruthy();

            await expect.poll(() => fs.existsSync(outputFile), {
                timeout: TEST_TIMEOUT_MS,
                message: 'presentation output file should be created',
            }).toBe(true);

            await expect.poll(() => {
                return harness.getTaskEvents().some((event) => (
                    event.taskId === startedTask.taskId && event.type === 'TASK_FINISHED'
                ));
            }, {
                timeout: TEST_TIMEOUT_MS,
                message: 'task should finish successfully',
            }).toBe(true);

            const skillEvidencePaths = [
                path.join(skillDir, 'SKILL.md'),
                path.join(skillDir, 'assets', 'template.html'),
                path.join(skillDir, 'references', 'slide-types.md'),
                path.join(skillDir, 'references', 'design-spec.md'),
            ];
            const toolCalls = harness.getTaskEvents().filter((event) => (
                event.taskId === startedTask.taskId && event.type === 'TOOL_CALL'
            ));
            expect(
                toolCalls.some((event) => {
                    if (event.payload.name !== 'view_file') {
                        return false;
                    }
                    const inputJson = JSON.stringify(event.payload.input ?? {});
                    return skillEvidencePaths.some((candidate) => inputJson.includes(candidate));
                })
            ).toBe(true);

            const html = fs.readFileSync(outputFile, 'utf-8');
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('slides-container');
            expect(html).toContain('progress-bar');
            expect(html).toContain('light-spot');
            expect(countSlides(html)).toBeGreaterThanOrEqual(4);
            expect(html).toMatch(/AI|办公|协同|发布会/);
            expect(html.includes('主标题')).toBe(false);
            expect(html.includes('金句内容')).toBe(false);

            await manageSkillsButton.click();
            await dialog.waitFor({ state: 'visible', timeout: 30_000 });

            const installTab = dialog.locator('button').filter({ hasText: /^(安装|Install)$/ }).first();
            await installTab.click();
            const skillCard = dialog.locator('text=ppt-generator').first();
            await skillCard.waitFor({ state: 'visible', timeout: 30_000 });
            await skillCard.click();

            const uninstallButton = dialog.locator('button').filter({ hasText: /^(卸载技能|Uninstall Skill)$/ }).first();
            await uninstallButton.waitFor({ state: 'visible', timeout: 30_000 });
            await uninstallButton.click();

            await expect.poll(() => fs.existsSync(skillDir), {
                timeout: 30_000,
                message: 'installed skill directory should be removed after uninstall',
            }).toBe(false);
        } finally {
            await harness.stop();
        }
    });
});

type SkillLifecycleScenario = {
    slug: 'weather' | 'self-improving-agent' | 'summarize';
    expectedSkillId: string;
    buildInvocationQuery: (input: {
        skillId: string;
        skillMdPath: string;
        artifactDir: string;
    }) => string;
    verifyInvocation: (input: {
        toolCalls: SidecarEvent[];
        skillMdPath: string;
        artifactDir: string;
    }) => void;
};

const SKILL_LIFECYCLE_SCENARIOS: SkillLifecycleScenario[] = [
    {
        slug: 'weather',
        expectedSkillId: 'weather',
        buildInvocationQuery: ({ skillId }) => [
            `当前已启用技能：${skillId}。`,
            '禁止安装、搜索、卸载或管理任何技能。',
            '必须调用 run_command 工具且仅调用一次。',
            'run_command 的命令必须是：curl -s "wttr.in/Shanghai?format=3"',
            '禁止调用 search_web、crawl_url。',
            '最后只回复命令输出，不要额外解释。',
        ].join('\n'),
        verifyInvocation: ({ toolCalls }) => {
            expect(
                toolCalls.some((event) => {
                    if (event.payload.name !== 'run_command') return false;
                    const inputText = JSON.stringify(event.payload.input ?? {});
                    return inputText.includes('wttr.in/Shanghai');
                }),
                'weather skill invocation should run wttr.in command',
            ).toBe(true);
        },
    },
    {
        slug: 'self-improving-agent',
        expectedSkillId: 'self-improvement',
        buildInvocationQuery: ({ skillId, artifactDir }) => {
            const learningFile = path.join(artifactDir, '.learnings', 'LEARNINGS.md');
            return [
                `当前已启用技能：${skillId}。`,
                '禁止安装、搜索、卸载或管理任何技能。',
                '必须调用 write_to_file 或 replace_file_content 工具。',
                '禁止调用 search_web、crawl_url。',
                `然后在 ${learningFile} 写入一条 correction 类型学习记录，必须包含 "Source:"、"Pattern-Key:"、"Learning:" 三行。`,
                '最后只回复：SELF_IMPROVEMENT_OK',
            ].join('\n');
        },
        verifyInvocation: ({ toolCalls, skillMdPath, artifactDir }) => {
            const learningFile = path.join(artifactDir, '.learnings', 'LEARNINGS.md');
            expect(
                toolCalls.some((event) => {
                    if (event.payload.name !== 'write_to_file' && event.payload.name !== 'replace_file_content') {
                        return false;
                    }
                    return JSON.stringify(event.payload.input ?? {}).includes(learningFile);
                }),
                'self-improving-agent invocation should write learning log file',
            ).toBe(true);
            expect(fs.existsSync(learningFile), 'learning log file should exist').toBe(true);
            const content = fs.readFileSync(learningFile, 'utf-8');
            expect(content).toContain('Source:');
            expect(content).toContain('Pattern-Key:');
            expect(content).toContain('Learning:');
        },
    },
    {
        slug: 'summarize',
        expectedSkillId: 'summarize',
        buildInvocationQuery: ({ skillId, artifactDir }) => {
            const outputPath = path.join(artifactDir, 'summarize-commands.txt');
            return [
                `当前已启用技能：${skillId}。`,
                '禁止安装、搜索、卸载或管理任何技能。',
                '必须调用 write_to_file 或 replace_file_content 工具。',
                '禁止调用 search_web、crawl_url。',
                `然后生成 2 条 summarize CLI 可执行命令（一个 URL，一个本地 PDF），写入文件：${outputPath}`,
                '命令必须以 summarize 开头，最后只回复：SUMMARIZE_OK',
            ].join('\n');
        },
        verifyInvocation: ({ toolCalls, skillMdPath, artifactDir }) => {
            const outputPath = path.join(artifactDir, 'summarize-commands.txt');
            expect(
                toolCalls.some((event) => {
                    if (event.payload.name !== 'write_to_file' && event.payload.name !== 'replace_file_content') {
                        return false;
                    }
                    return JSON.stringify(event.payload.input ?? {}).includes(outputPath);
                }),
                'summarize invocation should write command output file',
            ).toBe(true);
            expect(fs.existsSync(outputPath), 'summarize command output file should exist').toBe(true);
            const content = fs.readFileSync(outputPath, 'utf-8');
            expect(content).toContain('summarize ');
        },
    },
];

async function openSkillManagerDialog(page: Page): Promise<Locator> {
    const manageSkillsButton = page
        .locator('button[aria-label="管理技能"], button[aria-label="Manage Skills"]')
        .first();
    const immediateVisible = await manageSkillsButton.isVisible({ timeout: 4_000 }).catch(() => false);
    if (!immediateVisible) {
        await ensureComposerVisible(page);
        await submitQuery(page, '你好');
    }
    await manageSkillsButton.waitFor({ state: 'visible', timeout: 60_000 });
    await manageSkillsButton.click();
    const dialog = page.locator('.modal-dialog-content').first();
    await dialog.waitFor({ state: 'visible', timeout: 30_000 });
    return dialog;
}

async function switchToMarketTab(dialog: Locator): Promise<void> {
    const marketTab = dialog.locator('button').filter({ hasText: /^Market$/ }).first();
    await marketTab.waitFor({ state: 'visible', timeout: 15_000 });
    await marketTab.click();
}

async function switchToInstallTab(dialog: Locator): Promise<void> {
    const installTab = dialog.locator('button').filter({ hasText: /^(安装|Install)$/ }).first();
    await installTab.waitFor({ state: 'visible', timeout: 15_000 });
    await installTab.click();
}

function getSkillRowLocator(dialog: Locator, displayName: string): Locator {
    const skillNameNode = dialog.getByText(displayName, { exact: true }).first();
    return skillNameNode.locator('xpath=ancestor::div[contains(@style,"padding: 12px")][1]');
}

test.describe('Desktop E2E - Skillhub skill lifecycle matrix', () => {
    test.setTimeout(TEST_TIMEOUT_MS + 240_000);

    for (const scenario of SKILL_LIFECYCLE_SCENARIOS) {
        test(`skillhub lifecycle: ${scenario.slug}`, async ({ page }, testInfo) => {
            testInfo.setTimeout(TEST_TIMEOUT_MS + 240_000);
            const appDataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `coworkany-skillhub-${scenario.slug}-`));
            const harness = new BrowserDesktopHarness(await getFreePort(), appDataDir);
            const skillDir = path.join(harness.desktopDir, '.coworkany', 'skills', scenario.slug);
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            const artifactDir = path.join(harness.desktopDir, 'test-results', 'skillhub-lifecycle', scenario.slug);
            fs.rmSync(skillDir, { recursive: true, force: true });
            ensureDir(artifactDir);

            page.on('dialog', async (dialog) => {
                await dialog.accept();
            });

            try {
                await harness.start(page);
                await harness.gotoApp();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000);
                await ensureComposerVisible(page);

                const dialog = await openSkillManagerDialog(page);
                await switchToMarketTab(dialog);

                const sourceInput = dialog
                    .locator('input[placeholder="skillhub keyword or github:owner/repo"]')
                    .first();
                await sourceInput.waitFor({ state: 'visible', timeout: 15_000 });
                await sourceInput.fill(scenario.slug);
                await dialog.locator('button').filter({ hasText: /^Search$/ }).first().click();

                const sourceEntry = dialog.getByText(`skillhub:${scenario.slug}`, { exact: true });
                await sourceEntry.waitFor({ state: 'visible', timeout: 90_000 });

                const installResult = await page.evaluate(async ({ workspacePath, slug }) => {
                    const tauri = (window as Window & {
                        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
                    }).__TAURI_INTERNALS__;
                    return tauri.invoke('install_from_skillhub', {
                        input: {
                            workspacePath,
                            slug,
                        },
                    });
                }, {
                    workspacePath: harness.desktopDir,
                    slug: scenario.slug,
                });

                const installResultRecord = (installResult ?? {}) as Record<string, unknown>;
                expect(Boolean(installResultRecord.success ?? true), 'skillhub install command should succeed').toBe(true);

                await expect.poll(() => fs.existsSync(skillMdPath), {
                    timeout: 120_000,
                    message: `${scenario.slug} should be installed with SKILL.md`,
                }).toBe(true);

                const installedSkillContent = fs.readFileSync(skillMdPath, 'utf-8');
                const frontmatter = extractFrontmatter(installedSkillContent);
                expect(frontmatter, 'installed skill should have frontmatter').not.toBeNull();
                expect(frontmatter!).toMatch(/name:/);
                expect(frontmatter!).toMatch(/description:/);
                expect(
                    hasOpenClawCompatibilitySignals(installedSkillContent),
                    `${scenario.slug} should include OpenClaw compatibility signals`,
                ).toBe(true);

                const skillsAfterInstall = await harness.listSkills(true);
                const installedRecord = skillsAfterInstall.find((skill) => skill.rootPath === skillDir);
                expect(installedRecord, 'installed skill should be listed by list_claude_skills').toBeDefined();
                const skillId = installedRecord?.manifest.id ?? scenario.expectedSkillId;
                const skillDisplayName = installedRecord?.manifest.name ?? skillId;
                expect(skillId).toBe(scenario.expectedSkillId);
                expect(installedRecord?.source).toBe('local_folder');
                expect(installedRecord?.rootPath).toBe(skillDir);
                expect(installedRecord?.manifest.version).toBeTruthy();

                const disableResult = await harness.setSkillEnabled(skillId, false);
                expect(disableResult.success, 'set_claude_skill_enabled(false) should succeed').toBe(true);
                await expect.poll(async () => {
                    const list = await harness.listSkills(true);
                    return list.find((skill) => skill.manifest.id === skillId)?.enabled ?? true;
                }, {
                    timeout: 30_000,
                    message: 'skill should be disabled after toggle',
                }).toBe(false);

                await switchToInstallTab(dialog);
                await dialog.locator('button').filter({ hasText: /^(刷新|Refresh)$/ }).first().click();
                const skillRowAfterDisable = getSkillRowLocator(dialog, skillDisplayName);
                await skillRowAfterDisable.waitFor({ state: 'visible', timeout: 30_000 });
                await expect(skillRowAfterDisable.locator('input[type="checkbox"]').first()).not.toBeChecked();

                const enableResult = await harness.setSkillEnabled(skillId, true);
                expect(enableResult.success, 'set_claude_skill_enabled(true) should succeed').toBe(true);
                await expect.poll(async () => {
                    const list = await harness.listSkills(true);
                    return list.find((skill) => skill.manifest.id === skillId)?.enabled ?? false;
                }, {
                    timeout: 30_000,
                    message: 'skill should be enabled after toggle',
                }).toBe(true);

                await dialog.locator('button').filter({ hasText: /^(刷新|Refresh)$/ }).first().click();
                const skillRowAfterEnable = getSkillRowLocator(dialog, skillDisplayName);
                await skillRowAfterEnable.waitFor({ state: 'visible', timeout: 30_000 });
                await expect(skillRowAfterEnable.locator('input[type="checkbox"]').first()).toBeChecked();

                const startedTask = await harness.startTask({
                    title: `Skill lifecycle invoke ${scenario.slug}`,
                    userQuery: scenario.buildInvocationQuery({
                        skillId,
                        skillMdPath,
                        artifactDir,
                    }),
                    workspacePath: harness.desktopDir,
                    config: {
                        enabledClaudeSkills: [skillId],
                    },
                });
                expect(startedTask.success, 'skill invocation task should start').toBe(true);

                const terminalEvent = await waitForValue(() => {
                    return harness.getTaskEvents().find((event) =>
                        event.taskId === startedTask.taskId && isTaskTerminalEventType(event.type));
                }, TEST_TIMEOUT_MS, `skill invocation task should finish for ${scenario.slug}`);

                const taskEvents = harness.getTaskEvents().filter((event) => event.taskId === startedTask.taskId);
                const toolCalls = taskEvents.filter((event) => event.type === 'TOOL_CALL');
                const invocationLogs = harness.getRawSidecarLogs();
                const terminalPayload = (terminalEvent.payload ?? {}) as Record<string, unknown>;
                const terminalErrorCode = String(terminalPayload.errorCode ?? '');
                const terminalError = String(terminalPayload.error ?? '');

                if (terminalEvent.type === 'TASK_FINISHED') {
                    expect(toolCalls.length).toBeGreaterThan(0);
                    scenario.verifyInvocation({
                        toolCalls,
                        skillMdPath,
                        artifactDir,
                    });
                } else {
                    expect(
                        ['MODEL_STREAM_ERROR', 'MODEL_REQUEST_FAILED', 'MODEL_PROVIDER_ERROR', 'LLM_UNAVAILABLE'].includes(terminalErrorCode),
                        `unexpected terminal error for ${scenario.slug}: ${terminalErrorCode} ${terminalError}`,
                    ).toBe(true);
                    expect(
                        `${terminalErrorCode} ${terminalError}`.includes('MARKETPLACE_INSTALL_FAILED'),
                        'skill invocation should not regress into marketplace auto-install failure',
                    ).toBe(false);
                }

                expect(
                    invocationLogs.includes(skillId) || invocationLogs.includes(skillDisplayName),
                    'sidecar logs should contain installed skill identifier during lifecycle test',
                ).toBe(true);
                expect(
                    invocationLogs.includes(`Loaded from filesystem: ${skillId}`) || invocationLogs.includes(`Installed skill: ${skillId}`),
                    'sidecar logs should show local skill loading/registration during invocation phase',
                ).toBe(true);

                await switchToInstallTab(dialog);
                const uninstallRow = getSkillRowLocator(dialog, skillDisplayName);
                await uninstallRow.waitFor({ state: 'visible', timeout: 30_000 });
                await uninstallRow.click();
                const uninstallButton = dialog.locator('button').filter({ hasText: /^(卸载技能|Uninstall Skill)$/ }).first();
                await uninstallButton.waitFor({ state: 'visible', timeout: 30_000 });
                await uninstallButton.click();

                await expect.poll(() => fs.existsSync(skillDir), {
                    timeout: 45_000,
                    message: `${scenario.slug} skill directory should be removed after uninstall`,
                }).toBe(false);

                await expect.poll(async () => {
                    const list = await harness.listSkills(true);
                    return list.some((skill) => skill.manifest.id === skillId || skill.rootPath === skillDir);
                }, {
                    timeout: 30_000,
                    message: 'uninstalled skill should not remain in list_claude_skills',
                }).toBe(false);
            } finally {
                await harness.stop();
                fs.rmSync(appDataDir, { recursive: true, force: true });
            }
        });
    }
});
