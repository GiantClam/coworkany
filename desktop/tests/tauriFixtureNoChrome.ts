/**
 * Tauri WebView2 Test Fixture for TTS-only Tests (No Chrome)
 *
 * This fixture is designed for TTS (Text-to-Speech) tests that don't need browser automation.
 * It does NOT pre-launch Chrome, making tests faster and more focused.
 *
 * Usage:
 *   import { test } from './tauriFixtureNoChrome';
 *   test('TTS test without Chrome', async ({ page, tauriLogs }) => { ... });
 */

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { TauriLogCollector } from './tauriFixture';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

const CDP_PORT = 9945;
const DESKTOP_DIR = path.resolve(__dirname_local, '..');
const CDP_READY_TIMEOUT_MS = 120_000;
const CDP_POLL_MS = 2000;
const FRONTEND_PAGE_TIMEOUT_MS = 30_000;
const SIDECAR_BROWSER_CDP_PORTS = [9222, 9223, 9224, 9225];
const SIDECAR_PERSISTENT_PROFILE_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'CoworkAny', 'PlaywrightProfile');
const FRONTEND_DEV_PORT = 5173;

function clearFrontendDevPort(): void {
    if (process.platform !== 'win32') {
        return;
    }

    const script = `
$listeners = @()
try {
  $listeners += Get-NetTCPConnection -State Listen -LocalPort ${FRONTEND_DEV_PORT} -ErrorAction SilentlyContinue
} catch {}
$procIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $procIds) {
  if (-not $procId) { continue }
  try {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    if ($null -eq $proc) { continue }
    $name = ($proc.Name | Out-String).Trim().ToLower()
    $cmd = ($proc.CommandLine | Out-String).Trim().ToLower()
    $isNodeRuntime = $name -match 'node|bun'
    $isViteServer = $cmd -match 'vite(\\.js)?' -or $cmd -match '--port\\s+${FRONTEND_DEV_PORT}' -or $cmd -match '--strictport'
    if ($isNodeRuntime -and $isViteServer) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}
`;

    try {
        childProcess.execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, {
            stdio: 'ignore',
            timeout: 15_000,
        });
        console.log(`[Fixture-NoChrome] Cleared frontend dev server port ${FRONTEND_DEV_PORT}`);
    } catch {
        console.log('[Fixture-NoChrome] Failed to clear frontend dev server port; continuing');
    }
}

function clearSidecarBrowserCdpPorts(): void {
    if (process.platform !== 'win32') {
        return;
    }

    const portList = SIDECAR_BROWSER_CDP_PORTS.join(',');
    const script = `
$ports = @(${portList})
$listeners = @()
foreach ($port in $ports) {
  try {
    $listeners += Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  } catch {}
}
$pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pid in $pids) {
  if (-not $pid) { continue }
  try {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue
    if ($null -eq $proc) { continue }
    $name = ($proc.Name | Out-String).Trim().ToLower()
    $cmd = ($proc.CommandLine | Out-String).Trim().ToLower()
    $isBrowser = $name -match 'chrome|msedge|chromium|brave'
    $isDebugPort = $cmd -match '--remote-debugging-port=(9222|9223|9224|9225)'
    if ($isBrowser -or $isDebugPort) {
      Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}
`;

    try {
        childProcess.execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, {
            stdio: 'ignore',
            timeout: 15_000,
        });
        console.log('[Fixture-NoChrome] Cleared sidecar browser CDP ports 9222-9225');
    } catch {
        console.log('[Fixture-NoChrome] Failed to clear one or more sidecar browser CDP ports; continuing');
    }
}

