/**
 * Tauri WebView2 Test Fixture for Playwright
 *
 * Launches the Tauri desktop application with WebView2 CDP debugging enabled,
 * connects Playwright to the real WebView, and collects process output (stderr/stdout)
 * for test assertions.
 *
 * Architecture:
 *   Test -> spawn Tauri (`cargo tauri dev`) -> Tauri auto-spawns Sidecar
 *   Test -> connectOverCDP(port) -> real WebView2
 *   Test -> monitor stderr for Sidecar logs + JSON events
 *
 * Usage:
 *   import { test, expect } from './tauriFixture';
 *   test('my test', async ({ page, tauriLogs }) => { ... });
 */

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

// ============================================================================
// Configuration
// ============================================================================

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

// Use a port that does NOT conflict with the sidecar's Chrome CDP ports (9222-9223).
// The sidecar PlaywrightBackend cycles through 9222, 9223, etc. for its own Chrome browser.
// If we use 9222 here, the sidecar will find a stale CDP endpoint, fail, and fall back
// to a fresh persistent context that has no Xiaohongshu login cookies.
const CDP_PORT = 9944;
const DESKTOP_DIR = path.resolve(__dirname_local, '..');
const SIDECAR_DIR = path.resolve(DESKTOP_DIR, '..', 'sidecar');

/** Max time to wait for the WebView2 CDP endpoint to become available */
const CDP_READY_TIMEOUT_MS = 120_000; // 2 minutes (first Cargo build can be slow)

/** Polling interval when waiting for CDP */
const CDP_POLL_MS = 2000;

// ============================================================================
// Log Collector
// ============================================================================

export class TauriLogCollector {
    private lines: string[] = [];
    private allOutput = '';
    private _baselineLength = 0;
    private _baselineLineCount = 0;

    push(data: string): void {
        this.allOutput += data;
        const newLines = data.split('\n').filter(l => l.trim());
        this.lines.push(...newLines);
    }

    /** Get all collected lines */
    getLines(): string[] {
        return [...this.lines];
    }

    /** Get raw output */
    getRaw(): string {
        return this.allOutput;
    }

    /**
     * Set a baseline marker at the current log position.
     * After calling this, `containsSinceBaseline()` and `grepSinceBaseline()`
     * will only search in logs added AFTER this point.
     */
    setBaseline(): void {
        this._baselineLength = this.allOutput.length;
        this._baselineLineCount = this.lines.length;
    }

    /** Check if any line contains the given pattern */
    contains(pattern: string): boolean {
        return this.allOutput.includes(pattern);
    }

    /** Check if logs AFTER baseline contain the given pattern */
    containsSinceBaseline(pattern: string): boolean {
        return this.allOutput.substring(this._baselineLength).includes(pattern);
    }

    /** Check if any line matches the given regex */
    matches(regex: RegExp): boolean {
        return regex.test(this.allOutput);
    }

    /** Find all lines containing the given pattern */
    grep(pattern: string): string[] {
        return this.lines.filter(l => l.includes(pattern));
    }

    /** Find all lines AFTER baseline containing the given pattern */
    grepSinceBaseline(pattern: string): string[] {
        return this.lines.slice(this._baselineLineCount).filter(l => l.includes(pattern));
    }

    /** Get raw output AFTER baseline */
    getRawSinceBaseline(): string {
        return this.allOutput.substring(this._baselineLength);
    }

    /** Get the count of lines */
    get length(): number {
        return this.lines.length;
    }
}

// ============================================================================
// CDP Readiness Check
// ============================================================================

async function waitForCdp(port: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (res.ok) {
                const data = await res.json() as Record<string, string>;
                console.log(`[Fixture] CDP ready on port ${port}: ${data['Browser'] || 'unknown'}`);
                return true;
            }
        } catch {
            // Not ready yet
        }
        await new Promise(r => setTimeout(r, CDP_POLL_MS));
    }
    return false;
}

// ============================================================================
// Chrome Pre-launch (for sidecar CDP connection)
// ============================================================================

