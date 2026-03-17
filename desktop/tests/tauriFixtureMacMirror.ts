/**
 * macOS Tauri shell fixture for renderer smoke tests.
 *
 * Why this exists:
 * - Tauri on macOS renders through WKWebView, not WebView2 / Chromium.
 * - Playwright `connectOverCDP()` only works with Chromium-based browsers.
 * - Tauri's official WebDriver support does not cover macOS because there is
 *   no WKWebView driver tool available.
 *
 * So on macOS we still launch the real Tauri app and sidecar for process/log
 * coverage, but renderer interaction runs against the same Vite frontend in a
 * separate Chromium page. This is suitable for UI shell regressions such as
 * layout, typography, and editable inputs. It is NOT a replacement for native
 * Tauri command / event E2E tests.
 */

import { test as base, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as childProcess from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TauriLogCollector } from './tauriFixture';

const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const DESKTOP_DIR = path.resolve(__dirnameLocal, '..');
const FRONTEND_URL = 'http://127.0.0.1:5173/';
const FRONTEND_READY_TIMEOUT_MS = 120_000;
const FRONTEND_POLL_MS = 1000;

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

type TauriMacFixtures = {
    tauriProcess: childProcess.ChildProcess;
    tauriLogs: TauriLogCollector;
    mirrorBrowser: Browser;
    context: BrowserContext;
    page: Page;
};

export const test = base.extend<TauriMacFixtures>({
    tauriProcess: [async ({}, use) => {
        if (process.platform !== 'darwin') {
            throw new Error('tauriFixtureMacMirror is macOS-only.');
        }

        const tauriProc = childProcess.spawn(
            'npx',
            ['tauri', 'dev'],
            {
                cwd: DESKTOP_DIR,
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                },
            }
        );

        await use(tauriProc);

        try {
            tauriProc.kill('SIGTERM');
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

    mirrorBrowser: [async ({ tauriProcess: _proc }, use) => {
        await waitForFrontend(FRONTEND_URL, FRONTEND_READY_TIMEOUT_MS);
        const browser = await chromium.launch({ headless: true });
        await use(browser);
        await browser.close();
    }, { scope: 'test', timeout: 0 }],

    context: [async ({ mirrorBrowser }, use) => {
        const context = await mirrorBrowser.newContext();
        await use(context);
        await context.close();
    }, { scope: 'test' }],

    page: [async ({ context }, use) => {
        const page = await context.newPage();
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await use(page);
    }, { scope: 'test' }],
});

export { expect };
