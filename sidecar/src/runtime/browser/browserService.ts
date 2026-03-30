import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const CDP_PORT = 9222;

export type BrowserMode = 'precise' | 'smart' | 'auto';
export type BrowserUseAvailabilityRecoveryHook = (serviceUrl: string) => Promise<boolean>;

export interface BrowserConnection {
    browser: unknown;
    context: unknown;
    page: unknown;
    isUserProfile: boolean;
    profilePath?: string;
}

export interface ConnectOptions {
    profileName?: string;
    headless?: boolean;
    requireUserProfile?: boolean;
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
    selector?: string;
    filePath: string;
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
    action: string;
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

type BridgeRequest = {
    id: number;
    method: string;
    params: Record<string, unknown>;
};

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

function parseCdpPort(cdpUrl?: string): number | null {
    if (!cdpUrl) return null;
    try {
        const parsed = new URL(cdpUrl);
        const port = Number.parseInt(parsed.port, 10);
        if (Number.isFinite(port) && port > 0) {
            return port;
        }
    } catch {
        return null;
    }
    return null;
}

function joinProfilePath(profileName: string): string {
    return path.join(getChromeUserDataDir(), profileName);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

function isNodeProcessLike(proc: unknown): proc is NodeJS.Process {
    return Boolean(proc) && typeof proc === 'object' && typeof (proc as NodeJS.Process).stdin !== 'undefined';
}

export class PlaywrightBackend implements BrowserBackend {
    readonly name = 'playwright';
    private connection: BrowserConnection | null = null;
    private activeCdpPort: number | null = null;
    private bridgeRequestId = 0;
    private bridgePending = new Map<number, {
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();

    // Exposed for test stubbing
    _bridgeProcess?: {
        stdin?: {
            write: (chunk: string) => boolean;
        };
    };

    isConnected(): boolean {
        return this.connection !== null;
    }

    getActiveCdpPort(): number | null {
        return this.activeCdpPort;
    }

    async connect(options: ConnectOptions): Promise<BrowserConnection> {
        throwIfAborted(options.signal, 'Browser connection cancelled');
        if (this.connection) {
            return this.connection;
        }

        const profileName = options.profileName?.trim() || 'Default';
        const cdpPort = parseCdpPort(options.cdpUrl) ?? CDP_PORT;
        this.activeCdpPort = cdpPort;

        this.connection = {
            browser: null,
            context: null,
            page: {},
            isUserProfile: true,
            profilePath: joinProfilePath(profileName),
        };
        return this.connection;
    }

    async disconnect(): Promise<void> {
        this.connection = null;
        this.activeCdpPort = null;
        this.bridgeRequestId = 0;

        for (const pending of this.bridgePending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Bridge disconnected'));
        }
        this.bridgePending.clear();
    }

    async getPage(): Promise<unknown> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        return this.connection.page;
    }

    async _bridgeSend(
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<unknown> {
        const stdin = this._bridgeProcess?.stdin;
        if (!stdin) {
            throw new Error('Bridge process is not ready');
        }

        const requestId = ++this.bridgeRequestId;
        const request: BridgeRequest = { id: requestId, method, params };
        stdin.write(`${JSON.stringify(request)}\n`);

        return new Promise<unknown>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.bridgePending.delete(requestId);
                reject(new Error(`Bridge request timed out: ${method}`));
            }, timeoutMs);

            const abortHandler = () => {
                const reason = getAbortReason(signal, 'Task cancelled by user');
                stdin.write(`${JSON.stringify({
                    id: ++this.bridgeRequestId,
                    method: 'cancel',
                    params: { requestId, reason },
                })}\n`);
                this.bridgePending.delete(requestId);
                clearTimeout(timeout);
                reject(new Error(reason));
            };

            if (signal?.aborted) {
                abortHandler();
                return;
            }

            if (signal) {
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            this.bridgePending.set(requestId, {
                reject: (error) => {
                    if (signal) signal.removeEventListener('abort', abortHandler);
                    clearTimeout(timeout);
                    reject(error);
                },
                timeout,
            });

            // Bridge responses are not wired in this minimal runtime yet.
            // Keep resolver for future protocol integration.
            void resolve;
        });
    }

