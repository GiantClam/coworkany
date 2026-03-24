/**
 * Browser Automation Service - Hybrid Architecture
 *
 * Provides browser automation with two backends:
 * - PlaywrightBackend (precise mode): CSS selectors, direct DOM manipulation
 * - BrowserUseBackend (smart mode): AI vision, natural language actions
 *
 * BrowserService routes requests to the appropriate backend based on mode:
 * - "precise": Playwright only (fast, deterministic)
 * - "smart": browser-use only (AI-driven, adaptive)
 * - "auto": Try Playwright first, fallback to browser-use on failure
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// ============================================================================
// Constants
// ============================================================================

/** CDP (Chrome DevTools Protocol) port used by Playwright to control Chrome */
export const CDP_PORT = 9222;

/** Alternative CDP ports to try if the primary port is occupied */
const CDP_FALLBACK_PORTS = [9223, 9224, 9225];

/** All CDP ports to attempt, in order */
const ALL_CDP_PORTS = [CDP_PORT, ...CDP_FALLBACK_PORTS];

let cachedChromium: (typeof import('playwright'))['chromium'] | null = null;

async function getChromium(): Promise<(typeof import('playwright'))['chromium']> {
    if (cachedChromium) {
        return cachedChromium;
    }
    const playwright = await import('playwright');
    cachedChromium = playwright.chromium;
    return cachedChromium;
}

function shouldDisableExternalCdp(): boolean {
    const raw = process.env.COWORKANY_DISABLE_BROWSER_CDP?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveBridgeScriptPath(): string {
    const explicit = process.env.COWORKANY_PLAYWRIGHT_BRIDGE?.trim();
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }
    return path.join(__dirname, 'playwright-bridge.cjs');
}

function resolveBundledNodePath(): string | null {
    const explicit = process.env.COWORKANY_BUNDLED_NODE?.trim();
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }
    return null;
}

function resolvePlaywrightBrowsersPath(): string | null {
    const explicit = process.env.COWORKANY_PLAYWRIGHT_BROWSERS_PATH?.trim()
        || process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }
    return null;
}
// ============================================================================
// Types
// ============================================================================

export type BrowserMode = 'precise' | 'smart' | 'auto';

export interface BrowserConnection {
    browser: Browser | null;
    context: BrowserContext;
    page: Page;
    isUserProfile: boolean;
    profilePath?: string;
}

export interface ConnectOptions {
    profileName?: string;
    headless?: boolean;
    requireUserProfile?: boolean;
    /** CDP URL to connect to an existing browser instance (used for sharing browser between backends) */
    cdpUrl?: string;
    signal?: AbortSignal;
}

export interface NavigateOptions {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    timeout?: number;
    signal?: AbortSignal;
    taskId?: string;
}

export interface NavigateResult {
    url: string;
    title: string;
    warning?: string;
}

export interface ClickOptions {
    selector?: string;
    text?: string;
    timeout?: number;
    signal?: AbortSignal;
    taskId?: string;
}

export interface ClickResult {
    clicked: string;
}

export interface FillOptions {
    selector: string;
    value: string;
    clearFirst?: boolean;
    signal?: AbortSignal;
    taskId?: string;
}

export interface FillResult {
    filled: string;
    value: string;
}

export interface ScreenshotOptions {
    selector?: string;
    fullPage?: boolean;
    signal?: AbortSignal;
    taskId?: string;
}

export interface ScreenshotResult {
    base64: string;
    width: number;
    height: number;
}

export interface WaitOptions {
    selector: string;
    state?: 'visible' | 'hidden' | 'attached' | 'detached';
    timeout?: number;
    signal?: AbortSignal;
    taskId?: string;
}

export interface WaitResult {
    found: boolean;
    selector: string;
}

export interface ContentResult {
    content: string;
    url: string;
    title: string;
}

export interface UploadFileOptions {
    /** CSS selector for the file input element */
    selector?: string;
    /** Absolute path to the file to upload */
    filePath: string;
    /** Natural language instruction for finding upload element (smart mode) */
    instruction?: string;
    signal?: AbortSignal;
    taskId?: string;
}

export interface UploadResult {
    success: boolean;
    message: string;
    error?: string;
}

export interface AiActionOptions {
    /** Natural language description of the action */
    action: string;
    /** Additional context about the current page */
    context?: string;
    signal?: AbortSignal;
    taskId?: string;
}

export interface AiActionResult {
    success: boolean;
    result?: string;
    error?: string;
}

export interface BrowserOperationControl {
    signal?: AbortSignal;
    taskId?: string;
}

function getAbortReason(signal?: AbortSignal, fallback: string = 'Browser operation cancelled'): string {
    const reason = signal?.reason;
    if (typeof reason === 'string' && reason.trim().length > 0) {
        return reason;
    }
    if (reason instanceof Error && reason.message.trim().length > 0) {
        return reason.message;
    }
    return fallback;
}

function throwIfAborted(signal?: AbortSignal, fallback?: string): void {
    if (signal?.aborted) {
        throw new Error(getAbortReason(signal, fallback));
    }
}

