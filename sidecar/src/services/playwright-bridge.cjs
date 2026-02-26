/**
 * Node.js bridge for Playwright browser automation.
 *
 * WHY: Bun's child_process implementation doesn't properly support Playwright's
 * internal --remote-debugging-pipe mechanism. This bridge runs under Node.js
 * and handles ALL Playwright operations, communicating with the Bun sidecar
 * via stdin/stdout JSON-Lines IPC (which Bun handles correctly).
 *
 * PROTOCOL:
 *   Stdin  (from sidecar): JSON-Lines, each line: { "id": "...", "method": "...", "params": {...} }
 *   Stdout (to sidecar):   JSON-Lines, each line: { "id": "...", "success": true/false, "result": {...}, "error": "..." }
 *
 * LIFECYCLE:
 *   1. Bridge starts, outputs { "ready": true } on stdout
 *   2. Sidecar sends commands, bridge executes and responds
 *   3. When stdin closes (sidecar dies), bridge cleans up and exits
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

let browser = null;
let context = null;
let page = null;

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

function log(msg) {
    process.stderr.write(`[PW-Bridge] ${msg}\n`);
}

/**
 * Connect to an existing Chrome/Chromium browser via CDP (Chrome DevTools Protocol).
 *
 * This is critical for reusing the user's existing Chrome browser which has
 * login cookies (e.g., Xiaohongshu). The sidecar's Bun runtime has broken
 * WebSocket support, so CDP connections MUST go through this Node.js bridge.
 *
 * @param {Object} params
 * @param {string} params.cdpUrl - CDP endpoint URL, e.g., "http://127.0.0.1:9222"
 * @param {number} [params.timeout] - Connection timeout in ms (default: 10000)
 */
async function connectCDP(params) {
    if (browser || context) {
        return { alreadyConnected: true, url: page ? page.url() : 'unknown' };
    }

    const cdpUrl = params.cdpUrl;
    const timeout = params.timeout || 10000;

    if (!cdpUrl) throw new Error('connectCDP requires cdpUrl parameter');

    log(`Connecting via CDP to ${cdpUrl} (timeout: ${timeout}ms)...`);

    browser = await chromium.connectOverCDP(cdpUrl, { timeout });

    const contexts = browser.contexts();
    if (contexts.length === 0) {
        throw new Error('No browser contexts found after CDP connection');
    }

    context = contexts[0];
    const existingPages = context.pages();

    // Always create a new page (tab) for navigation instead of reusing
    // existing tabs. Reusing tabs can cause issues:
    // 1. Stale pages that haven't loaded properly
    // 2. Tabs with state that interferes with new navigation
    // 3. X.com's React not hydrating on reused tabs
    page = await context.newPage();

    log(`Connected via CDP — ${contexts.length} contexts, ${existingPages.length} existing pages, using NEW page`);
    return { connected: true, url: page.url(), isUserProfile: true, existingPages: existingPages.length };
}

async function launch(params) {
    const headless = params.headless || false;
    const userDataDir = params.userDataDir;
    const executablePath = params.executablePath;

    if (browser || context) {
        return { alreadyConnected: true };
    }

    const commonLaunchArgs = [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--disable-dev-shm-usage',
    ];

    if (userDataDir) {
        // Persistent context — preserves login sessions
        for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            try { fs.unlinkSync(path.join(userDataDir, lockFile)); } catch {}
        }
        try { fs.mkdirSync(userDataDir, { recursive: true }); } catch {}

        context = await chromium.launchPersistentContext(userDataDir, {
            headless,
            timeout: 30000,
            args: commonLaunchArgs,
            viewport: { width: 1920, height: 1080 },
            ignoreDefaultArgs: ['--enable-automation'],
            ...(executablePath ? { executablePath } : {}),
        });

        // Anti-bot hardening: align with real-user browser fingerprints.
        await context.addInitScript(() => {
            try {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                if (!window.chrome) {
                    Object.defineProperty(window, 'chrome', { value: { runtime: {} }, configurable: true });
                }
                const originalQuery = window.navigator.permissions?.query;
                if (originalQuery) {
                    window.navigator.permissions.query = (parameters) => (
                        parameters && parameters.name === 'notifications'
                            ? Promise.resolve({ state: Notification.permission })
                            : originalQuery(parameters)
                    );
                }
            } catch {}
        });

        const pages = context.pages();
        // Always use a fresh page to avoid stale/closed pre-existing tab state.
        page = await context.newPage();
        log(`Persistent context launched with ${pages.length} pages`);
    } else {
        // Fresh browser
        browser = await chromium.launch({
            headless,
            timeout: 30000,
            args: commonLaunchArgs,
            ...(executablePath ? { executablePath } : {}),
        });

        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
        });
        page = await context.newPage();
        log('Fresh browser launched');
    }

    return { launched: true, url: page.url() };
}