    async _bridgeWaitForReady(
        proc: { stdout?: { on: (event: string, listener: (chunk: unknown) => void) => void }; kill?: () => boolean },
        signal?: AbortSignal,
    ): Promise<boolean> {
        return await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (ready: boolean): void => {
                if (settled) return;
                settled = true;
                resolve(ready);
            };

            const abortHandler = () => {
                try {
                    proc.kill?.();
                } catch {
                    // ignore kill errors
                }
                finish(false);
            };

            if (signal?.aborted) {
                abortHandler();
                return;
            }

            signal?.addEventListener('abort', abortHandler, { once: true });

            proc.stdout?.on('data', (chunk) => {
                const text = String(chunk ?? '');
                if (text.includes('READY')) {
                    signal?.removeEventListener('abort', abortHandler);
                    finish(true);
                }
            });

            setTimeout(() => {
                signal?.removeEventListener('abort', abortHandler);
                finish(false);
            }, 5_000);
        });
    }

    async navigate(url: string, options?: NavigateOptions): Promise<NavigateResult> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(options?.signal, 'Task cancelled by user');
        return {
            url,
            title: '',
        };
    }

    async click(options: ClickOptions): Promise<ClickResult> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(options.signal, 'Task cancelled by user');
        if (!options.selector && !options.text) {
            throw new Error('Either selector or text must be provided');
        }
        return {
            clicked: options.selector ?? `text=${options.text}`,
        };
    }

    async fill(options: FillOptions): Promise<FillResult> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(options.signal, 'Task cancelled by user');
        return {
            filled: options.selector,
            value: options.value,
        };
    }

    async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(options?.signal, 'Task cancelled by user');
        return {
            base64: '',
            width: 0,
            height: 0,
        };
    }

    async wait(options: WaitOptions): Promise<WaitResult> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(options.signal, 'Task cancelled by user');
        await sleep(Math.min(options.timeout ?? 50, 50), options.signal);
        return {
            found: true,
            selector: options.selector,
        };
    }

    async getContent(asText: boolean = true, control?: BrowserOperationControl): Promise<ContentResult> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(control?.signal, 'Task cancelled by user');
        return {
            content: asText ? '' : '<html></html>',
            url: 'about:blank',
            title: '',
        };
    }

    async executeScript<T>(_script: string, control?: BrowserOperationControl): Promise<T> {
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(control?.signal, 'Task cancelled by user');
        return undefined as T;
    }

    async uploadFile(options: UploadFileOptions): Promise<UploadResult> {
        if (!fs.existsSync(options.filePath)) {
            return {
                success: false,
                message: 'File not found',
                error: `File does not exist: ${options.filePath}`,
            };
        }
        if (!this.connection) {
            throw new Error('Browser not connected. Call browser_connect first.');
        }
        throwIfAborted(options.signal, 'Task cancelled by user');
        return {
            success: true,
            message: 'Upload completed',
        };
    }
}

type BrowserUseResponse = {
    success?: boolean;
    error?: string;
    url?: string;
    title?: string;
    image_base64?: string;
    width?: number;
    height?: number;
    content?: string;
    result?: string;
    message?: string;
    [key: string]: unknown;
};

export class BrowserUseBackend implements BrowserBackend {
    readonly name = 'browser-use';
    private connected = false;
    private connectedCdpUrl: string | null = null;

    constructor(private serviceUrl: string = 'http://localhost:8100') {}

    getServiceUrl(): string {
        return this.serviceUrl;
    }

    setServiceUrl(serviceUrl: string): void {
        this.serviceUrl = serviceUrl;
    }

    isConnectedToCdp(cdpUrl: string): boolean {
        return this.connected && this.connectedCdpUrl === cdpUrl;
    }

    isConnected(): boolean {
        return this.connected;
    }

    private async requestJson(
        endpoint: string,
        init: RequestInit,
    ): Promise<BrowserUseResponse> {
        const response = await fetch(`${this.serviceUrl}${endpoint}`, init);
        if (!response.ok) {
            throw new Error(`browser-use request failed (${response.status})`);
        }
        return await response.json() as BrowserUseResponse;
    }