function createTimedAbortSignal(
    timeoutMs: number,
    parentSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new Error(`Browser operation timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const abortFromParent = () => {
        controller.abort(parentSignal?.reason ?? new Error('Browser operation cancelled'));
    };

    if (parentSignal) {
        if (parentSignal.aborted) {
            abortFromParent();
        } else {
            parentSignal.addEventListener('abort', abortFromParent, { once: true });
        }
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer);
            parentSignal?.removeEventListener('abort', abortFromParent);
        },
    };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return;
    }

    await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error(getAbortReason(signal)));
            return;
        }

        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            reject(new Error(getAbortReason(signal)));
        };

        signal.addEventListener('abort', onAbort, { once: true });
    });
}

// ============================================================================
// BrowserBackend Interface
// ============================================================================

/**
 * Abstract interface for browser automation backends.
 * Both PlaywrightBackend and BrowserUseBackend implement this.
 */
export interface BrowserBackend {
    readonly name: string;

    connect(options: ConnectOptions): Promise<BrowserConnection>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    navigate(url: string, options?: NavigateOptions): Promise<NavigateResult>;
    click(options: ClickOptions): Promise<ClickResult>;
    fill(options: FillOptions): Promise<FillResult>;
    screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
    wait(options: WaitOptions): Promise<WaitResult>;
    getContent(asText?: boolean, control?: BrowserOperationControl): Promise<ContentResult>;
    executeScript<T>(script: string, control?: BrowserOperationControl): Promise<T>;
    uploadFile(options: UploadFileOptions): Promise<UploadResult>;
}

// ============================================================================
// PlaywrightBackend - Precise Mode
// ============================================================================

/**
 * Playwright-based browser backend for precise, selector-driven automation.
 * Extracted from the original BrowserService implementation.
 */
export class PlaywrightBackend implements BrowserBackend {
    readonly name = 'playwright';
    private connection: BrowserConnection | null = null;
    private readonly taskPages = new Map<string, Page>();

    isConnected(): boolean {
        if (!this.connection) return false;

        // Bridge mode provides a lightweight context proxy without browser().
        // Treat any live connection object as connected in that case.
        const ctx = this.connection.context as unknown as { browser?: () => { isConnected?: () => boolean } };
        if (!ctx || typeof ctx.browser !== 'function') {
            return true;
        }

        try {
            return ctx.browser()?.isConnected?.() !== false;
        } catch {
            // If browser() exists but throws due to backend mismatch, keep the
            // connection alive and let concrete operations surface errors.
            return true;
        }
    }

    private async interruptCurrentPageOperation(page: Page, reason?: string): Promise<void> {
        if (!this.connection) {
            return;
        }
        if (typeof (page as any)?.isClosed !== 'function' || typeof (page as any)?.close !== 'function') {
            return;
        }

        try {
            if (!page.isClosed()) {
                await page.close({ runBeforeUnload: false });
            }
        } catch (error) {
            console.error('[PlaywrightBackend] Failed to close page during cancellation:', error);
        }

        if (this.connection.page !== page) {
            return;
        }

        try {
            this.connection.page = await this.connection.context.newPage();
            console.error(`[PlaywrightBackend] Replaced page after cancellation${reason ? `: ${reason}` : ''}`);
        } catch (error) {
            console.error('[PlaywrightBackend] Failed to create replacement page after cancellation:', error);
        }
    }

    private async runAbortablePageAction<T>(
        page: Page,
        signal: AbortSignal | undefined,
        action: () => Promise<T>
    ): Promise<T> {
        if (!signal) {
            return action();
        }
        if (signal.aborted) {
            throw new Error(getAbortReason(signal));
        }

        let abortListener: (() => void) | undefined;
        const operationPromise = action();
        const guardedOperation = operationPromise.catch((error) => {
            if (signal.aborted) {
                throw new Error(getAbortReason(signal));
            }
            throw error;
        });

        try {
            return await Promise.race<T>([
                guardedOperation,
                new Promise<T>((_, reject) => {
                    abortListener = () => {
                        void this.interruptCurrentPageOperation(page, getAbortReason(signal));
                        reject(new Error(getAbortReason(signal)));
                    };
                    signal.addEventListener('abort', abortListener, { once: true });
                }),
            ]);
        } finally {
            if (abortListener) {
                signal.removeEventListener('abort', abortListener);
            }
            guardedOperation.catch(() => {});
        }
    }

    private async runAbortableConnectAction<T>(
        signal: AbortSignal | undefined,
        action: () => Promise<T>,
        cleanupResolved: (value: T) => Promise<void> | void
    ): Promise<T> {
        if (!signal) {
            return action();
        }
        if (signal.aborted) {
            throw new Error(getAbortReason(signal, 'Browser connection cancelled'));
        }

        let aborted = false;

        return await new Promise<T>((resolve, reject) => {
            const onAbort = () => {
                aborted = true;
                signal.removeEventListener('abort', onAbort);
                reject(new Error(getAbortReason(signal, 'Browser connection cancelled')));
            };

            signal.addEventListener('abort', onAbort, { once: true });

            action().then(async (value) => {
                signal.removeEventListener('abort', onAbort);
                if (aborted) {
                    await cleanupResolved(value);
                    return;
                }
                resolve(value);
            }).catch((error) => {
                signal.removeEventListener('abort', onAbort);
                if (aborted) {
                    return;
                }
                reject(error);
            });
        });
    }

    /**
     * Connect to Chrome browser with a multi-strategy approach.
     *
     * Strategy order (designed for speed & reliability):
     *  1. Try connecting to an existing Chrome with working CDP on known ports
     *     (fast: ~2s per port, checks 9222-9225)
     *  2. Launch a NEW Chrome instance with a unique user-data-dir + debug port.
     *     Uses a unique dir per port to avoid Chrome single-instance merging.
     *     Only tries primary port + 1 fallback (max ~25s).
     *  3. Final fallback: use Playwright's launchPersistentContext — always works,
     *     no CDP needed. Profile persists at CoworkAny/PlaywrightProfile so user
     *     only logs in once.
     *
     * IMPORTANT: This method NEVER kills the user's existing Chrome browser.
     * It launches a separate Chrome process with its own user-data-dir.
     */
    async connect(options: ConnectOptions = {}): Promise<BrowserConnection> {
        const signal = options.signal;
        throwIfAborted(signal, 'Browser connection cancelled');
        const requireUserProfile = !!options.requireUserProfile;
        if (this.connection) {
            console.error('[PlaywrightBackend] Returning existing connection');
            if (requireUserProfile && !this.connection.isUserProfile) {
                throw new Error('Connected via persistent_profile; requireUserProfile=true. Start Chrome with --remote-debugging-port=9222 and reconnect.');
            }
            return this.connection;
        }

        const profileName = options.profileName || 'Default';
        const userDataDir = getChromeUserDataDir();
        const headless = options.headless ?? false;

        console.error(`[PlaywrightBackend] Connecting to Chrome (profile: ${profileName}, cdpHealth: ${this._cdpHealthStatus})`);

        // Fast path: if CDP is known to be broken on this system, go straight
        // to the persistent context fallback (saves 15-30s of futile retries).
        if (this._cdpHealthStatus === 'broken') {
            console.error('[PlaywrightBackend] CDP previously failed on this system, using persistent context directly');
            if (requireUserProfile) {
                throw new Error('CDP unavailable and requireUserProfile=true. Start Chrome with --remote-debugging-port=9222 and retry.');
            }
            return this._fallbackLaunchPersistentContext(headless, signal);
        }

        // ------------------------------------------------------------------
        // Strategy 1: Check if there's any Chrome with CDP HTTP endpoint
        // on ports 9222-9225. If found, skip Strategy 2 (which would kill
        // the Chrome) and go straight to the Bridge path.
        //
        // Key insight: under Bun, Playwright's connectOverCDP() fails due
        // to Bun's broken WebSocket. But the Node.js bridge can handle CDP
        // connections correctly. So if we detect a CDP endpoint, we should
        // go to the bridge immediately — NOT try to launch new Chrome
        // instances (Strategy 2) which would kill the existing one.
        // ------------------------------------------------------------------
        let cdpEndpointAvailable = false;
        for (const port of ALL_CDP_PORTS) {
            throwIfAborted(signal, 'Browser connection cancelled');
            if (await this._isCdpAvailable(port)) {
                console.error(`[PlaywrightBackend] Found CDP HTTP endpoint on port ${port}`);
                cdpEndpointAvailable = true;

                // Try direct Playwright connection (works under Node.js, fails under Bun)
                const connection = await this._connectViaCdp(port, getChromeUserDataDir(), signal);
                if (connection) {
                    this.connection = connection;
                    this._activeCdpPort = port;
                    this._cdpHealthStatus = 'works';
                    console.error(`[PlaywrightBackend] Connected to existing Chrome via CDP on port ${port}`);
                    return this.connection;
                }

                console.error(`[PlaywrightBackend] Direct CDP WS failed on port ${port} (likely Bun WebSocket issue)`);
                // DON'T continue trying — jump to bridge path below
                break;
            }
        }

        if (cdpEndpointAvailable) {
            // A CDP endpoint exists but Playwright can't connect (Bun WS issue).
            // Go DIRECTLY to Bridge path — do NOT launch new Chrome (Strategy 2)
            // because that would kill the existing Chrome with user's cookies.
            console.error('[PlaywrightBackend] CDP endpoint found but WS failed — using Bridge for CDP connection (preserves user Chrome)');
            const viaBridge = await this._fallbackLaunchPersistentContext(headless, signal);
            throwIfAborted(signal, 'Browser connection cancelled');
            if (requireUserProfile && !viaBridge.isUserProfile) {
                throw new Error('Bridge fallback did not attach to user profile while requireUserProfile=true. Ensure Chrome debug port 9222 is enabled.');
            }
            return viaBridge;
        }

        // Bun runtime note:
        // In Bun, direct connectOverCDP websocket frequently fails even when CDP HTTP is up.
        // Strategy 2 (launch Chrome with CDP and reconnect) tends to waste time and can leave
        // the agent appearing stalled. Prefer bridge/persistent fallback directly.
        const isBunRuntime = typeof (process as any).versions?.bun !== 'undefined';
        if (isBunRuntime) {
            this._cdpHealthStatus = 'broken';
            console.error('[PlaywrightBackend] Bun runtime detected with no reusable CDP endpoint; skipping CDP launch strategy and using bridge fallback');
            if (requireUserProfile) {
                throw new Error('No reusable CDP endpoint found with requireUserProfile=true. Start Chrome with --remote-debugging-port=9222.');
            }
            return this._fallbackLaunchPersistentContext(headless, signal);
        }

        // ------------------------------------------------------------------
        // Strategy 2: No CDP endpoint found. Launch a NEW Chrome with
        // dedicated profile + debug port. Only try 2 ports max.
        // ------------------------------------------------------------------
        const chromePath = getChromeExecutable();
        if (chromePath) {
            console.error(`[PlaywrightBackend] No CDP endpoint found. Launching new Chrome: ${chromePath}`);
            const portsToTry = [CDP_PORT, CDP_FALLBACK_PORTS[0]]; // max 2 ports

            for (const port of portsToTry) {
                const dedicatedDir = path.join(
                    process.env.LOCALAPPDATA || os.homedir(),
                    'CoworkAny', `ChromeProfile-${port}`
                );
                this._cleanStaleLocks(dedicatedDir);

                if (await this._isCdpAvailable(port)) {
                    console.error(`[PlaywrightBackend] Port ${port} occupied (stale), freeing...`);
                    await this._killProcessOnPort(port);
                    await delay(1000, signal);
                    if (await this._isCdpAvailable(port)) {
                        console.error(`[PlaywrightBackend] Port ${port} still occupied, skipping`);
                        continue;
                    }
                }

                const launched = await this._launchChromeWithCdp(chromePath, dedicatedDir, port, headless, signal);
                if (!launched) continue;

                const connection = await this._connectViaCdp(port, userDataDir, signal);
                if (connection) {
                    this.connection = connection;
                    this._activeCdpPort = port;
                    this._cdpHealthStatus = 'works';
                    console.error(`[PlaywrightBackend] Connected via CDP on port ${port}`);
                    return this.connection;
                }

                console.error(`[PlaywrightBackend] CDP WS failed on port ${port}, cleaning up`);
                await this._killProcessOnPort(port);
            }
        } else {
            console.error('[PlaywrightBackend] Chrome not found on system');
        }

        // ------------------------------------------------------------------
        // Strategy 3: Playwright persistent context via Bridge (always works).
        // ------------------------------------------------------------------
        this._cdpHealthStatus = 'broken';
        console.error('[PlaywrightBackend] All strategies exhausted — using Playwright persistent context');
        return this._fallbackLaunchPersistentContext(headless, signal);
    }

    /** Track which CDP port is in use for cleanup */
    private _activeCdpPort: number | null = null;

    /**
     * Remembers whether CDP has ever succeeded on this machine.
     * If CDP consistently fails (e.g. due to firewall), we skip straight
     * to the persistent context fallback on subsequent connects.
     * 'unknown' = never tried, 'works' = CDP succeeded before, 'broken' = CDP consistently fails
     */
    private _cdpHealthStatus: 'unknown' | 'works' | 'broken' = 'unknown';

    // ========================================================================
    // Connection Strategy Helpers
    // ========================================================================

    /**
     * Strategy 1: Scan all known CDP ports and try to establish a full
     * WebSocket connection (not just HTTP check).
     */
    private async _tryConnectExistingCdp(): Promise<BrowserConnection | null> {
        for (const port of ALL_CDP_PORTS) {
            if (!(await this._isCdpAvailable(port))) continue;

            console.error(`[PlaywrightBackend] Found CDP HTTP endpoint on port ${port}, testing WebSocket...`);
            const connection = await this._connectViaCdp(port, getChromeUserDataDir());
            if (connection) {
                this._activeCdpPort = port;
                return connection;
            }
            console.error(`[PlaywrightBackend] WebSocket failed on port ${port} (stale endpoint)`);
        }
        return null;
    }

    /**
     * Attempt to connect Playwright to a CDP endpoint via WebSocket.
     * Returns null if the connection fails (instead of throwing).
     */
    private async _connectViaCdp(
        port: number,
        userDataDir: string,
        signal?: AbortSignal
    ): Promise<BrowserConnection | null> {
        const cdpUrl = `http://localhost:${port}`;
        try {
            // 5s timeout: a healthy CDP WebSocket connects in < 1s
            const browser = await this.runAbortableConnectAction(
                signal,
                async () => {
                    const chromium = await getChromium();
                    return chromium.connectOverCDP(cdpUrl, { timeout: 5000 });
                },
                async (resolvedBrowser) => {
                    await resolvedBrowser.close().catch(() => {});
                }
            );
            const contexts = browser.contexts();
            const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
            // Always open a fresh tab for CoworkAny operations so each automation
            // session starts from a clean surface instead of hijacking existing tabs.
            const page = await context.newPage();

            return {
                browser,
                context,
                page,
                isUserProfile: true,
                profilePath: userDataDir,
            };
        } catch (error) {
            console.error(`[PlaywrightBackend] CDP WebSocket connection failed on port ${port}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Launch a new Chrome process with --remote-debugging-port.
     * Uses a dedicated user-data-dir so it runs as a SEPARATE process
     * from the user's main Chrome (no kill required).
     */
    private async _launchChromeWithCdp(
        chromePath: string,
        dedicatedUserDataDir: string,
        port: number,
        headless: boolean,
        signal?: AbortSignal
    ): Promise<boolean> {
        throwIfAborted(signal, 'Browser connection cancelled');
        try { fs.mkdirSync(dedicatedUserDataDir, { recursive: true }); } catch {}
        console.error(`[PlaywrightBackend] Launching Chrome on port ${port} (profile: ${dedicatedUserDataDir})`);

        try {
            const { spawn: spawnChild } = await import('child_process');
            const chromeArgs = [
                `--remote-debugging-port=${port}`,
                `--user-data-dir=${dedicatedUserDataDir}`,
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-infobars',
                // Ensure this instance is truly separate from user's Chrome
                '--disable-background-networking',
                '--disable-default-apps',
            ];
            if (headless) {
                chromeArgs.push('--headless=new');
            }

            const chromeProcess = spawnChild(chromePath, chromeArgs, {
                stdio: 'ignore',
                detached: true,
            });
            chromeProcess.unref();

            // Wait for CDP endpoint (shorter timeout: fail fast, move to fallback)
            const waitStart = Date.now();
            const CDP_TIMEOUT = 10000; // 10s (reduced from 20s)

            while (Date.now() - waitStart < CDP_TIMEOUT) {
                throwIfAborted(signal, 'Browser connection cancelled');
                if (await this._isCdpAvailable(port)) {
                    console.error(`[PlaywrightBackend] CDP ready on port ${port} (${Date.now() - waitStart}ms)`);
                    return true;
                }
                await delay(500, signal);
            }

            console.error(`[PlaywrightBackend] CDP not ready on port ${port} within ${CDP_TIMEOUT / 1000}s`);
            return false;
        } catch (error) {
            console.error(`[PlaywrightBackend] Chrome launch error: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Final fallback: use Playwright's launchPersistentContext.
     * This always works regardless of user's Chrome state because it uses
     * Playwright's bundled Chromium, not the system Chrome.
     * Downside: no access to user's existing login sessions.
     */
    /**
     * Fallback: launch browser using Playwright via a Node.js bridge.
     *
     * WHY: Playwright uses --remote-debugging-pipe to communicate with Chrome.
     * This pipe mechanism doesn't work when the parent process is Bun (our
     * sidecar runtime), because Bun's child_process implementation doesn't
     * properly inherit extra file descriptors. Direct Node.js execution works.
     *
     * SOLUTION: Spawn a Node.js child process that runs playwright-bridge.js,
     * which launches a Playwright browser server. The bridge returns a WebSocket
     * endpoint that we connect to via Playwright's `chromium.connect()`.
     *
     * This approach:
     *  - Always works regardless of parent process runtime (Bun, Node, etc.)
     *  - Uses Playwright's bundled Chromium (no dependency on system Chrome)
     *  - Browser stays alive as long as the bridge process is alive
     *  - Bridge process is killed when we disconnect
     */
    private async _fallbackLaunchPersistentContext(headless: boolean, signal?: AbortSignal): Promise<BrowserConnection> {
        throwIfAborted(signal, 'Browser connection cancelled');
        // Kill any Chrome instances WE spawned during CDP attempts
        await this._killChromeByProfileDir().catch(() => {});
        await delay(1000, signal);

        // --- Approach A: Node.js bridge (recommended for Bun environments) ---
        try {
            return await this._launchViaBridge(headless, signal);
        } catch (bridgeErr) {
            console.error(`[PlaywrightBackend] Bridge launch failed: ${bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr)}`);
        }

        // --- Approach B: Direct Playwright launch (works under Node.js) ---
        console.error('[PlaywrightBackend] Trying direct chromium.launch() as final fallback');

        try {
            const directConnection = await this.runAbortableConnectAction(
                signal,
                async () => {
                    const chromium = await getChromium();
                    const browser = await chromium.launch({
                        headless,
                        timeout: 30000,
                        args: [
                            '--disable-blink-features=AutomationControlled',
                            '--no-first-run',
                            '--no-default-browser-check',
                            '--disable-infobars',
                            '--disable-dev-shm-usage',
                        ],
                    });

                    const context = await browser.newContext({
                        viewport: { width: 1920, height: 1080 },
                    });
                    const page = await context.newPage();

                    return {
                        browser,
                        context,
                        page,
                        isUserProfile: false,
                    } as BrowserConnection;
                },
                async (resolvedConnection) => {
                    await resolvedConnection.context.close().catch(() => {});
                    await resolvedConnection.browser?.close().catch(() => {});
                }
            );

            this.connection = directConnection;
            console.error('[PlaywrightBackend] Connected via direct chromium.launch()');
            return this.connection;
        } catch (directErr) {
            console.error(`[PlaywrightBackend] Direct launch also failed: ${directErr instanceof Error ? directErr.message : String(directErr)}`);
            throw new Error('All browser launch strategies failed. Please check system configuration.');
        }
    }

    /** Reference to the bridge child process for cleanup */
    private _bridgeProcess: import('child_process').ChildProcess | null = null;

    /**
     * Launch browser via Node.js bridge IPC.
     *
     * Spawns a Node.js process running playwright-bridge.cjs, which handles
     * ALL Playwright operations. Communication is via stdin/stdout JSON-Lines
     * (which works correctly under Bun, unlike WebSocket connections).
     *
     * The bridge process stays alive and serves as a Playwright automation server.
     * The sidecar sends commands and receives results.
     */
    private async _launchViaBridge(headless: boolean, signal?: AbortSignal): Promise<BrowserConnection> {
        throwIfAborted(signal, 'Browser connection cancelled');
        const bridgeScript = resolveBridgeScriptPath();

        if (!fs.existsSync(bridgeScript)) {
            throw new Error(`Playwright bridge script not found: ${bridgeScript}`);
        }

        // Find Node.js executable (prefer bundled runtime from packaged desktop app)
        const nodePath = await this._resolveNodePath();

        if (!nodePath) {
            throw new Error('Node.js not found on system. Please install Node.js.');
        }

        console.error(`[PlaywrightBackend] Launching browser via Node.js bridge (node: ${nodePath})`);

        const { spawn: spawnChild } = await import('child_process');

        const bridgeEnv: Record<string, string> = { ...process.env } as Record<string, string>;
        const bundledBrowsersPath = resolvePlaywrightBrowsersPath();
        if (bundledBrowsersPath) {
            bridgeEnv.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsersPath;
        }

        const bridgeProc = spawnChild(nodePath, [bridgeScript], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: bridgeEnv,
            cwd: path.dirname(bridgeScript),
        });

        this._bridgeProcess = bridgeProc;

        // Collect stderr for debugging
        bridgeProc.stderr?.on('data', (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) console.error(`[PW-Bridge] ${msg}`);
        });

        // Wait for "ready" message from bridge
        const ready = await this._bridgeWaitForReady(bridgeProc, signal);
        if (!ready) {
            bridgeProc.kill();
            throw new Error('Bridge failed to start');
        }

        console.error('[PlaywrightBackend] Bridge is ready, launching browser...');

        // Setup the IPC response handler
        this._setupBridgeIPC(bridgeProc);

        // ------------------------------------------------------------------
        // Try CDP connection THROUGH the bridge first.
        // Bun's WebSocket is broken (causes connectOverCDP timeout), but
        // Node.js in the bridge process handles WebSocket correctly.
        // If the user's Chrome is running with --remote-debugging-port,
        // this will connect to it and preserve the user's login cookies.
        // ------------------------------------------------------------------
        for (const cdpPort of ALL_CDP_PORTS) {
            throwIfAborted(signal, 'Browser connection cancelled');
            if (await this._isCdpAvailable(cdpPort)) {
                console.error(`[PlaywrightBackend] Bridge: trying CDP connection on port ${cdpPort}...`);
                try {
                    const cdpResult = await this._bridgeSend('connectCDP', {
                        cdpUrl: `http://127.0.0.1:${cdpPort}`,
                        timeout: 10000,
                    }, undefined, signal);
                    if (cdpResult.success) {
                        console.error(`[PlaywrightBackend] Bridge: CDP connected on port ${cdpPort}! (user profile with cookies)`);
                        this._cdpHealthStatus = 'works';

                        const bridgePage = this._createBridgePageProxy();
                        const bridgeContext = {
                            close: async () => { await this._bridgeSend('close', {}).catch(() => {}); },
                            pages: () => [bridgePage],
                            newPage: async () => bridgePage,
                        } as unknown as import('playwright').BrowserContext;

                        this.connection = {
                            browser: null as unknown as Browser,
                            context: bridgeContext,
                            page: bridgePage as unknown as import('playwright').Page,
                            isUserProfile: true,
                            profilePath: getChromeUserDataDir(),
                        };
                        return this.connection;
                    }
                } catch (cdpErr) {
                    console.error(`[PlaywrightBackend] Bridge: CDP connection failed on port ${cdpPort}: ${cdpErr instanceof Error ? cdpErr.message : String(cdpErr)}`);
                }
            }
        }
        console.error('[PlaywrightBackend] Bridge: no CDP endpoint available, using persistent context');

        // Send launch command (persistent context — separate profile, no user cookies)
        const persistentDir = path.join(
            process.env.LOCALAPPDATA || os.homedir(),
            'CoworkAny', 'PlaywrightProfile'
        );

        const launchResult = await this._bridgeSend('launch', {
            headless,
            userDataDir: persistentDir,
            executablePath: getChromeExecutable() || undefined,
        }, undefined, signal);

        if (!launchResult.success) {
            // Try without persistent dir
            console.error(`[PlaywrightBackend] Persistent launch failed: ${launchResult.error}, trying fresh...`);
            const freshResult = await this._bridgeSend('launch', {
                headless,
                executablePath: getChromeExecutable() || undefined,
            }, undefined, signal);
            if (!freshResult.success) {
                bridgeProc.kill();
                throw new Error(`Bridge launch failed: ${freshResult.error}`);
            }
        }

        console.error('[PlaywrightBackend] Browser launched via bridge');

        // Create a proxy Page-like object that delegates to the bridge
        const bridgePage = this._createBridgePageProxy();

        // Create a minimal context that wraps bridge operations
        const bridgeContext = {
            close: async () => {
                await this._bridgeSend('close', {}).catch(() => {});
            },
            pages: () => [bridgePage],
            newPage: async () => bridgePage,
        } as unknown as import('playwright').BrowserContext;

        this.connection = {
            browser: null,
            context: bridgeContext,
            page: bridgePage as unknown as import('playwright').Page,
            isUserProfile: false,
            profilePath: persistentDir,
        };

        return this.connection;
    }

    // ---- Bridge IPC helpers ----

    private _bridgeResponseHandlers = new Map<string, (response: any) => void>();
    private _bridgeIdCounter = 0;

    private _bridgeWaitForReady(proc: import('child_process').ChildProcess, signal?: AbortSignal): Promise<boolean> {
        return new Promise((resolve) => {
            const cleanup = () => {
                clearTimeout(timeout);
                proc.stdout?.removeListener('data', onData);
                proc.removeListener('exit', onExit);
                signal?.removeEventListener('abort', onAbort);
            };
            const timeout = setTimeout(() => {
                cleanup();
                resolve(false);
            }, 15000);
            let buffer = '';

            const onData = (data: Buffer) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const msg = JSON.parse(line.trim());
                            if (msg.ready) {
                                cleanup();
                                resolve(true);
                                return;
                            }
                        } catch {}
                    }
                }
            };

            const onExit = () => {
                cleanup();
                resolve(false);
            };
            const onAbort = () => {
                cleanup();
                try {
                    proc.kill();
                } catch {
                    // Ignore cleanup failures while aborting bridge startup.
                }
                resolve(false);
            };

            if (signal?.aborted) {
                onAbort();
                return;
            }

            proc.stdout?.on('data', onData);
            proc.on('exit', onExit);
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    private _setupBridgeIPC(proc: import('child_process').ChildProcess): void {
        let buffer = '';
        proc.stdout?.on('data', (data: Buffer) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const msg = JSON.parse(line.trim());
                        if (msg.id && this._bridgeResponseHandlers.has(msg.id)) {
                            const handler = this._bridgeResponseHandlers.get(msg.id)!;
                            this._bridgeResponseHandlers.delete(msg.id);
                            handler(msg);
                        }
                    } catch {}
                }
            }
        });
    }

    private _bridgeSend(method: string, params: any, timeoutMs?: number, signal?: AbortSignal): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this._bridgeProcess || !this._bridgeProcess.stdin) {
                reject(new Error('Bridge not running'));
                return;
            }
            if (signal?.aborted) {
                reject(new Error(getAbortReason(signal)));
                return;
            }

            // Use provided timeout, or derive from params, or default 30s.
            // Navigation commands need longer timeouts (especially with networkidle).
            const effectiveTimeout = timeoutMs
                || (params?.timeout ? params.timeout + 10000 : undefined) // Bridge timeout + 10s buffer
                || (method === 'navigate' ? 90000 : 30000); // Navigation: 90s, others: 30s

            const id = `cmd_${++this._bridgeIdCounter}`;
            const cleanup = () => {
                clearTimeout(timeout);
                if (abortListener) {
                    signal?.removeEventListener('abort', abortListener);
                }
            };
            const timeout = setTimeout(() => {
                this._bridgeResponseHandlers.delete(id);
                cleanup();
                reject(new Error(`Bridge command "${method}" timed out after ${Math.round(effectiveTimeout / 1000)}s`));
            }, effectiveTimeout);

            this._bridgeResponseHandlers.set(id, (response) => {
                cleanup();
                resolve(response);
            });

            const abortListener = signal
                ? () => {
                    this._bridgeResponseHandlers.delete(id);
                    cleanup();
                    try {
                        this._bridgeProcess?.stdin?.write(JSON.stringify({
                            id: `cancel_${id}`,
                            method: 'cancel',
                            params: {
                                targetId: id,
                                reason: getAbortReason(signal),
                            },
                        }) + '\n');
                    } catch {
                        // Ignore bridge cancellation write failures.
                    }
                    reject(new Error(getAbortReason(signal)));
                }
                : undefined;

            if (abortListener && signal) {
                signal.addEventListener('abort', abortListener, { once: true });
            }

            const cmd = JSON.stringify({ id, method, params }) + '\n';
            this._bridgeProcess.stdin.write(cmd);
        });
    }

    /**
     * Create a proxy object that implements the Page interface methods
     * by delegating to the bridge process via IPC.
     */
    private _createBridgePageProxy(taskKey?: string): any {
        const self = this;
        const attachTaskKey = <T extends Record<string, unknown>>(payload: T): T & { taskKey?: string } => (
            taskKey ? { ...payload, taskKey } : payload
        );
        let localLastUrl = 'about:blank';
        let localLastNavMeta: any = null;
        return {
            _isBridgeProxy: true,
            _taskKey: taskKey,
            __lastNavMeta: null as any,
            goto: async (url: string, options?: any) => {
                // Pass the page-level timeout to the IPC layer so it doesn't
                // cut off long navigation waits (e.g., networkidle on X.com).
                const ipcTimeout = options?.timeout ? options.timeout + 15000 : undefined;
                const result = await self._bridgeSend('navigate', {
                    url,
                    waitUntil: options?.waitUntil,
                    timeout: options?.timeout,
                    ...attachTaskKey({}),
                }, ipcTimeout, options?.signal);
                if (!result.success) throw new Error(result.error);
                // Store the actual URL returned by the bridge (page.url() after goto)
                localLastUrl = result.result?.url || url;
                localLastNavMeta = result.result || null;
                (this as any).__lastNavMeta = localLastNavMeta;
                return { status: () => result.result?.status };
            },
            url: () => localLastUrl,
            title: async () => {
                const r = await self._bridgeSend('getUrl', attachTaskKey({}), undefined, undefined);
                if (r.success && r.result.url) {
                    localLastUrl = r.result.url; // Keep URL in sync
                }
                return r.success ? r.result.title : '';
            },
            click: async (selector: string, options?: any) => {
                const result = await self._bridgeSend('click', {
                    selector,
                    timeout: options?.timeout,
                    ...attachTaskKey({}),
                }, undefined, options?.signal);
                if (!result.success) throw new Error(result.error);
            },
            textContent: async (selector?: string) => {
                const result = await self._bridgeSend('getContent', attachTaskKey({ selector }));
                return result.success ? result.result.content : null;
            },
            innerText: async (selector: string) => {
                const result = await self._bridgeSend('getContent', attachTaskKey({ selector }));
                return result.success ? result.result.content : '';
            },
            content: async () => {
                const result = await self._bridgeSend('getContent', attachTaskKey({}));
                return result.success ? result.result.content : '';
            },
            screenshot: async (options?: any) => {
                const result = await self._bridgeSend('screenshot', {
                    fullPage: options?.fullPage,
                    ...attachTaskKey({}),
                }, undefined, options?.signal);
                if (!result.success) throw new Error(result.error);
                return Buffer.from(result.result.base64, 'base64');
            },
            evaluate: async (script: string | Function) => {
                const scriptStr = typeof script === 'function' ? `(${script.toString()})()` : script;
                const result = await self._bridgeSend('executeScript', attachTaskKey({ script: scriptStr }));
                if (!result.success) throw new Error(result.error);
                return result.result?.result;
            },
            waitForSelector: async (selector: string, options?: any) => {
                const result = await self._bridgeSend('waitForSelector', {
                    selector,
                    timeout: options?.timeout,
                    state: options?.state,
                    ...attachTaskKey({}),
                }, undefined, options?.signal);
                if (!result.success) throw new Error(result.error);
            },
            waitForTimeout: async (ms: number) => {
                // Bridge parity for Playwright Page.waitForTimeout()
                const delay = Math.max(0, Number(ms) || 0);
                const result = await self._bridgeSend('executeScript', {
                    script: `new Promise(resolve => setTimeout(resolve, ${delay}))`,
                    ...attachTaskKey({}),
                }, delay + 5000);
                if (!result.success) throw new Error(result.error);
            },
            // ============================================================
            // Playwright Locator-compatible helpers
            // These return Locator-like objects that delegate to the bridge
            // ============================================================

            // Helper to create a Locator-like object for a given selector or text
            ...(() => {
                function createLocator(opts: { selector?: string; text?: string }): any {
                    const loc: any = {
                        click: async (options?: any) => {
                            const params: any = { timeout: options?.timeout };
                            if (opts.text) params.text = opts.text;
                            else if (opts.selector) params.selector = opts.selector;
                            if (taskKey) params.taskKey = taskKey;
                            const result = await self._bridgeSend('click', params, undefined, options?.signal);
                            if (!result.success) throw new Error(result.error);
                        },
                        fill: async (value: string, options?: any) => {
                            const params: any = { value, timeout: options?.timeout };
                            if (opts.text) params.text = opts.text;
                            else if (opts.selector) params.selector = opts.selector;
                            if (taskKey) params.taskKey = taskKey;
                            const result = await self._bridgeSend('fill', params, undefined, options?.signal);
                            if (!result.success) throw new Error(result.error);
                        },
                        pressSequentially: async (text: string, _options?: any) => {
                            // Simulate typing by inserting text via fill
                            const params: any = { value: text };
                            if (opts.selector) params.selector = opts.selector;
                            if (taskKey) params.taskKey = taskKey;
                            const result = await self._bridgeSend('fill', params, undefined, _options?.signal);
                            if (!result.success) throw new Error(result.error);
                        },
                        screenshot: async (options?: any) => {
                            // Element screenshots fall back to full page
                            const result = await self._bridgeSend('screenshot', {
                                fullPage: options?.fullPage,
                                ...attachTaskKey({}),
                            }, undefined, options?.signal);
                            if (!result.success) throw new Error(result.error);
                            return Buffer.from(result.result.base64, 'base64');
                        },
                        waitFor: async (options?: any) => {
                            if (opts.selector) {
                                const result = await self._bridgeSend('waitForSelector', {
                                    selector: opts.selector,
                                    timeout: options?.timeout,
                                    state: options?.state,
                                    ...attachTaskKey({}),
                                }, undefined, options?.signal);
                                if (!result.success) throw new Error(result.error);
                            }
                        },
                        setInputFiles: async (files: string | string[]) => {
                            const result = await self._bridgeSend('uploadFile', {
                                selector: opts.selector || 'input[type="file"]',
                                filePath: Array.isArray(files) ? files[0] : files,
                                ...attachTaskKey({}),
                            });
                            if (!result.success) throw new Error(result.error);
                        },
                        count: async () => {
                            if (opts.selector) {
                                try {
                                    const result = await self._bridgeSend('executeScript', {
                                        script: `document.querySelectorAll('${opts.selector.replace(/'/g, "\\'")}').length`,
                                        ...attachTaskKey({}),
                                    });
                                    return result.success ? (result.result?.result || 0) : 0;
                                } catch { return 0; }
                            }
                            return 1; // Text-based locators assume at least 1
                        },
                        first: () => loc, // .first() returns the same locator
                        // Allow .or() chaining for compound locators
                        or: (other: any) => {
                            // Return a combined locator that tries self first, then other
                            const combined: any = { ...loc };
                            combined.click = async (options?: any) => {
                                try { await loc.click(options); }
                                catch { await other.click(options); }
                            };
                            combined.fill = async (value: string, options?: any) => {
                                try { await loc.fill(value, options); }
                                catch { await other.fill(value, options); }
                            };
                            combined.first = () => combined;
                            combined.or = (another: any) => loc.or.call(combined, another);
                            return combined;
                        },
                    };
                    return loc;
                }

                return {
                    // page.getByText(text, options?) -> Locator
                    getByText: (text: string, _options?: any) => createLocator({ text }),
                    // page.getByRole(role, options?) -> Locator
                    getByRole: (role: string, options?: any) => {
                        const name = options?.name;
                        // Map role+name to a CSS selector approximation
                        const selector = name
                            ? `[role="${role}"][aria-label*="${name}"], ${role}:has-text("${name}")`
                            : `[role="${role}"]`;
                        return createLocator({ selector });
                    },
                    // page.getByLabel(text) -> Locator
                    getByLabel: (text: string) => createLocator({ text }),
                    // page.getByPlaceholder(text) -> Locator
                    // Maps to CSS selector matching placeholder, aria-placeholder, and data-placeholder attrs
                    getByPlaceholder: (text: string, _options?: any) => {
                        const escaped = text.replace(/"/g, '\\"');
                        return createLocator({
                            selector: `[placeholder*="${escaped}"], [aria-placeholder*="${escaped}"], [data-placeholder*="${escaped}"], [contenteditable][aria-label*="${escaped}"]`
                        });
                    },
                    // page.locator(selector) -> Locator
                    locator: (selector: string) => createLocator({ selector }),
                    // page.fill(selector, value) — direct shorthand
                    fill: async (selector: string, value: string, options?: any) => {
                        const result = await self._bridgeSend('fill', {
                            selector,
                            value,
                            timeout: options?.timeout,
                            ...attachTaskKey({}),
                        });
                        if (!result.success) throw new Error(result.error);
                    },
                };
            })(),

            // Playwright-compatible querySelector shorthand: page.$()
            $: async (selector: string) => {
                try {
                    const result = await self._bridgeSend('executeScript', {
                        script: `(() => {
                            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                            return el ? true : false;
                        })()`,
                        ...attachTaskKey({}),
                    });
                    if (!result.success) return null;
                    return result.result?.result ? { _exists: true } : null;
                } catch {
                    return null;
                }
            },
            // Playwright-compatible querySelectorAll shorthand: page.$$()
            $$: async (selector: string) => {
                try {
                    const result = await self._bridgeSend('executeScript', {
                        script: `(() => {
                            return document.querySelectorAll('${selector.replace(/'/g, "\\'")}').length;
                        })()`,
                        ...attachTaskKey({}),
                    });
                    if (!result.success) return [];
                    const count = result.result?.result || 0;
                    return Array(count).fill({ _exists: true });
                } catch {
                    return [];
                }
            },
            keyboard: {
                insertText: async (text: string) => {
                    const result = await self._bridgeSend('fill', attachTaskKey({ value: text }));
                    if (!result.success) throw new Error(result.error);
                },
                press: async (key: string) => {
                    const result = await self._bridgeSend('executeScript', {
                        script: `document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`,
                        ...attachTaskKey({}),
                    });
                    if (!result.success) throw new Error(result.error);
                },
            },
            viewportSize: () => ({ width: 1920, height: 1080 }),
            waitForEvent: async (_event: string, _options?: any) => {
                // Stub - bridge doesn't support waitForEvent directly
                throw new Error('waitForEvent not supported via bridge');
            },
            close: async () => {},
        };
    }

    /**
     * Find Node.js executable path on the system.
     */
    private async _resolveNodePath(): Promise<string | null> {
        const bundledNode = resolveBundledNodePath();
        if (bundledNode) {
            return bundledNode;
        }

        const { execSync } = await import('child_process');
        try {
            const lookup = process.platform === 'win32' ? 'where node' : 'which node';
            const result = execSync(lookup, { encoding: 'utf-8', timeout: 5000 }).trim();
            const firstLine = result.split('\n')[0].trim();
            if (firstLine && fs.existsSync(firstLine)) {
                return firstLine;
            }
        } catch {}

        // Check common install paths.
        const commonPaths = process.platform === 'win32'
            ? [
                'C:\\Program Files\\nodejs\\node.exe',
                'C:\\Program Files (x86)\\nodejs\\node.exe',
            ]
            : [
                '/opt/homebrew/bin/node',
                '/usr/local/bin/node',
                '/usr/bin/node',
            ];

        for (const p of commonPaths) {
            if (fs.existsSync(p)) return p;
        }

        return null;
    }

    // ========================================================================
    // CDP Port & Process Management
    // ========================================================================

    /**
     * Check if a CDP endpoint is already responding on the given port.
     */
    private async _isCdpAvailable(port: number): Promise<boolean> {
        try {
            const resp = await fetch(`http://localhost:${port}/json/version`, {
                signal: AbortSignal.timeout(2000),
            });
            return resp.ok;
        } catch {
            return false;
        }
    }

    /**
     * Clean up stale Chrome lock files that prevent a new instance from starting.
     * These files are left behind if Chrome crashes or is force-killed.
     */
    private _cleanStaleLocks(userDataDir: string): void {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        for (const lockFile of lockFiles) {
            const lockPath = path.join(userDataDir, lockFile);
            try {
                fs.unlinkSync(lockPath);
                console.error(`[PlaywrightBackend] Removed stale lock: ${lockPath}`);
            } catch {
                // File doesn't exist or can't be removed — fine
            }
        }

        // Also clean up the Default profile's lock if it exists
        const defaultLock = path.join(userDataDir, 'Default', 'lockfile');
        try {
            fs.unlinkSync(defaultLock);
            console.error(`[PlaywrightBackend] Removed stale profile lock: ${defaultLock}`);
        } catch {}
    }

    /**
     * Kill the process that is listening on a specific port.
     * This is more targeted than killing all Chrome processes —
     * it only kills the process that occupies the debug port.
     */
    private async _killProcessOnPort(port: number): Promise<void> {
        const { execSync } = await import('child_process');
        const isWindows = process.platform === 'win32';

        try {
            if (isWindows) {
                // Find PID using the port
                const output = execSync(
                    `netstat -ano | findstr :${port} | findstr LISTENING`,
                    { encoding: 'utf-8', timeout: 5000 }
                ).trim();

                // Extract PIDs from netstat output
                const pids = new Set<string>();
                for (const line of output.split('\n')) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && /^\d+$/.test(pid) && pid !== '0') {
                        pids.add(pid);
                    }
                }

                for (const pid of pids) {
                    try {
                        // Use /F (force) but NOT /T (tree kill) to avoid killing
                        // other Chrome instances that share the process tree.
                        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
                        console.error(`[PlaywrightBackend] Killed process ${pid} on port ${port}`);
                    } catch {
                        console.error(`[PlaywrightBackend] Failed to kill PID ${pid}`);
                    }
                }
            } else {
                // Linux/macOS: use lsof to find PID
                try {
                    const output = execSync(`lsof -ti:${port}`, { encoding: 'utf-8', timeout: 5000 }).trim();
                    for (const pid of output.split('\n')) {
                        if (pid.trim()) {
                            execSync(`kill -9 ${pid.trim()}`, { stdio: 'ignore', timeout: 5000 });
                            console.error(`[PlaywrightBackend] Killed process ${pid.trim()} on port ${port}`);
                        }
                    }
                } catch {
                    // lsof/kill might fail — that's ok
                }
            }
        } catch (error) {
            console.error(`[PlaywrightBackend] Could not kill process on port ${port}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Kill Chrome processes launched by our CDP attempts (identifiable by the
     * CoworkAny profile directory). This is more targeted than killing ALL
     * Chrome — it only kills the ones we spawned.
     */
    private async _killChromeByProfileDir(): Promise<void> {
        const { execSync } = await import('child_process');
        const isWindows = process.platform === 'win32';

        try {
            if (isWindows) {
                // Find Chrome processes with our CoworkAny profile dir in their command line
                const output = execSync(
                    'wmic process where "name=\'chrome.exe\'" get ProcessId,CommandLine /format:csv 2>nul',
                    { encoding: 'utf-8', timeout: 10000 }
                );

                const coworkanyPids: string[] = [];
                for (const line of output.split('\n')) {
                    if (line.includes('CoworkAny') && line.includes('ChromeProfile')) {
                        const parts = line.trim().split(',');
                        const pid = parts[parts.length - 1]?.trim();
                        if (pid && /^\d+$/.test(pid)) {
                            coworkanyPids.push(pid);
                        }
                    }
                }

                if (coworkanyPids.length > 0) {
                    console.error(`[PlaywrightBackend] Killing ${coworkanyPids.length} CoworkAny Chrome processes`);
                    for (const pid of coworkanyPids) {
                        try {
                            execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore', timeout: 5000 });
                        } catch {}
                    }
                } else {
                    console.error('[PlaywrightBackend] No CoworkAny Chrome processes found to kill');
                }
            } else {
                execSync("pkill -f 'CoworkAny.*ChromeProfile' || true", { stdio: 'ignore', timeout: 5000 });
            }
        } catch (error) {
            // Don't fall back to port-based kill — that would kill the user's
            // Chrome browser (e.g., on port 9224 started by the test fixture).
            // Only CoworkAny-launched Chrome should be cleaned up.
            console.error(`[PlaywrightBackend] Profile-based kill failed (non-critical): ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Kill all Chrome processes. Only used as an internal last resort,
     * NOT called during normal connect flow to avoid disrupting user's browser.
     * @deprecated Prefer _killChromeByProfileDir for targeted cleanup
     */
    private async _killChromeProcesses(): Promise<void> {
        const { execSync } = await import('child_process');
        const isWindows = process.platform === 'win32';
        try {
            if (isWindows) {
                execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' });
            } else {
                execSync("pkill -f 'Google Chrome' || pkill -f chrome || true", { stdio: 'ignore' });
            }
            console.error('[PlaywrightBackend] Chrome processes killed');
        } catch {
            console.error('[PlaywrightBackend] No Chrome processes to kill (or kill failed)');
        }
    }

    async disconnect(): Promise<void> {
        if (this.connection) {
            console.error('[PlaywrightBackend] Disconnecting from browser');
            try {
                const basePage = this.connection.page;
                for (const [, taskPage] of this.taskPages) {
                    if (taskPage === basePage) {
                        continue;
                    }
                    if ((taskPage as any)?._isBridgeProxy) {
                        continue;
                    }
                    if (typeof (taskPage as any)?.close === 'function' && !this.isPageClosed(taskPage)) {
                        await (taskPage as any).close({ runBeforeUnload: false }).catch(() => {});
                    }
                }
                this.taskPages.clear();

                // If we used launchPersistentContext (browser is null), close the context
                if (!this.connection.browser) {
                    await this.connection.context.close();
                } else {
                    // For CDP connections, just disconnect (don't close the browser)
                    await this.connection.browser.close();
                }
                // Ensure any dedicated CoworkAny Chrome profile processes are cleaned
                // up after disconnect to avoid lingering extra instances in test runs.
                await this._killChromeByProfileDir().catch((error) => {
                    console.error(
                        `[PlaywrightBackend] Post-disconnect profile cleanup failed (non-critical): ${error instanceof Error ? error.message : String(error)}`
                    );
                });
            } catch (error) {
                console.error('[PlaywrightBackend] Error closing:', error);
            }

            // Kill the bridge process if it exists
            if (this._bridgeProcess) {
                try {
                    this._bridgeProcess.kill();
                    console.error('[PlaywrightBackend] Killed bridge process');
                } catch {}
                this._bridgeProcess = null;
            }

            this.connection = null;
            this._activeCdpPort = null;
            console.error('[PlaywrightBackend] Disconnected');
        }
    }

    /**
     * Get the CDP port currently in use (null if using persistent context fallback).
     */
    getActiveCdpPort(): number | null {
        return this._activeCdpPort;
    }

    getConnection(): BrowserConnection | null {
        return this.connection;
    }

    private normalizeTaskKey(taskId?: string): string | null {
        if (!taskId) return null;
        const normalized = taskId.trim();
        return normalized.length > 0 ? normalized : null;
    }

    private isPageClosed(page: Page): boolean {
        try {
            if (typeof (page as any)?.isClosed === 'function') {
                return Boolean((page as any).isClosed());
            }
            return false;
        } catch {
            return false;
        }
    }

    private async getOrCreateTaskPage(taskKey: string): Promise<Page> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }

        const existing = this.taskPages.get(taskKey);
        if (existing && !this.isPageClosed(existing)) {
            return existing;
        }

        const basePage = this.connection.page;
        if ((basePage as any)?._isBridgeProxy) {
            const taskScopedBridgePage = this._createBridgePageProxy(taskKey) as unknown as Page;
            this.taskPages.set(taskKey, taskScopedBridgePage);
            return taskScopedBridgePage;
        }

        const nextPage = await this.connection.context.newPage();
        this.taskPages.set(taskKey, nextPage);
        return nextPage;
    }

    async getPage(taskId?: string): Promise<Page> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }

        const taskKey = this.normalizeTaskKey(taskId);
        if (!taskKey) {
            return this.connection.page;
        }

        return this.getOrCreateTaskPage(taskKey);
    }

    async navigate(url: string, options: NavigateOptions = {}): Promise<NavigateResult> {
        const page = await this.getPage(options.taskId);
        if ((page as any)?._isBridgeProxy) {
            // Bridge handles SPA hydration and retry logic internally.
            const { waitUntil = 'domcontentloaded', timeout = 30000, signal } = options;
            await (page as any).goto(url, { waitUntil, timeout, signal });
            const navMeta = (page as any).__lastNavMeta || {};
            return {
                url: page.url(),
                title: await page.title(),
                warning: navMeta?.xTransientError ? 'x_transient_error_detected' : undefined,
            };
        }
        const { waitUntil = 'domcontentloaded', timeout = 30000, signal } = options;

        console.error(`[PlaywrightBackend] Navigating to: ${url}`);
        await this.runAbortablePageAction(
            page,
            signal,
            () => page.goto(url, { waitUntil, timeout }).then(() => undefined)
        );

        const title = await page.title();
        const finalUrl = page.url();

        // ── SPA readiness check ─────────────────────────────────────
        // Many modern sites (X, Facebook, etc.) are SPAs that render with JS.
        // After initial navigation, check if the page has meaningful content.
        // If not, wait for SPA hydration (up to 10s).
        let isSpaReady = true;
        // Use string-based evaluate to avoid TypeScript DOM lib requirement
        const getBodyTextScript = `(() => { try { return (document.body && document.body.innerText || '').trim(); } catch(e) { return ''; } })()`;
        try {
            const bodyText = await page.evaluate(getBodyTextScript) as string;
            const bodyLen = (bodyText || '').length;

            // Detect common SPA-not-ready patterns
            const spaNotReady =
                bodyLen < 50 ||
                bodyText.includes('JavaScript is not available') ||
                bodyText.includes('Enable JavaScript') ||
                bodyText.includes('You need to enable JavaScript') ||
                (bodyText.includes('noscript') && bodyLen < 200);

            if (spaNotReady) {
                isSpaReady = false;
                console.error(`[PlaywrightBackend] SPA not ready (bodyLen=${bodyLen}). Waiting for hydration...`);

                // Wait for SPA frameworks to render (check every 1s, up to 10s)
                for (let i = 0; i < 10; i++) {
                    await delay(1000, signal);
                    const newBodyText = await this.runAbortablePageAction(
                        page,
                        signal,
                        () => page.evaluate(getBodyTextScript) as Promise<string>
                    );
                    const newLen = (newBodyText || '').length;

                    if (newLen > 200 && !newBodyText.includes('JavaScript is not available')) {
                        console.error(`[PlaywrightBackend] SPA hydrated after ${i + 1}s (bodyLen=${newLen})`);
                        isSpaReady = true;
                        break;
                    }
                }

                if (!isSpaReady) {
                    // Last resort: try networkidle wait
                    console.error(`[PlaywrightBackend] SPA still not ready. Trying networkidle...`);
                    try {
                        await this.runAbortablePageAction(
                            page,
                            signal,
                            () => page.waitForLoadState('networkidle', { timeout: 10000 })
                        );
                        const finalBodyText = await this.runAbortablePageAction(
                            page,
                            signal,
                            () => page.evaluate(getBodyTextScript) as Promise<string>
                        );
                        if ((finalBodyText || '').length > 200) {
                            isSpaReady = true;
                            console.error(`[PlaywrightBackend] SPA ready after networkidle (bodyLen=${(finalBodyText || '').length})`);
                        }
                    } catch {
                        console.error(`[PlaywrightBackend] networkidle wait timed out`);
                    }
                }
            }
        } catch (e) {
            console.error(`[PlaywrightBackend] SPA readiness check error: ${e instanceof Error ? e.message : String(e)}`);
        }

        const updatedTitle = await page.title();
        const updatedUrl = page.url();

        console.error(`[PlaywrightBackend] Navigation complete: ${updatedTitle} (spaReady=${isSpaReady})`);
        return {
            url: updatedUrl,
            title: updatedTitle,
            ...(isSpaReady ? {} : { warning: 'Page may not be fully rendered. SPA hydration incomplete. Try wait_until="networkidle" or wait longer.' }),
        };
    }

    async click(options: ClickOptions): Promise<ClickResult> {
        const page = await this.getPage(options.taskId);
        const { selector, text, timeout = 10000, signal, taskId } = options;

        if ((page as any)?._isBridgeProxy) {
            const result = await this._bridgeSend('click', { selector, text, timeout, ...(taskId ? { taskKey: taskId } : {}) }, undefined, signal);
            if (!result.success) {
                throw new Error(result.error);
            }
            return { clicked: text ? `text="${text}"` : (selector || 'bridge-click') };
        }

        if (text) {
            console.error(`[PlaywrightBackend] Clicking element with text: ${text}`);

            // Strategy 1: getByText (most common — visible text content)
            try {
                await this.runAbortablePageAction(
                    page,
                    signal,
                    () => page.getByText(text, { exact: false }).first().click({ timeout })
                );
                return { clicked: `text="${text}"` };
            } catch (e: any) {
                console.error(`[PlaywrightBackend] getByText failed: ${e.message?.substring(0, 100)}`);
            }

            // Strategy 2: getByPlaceholder (for input/textarea/contenteditable placeholders)
            // X.com's tweet box uses "What's happening?" as a placeholder, not text content.
            try {
                console.error(`[PlaywrightBackend] Trying getByPlaceholder("${text}")`);
                await this.runAbortablePageAction(
                    page,
                    signal,
                    () => page.getByPlaceholder(text, { exact: false }).first().click({ timeout: 5000 })
                );
                return { clicked: `placeholder="${text}"` };
            } catch (e: any) {
                console.error(`[PlaywrightBackend] getByPlaceholder failed: ${e.message?.substring(0, 100)}`);
            }

            // Strategy 3: getByRole textbox with name matching text
            try {
                console.error(`[PlaywrightBackend] Trying getByRole("textbox", {name: "${text}"})`);
                await this.runAbortablePageAction(
                    page,
                    signal,
                    () => page.getByRole('textbox', { name: text }).first().click({ timeout: 5000 })
                );
                return { clicked: `role=textbox[name="${text}"]` };
            } catch (e: any) {
                console.error(`[PlaywrightBackend] getByRole textbox failed: ${e.message?.substring(0, 100)}`);
            }

            // Strategy 4: JavaScript DOM search — text, placeholder, aria-label, data-testid
            console.error(`[PlaywrightBackend] Trying JS fallback click for: ${text}`);
            const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const jsClickScript = `(function() {
                var targetText = '${escapedText}';
                var lowerTarget = targetText.toLowerCase();

                function fireClick(el) {
                    var events = ['mousedown', 'mouseup', 'click'];
                    for (var e = 0; e < events.length; e++) {
                        el.dispatchEvent(new MouseEvent(events[e], {bubbles:true,cancelable:true,view:window}));
                    }
                }

                // A: Match placeholder attribute (common for SPA input/textarea/contenteditable)
                var placeholderEls = document.querySelectorAll('[placeholder]');
                for (var i = 0; i < placeholderEls.length; i++) {
                    var ph = placeholderEls[i].getAttribute('placeholder') || '';
                    if (ph.toLowerCase().includes(lowerTarget)) {
                        placeholderEls[i].scrollIntoView({behavior:'instant',block:'center'});
                        placeholderEls[i].focus();
                        fireClick(placeholderEls[i]);
                        return 'js-placeholder: ' + placeholderEls[i].tagName;
                    }
                }

                // B: Match aria-label or aria-placeholder (X uses these for contenteditable)
                var ariaEls = document.querySelectorAll('[aria-label], [aria-placeholder], [contenteditable]');
                for (var i = 0; i < ariaEls.length; i++) {
                    var label = (ariaEls[i].getAttribute('aria-label') || '') +
                                (ariaEls[i].getAttribute('aria-placeholder') || '') +
                                (ariaEls[i].getAttribute('data-placeholder') || '');
                    if (label.toLowerCase().includes(lowerTarget)) {
                        ariaEls[i].scrollIntoView({behavior:'instant',block:'center'});
                        ariaEls[i].focus();
                        fireClick(ariaEls[i]);
                        return 'js-aria: ' + ariaEls[i].tagName + '.' + ariaEls[i].className.substring(0, 50);
                    }
                }

                // C: Match data-testid containing relevant keywords
                var testIds = document.querySelectorAll('[data-testid*="tweetTextarea"], [data-testid*="tweet"], [data-testid*="compose"]');
                if (testIds.length > 0) {
                    testIds[0].scrollIntoView({behavior:'instant',block:'center'});
                    testIds[0].focus();
                    fireClick(testIds[0]);
                    return 'js-testid: ' + testIds[0].getAttribute('data-testid');
                }

                // D: Exact text match on leaf nodes (original strategy)
                var allElements = document.querySelectorAll('*');
                for (var i = 0; i < allElements.length; i++) {
                    var el = allElements[i];
                    var tag = el.tagName.toLowerCase();
                    if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style') continue;
                    if (el.textContent && el.textContent.trim() === targetText && el.children.length === 0) {
                        el.scrollIntoView({behavior:'instant',block:'center'});
                        fireClick(el);
                        if (el.parentElement) fireClick(el.parentElement);
                        return 'js-text: ' + el.tagName + '.' + el.className;
                    }
                }

                // E: Text match on elements with few children
                for (var i = 0; i < allElements.length; i++) {
                    var el = allElements[i];
                    var tag = el.tagName.toLowerCase();
                    if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style' || tag === 'main' || tag === 'section' || tag === 'article') continue;
                    if (el.textContent && el.textContent.trim() === targetText && el.children.length <= 2) {
                        el.scrollIntoView({behavior:'instant',block:'center'});
                        fireClick(el);
                        if (el.parentElement) fireClick(el.parentElement);
                        return 'js-parent: ' + el.tagName + '.' + el.className;
                    }
                }
                return null;
            })()`;
            const jsClicked = await this.runAbortablePageAction(
                page,
                signal,
                () => page.evaluate(jsClickScript)
            );
            if (jsClicked) {
                return { clicked: jsClicked as string };
            }

            throw new Error(`Could not find clickable element matching "${text}". Tried: getByText, getByPlaceholder, getByRole, JS DOM search (placeholder, aria-label, data-testid, textContent).`);
        }

        if (selector) {
            console.error(`[PlaywrightBackend] Clicking selector: ${selector}`);
            try {
                await this.runAbortablePageAction(page, signal, () => page.click(selector, { timeout }));
            } catch (e: any) {
                if (e.message?.includes('outside of the viewport') || e.message?.includes('Timeout')) {
                    console.error(`[PlaywrightBackend] Normal click failed, trying force click for selector: ${selector}`);
                    await this.runAbortablePageAction(page, signal, () => page.click(selector, { force: true, timeout: 5000 }));
                }
                else throw e;
            }
            return { clicked: selector };
        }

        throw new Error('Either selector or text must be provided');
    }

    async fill(options: FillOptions): Promise<FillResult> {
        const page = await this.getPage(options.taskId);
        const { selector, value, clearFirst = true, signal, taskId } = options;

        if ((page as any)?._isBridgeProxy) {
            const result = await this._bridgeSend('fill', {
                selector,
                value,
                clearFirst,
                timeout: 10000,
                ...(taskId ? { taskKey: taskId } : {}),
            }, undefined, signal);
            if (!result.success) {
                throw new Error(result.error);
            }
            return { filled: selector, value };
        }

        console.error(`[PlaywrightBackend] Filling ${selector} with value`);

        if (clearFirst) {
            await this.runAbortablePageAction(page, signal, () => page.fill(selector, value));
        } else {
            await this.runAbortablePageAction(page, signal, () => page.locator(selector).pressSequentially(value));
        }

        return { filled: selector, value };
    }

    async screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
        const page = await this.getPage(options.taskId);
        const { selector, fullPage = false, signal, taskId } = options;

        if ((page as any)?._isBridgeProxy) {
            const result = await this._bridgeSend('screenshot', {
                selector,
                fullPage,
                ...(taskId ? { taskKey: taskId } : {}),
            }, undefined, signal);
            if (!result.success) {
                throw new Error(result.error);
            }
            return {
                base64: result.result.base64,
                width: result.result.width || 1280,
                height: result.result.height || 720,
            };
        }

        console.error(`[PlaywrightBackend] Taking screenshot${selector ? ` of ${selector}` : ''}`);

        let buffer: Buffer;
        if (selector) {
            buffer = await this.runAbortablePageAction(page, signal, () => page.locator(selector).screenshot());
        } else {
            buffer = await this.runAbortablePageAction(page, signal, () => page.screenshot({ fullPage }));
        }

        const viewport = page.viewportSize();
        return {
            base64: buffer.toString('base64'),
            width: viewport?.width || 1280,
            height: viewport?.height || 720,
        };
    }

    async wait(options: WaitOptions): Promise<WaitResult> {
        const page = await this.getPage(options.taskId);
        const { selector, state = 'visible', timeout = 30000, signal, taskId } = options;

        if ((page as any)?._isBridgeProxy) {
            const result = await this._bridgeSend('waitForSelector', {
                selector,
                state,
                timeout,
                ...(taskId ? { taskKey: taskId } : {}),
            }, undefined, signal);
            if (!result.success) {
                return { found: false, selector };
            }
            return { found: true, selector };
        }

        console.error(`[PlaywrightBackend] Waiting for ${selector} to be ${state}`);

        try {
            await this.runAbortablePageAction(page, signal, () => page.locator(selector).waitFor({ state, timeout }));
            return { found: true, selector };
        } catch (error) {
            console.error(`[PlaywrightBackend] Wait timeout for ${selector}`);
            return { found: false, selector };
        }
    }

    async getContent(asText: boolean = true, control?: BrowserOperationControl): Promise<ContentResult> {
        const page = await this.getPage(control?.taskId);
        const signal = control?.signal;

        if ((page as any)?._isBridgeProxy) {
            const result = await this._bridgeSend('getContent', {
                ...(control?.taskId ? { taskKey: control.taskId } : {}),
            }, undefined, signal);
            if (!result.success) {
                throw new Error(result.error);
            }
            return {
                content: String(result.result.content || '').slice(0, 100000),
                url: page.url(),
                title: await page.title(),
            };
        }

        const content = asText
            ? await this.runAbortablePageAction(page, signal, () => page.innerText('body'))
            : await this.runAbortablePageAction(page, signal, () => page.content());

        return {
            content: content.slice(0, 100000),
            url: page.url(),
            title: await this.runAbortablePageAction(page, signal, () => page.title()),
        };
    }

    async executeScript<T>(script: string, control?: BrowserOperationControl): Promise<T> {
        const page = await this.getPage(control?.taskId);
        console.error('[PlaywrightBackend] Executing script in page context');
        if ((page as any)?._isBridgeProxy) {
            const result = await this._bridgeSend('executeScript', {
                script,
                ...(control?.taskId ? { taskKey: control.taskId } : {}),
            }, undefined, control?.signal);
            if (!result.success) {
                throw new Error(result.error);
            }
            return result.result?.result as T;
        }
        return await this.runAbortablePageAction(page, control?.signal, () => page.evaluate(script));
    }

    async uploadFile(options: UploadFileOptions): Promise<UploadResult> {
        const page = await this.getPage(options.taskId);
        const { selector, filePath, signal, taskId } = options;

        if ((page as any)?._isBridgeProxy) {
            const result = await this._bridgeSend('uploadFile', {
                selector,
                filePath,
                ...(taskId ? { taskKey: taskId } : {}),
            }, undefined, signal);
            if (!result.success) {
                throw new Error(result.error);
            }
            return {
                success: true,
                message: `File uploaded${selector ? ` via selector: ${selector}` : ''}`,
            };
        }

        console.error(`[PlaywrightBackend] Uploading file: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            return { success: false, message: 'File not found', error: `File does not exist: ${filePath}` };
        }

        try {
            if (selector) {
                // Direct upload via file input selector
                await this.runAbortablePageAction(page, signal, () => page.locator(selector).setInputFiles(filePath));
                return { success: true, message: `File uploaded via selector: ${selector}` };
            }

            // Try to find a file input on the page
            const fileInput = page.locator('input[type="file"]').first();
            const count = await this.runAbortablePageAction(page, signal, () => fileInput.count());
            if (count > 0) {
                await this.runAbortablePageAction(page, signal, () => fileInput.setInputFiles(filePath));
                return { success: true, message: 'File uploaded via detected file input' };
            }

            // Use filechooser event: click the first likely upload trigger
            const uploadResult = await new Promise<UploadResult>(async (resolve) => {
                const fileChooserPromise = this.runAbortablePageAction(
                    page,
                    signal,
                    () => page.waitForEvent('filechooser', { timeout: 10000 })
                );

                // Try clicking common upload button patterns
                const uploadButton = page.locator(
                    'button:has-text("upload"), button:has-text("上传"), ' +
                    'button:has-text("选择文件"), button:has-text("Choose"), ' +
                    '[class*="upload"], [data-testid*="upload"]'
                ).first();

                const btnCount = await this.runAbortablePageAction(page, signal, () => uploadButton.count());
                if (btnCount > 0) {
                    await this.runAbortablePageAction(page, signal, () => uploadButton.click());
                }

                try {
                    const fileChooser = await fileChooserPromise;
                    await this.runAbortablePageAction(page, signal, () => fileChooser.setFiles(filePath));
                    resolve({ success: true, message: 'File uploaded via file chooser dialog' });
                } catch {
                    resolve({
                        success: false,
                        message: 'Could not find upload target',
                        error: 'No file input, upload button, or file chooser dialog found. Try providing a CSS selector or use smart mode.',
                    });
                }
            });

            return uploadResult;
        } catch (error) {
            return {
                success: false,
                message: 'Upload failed',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}

// ============================================================================
// BrowserUseBackend - Smart Mode (HTTP client to browser-use-service)
// ============================================================================

/**
 * Browser-use backend that delegates to the Python browser-use-service via HTTP.
 * Provides AI-driven browser automation with visual understanding.
 */
export class BrowserUseBackend implements BrowserBackend {
    readonly name = 'browser-use';
    private serviceUrl: string;
    private connected: boolean = false;

    constructor(serviceUrl: string = 'http://localhost:8100') {
        this.serviceUrl = serviceUrl;
    }

    /**
     * Check if the browser-use-service is healthy
     */
    async isServiceAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.serviceUrl}/health`, {
                signal: AbortSignal.timeout(3000),
            });
            if (!response.ok) return false;
            const data = await response.json() as { status: string };
            return data.status === 'ok';
        } catch {
            return false;
        }
    }

    private async post<T>(
        endpoint: string,
        body: Record<string, unknown> = {},
        options: { signal?: AbortSignal; timeoutMs?: number } = {}
    ): Promise<T> {
        const url = `${this.serviceUrl}${endpoint}`;
        console.error(`[BrowserUseBackend] POST ${url}`);

        const timeoutMs = options.timeoutMs ?? 120000;
        const { signal, cleanup } = createTimedAbortSignal(timeoutMs, options.signal);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`browser-use-service error (${response.status}): ${text}`);
            }

            return await response.json() as T;
        } finally {
            cleanup();
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async connect(options: ConnectOptions = {}): Promise<BrowserConnection> {
        const result = await this.post<{ success: boolean; message: string; profile: string }>('/connect', {
            profile_name: options.profileName || 'Default',
            headless: options.headless ?? false,
            // Pass CDP URL so browser-use connects to the same Chrome instance as Playwright
            // This avoids Chrome profile lock conflicts (Risk Mitigation: Chrome profile 互斥)
            ...(options.cdpUrl ? { cdp_url: options.cdpUrl } : {}),
        }, {
            signal: options.signal,
            timeoutMs: 30000,
        });

        if (!result.success) {
            throw new Error(`BrowserUse connect failed: ${result.message}`);
        }

        this.connected = true;

        // Return a synthetic BrowserConnection (no actual Playwright objects)
        return {
            browser: null,
            context: null as unknown as BrowserContext,
            page: null as unknown as Page,
            isUserProfile: true,
            profilePath: getChromeUserDataDir(),
        };
    }

    async disconnect(): Promise<void> {
        try {
            await this.post('/disconnect');
        } catch (error) {
            console.error('[BrowserUseBackend] Disconnect error:', error);
        }
        this.connected = false;
    }

    async navigate(url: string, options: NavigateOptions = {}): Promise<NavigateResult> {
        const result = await this.post<{ success: boolean; url: string; title: string; error?: string }>('/navigate', {
            url,
            wait_until: options.waitUntil || 'domcontentloaded',
            timeout_ms: options.timeout || 30000,
            ...(options.taskId ? { task_key: options.taskId } : {}),
        }, {
            signal: options.signal,
            timeoutMs: (options.timeout || 30000) + 10000,
        });

        if (!result.success) {
            throw new Error(result.error || 'Navigate failed');
        }

        return { url: result.url, title: result.title };
    }

    async click(options: ClickOptions): Promise<ClickResult> {
        const instruction = options.text
            ? `click the element containing text "${options.text}"`
            : options.selector
                ? `click the element matching selector "${options.selector}"`
                : 'click the most relevant interactive element';

        const result = await this.post<{ success: boolean; result?: string; error?: string }>('/click', {
            instruction,
            selector: options.selector,
            ...(options.taskId ? { task_key: options.taskId } : {}),
        }, {
            signal: options.signal,
        });

        if (!result.success) {
            throw new Error(result.error || 'Click failed');
        }

        return { clicked: options.text ? `text="${options.text}"` : (options.selector || 'ai-detected') };
    }

    async fill(options: FillOptions): Promise<FillResult> {
        const result = await this.post<{ success: boolean; result?: string; error?: string }>('/fill', {
            instruction: `type "${options.value}" into the field matching selector "${options.selector}"`,
            selector: options.selector,
            value: options.value,
            ...(options.taskId ? { task_key: options.taskId } : {}),
        }, {
            signal: options.signal,
        });

        if (!result.success) {
            throw new Error(result.error || 'Fill failed');
        }

        return { filled: options.selector, value: options.value };
    }

    async screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
        const result = await this.post<{
            success: boolean;
            image_base64: string;
            width: number;
            height: number;
            error?: string;
        }>('/screenshot', {
            ...(options.taskId ? { task_key: options.taskId } : {}),
        }, {
            signal: options.signal,
        });

        if (!result.success) {
            throw new Error(result.error || 'Screenshot failed');
        }

        return {
            base64: result.image_base64,
            width: result.width,
            height: result.height,
        };
    }

    async wait(options: WaitOptions): Promise<WaitResult> {
        // browser-use doesn't have a direct wait equivalent,
        // fall back to a small delay + screenshot check
        console.error(`[BrowserUseBackend] Wait for ${options.selector} - using delay-based approach`);

        const timeout = options.timeout || 30000;
        const start = Date.now();
        const interval = 2000;

        while (Date.now() - start < timeout) {
            try {
                // Ask the AI to check if element is present
                const result = await this.post<{ success: boolean; result?: string; error?: string }>('/action', {
                    action: `Check if an element matching "${options.selector}" is ${options.state || 'visible'} on the page. Reply with just "yes" or "no".`,
                    ...(options.taskId ? { task_key: options.taskId } : {}),
                }, {
                    signal: options.signal,
                    timeoutMs: interval + 5000,
                });

                if (result.success && result.result?.toLowerCase().includes('yes')) {
                    return { found: true, selector: options.selector };
                }
            } catch {
                // Ignore errors during polling
            }

            await delay(interval, options.signal);
        }

        return { found: false, selector: options.selector };
    }

    async getContent(asText: boolean = true, control?: BrowserOperationControl): Promise<ContentResult> {
        const result = await this.post<{
            success: boolean;
            content: string;
            url: string;
            title: string;
            error?: string;
        }>(`/content?as_text=${asText}`, {
            ...(control?.taskId ? { task_key: control.taskId } : {}),
        }, {
            signal: control?.signal,
            timeoutMs: 30000,
        });

        if (!result.success) {
            throw new Error(result.error || 'Get content failed');
        }

        return { content: result.content, url: result.url, title: result.title };
    }

    async executeScript<T>(script: string, control?: BrowserOperationControl): Promise<T> {
        // browser-use doesn't expose direct script execution
        // Fall back to extracting via AI or throw
        console.error('[BrowserUseBackend] executeScript not directly supported, attempting via action');
        const result = await this.post<{ success: boolean; result?: string; error?: string }>('/action', {
            action: `Execute this JavaScript in the page console and report the result: ${script}`,
            ...(control?.taskId ? { task_key: control.taskId } : {}),
        }, {
            signal: control?.signal,
        });

        if (!result.success) {
            throw new Error(result.error || 'Script execution not supported in smart mode');
        }

        // Try to parse as JSON, otherwise return as string
        try {
            return JSON.parse(result.result || 'null') as T;
        } catch {
            return result.result as unknown as T;
        }
    }

    async uploadFile(options: UploadFileOptions): Promise<UploadResult> {
        return await this.post<UploadResult>('/upload', {
            file_path: options.filePath,
            instruction: options.instruction || 'click the file upload button and upload the file',
            selector: options.selector,
            ...(options.taskId ? { task_key: options.taskId } : {}),
        }, {
            signal: options.signal,
        });
    }

    /**
     * Perform a natural language browser action (smart mode exclusive feature)
     */
    async aiAction(options: AiActionOptions): Promise<AiActionResult> {
        return await this.post<AiActionResult>('/action', {
            action: options.action,
            context: options.context,
            ...(options.taskId ? { task_key: options.taskId } : {}),
        }, {
            signal: options.signal,
        });
    }

    /**
     * Run a complete AI-driven browser task
     */
    async runTask(task: string, options: {
        url?: string;
        maxSteps?: number;
        llmModel?: string;
        taskId?: string;
    } = {}): Promise<{ success: boolean; result?: string; stepsTaken?: number; error?: string }> {
        const raw = await this.post<{
            success: boolean;
            result?: string;
            steps_taken?: number;  // Python returns snake_case
            error?: string;
        }>('/task', {
            task,
            url: options.url,
            max_steps: options.maxSteps || 20,
            llm_model: options.llmModel,
            ...(options.taskId ? { task_key: options.taskId } : {}),
        });

        return {
            success: raw.success,
            result: raw.result,
            stepsTaken: raw.steps_taken,
            error: raw.error,
        };
    }
}