/**
 * Ensures Chrome is running with CDP debugging enabled on the given port.
 * The sidecar's Node.js bridge will connect to this Chrome via CDP,
 * reusing the user's login cookies (e.g., Xiaohongshu).
 */
async function ensureChromeWithCDP(port: number): Promise<void> {
    // Check if CDP is already available
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
            const data = await res.json() as Record<string, string>;
            console.log(`[Fixture] Chrome CDP already available on port ${port}: ${data['Browser']}`);
            return;
        }
    } catch {
        // Not available yet
    }

    // Find Chrome executable
    const chromeCandidates = [
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const chromePath = chromeCandidates.find(p => fs.existsSync(p));

    if (!chromePath) {
        console.log('[Fixture] Chrome not found, sidecar will use its own browser (no user cookies)');
        return;
    }

    // Kill existing Chrome to avoid singleton-merge (Chrome ignores --remote-debugging-port
    // if it merges into an existing instance that wasn't started with it)
    console.log('[Fixture] Killing existing Chrome to enable remote debugging...');
    try {
        childProcess.execSync('taskkill /IM chrome.exe /F', { stdio: 'ignore', timeout: 10_000 });
    } catch {
        // No Chrome running, fine
    }
    await new Promise(r => setTimeout(r, 2000));

    // User's real Chrome profile (contains login cookies)
    const userDataDir = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');

    // Clean stale lock files
    for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try { fs.unlinkSync(path.join(userDataDir, lockFile)); } catch {}
    }

    // Launch Chrome with remote debugging in a fully detached way.
    // On Windows, use powershell Start-Process for reliable background launch.
    console.log(`[Fixture] Launching Chrome: ${chromePath} (port ${port}, profile: ${userDataDir})`);

    if (process.platform === 'win32') {
        // PowerShell Start-Process reliably launches Chrome independently
        const args = `--remote-debugging-port=${port} --user-data-dir="${userDataDir}" --no-first-run --no-default-browser-check about:blank`;
        childProcess.execSync(
            `powershell -Command "Start-Process '${chromePath}' -ArgumentList '${args}'"`,
            { stdio: 'ignore', timeout: 15_000 }
        );
    } else {
        childProcess.spawn(chromePath, [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            'about:blank',
        ], { detached: true, stdio: 'ignore' }).unref();
    }

    // Wait for CDP
    const ready = await waitForCdp(port, 30_000);
    if (ready) {
        console.log(`[Fixture] Chrome CDP ready on port ${port} — sidecar will connect to user's logged-in Chrome`);
    } else {
        console.log(`[Fixture] WARNING: Chrome CDP not ready on port ${port} — sidecar will use fresh profile`);
    }
}

// ============================================================================
// Fixture Definition
// ============================================================================

/**
 * Port to pre-launch Chrome with CDP for the sidecar to discover.
 *
 * IMPORTANT: Must NOT be 9222 or 9223 because the sidecar's Strategy 2 will
 * kill any process on those ports during its CDP retry loop. Port 9224 is in
 * ALL_CDP_PORTS (checked by the bridge) but NOT in Strategy 2's portsToTry
 * (which only tries [9222, 9223]). This way:
 *  1. Sidecar Strategy 1 & 2 fail (Bun WebSocket is broken) — they kill 9222/9223
 *  2. Sidecar falls back to bridge
 *  3. Bridge checks ALL_CDP_PORTS and finds Chrome on 9224
 *  4. Bridge connects via Node.js WebSocket (which works) to user's Chrome with cookies
 */
const SIDECAR_CDP_PORT = 9224;

type TauriFixtures = {
    tauriProcess: childProcess.ChildProcess;
    tauriLogs: TauriLogCollector;
    page: Page;
    context: BrowserContext;
};

