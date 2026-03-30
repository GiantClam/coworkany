import assert from 'node:assert/strict';
import { BrowserService } from '../src/runtime/browser/browserService';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${baseUrl}/health`);
            if (res.ok) {
                return;
            }
        } catch {
            // External service may not be reachable yet.
        }
        await sleep(500);
    }
    throw new Error(
        `browser-use-service is not healthy at ${baseUrl} within ${timeoutMs}ms. Start an external browser-use service before running this E2E.`,
    );
}

async function main(): Promise<void> {
    const configuredUrl = process.env.COWORKANY_TEST_BROWSER_USE_SERVICE_URL?.trim();
    const baseUrl = (configuredUrl && configuredUrl.length > 0)
        ? configuredUrl.replace(/\/$/, '')
        : 'http://127.0.0.1:8100';

    await waitForHealth(baseUrl, 20_000);

    const browserService = new BrowserService(baseUrl);
    await browserService.connect({ headless: true });

    const status = await browserService.getSmartModeStatus();
    assert.equal(status.available, true, `Smart mode expected available, got: ${status.reason || 'unknown'}`);
    assert.ok(status.sharedCdpUrl?.includes('localhost:'), `Missing sharedCdpUrl: ${JSON.stringify(status)}`);

    browserService.setMode('smart');

    const nav = await browserService.navigate('https://example.com');
    assert.ok(nav.title.includes('Example'), `Unexpected title: ${nav.title}`);

    const shot = await browserService.screenshot();
    assert.ok(shot.base64.length > 100, 'Screenshot base64 is unexpectedly short');

    await browserService.disconnect();
    console.log('E2E smart browser reuse passed');
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