// ============================================================================
// BrowserService - Hybrid Router
// ============================================================================

/**
 * Main BrowserService that routes to the appropriate backend based on mode.
 * Singleton pattern preserved for backward compatibility.
 */
export class BrowserService {
    private static instance: BrowserService | null = null;

    private playwrightBackend: PlaywrightBackend;
    private browserUseBackend: BrowserUseBackend;
    private _mode: BrowserMode = 'auto';
    private _browserUseAvailable: boolean | null = null; // Cached availability

    constructor(browserUseServiceUrl?: string) {
        this.playwrightBackend = new PlaywrightBackend();
        this.browserUseBackend = new BrowserUseBackend(browserUseServiceUrl);
    }

    static getInstance(browserUseServiceUrl?: string): BrowserService {
        if (!BrowserService.instance) {
            BrowserService.instance = new BrowserService(browserUseServiceUrl);
        }
        return BrowserService.instance;
    }

    // ========================================================================
    // Mode Management
    // ========================================================================

    get mode(): BrowserMode {
        return this._mode;
    }

    setMode(mode: BrowserMode): void {
        console.error(`[BrowserService] Mode changed: ${this._mode} -> ${mode}`);
        this._mode = mode;
    }

    /**
     * Get the active backend based on current mode
     */
    private getActiveBackend(): BrowserBackend {
        switch (this._mode) {
            case 'precise':
                return this.playwrightBackend;
            case 'smart':
                return this.browserUseBackend;
            case 'auto':
            default:
                return this.playwrightBackend; // auto starts with playwright
        }
    }

