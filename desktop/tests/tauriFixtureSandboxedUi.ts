import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { TauriLogCollector } from './tauriFixture';

const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);

const CDP_PORT = 9946;
const DESKTOP_DIR = path.resolve(__dirnameLocal, '..');
const CDP_READY_TIMEOUT_MS = 120_000;
const CDP_POLL_MS = 2000;
const FRONTEND_URL = 'http://127.0.0.1:5173/';
const FRONTEND_READY_TIMEOUT_MS = 120_000;
const FRONTEND_POLL_MS = 1000;

async function waitForCdp(port: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (res.ok) {
                return true;
            }
        } catch {
            // not ready yet
        }
        await new Promise((resolve) => setTimeout(resolve, CDP_POLL_MS));
    }
    return false;
}

async function waitForFrontend(url: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetch(url, { redirect: 'follow' });
            if (response.ok) {
                return;
            }
        } catch {
            // frontend not ready yet
        }
        await new Promise((resolve) => setTimeout(resolve, FRONTEND_POLL_MS));
    }
    throw new Error(`Frontend not available at ${url} after ${timeoutMs / 1000}s`);
}

function writeJsonFile(filePath: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function buildSeededLlmConfigFromEnv(): Record<string, unknown> | null {
    const profileId = 'sandboxed-e2e-profile';
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
                    name: 'Aiberm Sandboxed E2E',
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
                    name: 'OpenAI Sandboxed E2E',
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
                    name: 'OpenRouter Sandboxed E2E',
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
                    name: 'Anthropic Sandboxed E2E',
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

function seedSandboxAppData(appDataDir: string): void {
    const llmConfig = buildSeededLlmConfigFromEnv();

    writeJsonFile(path.join(appDataDir, 'settings.json'), {
        setupCompleted: true,
        ...(llmConfig ? { llmConfig } : {}),
    });

    if (llmConfig) {
        writeJsonFile(path.join(appDataDir, 'llm-config.json'), llmConfig);
    }
}

type TauriFixtures = {
    tauriProcess: childProcess.ChildProcess;
    tauriLogs: TauriLogCollector;
    page: Page;
    context: BrowserContext;
    appDataDir: string;
};

export const test = base.extend<TauriFixtures>({
    appDataDir: [async ({}, use, testInfo) => {
        const appDataDir = fs.mkdtempSync(
            path.join(fs.realpathSync(os.tmpdir()), `coworkany-sandboxed-ui-appdata-${testInfo.workerIndex}-`)
        );
        seedSandboxAppData(appDataDir);
        await use(appDataDir);
        fs.rmSync(appDataDir, { recursive: true, force: true });
    }, { scope: 'test' }],

    tauriProcess: [async ({ appDataDir }, use, testInfo) => {
        const env: Record<string, string> = { ...process.env };
        env.COWORKANY_APP_DATA_DIR = appDataDir;
        env.COWORKANY_DISABLE_BROWSER_CDP = 'true';

        if (process.platform === 'win32') {
            env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${CDP_PORT}`;
            env.WEBVIEW2_USER_DATA_FOLDER = path.join(
                fs.realpathSync(os.tmpdir()),
                `coworkany-sandboxed-ui-webview-${testInfo.workerIndex}`,
            );
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

        await use(tauriProc);

        try {
            if (process.platform === 'win32') {
                childProcess.execSync(`taskkill /PID ${tauriProc.pid} /T /F`, { stdio: 'ignore' });
            } else {
                tauriProc.kill('SIGTERM');
            }
        } catch {
            // ignore shutdown failures
        }
    }, { scope: 'test', timeout: 0 }],

    tauriLogs: [async ({ tauriProcess }, use) => {
        const logs = new TauriLogCollector();

        tauriProcess.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            logs.push(text);
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri] ${line}\n`);
                }
            }
        });

        tauriProcess.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            logs.push(text);
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri-stdout] ${line}\n`);
                }
            }
        });

        await use(logs);
    }, { scope: 'test' }],

    context: [async ({ playwright, tauriProcess: _proc }, use) => {
        if (process.platform === 'darwin') {
            await waitForFrontend(FRONTEND_URL, FRONTEND_READY_TIMEOUT_MS);
            const browser = await playwright.chromium.launch({ headless: true });
            const context = await browser.newContext();
            await use(context);
            await context.close();
            await browser.close();
            return;
        }

        const cdpReady = await waitForCdp(CDP_PORT, CDP_READY_TIMEOUT_MS);
        if (!cdpReady) {
            throw new Error(`CDP not available on port ${CDP_PORT}`);
        }

        const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const context = browser.contexts()[0];

        if (!context) {
            throw new Error('No browser context found after CDP connection.');
        }

        await use(context);
        await browser.close();
    }, { scope: 'test', timeout: 0 }],

    page: [async ({ context }, use) => {
        if (process.platform === 'darwin') {
            const page = await context.newPage();
            await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
            await use(page);
            return;
        }

        let pages = context.pages();
        await new Promise((resolve) => setTimeout(resolve, 5000));

        for (const page of pages) {
            if (page.url() === 'about:blank' || !page.url().includes('localhost:5173')) {
                try {
                    await page.waitForURL('**/localhost:5173/**', { timeout: 20_000 });
                } catch {
                    // skip pages that never become the app
                }
            }
        }

        pages = context.pages();
        let selected: Page | null = null;

        for (const page of pages) {
            if (!page.url().includes('localhost:5173')) {
                continue;
            }

            const hasChatInput = await page.locator('.chat-input')
                .isVisible({ timeout: 2_000 }).catch(() => false);
            if (hasChatInput) {
                selected = page;
                break;
            }
        }

        if (!selected) {
            selected = pages.find((page) => page.url().includes('localhost:5173')) || pages[0] || null;
        }

        if (!selected) {
            throw new Error('Could not find Tauri application page');
        }

        await use(selected);
    }, { scope: 'test', timeout: 0 }],
});

export { expect };