async function navigate(params) {
    if (!page) throw new Error('Browser not launched');
    const timeout = params.timeout || 30000;
    const waitUntil = params.waitUntil || 'domcontentloaded';

    const response = await page.goto(params.url, { waitUntil, timeout });

    // Check if the page needs time for SPA hydration (common with X, Twitter, etc.)
    // Many SPAs ship minimal HTML with a <noscript> fallback, then render via JavaScript.
    let bodyText = '';
    try {
        bodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
    } catch { /* page might be navigating */ }

    const spaNotReady = !bodyText
        || bodyText.length < 50
        || bodyText.includes('JavaScript is not available')
        || bodyText.includes('Enable JavaScript')
        || bodyText.includes('You need to enable JavaScript');

    if (spaNotReady) {
        log(`SPA not ready after goto (bodyLen=${bodyText.length}). Waiting for hydration...`);

        // Poll for up to 15 seconds waiting for JS to render
        for (let i = 0; i < 15; i++) {
            await page.waitForTimeout(1000);
            try {
                bodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
                if (bodyText.length > 100 && !bodyText.includes('JavaScript is not available')) {
                    log(`SPA hydrated after ${i + 1}s (bodyLen=${bodyText.length})`);
                    break;
                }
            } catch { /* page might be navigating */ }
        }

        // If still not ready, try waiting for load state
        if (bodyText.length < 100 || bodyText.includes('JavaScript is not available')) {
            log('SPA still not ready, trying waitForLoadState("load")...');
            try {
                await page.waitForLoadState('load', { timeout: 15000 });
                bodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
                log(`After load state: bodyLen=${bodyText.length}`);
            } catch (e) {
                log(`waitForLoadState failed: ${e.message}`);
            }
        }
    }

    // X/Twitter anti-bot/error interstitial sometimes appears transiently.
    // Retry one hard reload before returning control to caller.
    const xTransientError =
        bodyText.includes('出错了。请尝试重新加载') ||
        bodyText.includes('Something went wrong. Try reloading.');
    if (xTransientError) {
        log('Detected transient X error page, attempting one reload...');
        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(1500);
            bodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
            log(`After reload: bodyLen=${bodyText.length}`);
        } catch (e) {
            log(`Reload after X error failed: ${e.message}`);
        }
    }

    return {
        url: page.url(),
        title: await page.title(),
        status: response ? response.status() : null,
        bodyLength: bodyText.length,
        xTransientError,
    };
}