    /**
     * Execute an operation with auto-fallback if in auto mode
     */
    private async withFallback<T>(
        operation: string,
        preciseFn: () => Promise<T>,
        smartFn: () => Promise<T>
    ): Promise<T> {
        if (this._mode === 'precise') {
            return preciseFn();
        }

        if (this._mode === 'smart') {
            // In smart mode, still keep Playwright as a hard fallback if browser-use
            // backend is disconnected or returns a connection-state error.
            if (!this.browserUseBackend.isConnected()) {
                console.error(`[BrowserService] Smart mode requested for ${operation}, but browser-use is not connected. Falling back to Playwright.`);
                return preciseFn();
            }

            try {
                return await smartFn();
            } catch (smartError) {
                const msg = smartError instanceof Error ? smartError.message : String(smartError);
                const isConnectionStateError =
                    msg.includes('Browser not connected') ||
                    msg.includes('Call POST /connect first') ||
                    msg.includes('browser-use-service error (400)');

                if (isConnectionStateError) {
                    console.error(`[BrowserService] Smart backend connection-state error for ${operation}. Falling back to Playwright. Error: ${msg}`);
                    return preciseFn();
                }

                throw smartError;
            }
        }

        // Auto mode: try precise first, fallback to smart
        try {
            return await preciseFn();
        } catch (preciseError) {
            console.error(`[BrowserService] Precise mode failed for ${operation}, trying smart mode...`);
            console.error(`[BrowserService] Precise error: ${preciseError instanceof Error ? preciseError.message : String(preciseError)}`);

            // Check if browser-use service is available
            const available = await this.isBrowserUseAvailable();
            if (!available) {
                console.error('[BrowserService] Smart mode unavailable, re-throwing precise error');
                throw preciseError;
            }

            try {
                const result = await smartFn();
                console.error(`[BrowserService] Smart mode succeeded for ${operation}`);
                return result;
            } catch (smartError) {
                console.error(`[BrowserService] Smart mode also failed for ${operation}`);
                // Throw the original precise error as it's usually more specific
                throw preciseError;
            }
        }
    }