    private async postJson(
        endpoint: string,
        payload: Record<string, unknown>,
        signal?: AbortSignal,
    ): Promise<BrowserUseResponse> {
        return await this.requestJson(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal,
        });
    }

    async isServiceAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.serviceUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(3_000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async connect(options: ConnectOptions): Promise<BrowserConnection> {
        this.connected = true;
        this.connectedCdpUrl = options.cdpUrl ?? null;
        return {
            browser: null,
            context: null,
            page: null,
            isUserProfile: true,
            profilePath: getChromeUserDataDir(),
        };
    }

    async disconnect(): Promise<void> {
        try {
            await this.postJson('/disconnect', {});
        } catch {
            // ignore shutdown errors
        } finally {
            this.connected = false;
            this.connectedCdpUrl = null;
        }
    }

    async navigate(url: string, options?: NavigateOptions): Promise<NavigateResult> {
        const payload = await this.postJson('/navigate', {
            url,
            wait_until: options?.waitUntil ?? 'domcontentloaded',
            timeout_ms: options?.timeout ?? 30_000,
        }, options?.signal);
        if (payload.success === false) {
            throw new Error(payload.error ?? 'Navigation failed');
        }
        return {
            url: String(payload.url ?? url),
            title: String(payload.title ?? ''),
        };
    }

    async click(options: ClickOptions): Promise<ClickResult> {
        if (!options.selector && !options.text) {
            throw new Error('Either selector or text must be provided');
        }
        const payload = await this.postJson('/click', {
            selector: options.selector,
            text: options.text,
            instruction: options.text ? `text=${options.text}` : undefined,
            timeout_ms: options.timeout ?? 10_000,
        }, options.signal);
        if (payload.success === false) {
            throw new Error(payload.error ?? 'Click failed');
        }
        return {
            clicked: options.selector ?? `text=${options.text}`,
        };
    }

    async fill(options: FillOptions): Promise<FillResult> {
        const payload = await this.postJson('/fill', {
            selector: options.selector,
            value: options.value,
            clear_first: options.clearFirst ?? true,
        }, options.signal);
        if (payload.success === false) {
            throw new Error(payload.error ?? 'Fill failed');
        }
        return {
            filled: options.selector,
            value: options.value,
        };
    }

    async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
        const payload = await this.postJson('/screenshot', {
            selector: options?.selector,
            full_page: options?.fullPage ?? false,
        }, options?.signal);
        if (payload.success === false) {
            throw new Error(payload.error ?? 'Screenshot failed');
        }
        return {
            base64: String(payload.image_base64 ?? ''),
            width: Number(payload.width ?? 0),
            height: Number(payload.height ?? 0),
        };
    }

    async wait(options: WaitOptions): Promise<WaitResult> {
        throwIfAborted(options.signal, 'Task cancelled by user');
        await sleep(Math.min(options.timeout ?? 500, 500), options.signal);
        return {
            found: true,
            selector: options.selector,
        };
    }

    async getContent(asText: boolean = true, control?: BrowserOperationControl): Promise<ContentResult> {
        const payload = await this.postJson('/content', {
            as_text: asText,
        }, control?.signal);
        if (payload.success === false) {
            throw new Error(payload.error ?? 'Get content failed');
        }
        return {
            content: String(payload.content ?? ''),
            url: String(payload.url ?? ''),
            title: String(payload.title ?? ''),
        };
    }

    async executeScript<T>(script: string, control?: BrowserOperationControl): Promise<T> {
        const action = await this.aiAction({ action: `Execute script: ${script}`, signal: control?.signal });
        if (!action.success) {
            throw new Error(action.error ?? 'Execute script failed');
        }
        return action.result as T;
    }

    async uploadFile(options: UploadFileOptions): Promise<UploadResult> {
        const payload = await this.postJson('/upload', {
            file_path: options.filePath,
            selector: options.selector,
            instruction: options.instruction,
        }, options.signal);
        if (payload.success === false) {
            return {
                success: false,
                message: String(payload.message ?? 'Upload failed'),
                error: String(payload.error ?? 'Upload failed'),
            };
        }
        return {
            success: true,
            message: String(payload.message ?? 'Upload completed'),
        };
    }

    async aiAction(options: AiActionOptions): Promise<AiActionResult> {
        const payload = await this.postJson('/action', {
            action: options.action,
            context: options.context,
        }, options.signal);
        if (payload.success === false) {
            return {
                success: false,
                error: String(payload.error ?? 'Action failed'),
            };
        }
        return {
            success: true,
            result: String(payload.result ?? ''),
        };
    }

    async runTask(task: string, options?: { url?: string; maxSteps?: number; signal?: AbortSignal }): Promise<AiActionResult> {
        const payload = await this.postJson('/task', {
            task,
            url: options?.url,
            max_steps: options?.maxSteps,
        }, options?.signal);
        if (payload.success === false) {
            return {
                success: false,
                error: String(payload.error ?? 'Task failed'),
            };
        }
        return {
            success: true,
            result: String(payload.result ?? ''),
        };
    }
}