async function click(params) {
    if (!page) throw new Error('Browser not launched');
    const timeout = params.timeout || 10000;

    if (params.selector) {
        await page.click(params.selector, { timeout });
        return { clicked: true, selector: params.selector };
    } else if (params.text) {
        // Strategy 1: getByText (visible text content)
        try {
            const el = page.getByText(params.text, { exact: false }).first();
            await el.click({ timeout: Math.min(timeout, 5000) });
            return { clicked: true, method: 'getByText', text: params.text };
        } catch (e) {
            log(`getByText("${params.text}") failed: ${e.message?.substring(0, 80)}`);
        }

        // Strategy 2: getByPlaceholder (for input fields with placeholder text)
        try {
            const el = page.getByPlaceholder(params.text, { exact: false }).first();
            await el.click({ timeout: Math.min(timeout, 5000) });
            return { clicked: true, method: 'getByPlaceholder', text: params.text };
        } catch (e) {
            log(`getByPlaceholder("${params.text}") failed: ${e.message?.substring(0, 80)}`);
        }

        // Strategy 3: getByRole textbox with name
        try {
            const el = page.getByRole('textbox', { name: params.text }).first();
            await el.click({ timeout: Math.min(timeout, 5000) });
            return { clicked: true, method: 'getByRole(textbox)', text: params.text };
        } catch (e) {
            log(`getByRole textbox("${params.text}") failed: ${e.message?.substring(0, 80)}`);
        }

        // Strategy 4: CSS selector for placeholder/aria-label/contenteditable
        try {
            const escaped = params.text.replace(/"/g, '\\"');
            const selectors = [
                `[placeholder*="${escaped}"]`,
                `[aria-placeholder*="${escaped}"]`,
                `[data-placeholder*="${escaped}"]`,
                `[contenteditable][aria-label*="${escaped}"]`,
                `[data-testid*="tweetTextarea"]`,
            ].join(', ');
            await page.click(selectors, { timeout: Math.min(timeout, 5000) });
            return { clicked: true, method: 'css-placeholder-fallback', text: params.text };
        } catch (e) {
            log(`CSS placeholder fallback failed: ${e.message?.substring(0, 80)}`);
        }

        throw new Error(`Could not find element matching text "${params.text}" via any strategy (getByText, getByPlaceholder, getByRole, CSS selectors)`);
    }
    throw new Error('click requires selector or text');
}

async function fill(params) {
    if (!page) throw new Error('Browser not launched');
    const timeout = params.timeout || 10000;

    if (params.selector) {
        try {
            await page.fill(params.selector, params.value, { timeout });
            return { filled: true, method: 'fill-selector', value: params.value };
        } catch (e) {
            // fill() fails on contenteditable elements — fallback to click+type
            log(`fill(selector) failed, trying click+type: ${e.message?.substring(0, 80)}`);
            try {
                await page.click(params.selector, { timeout: 3000 });
                await page.keyboard.selectAll();
                await page.keyboard.press('Backspace');
                await page.keyboard.type(params.value, { delay: 30 });
                return { filled: true, method: 'click+type-selector', value: params.value };
            } catch (e2) {
                throw new Error(`fill selector "${params.selector}" failed: ${e2.message}`);
            }
        }
    } else if (params.text) {
        // Strategy 1: getByPlaceholder + fill
        try {
            const el = page.getByPlaceholder(params.text, { exact: false }).or(page.getByLabel(params.text)).first();
            await el.fill(params.value, { timeout: Math.min(timeout, 5000) });
            return { filled: true, method: 'getByPlaceholder+fill', value: params.value };
        } catch (e) {
            log(`getByPlaceholder fill failed: ${e.message?.substring(0, 80)}`);
        }

        // Strategy 2: Find contenteditable with matching aria-label/placeholder + click+type
        try {
            const escaped = params.text.replace(/"/g, '\\"');
            const selectors = [
                `[contenteditable][aria-label*="${escaped}"]`,
                `[contenteditable][data-placeholder*="${escaped}"]`,
                `[placeholder*="${escaped}"]`,
                `[aria-placeholder*="${escaped}"]`,
                `[data-testid*="tweetTextarea"]`,
            ].join(', ');
            await page.click(selectors, { timeout: 3000 });
            await page.keyboard.selectAll();
            await page.keyboard.press('Backspace');
            await page.keyboard.type(params.value, { delay: 30 });
            return { filled: true, method: 'contenteditable-click+type', value: params.value };
        } catch (e) {
            log(`contenteditable fill failed: ${e.message?.substring(0, 80)}`);
        }

        // Strategy 3: getByRole textbox + fill
        try {
            const el = page.getByRole('textbox', { name: params.text }).first();
            await el.fill(params.value, { timeout: Math.min(timeout, 5000) });
            return { filled: true, method: 'getByRole+fill', value: params.value };
        } catch (e) {
            log(`getByRole fill failed: ${e.message?.substring(0, 80)}`);
        }

        throw new Error(`Could not find element to fill with text "${params.text}"`);
    } else {
        // Fill focused element
        await page.keyboard.insertText(params.value);
        return { filled: true, method: 'keyboard-insert', value: params.value };
    }
}

async function screenshot(params) {
    if (!page) throw new Error('Browser not launched');

    const buffer = await page.screenshot({
        fullPage: params.fullPage || false,
        type: 'png',
    });
    return {
        base64: buffer.toString('base64'),
        width: (await page.viewportSize())?.width,
        height: (await page.viewportSize())?.height,
    };
}

async function getContent(params) {
    if (!page) throw new Error('Browser not launched');

    // Use innerText (visible text only) instead of textContent
    // (which includes hidden text from <style>/<script> elements).
    // This prevents X.com's noscript CSS from polluting the content.
    if (params.selector) {
        try {
            const text = await page.innerText(params.selector, { timeout: 5000 });
            return { content: text };
        } catch {
            // Fallback to textContent if innerText fails
            const text = await page.textContent(params.selector, { timeout: 5000 });
            return { content: text };
        }
    }
    try {
        const text = await page.innerText('body', { timeout: 5000 });
        return { content: text ? text.substring(0, 10000) : '' };
    } catch {
        const text = await page.textContent('body');
        return { content: text ? text.substring(0, 10000) : '' };
    }
}

async function executeScript(params) {
    if (!page) throw new Error('Browser not launched');
    const result = await page.evaluate(params.script);
    return { result };
}

async function waitForSelector(params) {
    if (!page) throw new Error('Browser not launched');
    await page.waitForSelector(params.selector, {
        timeout: params.timeout || 10000,
        state: params.state || 'visible',
    });
    return { found: true };
}

async function getUrl() {
    if (!page) throw new Error('Browser not launched');
    return { url: page.url(), title: await page.title() };
}

/**
 * Upload a file to an input[type="file"] element using Playwright's native
 * setInputFiles (the most reliable method for all frameworks).
 *
 * If `params.generateImage` is true and no `params.filePath` is given, a
 * temporary PNG image is generated via the browser's Canvas API and saved
 * to disk before uploading.
 *
 * @param {Object}  params
 * @param {string}  [params.selector]       CSS selector for the file input (default: 'input[type="file"]')
 * @param {string}  [params.filePath]       Path to an existing file on disk
 * @param {boolean} [params.generateImage]  If true, generate a temp image
 * @param {string}  [params.imageText]      Text to render on the generated image
 * @param {number}  [params.imageWidth]     Image width  (default 1080)
 * @param {number}  [params.imageHeight]    Image height (default 1080)
 * @param {number}  [params.timeout]        Timeout in ms (default 10000)
 */
async function uploadFile(params) {
    if (!page) throw new Error('Browser not launched');

    const selector = params.selector || 'input[type="file"]';
    let filePath = params.filePath;

    // Generate a temp image if requested and no filePath supplied
    if (!filePath && params.generateImage) {
        const os = require('os');
        filePath = path.join(os.tmpdir(), `xhs_temp_${Date.now()}.png`);

        const base64 = await page.evaluate(({ text, width, height }) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Warm gradient background
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, '#ffecd2');
            grad.addColorStop(1, '#fcb69f');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            // Decorative border
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 20;
            ctx.strokeRect(40, 40, width - 80, height - 80);

            // Main text with word wrap
            ctx.font = 'bold 64px "Microsoft YaHei", "PingFang SC", "Helvetica Neue", sans-serif';
            ctx.fillStyle = '#333';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const maxWidth = width * 0.75;
            const chars = text.split('');
            let line = '';
            const lines = [];
            for (const ch of chars) {
                const test = line + ch;
                if (ctx.measureText(test).width > maxWidth && line) {
                    lines.push(line);
                    line = ch;
                } else {
                    line = test;
                }
            }
            lines.push(line);

            const lineHeight = 80;
            const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
            lines.forEach((l, i) => {
                ctx.fillText(l, width / 2, startY + i * lineHeight);
            });

            return canvas.toDataURL('image/png').split(',')[1];
        }, {
            text: params.imageText || 'Hello World',
            width: params.imageWidth || 1080,
            height: params.imageHeight || 1080,
        });

        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
        log(`Generated temp image: ${filePath} (${Buffer.from(base64, 'base64').length} bytes)`);
    }

    if (!filePath) throw new Error('No filePath or generateImage specified');

    // Use Playwright's native setInputFiles — the gold standard for file uploads
    const locator = page.locator(selector).first();
    await locator.setInputFiles(filePath, { timeout: params.timeout || 15000 });

    log(`File uploaded via setInputFiles: ${filePath} -> ${selector}`);
    return { uploaded: true, filePath, selector };
}