    // ========================================================================
    // Service Availability
    // ========================================================================

    /**
     * Check if browser-use-service is available (cached for 30 seconds)
     */
    async isBrowserUseAvailable(): Promise<boolean> {
        if (this._browserUseAvailable !== null) {
            return this._browserUseAvailable;
        }

        this._browserUseAvailable = await this.browserUseBackend.isServiceAvailable();

        // Cache for 30 seconds
        setTimeout(() => {
            this._browserUseAvailable = null;
        }, 30000);

        return this._browserUseAvailable;
    }

    /**
     * Return whether smart mode can be used for the current browser session.
     * Smart mode requires:
     * 1) browser-use-service available
     * 2) an active shared CDP-backed Playwright session
     */
    async getSmartModeStatus(): Promise<{ available: boolean; reason?: string; sharedCdpUrl?: string }> {
        const available = await this.isBrowserUseAvailable();
        if (!available) {
            return {
                available: false,
                reason: 'browser-use-service is not available. Start it with: cd browser-use-service && python main.py',
            };
        }

        const activeCdpPort = this.playwrightBackend.getActiveCdpPort();
        if (!activeCdpPort) {
            return {
                available: false,
                reason: 'No shared CDP Chrome session. Connect browser first to enable smart mode.',
            };
        }

        return {
            available: true,
            sharedCdpUrl: `http://localhost:${activeCdpPort}`,
        };
    }