export const test = base.extend<TauriFixtures>({
    // eslint-disable-next-line no-empty-pattern
    tauriProcess: [async ({}, use, testInfo) => {
        // ------------------------------------------------------------------
        // Pre-launch Chrome with user's profile + remote debugging.
        // The sidecar's PlaywrightBackend will connect to it via CDP through
        // the Node.js bridge, reusing the user's login cookies (e.g., Xiaohongshu).
        // ------------------------------------------------------------------
        await ensureChromeWithCDP(SIDECAR_CDP_PORT);

        console.log(`[Fixture] Starting Tauri app (WebView2 CDP port: ${CDP_PORT})...`);

        // Use `npx tauri dev` which handles Vite + Rust build + launch
        // @tauri-apps/cli is in devDependencies of desktop/package.json
        const tauriProc = childProcess.spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['tauri', 'dev'],
            {
                cwd: DESKTOP_DIR,
                shell: true,
                env: {
                    ...process.env,
                    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
                    // Prevent Tauri from using the same user data as normal usage
                    WEBVIEW2_USER_DATA_FOLDER: path.join(
                        fs.realpathSync(os.tmpdir()),
                        `coworkany-e2e-test-${testInfo.workerIndex}`,
                    ),
                },
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        );

        console.log(`[Fixture] Tauri process spawned (PID: ${tauriProc.pid})`);

        await use(tauriProc);

        // Cleanup: kill Tauri process tree
        console.log(`[Fixture] Killing Tauri process tree (PID: ${tauriProc.pid})...`);
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

        // Collect stderr (Rust tracing logs + Sidecar stderr forwarded as warnings)
        tauriProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            logs.push(text);
            // Echo to test console for real-time visibility
            for (const line of text.split('\n')) {
                if (line.trim()) {
                    process.stderr.write(`[Tauri] ${line}\n`);
                }
            }
        });

        // Collect stdout (may contain Vite dev server output or other info)
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
        // Wait for the WebView2 CDP endpoint to become available
        console.log(`[Fixture] Waiting for CDP on port ${CDP_PORT} (timeout: ${CDP_READY_TIMEOUT_MS / 1000}s)...`);
        const cdpReady = await waitForCdp(CDP_PORT, CDP_READY_TIMEOUT_MS);

        if (!cdpReady) {
            throw new Error(
                `CDP not available on port ${CDP_PORT} after ${CDP_READY_TIMEOUT_MS / 1000}s. ` +
                `Possible causes:\n` +
                `  1. First Cargo build is still in progress (check terminal output)\n` +
                `  2. Tauri app failed to start\n` +
                `  3. WebView2 is not installed on this system\n` +
                `  4. Port ${CDP_PORT} is already in use`
            );
        }

        // Connect Playwright to the WebView2 via CDP
        console.log(`[Fixture] Connecting Playwright to WebView2 via CDP...`);
        const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const context = browser.contexts()[0];

        if (!context) {
            throw new Error('No browser context found after CDP connection. WebView may not be ready.');
        }

        await use(context);

        await browser.close();
    }, { scope: 'test', timeout: 0 }],

    page: [async ({ context }, use) => {
        // Tauri creates multiple WebView windows (main, dashboard, settings).
        // All load the same devUrl, but render different React components based on
        // getCurrentWindow().label. We need the MAIN window's page.
        //
        // The "main" window renders <App /> with ChatInterface input.
        // The "dashboard" window renders <DashboardView /> (full-screen overlay).
        // The "settings" window renders <SettingsView />.
        //
        // Strategy: find the page whose title is "CoworkAny" (main window title).

        let pages = context.pages();
        console.log(`[Fixture] Found ${pages.length} pages:`);
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            try {
                const title = await p.title();
                console.log(`[Fixture]   Page ${i}: title="${title}", url="${p.url()}"`);
            } catch {
                console.log(`[Fixture]   Page ${i}: url="${p.url()}" (title unavailable)`);
            }
        }

        // Wait for all pages to load the frontend URL
        const FRONTEND_URL = 'http://localhost:5173';
        for (const p of pages) {
            if (p.url() === 'about:blank' || !p.url().includes('localhost:5173')) {
                try {
                    await p.waitForURL('**/localhost:5173/**', { timeout: 20_000 });
                } catch {
                    // This page might not navigate — skip it
                }
            }
        }

        // Re-read pages after navigation
        pages = context.pages();

        // Find the MAIN window page.
        //
        // Problem: all three Tauri windows (main, dashboard, settings) initially
        // show title "CoworkAny" from the HTML template. React hydration later
        // updates dashboard to "CoworkAny Dashboard" and settings to "CoworkAny Settings",
        // but this may not have happened yet.
        //
        // Solution: identify the main window by its UNIQUE content:
        //   - Main window: has Launcher input with placeholder "Ask CoworkAny..."
        //     or ChatInterface input with class ".chat-input"
        //   - Dashboard: has overlay with class ".fixed.inset-0.z-50"
        //   - Settings: has inputs like "e.g. My Claude 3.5" (model config)
        //
        // Wait for React hydration first, then check for specific content.
        let page: Page | null = null;

        // Give React time to hydrate on all pages
        await new Promise(r => setTimeout(r, 5000));

        for (const p of pages) {
            try {
                const title = await p.title();
                const url = p.url();
                console.log(`[Fixture] Checking page: title="${title}", url="${url}"`);

                // Skip about:blank or non-frontend pages
                if (!url.includes('localhost:5173')) continue;

                // Check for main window's unique Launcher input
                const hasLauncherInput = await p.locator('input[placeholder="Ask CoworkAny..."]')
                    .isVisible({ timeout: 3_000 }).catch(() => false);

                if (hasLauncherInput) {
                    page = p;
                    console.log(`[Fixture] Selected MAIN window (Launcher input found): title="${title}"`);
                    break;
                }

                // Check for main window's ChatInterface input
                const hasChatInput = await p.locator('.chat-input')
                    .isVisible({ timeout: 2_000 }).catch(() => false);

                if (hasChatInput) {
                    page = p;
                    console.log(`[Fixture] Selected MAIN window (ChatInterface input found): title="${title}"`);
                    break;
                }

                // Check for App container (main window uses bg-app class)
                const hasAppContainer = await p.locator('.bg-app')
                    .isVisible({ timeout: 2_000 }).catch(() => false);
                const hasDashboardOverlay = await p.locator('.fixed.inset-0.z-50')
                    .isVisible({ timeout: 1_000 }).catch(() => false);

                if (hasAppContainer && !hasDashboardOverlay) {
                    page = p;
                    console.log(`[Fixture] Selected MAIN window (App container found): title="${title}"`);
                    break;
                }

                // Check by differentiated title (after React hydration)
                if (title === 'CoworkAny' && !title.includes('Dashboard') && !title.includes('Settings')) {
                    // Verify it's NOT the settings page by checking for model config inputs
                    const hasModelInput = await p.locator('input[placeholder*="Claude"], input[placeholder*="model"]')
                        .isVisible({ timeout: 1_000 }).catch(() => false);
                    if (!hasModelInput && !hasDashboardOverlay) {
                        page = p;
                        console.log(`[Fixture] Selected MAIN window by title exclusion: "${title}"`);
                        break;
                    }
                }
            } catch {
                continue;
            }
        }

        // Fallback: use the page that has neither dashboard overlay nor settings-specific inputs
        if (!page) {
            for (const p of pages) {
                if (!p.url().includes('localhost:5173')) continue;
                const hasDashboard = await p.locator('.fixed.inset-0.z-50').isVisible({ timeout: 1_000 }).catch(() => false);
                const hasModelInput = await p.locator('input[placeholder*="Claude"]').isVisible({ timeout: 1_000 }).catch(() => false);
                if (!hasDashboard && !hasModelInput) {
                    page = p;
                    console.log(`[Fixture] Fallback: selected page without dashboard/settings, url=${p.url()}`);
                    break;
                }
            }
        }

        // Last fallback: just use the first page
        if (!page) {
            page = pages[0];
            if (!page) {
                page = await context.waitForEvent('page', { timeout: 30_000 });
            }
            console.log(`[Fixture] Last fallback: using first page, url=${page.url()}`);
        }

        // Wait for stability
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

        console.log(`[Fixture] Final page: title="${await page.title()}", url="${page.url()}"`);
        await use(page);
    }, { scope: 'test' }],
});

export { expect };