async function close() {
    if (context) {
        await context.close().catch(() => {});
        context = null;
    }
    if (browser) {
        await browser.close().catch(() => {});
        browser = null;
    }
    page = null;
    return { closed: true };
}

const handlers = {
    connectCDP,
    launch,
    navigate,
    click,
    fill,
    screenshot,
    getContent,
    executeScript,
    waitForSelector,
    getUrl,
    uploadFile,
    close,
};

async function handleCommand(line) {
    let cmd;
    try {
        cmd = JSON.parse(line);
    } catch {
        send({ id: null, success: false, error: 'Invalid JSON' });
        return;
    }

    const { id, method, params } = cmd;
    const handler = handlers[method];

    if (!handler) {
        send({ id, success: false, error: `Unknown method: ${method}` });
        return;
    }

    try {
        const result = await handler(params || {});
        send({ id, success: true, result });
    } catch (error) {
        send({ id, success: false, error: error.message || String(error) });
    }
}

// Main
async function main() {
    send({ ready: true, pid: process.pid });
    log('Bridge ready, waiting for commands...');

    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', (line) => {
        if (line.trim()) {
            handleCommand(line.trim());
        }
    });

    rl.on('close', async () => {
        log('Stdin closed, shutting down...');
        await close();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await close();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        await close();
        process.exit(0);
    });
}

main();