    // ========================================================================
    // Public API (backward compatible with original BrowserService)
    // ========================================================================

    isConnected(): boolean {
        return this.playwrightBackend.isConnected() || this.browserUseBackend.isConnected();
    }

    getConnectionInfo(): { connected: boolean; isUserProfile: boolean; mode: 'cdp_user_profile' | 'persistent_profile' | 'disconnected'; profilePath?: string } {
        const conn = this.playwrightBackend.getConnection();
        if (!conn) {
            return { connected: false, isUserProfile: false, mode: 'disconnected' };
        }
        return {
            connected: true,
            isUserProfile: !!conn.isUserProfile,
            mode: conn.isUserProfile ? 'cdp_user_profile' : 'persistent_profile',
            profilePath: conn.profilePath,
        };
    }

    getChromeUserDataDir(): string {
        return getChromeUserDataDir();
    }

    async getAvailableProfiles(): Promise<string[]> {
        const userDataDir = getChromeUserDataDir();

        try {
            const entries = await fs.promises.readdir(userDataDir, { withFileTypes: true });
            const profiles: string[] = [];

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const prefsPath = path.join(userDataDir, entry.name, 'Preferences');
                    try {
                        await fs.promises.access(prefsPath);
                        profiles.push(entry.name);
                    } catch {
                        // Not a profile directory
                    }
                }
            }