function clearSidecarPersistentProfile(): void {
    try {
        fs.rmSync(SIDECAR_PERSISTENT_PROFILE_DIR, { recursive: true, force: true });
        console.log(`[Fixture-NoChrome] Cleared sidecar persistent browser profile: ${SIDECAR_PERSISTENT_PROFILE_DIR}`);
    } catch {
        console.log('[Fixture-NoChrome] Failed to clear sidecar persistent browser profile; continuing');
    }
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

async function waitForFrontendPages(context: BrowserContext, timeoutMs: number): Promise<Page[]> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const frontendPages = context.pages().filter((p) => p.url().includes('localhost:5173'));
        if (frontendPages.length > 0) {
            return frontendPages;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return context.pages().filter((p) => p.url().includes('localhost:5173'));
}

async function recoverFrontendDom(page: Page): Promise<void> {
    const url = page.url();
    if (!url.includes('localhost:5173')) {
        return;
    }

    const hasBodyText = await page.locator('body').innerText({ timeout: 1500 }).then((text) => text.trim().length > 0).catch(() => false);
    if (hasBodyText) {
        return;
    }

    console.log('[Fixture-NoChrome] Frontend target is attached but DOM is empty; forcing navigation recovery...');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const stillEmpty = await page.locator('body').innerText({ timeout: 1500 }).then((text) => text.trim().length === 0).catch(() => true);
    if (stillEmpty) {
        console.log('[Fixture-NoChrome] DOM still empty after goto; trying a hard reload...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }
}

type TauriFixtures = {
    tauriProcess: childProcess.ChildProcess;
    tauriLogs: TauriLogCollector;
    page: Page;
    context: BrowserContext;
};

export const test = base.extend<TauriFixtures>({
    tauriProcess: [async ({}, use, testInfo) => {
        console.log('[Fixture-NoChrome] Starting Tauri app (NO Chrome)...');
        clearFrontendDevPort();
        clearSidecarBrowserCdpPorts();
        clearSidecarPersistentProfile();

        const tauriProc = childProcess.spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['tauri', 'dev'],
            {
                cwd: DESKTOP_DIR,
                shell: true,
                env: {
                    ...process.env,
                    COWORKANY_DISABLE_BROWSER_CDP: '1',
                    VITE_E2E_BOOT_FALLBACK: '1',
                    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
                    WEBVIEW2_USER_DATA_FOLDER: path.join(
                        fs.realpathSync(os.tmpdir()),
                        `coworkany-tts-test-${testInfo.workerIndex}`,
                    ),
                },
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        );

        console.log(`[Fixture-NoChrome] Tauri process spawned (PID: ${tauriProc.pid})`);

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

    tauriLogs: [async ({ tauriProcess: tauriProc }, use) => {
        const logs = new TauriLogCollector();

        tauriProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            logs.push(text);
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri] ${line}\n`);
                }
            }
        });

        tauriProc.stdout?.on('data', (chunk: Buffer) => {
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

    context: [async ({ playwright, tauriProcess: _proc, tauriLogs: _logs }, use) => {
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

        console.log(`[Fixture-NoChrome] Connecting Playwright to WebView2 via CDP...`);
        const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const context = browser.contexts()[0];

        if (!context) {
            throw new Error('No browser context found after CDP connection.');
        }

        await use(context);

        await browser.close();
    }, { scope: 'test', timeout: 0 }],

    page: [async ({ context }, use) => {
        // Same single-window selection logic as tauriFixture.ts.
        let pages = await waitForFrontendPages(context, FRONTEND_PAGE_TIMEOUT_MS);
        if (pages.length === 0) {
            pages = context.pages();
        }
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

        // Wait for all pages to load the frontend URL
        for (const p of pages) {
            if (p.url() === 'about:blank' || !p.url().includes('localhost:5173')) {
                try {
                    await p.waitForURL('**/localhost:5173/**', { timeout: 20_000 });
                } catch {
                    // Skip
                }
            }
        }

        pages = await waitForFrontendPages(context, FRONTEND_PAGE_TIMEOUT_MS);
        if (pages.length === 0) {
            pages = context.pages();
        }
        let page: Page | null = null;

        // Give React time to hydrate
        await new Promise(r => setTimeout(r, 5000));

        for (const p of pages) {
            try {
                const title = await p.title();
                const url = p.url();
                console.log(`[Fixture-NoChrome] Checking page: title="${title}", url="${url}"`);

                if (!url.includes('localhost:5173')) continue;

                // Check for the main chat input
                const hasChatInput = await p.locator('.chat-input')
                    .isVisible({ timeout: 2_000 }).catch(() => false);

                if (hasChatInput) {
                    page = p;
                    console.log(`[Fixture-NoChrome] Selected MAIN window (ChatInterface found)`);
                    break;
                }

                // Check for App container
                const hasAppContainer = await p.locator('.bg-app')
                    .isVisible({ timeout: 2_000 }).catch(() => false);
                const hasDashboardOverlay = await p.locator('.fixed.inset-0.z-50')
                    .isVisible({ timeout: 1_000 }).catch(() => false);

                if (hasAppContainer && !hasDashboardOverlay) {
                    page = p;
                    console.log(`[Fixture-NoChrome] Selected MAIN window (App container found)`);
                    break;
                }

                // Check by title
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

        // Fallback
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
            // Fallback to first frontend page if present
            const frontendPages = pages.filter(p => p.url().includes('localhost:5173'));
            if (frontendPages.length > 0) {
                page = frontendPages[0];
                console.log('[Fixture-NoChrome] Fallback: using first frontend page');
            }
        }

        if (!page) {
            // Last fallback: first page in context, then wait for a newly opened page.
            page = pages[0] ?? null;
            if (!page) {
                page = await context.waitForEvent('page', { timeout: 30_000 });
            }
            console.log(`[Fixture-NoChrome] Last fallback: using page url="${page.url()}"`);
        }

        console.log('[Fixture-NoChrome] Page selected, waiting for stabilization...');
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
        if (page.url() === 'about:blank') {
            await page.waitForURL('**/localhost:5173/**', { timeout: 30_000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 3000));
        await recoverFrontendDom(page);

        await use(page);
    }, { scope: 'test' }],
});

export { expect };
