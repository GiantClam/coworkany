import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: [
        ['html', { open: 'never' }],
        ['list'],
    ],
    use: {
        // No baseURL — the fixture connects to the Tauri WebView via CDP
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    // Increased timeout for E2E tests with Cargo build + login wait
    timeout: 10 * 60 * 1000, // 10 minutes per test
    expect: {
        timeout: 30_000,
    },
    // Output directory for screenshots and traces
    outputDir: './test-results',
    // No webServer — the tauriFixture manages the Tauri process
    webServer: undefined,
});