            return profiles;
        } catch (error) {
            console.error('[BrowserService] Failed to list profiles:', error);
            return ['Default'];
        }
    }

    async tryConnectToRunningChrome(): Promise<Browser | null> {
        for (const port of ALL_CDP_PORTS) {
            try {
                console.error(`[BrowserService] Trying to connect to Chrome on port ${port}...`);
                const chromium = await getChromium();
                const browser = await chromium.connectOverCDP(`http://localhost:${port}`, {
                    timeout: 5000,
                });
                console.error(`[BrowserService] Connected to Chrome on port ${port}`);
                return browser;
            } catch {
                // Port not available, try next
            }
        }

        console.error('[BrowserService] No running Chrome with debug port found');
        return null;
    }

    async connect(options: ConnectOptions = {}): Promise<BrowserConnection> {
        // Always connect Playwright backend (primary)
        const connection = await this.playwrightBackend.connect(options);

        // Try to connect browser-use backend in the background (non-blocking)
        // Pass CDP URL so browser-use connects to the SAME Chrome instance launched by Playwright.
        const activeCdpPort = this.playwrightBackend.getActiveCdpPort();
        if (activeCdpPort) {
            const cdpUrl = `http://localhost:${activeCdpPort}`;
            this.browserUseBackend.connect({ ...options, cdpUrl }).catch(err => {
                console.error('[BrowserService] BrowserUse background connect failed (non-critical):', err);
            });
        }

        // Best-effort small delay to give browser-use backend time to attach when available.
        // This reduces transient race where first smart operation happens before background connect completes.
        await new Promise(resolve => setTimeout(resolve, 200));

        return connection;
    }

    async getPage(taskId?: string): Promise<Page> {
        return this.playwrightBackend.getPage(taskId);
    }

    async navigate(url: string, options: NavigateOptions = {}): Promise<NavigateResult> {
        return this.withFallback(
            'navigate',
            () => this.playwrightBackend.navigate(url, options),
            () => this.browserUseBackend.navigate(url, options)
        );
    }

    async click(options: ClickOptions): Promise<ClickResult> {
        return this.withFallback(
            'click',
            () => this.playwrightBackend.click(options),
            () => this.browserUseBackend.click(options)
        );
    }

    async fill(options: FillOptions): Promise<FillResult> {
        return this.withFallback(
            'fill',
            () => this.playwrightBackend.fill(options),
            () => this.browserUseBackend.fill(options)
        );
    }

    async screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
        return this.withFallback(
            'screenshot',
            () => this.playwrightBackend.screenshot(options),
            () => this.browserUseBackend.screenshot(options)
        );
    }

    async wait(options: WaitOptions): Promise<WaitResult> {
        return this.withFallback(
            'wait',
            () => this.playwrightBackend.wait(options),
            () => this.browserUseBackend.wait(options)
        );
    }

    async getContent(asText: boolean = true, control?: BrowserOperationControl): Promise<ContentResult> {
        return this.withFallback(
            'getContent',
            () => this.playwrightBackend.getContent(asText, control),
            () => this.browserUseBackend.getContent(asText, control)
        );
    }

    async executeScript<T>(script: string, control?: BrowserOperationControl): Promise<T> {
        // Script execution is always Playwright (direct DOM access required)
        return this.playwrightBackend.executeScript<T>(script, control);
    }

    async disconnect(): Promise<void> {
        await Promise.all([
            this.playwrightBackend.disconnect(),
            this.browserUseBackend.disconnect().catch(() => {}),
        ]);
    }

    // ========================================================================
    // New Hybrid API
    // ========================================================================

    /**
     * Upload a file. In auto mode, tries Playwright first then browser-use.
     */
    async uploadFile(options: UploadFileOptions): Promise<UploadResult> {
        return this.withFallback(
            'uploadFile',
            () => this.playwrightBackend.uploadFile(options),
            () => this.browserUseBackend.uploadFile(options)
        );
    }

    /**
     * Perform an AI-driven action (smart mode only, no Playwright fallback).
     * Used by browser_ai_action tool.
     */
    async aiAction(options: AiActionOptions): Promise<AiActionResult> {
        const available = await this.isBrowserUseAvailable();
        if (!available) {
            return {
                success: false,
                error: 'browser-use-service is not available. Start it with: cd browser-use-service && python main.py',
            };
        }

        const ensureSmartSession = async (): Promise<void> => {
            if (!this.playwrightBackend.isConnected()) {
                await this.playwrightBackend.connect({
                    headless: false,
                    signal: options.signal,
                });
            }

            const activeCdpPort = this.playwrightBackend.getActiveCdpPort();
            if (activeCdpPort) {
                // Always present the active CDP endpoint to browser-use so it can
                // reuse the same Chrome instance as Playwright (or switch to it).
                await this.browserUseBackend.connect({
                    cdpUrl: `http://localhost:${activeCdpPort}`,
                    signal: options.signal,
                });
                return;
            }

            if (!this.browserUseBackend.isConnected()) {
                await this.browserUseBackend.connect({
                    headless: false,
                    signal: options.signal,
                });
            }

            // If smart mode had to launch its own browser session, sync it to the
            // currently active Playwright page so ai_action works on the same URL.
            if (!activeCdpPort && this.playwrightBackend.isConnected()) {
                try {
                    const currentPage = await this.playwrightBackend.getContent(true, {
                        signal: options.signal,
                        taskId: options.taskId,
                    });
                    if (currentPage.url) {
                        await this.browserUseBackend.navigate(currentPage.url, {
                            signal: options.signal,
                            taskId: options.taskId,
                        });
                    }
                } catch (error) {
                    console.error('[BrowserService] Failed to sync URL to browser-use session:', error);
                }
            }
        };

        try {
            await ensureSmartSession();
            return await this.browserUseBackend.aiAction(options);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            const needsReconnect =
                message.includes('Browser not connected') ||
                message.includes('Call POST /connect first');

            if (needsReconnect) {
                try {
                    await this.browserUseBackend.disconnect().catch(() => {});
                    await ensureSmartSession();
                    return await this.browserUseBackend.aiAction(options);
                } catch (retryError) {
                    return {
                        success: false,
                        error: retryError instanceof Error ? retryError.message : String(retryError),
                    };
                }
            }

            return {
                success: false,
                error: message,
            };
        }
    }

    /**
     * Run a full AI-driven browser task (smart mode only).
     */
    async runAiTask(task: string, options: {
        url?: string;
        maxSteps?: number;
        llmModel?: string;
    } = {}): Promise<{ success: boolean; result?: string; stepsTaken?: number; error?: string }> {
        const available = await this.isBrowserUseAvailable();
        if (!available) {
            return {
                success: false,
                error: 'browser-use-service is not available. Start it with: cd browser-use-service && python main.py',
            };
        }
        return this.browserUseBackend.runTask(task, options);
    }

    /**
     * Get direct access to backends (for advanced use)
     */
    getPlaywrightBackend(): PlaywrightBackend {
        return this.playwrightBackend;
    }

    getBrowserUseBackend(): BrowserUseBackend {
        return this.browserUseBackend;
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get Chrome user data directory path based on OS
 */
export function getChromeUserDataDir(): string {
    switch (process.platform) {
        case 'win32':
            return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
        default: // Linux
            return path.join(os.homedir(), '.config', 'google-chrome');
    }
}

/**
 * Find the Chrome executable path on the current OS.
 * Returns null if Chrome is not found.
 */
export function getChromeExecutable(): string | null {
    const candidates: string[] = [];
    switch (process.platform) {
        case 'win32':
            for (const base of [
                process.env.PROGRAMFILES || '',
                process.env['PROGRAMFILES(X86)'] || '',
                process.env.LOCALAPPDATA || '',
            ]) {
                if (base) {
                    candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
                }
            }
            break;
        case 'darwin':
            candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
            break;
        default:
            candidates.push(
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
            );
    }

    for (const p of candidates) {
        try {
            fs.accessSync(p, fs.constants.X_OK);
            return p;
        } catch {
            // Not found or not executable
        }
    }
    return null;
}

// ============================================================================
// Singleton Export (backward compatible)
// ============================================================================

export const browserService = BrowserService.getInstance();
