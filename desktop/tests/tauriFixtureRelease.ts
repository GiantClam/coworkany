import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TauriLogCollector } from './tauriFixture';

const CDP_PORT = 9945;
const CDP_READY_TIMEOUT_MS = 120_000;
const CDP_POLL_MS = 1000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESKTOP_DIR = path.resolve(__dirname, '..');
const RELEASE_EXE_CANDIDATES = [
    path.resolve(
        DESKTOP_DIR,
        'src-tauri',
        'target',
        'release',
        'coworkany-desktop.exe',
    ),
    path.resolve(
        DESKTOP_DIR,
        'src-tauri',
        'target',
        'x86_64-pc-windows-msvc',
        'release',
        'coworkany-desktop.exe',
    ),
];

function resolveReleaseExePath(): string {
    const resolved = RELEASE_EXE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (!resolved) {
        throw new Error(`Release desktop executable not found. Checked: ${RELEASE_EXE_CANDIDATES.join(', ')}`);
    }
    return resolved;
}

type TauriFixtures = {
    tauriProcess: childProcess.ChildProcess;
    tauriLogs: TauriLogCollector;
    page: Page;
    context: BrowserContext;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(port: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (res.ok) {
                const data = await res.json() as Record<string, string>;
                console.log(`[Fixture-Release] CDP ready on port ${port}: ${data['Browser'] || 'unknown'}`);
                return true;
            }
        } catch {
            // Not ready yet
        }
        await sleep(CDP_POLL_MS);
    }
    return false;
}

async function isAppPage(page: Page): Promise<boolean> {
    if (page.isClosed()) {
        return false;
    }

    const pageUrl = page.url();
    if (pageUrl.startsWith('devtools://')) {
        return false;
    }

    try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5_000 });
    } catch {
        // Ignore transient load state failures while the window is booting.
    }

    try {
        return await page.evaluate(() => {
            const root = document.querySelector('#root');
            const hasMountedApp = Boolean(root && root.childElementCount > 0);
            const hasChatInput = Boolean(
                document.querySelector('.chat-input, input[placeholder*="instructions"], textarea'),
            );
            const bodyText = document.body?.innerText?.trim() ?? '';
            return hasMountedApp || hasChatInput || bodyText.length > 32;
        });
    } catch {
        return false;
    }
}

async function waitForAppPage(context: BrowserContext, timeoutMs: number): Promise<Page> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const pages = context.pages();
        for (const page of pages) {
            if (await isAppPage(page)) {
                console.log(`[Fixture-Release] Using page ${page.url() || '<empty-url>'}`);
                return page;
            }
        }

        try {
            const page = await context.waitForEvent('page', { timeout: Math.min(2_000, deadline - Date.now()) });
            if (await isAppPage(page)) {
                console.log(`[Fixture-Release] Using newly opened page ${page.url() || '<empty-url>'}`);
                return page;
            }
        } catch {
            // No new pages during this poll window.
        }

        await sleep(500);
    }

    const pageDescriptions = await Promise.all(context.pages().map(async (page) => {
        let title = '';
        try {
            title = await page.title();
        } catch {
            title = '<title-unavailable>';
        }
        return `${page.url() || '<empty-url>'} :: ${title}`;
    }));

    throw new Error(`No mounted CoworkAny page found. Pages seen: ${pageDescriptions.join(' | ') || '<none>'}`);
}

export const test = base.extend<TauriFixtures>({
    tauriProcess: [async ({}, use, testInfo) => {
        const releaseExePath = resolveReleaseExePath();

        console.log('[Fixture-Release] Starting packaged Tauri app...');

        const tauriProc = childProcess.spawn(releaseExePath, [], {
            cwd: path.dirname(releaseExePath),
            env: {
                ...process.env,
                HTTP_PROXY: '',
                HTTPS_PROXY: '',
                ALL_PROXY: '',
                NO_PROXY: 'localhost,127.0.0.1,::1',
                OPENCLAW_STORE_CLAWHUB_BASE_URL: process.env.OPENCLAW_STORE_CLAWHUB_BASE_URL,
                WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT} --no-proxy-server --proxy-bypass-list=<-loopback>`,
                WEBVIEW2_USER_DATA_FOLDER: path.join(
                    fs.realpathSync(os.tmpdir()),
                    `coworkany-release-e2e-${testInfo.workerIndex}`,
                ),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        console.log(`[Fixture-Release] Tauri process spawned (PID: ${tauriProc.pid})`);

        await use(tauriProc);

        console.log(`[Fixture-Release] Killing Tauri process tree (PID: ${tauriProc.pid})...`);
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

    tauriLogs: [async ({ tauriProcess: tauriProc }, use) => {
        const logs = new TauriLogCollector();

        tauriProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            logs.push(text);
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri-Release] ${line}\n`);
                }
            }
        });

        tauriProc.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            logs.push(text);
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri-Release-stdout] ${line}\n`);
                }
            }
        });

        await use(logs);
    }, { scope: 'test' }],

    context: [async ({ playwright, tauriProcess: _tauriProcess }, use) => {
        console.log(`[Fixture-Release] Waiting for CDP on port ${CDP_PORT} (timeout: ${CDP_READY_TIMEOUT_MS / 1000}s)...`);
        const cdpReady = await waitForCdp(CDP_PORT, CDP_READY_TIMEOUT_MS);

        if (!cdpReady) {
            throw new Error(`CDP not available on port ${CDP_PORT} after ${CDP_READY_TIMEOUT_MS / 1000}s`);
        }

        const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const context = browser.contexts()[0];

        if (!context) {
            throw new Error('No browser context found after CDP connection.');
        }

        await use(context);
        await browser.close();
    }, { scope: 'test', timeout: 0 }],

    page: [async ({ context, tauriProcess: _tauriProcess }, use) => {
        const page = await waitForAppPage(context, 60_000);
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
        await sleep(2_000);
        await use(page);
    }, { scope: 'test' }],
});

export { expect };
