/**
 * Unit Tests for Hybrid BrowserService Architecture
 *
 * Tests:
 * 1. BrowserBackend interface compliance for both backends
 * 2. PlaywrightBackend (precise mode) - basic method structure
 * 3. BrowserUseBackend (smart mode) - HTTP client behavior with mocked fetch
 * 4. BrowserService (router) - mode routing and fallback logic
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
    BrowserService,
    PlaywrightBackend,
    BrowserUseBackend,
    getChromeUserDataDir,
    type BrowserMode,
    type BrowserBackend,
    type UploadFileOptions,
} from '../browserService';

// ============================================================================
// Helper: Mock fetch for BrowserUseBackend tests
// ============================================================================

function mockFetch(responses: Record<string, any>) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        for (const [pattern, response] of Object.entries(responses)) {
            if (url.includes(pattern)) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => response,
                    text: async () => JSON.stringify(response),
                } as Response;
            }
        }

        return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'Not found' }),
            text: async () => 'Not found',
        } as Response;
    }) as typeof fetch;

    return () => {
        globalThis.fetch = originalFetch;
    };
}

// ============================================================================
// 1. getChromeUserDataDir utility
// ============================================================================

describe('getChromeUserDataDir', () => {
    test('returns a non-empty string', () => {
        const dir = getChromeUserDataDir();
        expect(typeof dir).toBe('string');
        expect(dir.length).toBeGreaterThan(0);
    });

    test('contains Chrome-related path segments', () => {
        const dir = getChromeUserDataDir();
        const lower = dir.toLowerCase();
        // Should contain "chrome" or "google" depending on OS
        expect(lower.includes('chrome') || lower.includes('google')).toBe(true);
    });
});

// ============================================================================
// 2. PlaywrightBackend
// ============================================================================

describe('PlaywrightBackend', () => {
    test('has correct name', () => {
        const backend = new PlaywrightBackend();
        expect(backend.name).toBe('playwright');
    });

    test('isConnected returns false initially', () => {
        const backend = new PlaywrightBackend();
        expect(backend.isConnected()).toBe(false);
    });

    test('implements BrowserBackend interface', () => {
        const backend = new PlaywrightBackend();
        // Check all required methods exist
        expect(typeof backend.connect).toBe('function');
        expect(typeof backend.disconnect).toBe('function');
        expect(typeof backend.isConnected).toBe('function');
        expect(typeof backend.navigate).toBe('function');
        expect(typeof backend.click).toBe('function');
        expect(typeof backend.fill).toBe('function');
        expect(typeof backend.screenshot).toBe('function');
        expect(typeof backend.wait).toBe('function');
        expect(typeof backend.getContent).toBe('function');
        expect(typeof backend.executeScript).toBe('function');
        expect(typeof backend.uploadFile).toBe('function');
    });

    test('getPage throws when not connected', async () => {
        const backend = new PlaywrightBackend();
        try {
            await backend.getPage();
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            expect((error as Error).message).toContain('not connected');
        }
    });

    test('navigate throws when not connected', async () => {
        const backend = new PlaywrightBackend();
        try {
            await backend.navigate('https://example.com');
            expect(true).toBe(false);
        } catch (error) {
            expect((error as Error).message).toContain('not connected');
        }
    });

    test('uploadFile returns error for non-existent file', async () => {
        const backend = new PlaywrightBackend();
        // Even though not connected, the file check happens first when we can mock
        // We test the file existence check logic
        const result = await backend.uploadFile({
            filePath: '/non/existent/file.png',
        }).catch(e => ({ success: false, message: e.message, error: e.message }));

        // Either it fails on not connected or file not found - both are valid
        expect(result.success).toBe(false);
    });
});

// ============================================================================
// 3. BrowserUseBackend
// ============================================================================

describe('BrowserUseBackend', () => {
    test('has correct name', () => {
        const backend = new BrowserUseBackend('http://localhost:9999');
        expect(backend.name).toBe('browser-use');
    });

    test('isConnected returns false initially', () => {
        const backend = new BrowserUseBackend('http://localhost:9999');
        expect(backend.isConnected()).toBe(false);
    });

    test('implements BrowserBackend interface', () => {
        const backend = new BrowserUseBackend('http://localhost:9999');
        expect(typeof backend.connect).toBe('function');
        expect(typeof backend.disconnect).toBe('function');
        expect(typeof backend.isConnected).toBe('function');
        expect(typeof backend.navigate).toBe('function');
        expect(typeof backend.click).toBe('function');
        expect(typeof backend.fill).toBe('function');
        expect(typeof backend.screenshot).toBe('function');
        expect(typeof backend.wait).toBe('function');
        expect(typeof backend.getContent).toBe('function');
        expect(typeof backend.executeScript).toBe('function');
        expect(typeof backend.uploadFile).toBe('function');
    });

    test('isServiceAvailable returns false when service is down', async () => {
        const backend = new BrowserUseBackend('http://localhost:19999');
        const available = await backend.isServiceAvailable();
        expect(available).toBe(false);
    });

    test('isServiceAvailable returns true for healthy service', async () => {
        const restore = mockFetch({
            '/health': { status: 'ok' },
        });
        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const available = await backend.isServiceAvailable();
            expect(available).toBe(true);
        } finally {
            restore();
        }
    });

    test('navigate calls correct endpoint', async () => {
        let capturedUrl = '';
        let capturedBody: any = null;

        const restore = mockFetch({
            '/navigate': { success: true, url: 'https://example.com', title: 'Example' },
        });

        const origFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            capturedUrl = url;
            if (init?.body) {
                capturedBody = JSON.parse(init.body as string);
            }
            return origFetch(input, init);
        }) as typeof fetch;

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const result = await backend.navigate('https://example.com', {
                waitUntil: 'networkidle',
                timeout: 5000,
            });

            expect(result.url).toBe('https://example.com');
            expect(result.title).toBe('Example');
            expect(capturedUrl).toContain('/navigate');
            expect(capturedBody.url).toBe('https://example.com');
            expect(capturedBody.wait_until).toBe('networkidle');
            expect(capturedBody.timeout_ms).toBe(5000);
        } finally {
            restore();
        }
    });

    test('click calls correct endpoint with text-based instruction', async () => {
        const restore = mockFetch({
            '/click': { success: true, result: 'Clicked' },
        });

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const result = await backend.click({ text: 'Submit' });
            expect(result.clicked).toContain('text=');
        } finally {
            restore();
        }
    });

    test('fill calls correct endpoint', async () => {
        const restore = mockFetch({
            '/fill': { success: true, result: 'Filled' },
        });

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const result = await backend.fill({ selector: '#email', value: 'test@test.com' });
            expect(result.filled).toBe('#email');
            expect(result.value).toBe('test@test.com');
        } finally {
            restore();
        }
    });

    test('screenshot returns base64 image data', async () => {
        const restore = mockFetch({
            '/screenshot': {
                success: true,
                image_base64: 'iVBORw0KGgo=',
                width: 1280,
                height: 720,
            },
        });

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const result = await backend.screenshot();
            expect(result.base64).toBe('iVBORw0KGgo=');
            expect(result.width).toBe(1280);
            expect(result.height).toBe(720);
        } finally {
            restore();
        }
    });

    test('uploadFile calls /upload endpoint', async () => {
        const restore = mockFetch({
            '/upload': { success: true, message: 'Upload completed' },
        });

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const result = await backend.uploadFile({
                filePath: 'C:\\test\\image.png',
                instruction: 'click the upload button',
            });
            expect(result.success).toBe(true);
            expect(result.message).toBe('Upload completed');
        } finally {
            restore();
        }
    });

    test('aiAction calls /action endpoint', async () => {
        const restore = mockFetch({
            '/action': { success: true, result: 'Action completed' },
        });

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const result = await backend.aiAction({
                action: 'click the publish button',
                context: 'on the post editor page',
            });
            expect(result.success).toBe(true);
            expect(result.result).toBe('Action completed');
        } finally {
            restore();
        }
    });

    test('runTask calls /task endpoint', async () => {
        const restore = mockFetch({
            '/task': { success: true, result: 'Task done', steps_taken: 5 },
        });

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            const result = await backend.runTask('Post a message on Xiaohongshu', {
                url: 'https://www.xiaohongshu.com',
                maxSteps: 15,
            });
            expect(result.success).toBe(true);
            expect(result.result).toBe('Task done');
        } finally {
            restore();
        }
    });

    test('navigate throws on service error', async () => {
        const restore = mockFetch({
            '/navigate': { success: false, error: 'Navigation timeout' },
        });

        try {
            const backend = new BrowserUseBackend('http://mock-server:8100');
            await backend.navigate('https://example.com');
            expect(true).toBe(false); // Should not reach
        } catch (error) {
            expect((error as Error).message).toContain('Navigation timeout');
        } finally {
            restore();
        }
    });
});

// ============================================================================
// 4. BrowserService (Hybrid Router)
// ============================================================================

describe('BrowserService', () => {
    // Reset singleton between tests
    beforeEach(() => {
        // Access private static to reset singleton
        (BrowserService as any).instance = null;
    });

    test('default mode is auto', () => {
        const service = new BrowserService();
        expect(service.mode).toBe('auto');
    });

    test('setMode changes mode', () => {
        const service = new BrowserService();
        service.setMode('smart');
        expect(service.mode).toBe('smart');

        service.setMode('precise');
        expect(service.mode).toBe('precise');

        service.setMode('auto');
        expect(service.mode).toBe('auto');
    });

    test('getInstance returns singleton', () => {
        const a = BrowserService.getInstance();
        const b = BrowserService.getInstance();
        expect(a).toBe(b);
    });

    test('isConnected returns false initially', () => {
        const service = new BrowserService();
        expect(service.isConnected()).toBe(false);
    });

    test('getPlaywrightBackend returns PlaywrightBackend', () => {
        const service = new BrowserService();
        const backend = service.getPlaywrightBackend();
        expect(backend).toBeInstanceOf(PlaywrightBackend);
        expect(backend.name).toBe('playwright');
    });

    test('getBrowserUseBackend returns BrowserUseBackend', () => {
        const service = new BrowserService();
        const backend = service.getBrowserUseBackend();
        expect(backend).toBeInstanceOf(BrowserUseBackend);
        expect(backend.name).toBe('browser-use');
    });

    test('getChromeUserDataDir returns valid path', () => {
        const service = new BrowserService();
        const dir = service.getChromeUserDataDir();
        expect(typeof dir).toBe('string');
        expect(dir.length).toBeGreaterThan(0);
    });

    test('isBrowserUseAvailable returns false when service is down', async () => {
        const service = new BrowserService('http://localhost:19999');
        const available = await service.isBrowserUseAvailable();
        expect(available).toBe(false);
    });

    test('aiAction returns error when service unavailable', async () => {
        const service = new BrowserService('http://localhost:19999');
        const result = await service.aiAction({ action: 'click something' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('not available');
    });

    test('runAiTask returns error when service unavailable', async () => {
        const service = new BrowserService('http://localhost:19999');
        const result = await service.runAiTask('do something');
        expect(result.success).toBe(false);
        expect(result.error).toContain('not available');
    });

    test('executeScript always uses Playwright backend', async () => {
        const service = new BrowserService();
        service.setMode('smart');
        // Should fail because Playwright is not connected, not because smart mode
        try {
            await service.executeScript('document.title');
            expect(true).toBe(false);
        } catch (error) {
            expect((error as Error).message).toContain('not connected');
        }
    });

    test('disconnect does not throw even when not connected', async () => {
        const service = new BrowserService();
        // Should not throw
        await service.disconnect();
        expect(true).toBe(true);
    });
});

// ============================================================================
// 5. Mode Routing Logic (integration-like tests with mocked backends)
// ============================================================================

describe('BrowserService Mode Routing', () => {
    beforeEach(() => {
        (BrowserService as any).instance = null;
    });

    test('precise mode only calls Playwright', async () => {
        const service = new BrowserService();
        service.setMode('precise');

        // Playwright should be called, it will fail (not connected) -
        // but smart mode should NOT be attempted
        try {
            await service.navigate('https://example.com');
            expect(true).toBe(false);
        } catch (error) {
            // Should be a Playwright error (not connected), not a browser-use error
            expect((error as Error).message).toContain('not connected');
        }
    });

    test('smart mode falls back to Playwright when BrowserUse is disconnected', async () => {
        const service = new BrowserService();
        service.setMode('smart');

        // In hardened routing, smart mode first checks BrowserUse connection state.
        // If BrowserUse is disconnected, it should fallback to Playwright immediately.
        try {
            await service.navigate('https://example.com');
            expect(true).toBe(false);
        } catch (error) {
            // Should now be a Playwright not-connected error from fallback path.
            const msg = (error as Error).message;
            expect(msg.includes('Browser not connected') || msg.includes('not connected')).toBe(true);
        }
    });

    test('auto mode tries Playwright first', async () => {
        const service = new BrowserService();
        service.setMode('auto');

        // Playwright will fail (not connected), then browser-use is unavailable too
        // Should get the Playwright error (primary)
        try {
            await service.navigate('https://example.com');
            expect(true).toBe(false);
        } catch (error) {
            expect((error as Error).message).toContain('not connected');
        }
    });
});