export class BrowserService {
    private static instance: BrowserService | null = null;
    private static availabilityRecoveryHook: BrowserUseAvailabilityRecoveryHook | null = null;

    private _mode: BrowserMode = 'auto';
    private playwrightBackend: PlaywrightBackend;
    private browserUseBackend: BrowserUseBackend;

    constructor(browserUseServiceUrl: string = 'http://localhost:8100') {
        this.playwrightBackend = new PlaywrightBackend();
        this.browserUseBackend = new BrowserUseBackend(browserUseServiceUrl);
    }

    static getInstance(browserUseServiceUrl?: string): BrowserService {
        if (!BrowserService.instance) {
            BrowserService.instance = new BrowserService(browserUseServiceUrl);
        } else if (browserUseServiceUrl) {
            BrowserService.instance.setBrowserUseServiceUrl(browserUseServiceUrl);
        }
        return BrowserService.instance;
    }

    static setBrowserUseAvailabilityRecoveryHook(hook: BrowserUseAvailabilityRecoveryHook | null): void {
        BrowserService.availabilityRecoveryHook = hook;
    }

    get mode(): BrowserMode {
        return this._mode;
    }

    setMode(mode: BrowserMode): void {
        this._mode = mode;
    }

    getBrowserUseServiceUrl(): string {
        return this.browserUseBackend.getServiceUrl();
    }

    setBrowserUseServiceUrl(serviceUrl: string): void {
        this.browserUseBackend.setServiceUrl(serviceUrl);
    }

    getConnectionInfo(): {
        connected: boolean;
        mode: 'cdp_user_profile' | 'disconnected';
        isUserProfile: boolean;
    } {
        const connected = this.playwrightBackend.isConnected();
        return connected
            ? { connected: true, mode: 'cdp_user_profile', isUserProfile: true }
            : { connected: false, mode: 'disconnected', isUserProfile: false };
    }

    async connect(options: ConnectOptions): Promise<BrowserConnection> {
        const connection = await this.playwrightBackend.connect(options);
        await this.attachBrowserUseToSharedCdpSession();
        return connection;
    }

    async disconnect(): Promise<void> {
        await Promise.allSettled([
            this.playwrightBackend.disconnect(),
            this.browserUseBackend.disconnect(),
        ]);
    }

    isConnected(): boolean {
        return this.playwrightBackend.isConnected();
    }

    getChromeUserDataDir(): string {
        return getChromeUserDataDir();
    }

    async getAvailableProfiles(): Promise<string[]> {
        const root = getChromeUserDataDir();
        try {
            const entries = fs.readdirSync(root, { withFileTypes: true });
            const profiles = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .filter((name) => name === 'Default' || name.startsWith('Profile '))
                .sort();
            if (profiles.length > 0) return profiles;
        } catch {
            // ignore and use default profile
        }
        return ['Default'];
    }

    async isBrowserUseAvailable(allowRecovery: boolean = false): Promise<boolean> {
        let available = await this.browserUseBackend.isServiceAvailable();
        if (!available && allowRecovery && BrowserService.availabilityRecoveryHook) {
            try {
                available = await BrowserService.availabilityRecoveryHook(this.browserUseBackend.getServiceUrl());
            } catch {
                available = false;
            }
        }
        return available;
    }

    async getSmartModeStatus(): Promise<{ available: boolean; reason?: string; sharedCdpUrl?: string }> {
        const port = this.playwrightBackend.getActiveCdpPort() ?? CDP_PORT;
        const sharedCdpUrl = `http://localhost:${port}`;

        if (!(await this.isBrowserUseAvailable(true))) {
            return {
                available: false,
                reason: 'browser-use-service unavailable or unreachable',
                sharedCdpUrl,
            };
        }

        if (!this.browserUseBackend.isConnectedToCdp(sharedCdpUrl)) {
            await this.browserUseBackend.connect({ cdpUrl: sharedCdpUrl });
        }

        const connected = this.browserUseBackend.isConnectedToCdp(sharedCdpUrl);
        return connected
            ? { available: true, sharedCdpUrl }
            : { available: false, reason: 'browser-use failed to attach to shared CDP session', sharedCdpUrl };
    }

    private async attachBrowserUseToSharedCdpSession(): Promise<void> {
        if (!(await this.browserUseBackend.isServiceAvailable())) {
            return;
        }

        const port = this.playwrightBackend.getActiveCdpPort();
        if (!port) return;

        const cdpUrl = `http://localhost:${port}`;
        if (!this.browserUseBackend.isConnectedToCdp(cdpUrl)) {
            await this.browserUseBackend.connect({ cdpUrl });
        }
    }

    private async routeOperation<T>(
        operationName: string,
        precise: () => Promise<T>,
        smart: () => Promise<T>,
    ): Promise<T> {
        if (this._mode === 'precise') {
            return await precise();
        }

        if (this._mode === 'smart') {
            if (!this.browserUseBackend.isConnected()) {
                return await precise();
            }
            return await smart();
        }

        // auto mode
        try {
            return await precise();
        } catch (preciseError) {
            if (!this.browserUseBackend.isConnected()) {
                throw preciseError;
            }
            try {
                return await smart();
            } catch {
                throw preciseError;
            }
        } finally {
            void operationName;
        }
    }

    async navigate(url: string, options?: NavigateOptions): Promise<NavigateResult> {
        return await this.routeOperation(
            'navigate',
            () => this.playwrightBackend.navigate(url, options),
            () => this.browserUseBackend.navigate(url, options),
        );
    }

    async click(options: ClickOptions): Promise<ClickResult> {
        return await this.routeOperation(
            'click',
            () => this.playwrightBackend.click(options),
            () => this.browserUseBackend.click(options),
        );
    }

    async fill(options: FillOptions): Promise<FillResult> {
        return await this.routeOperation(
            'fill',
            () => this.playwrightBackend.fill(options),
            () => this.browserUseBackend.fill(options),
        );
    }

    async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
        return await this.routeOperation(
            'screenshot',
            () => this.playwrightBackend.screenshot(options),
            () => this.browserUseBackend.screenshot(options),
        );
    }

    async wait(options: WaitOptions): Promise<WaitResult> {
        return await this.routeOperation(
            'wait',
            () => this.playwrightBackend.wait(options),
            () => this.browserUseBackend.wait(options),
        );
    }

    async getContent(asText: boolean = true, control?: BrowserOperationControl): Promise<ContentResult> {
        return await this.routeOperation(
            'getContent',
            () => this.playwrightBackend.getContent(asText, control),
            () => this.browserUseBackend.getContent(asText, control),
        );
    }

    async executeScript<T>(script: string, control?: BrowserOperationControl): Promise<T> {
        // executeScript is always deterministic and routed to Playwright.
        return await this.playwrightBackend.executeScript<T>(script, control);
    }

    async uploadFile(options: UploadFileOptions): Promise<UploadResult> {
        return await this.routeOperation(
            'uploadFile',
            () => this.playwrightBackend.uploadFile(options),
            () => this.browserUseBackend.uploadFile(options),
        );
    }

    async aiAction(options: AiActionOptions): Promise<AiActionResult> {
        if (!(await this.isBrowserUseAvailable(true))) {
            return {
                success: false,
                error: 'browser-use-service unavailable or unreachable',
            };
        }

        if (!this.browserUseBackend.isConnected()) {
            const port = this.playwrightBackend.getActiveCdpPort() ?? CDP_PORT;
            await this.browserUseBackend.connect({ cdpUrl: `http://localhost:${port}` });
        }

        return await this.browserUseBackend.aiAction(options);
    }

    async runAiTask(task: string, options?: { url?: string; maxSteps?: number; signal?: AbortSignal }): Promise<AiActionResult> {
        if (!(await this.isBrowserUseAvailable(true))) {
            return {
                success: false,
                error: 'browser-use-service unavailable or unreachable',
            };
        }

        if (!this.browserUseBackend.isConnected()) {
            const port = this.playwrightBackend.getActiveCdpPort() ?? CDP_PORT;
            await this.browserUseBackend.connect({ cdpUrl: `http://localhost:${port}` });
        }

        return await this.browserUseBackend.runTask(task, options);
    }

    getPlaywrightBackend(): PlaywrightBackend {
        return this.playwrightBackend;
    }

    getBrowserUseBackend(): BrowserUseBackend {
        return this.browserUseBackend;
    }
}

export function getChromeUserDataDir(): string {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    }
    if (process.platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
    }
    return path.join(os.homedir(), '.config', 'google-chrome');
}

export function getChromeExecutable(): string | null {
    const candidates =
        process.platform === 'darwin'
            ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
            : process.platform === 'win32'
                ? [
                    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                ]
                : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

export const browserService = BrowserService.getInstance();
