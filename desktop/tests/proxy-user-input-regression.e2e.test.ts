import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
const QUERY = '请用一句中文回复“代理链路验证中”，不要调用工具。';
const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input textarea',
    '.chat-input input',
    'textarea[placeholder*="instructions"]',
    'textarea',
    'input[placeholder="New instructions..."]',
    'input[type="text"]',
];

type ProxySnapshot = {
    enabled?: boolean;
    source?: string | null;
    endpoint?: string | null;
    noProxy?: string | null;
};

type LlmTimingPayload = {
    event?: string;
    taskId?: string;
    outcome?: string;
    error?: string | null;
    finishReason?: string | null;
    assistantChars?: number;
    proxy?: {
        before?: ProxySnapshot;
        after?: ProxySnapshot;
    };
};

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeProxyEndpoint(raw: string): string {
    const trimmed = raw.trim();
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(candidate);
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname}${port}`;
}

function parseLatestLlmTiming(logs: string): LlmTimingPayload | null {
    let latest: LlmTimingPayload | null = null;
    const marker = '[coworkany-metrics]';
    for (const line of logs.split('\n')) {
        const index = line.indexOf(marker);
        if (index < 0) {
            continue;
        }
        const serialized = line.slice(index + marker.length).trim();
        if (serialized.length === 0) {
            continue;
        }
        try {
            const payload = JSON.parse(serialized) as LlmTimingPayload;
            if (payload?.event === 'llm_timing') {
                latest = payload;
            }
        } catch {
            // ignore non-json metric lines
        }
    }
    return latest;
}

async function findChatInput(page: any): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible({ timeout: 1200 }).catch(() => false);
        if (visible) {
            return candidate;
        }
    }
    return null;
}

test.describe('Desktop proxy regression - user input path', () => {
    const expectedProxyUrl = (process.env.COWORKANY_TEST_PROXY_URL ?? '').trim();
    test.skip(
        expectedProxyUrl.length === 0,
        'Requires COWORKANY_TEST_PROXY_URL (http://... or socks5://...)',
    );
    test.setTimeout(TASK_TIMEOUT_MS + 60_000);

    test('desktop message submit keeps proxy enabled in llm_timing snapshot', async ({ page, tauriLogs }) => {
        const testResultsDir = path.join(process.cwd(), 'test-results');
        ensureDir(testResultsDir);

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(10_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        tauriLogs.setBaseline();
        await input!.fill(QUERY);
        await input!.press('Enter');
        await page.waitForTimeout(1500);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(1500);
            }
        }

        let submitted = false;
        let llmTimingPayload: LlmTimingPayload | null = null;
        let sawTaskFailed = false;
        let sawUnsupportedProxyProtocol = false;

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);
            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();
            submitted =
                submitted
                || lower.includes('send_task_message command received')
                || lower.includes('start_task command received')
                || lower.includes('"type":"start_task"');
            sawTaskFailed = sawTaskFailed || lower.includes('"type":"task_failed"');
            sawUnsupportedProxyProtocol = sawUnsupportedProxyProtocol || lower.includes('unsupportedproxyprotocol');

            llmTimingPayload = parseLatestLlmTiming(logs);
            if (llmTimingPayload?.proxy?.after?.endpoint && (llmTimingPayload.assistantChars ?? 0) > 0) {
                break;
            }
        }

        const expectedEndpoint = normalizeProxyEndpoint(expectedProxyUrl);
        const summary = {
            query: QUERY,
            expectedProxyUrl,
            expectedEndpoint,
            submitted,
            sawTaskFailed,
            sawUnsupportedProxyProtocol,
            llmTimingPayload,
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'proxy-user-input-regression-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'proxy-user-input-regression-logs.txt'),
            tauriLogs.getRawSinceBaseline(),
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'proxy-user-input-regression-final.png'),
        }).catch(() => {});

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(llmTimingPayload, 'sidecar should emit llm_timing metric after desktop submit').not.toBeNull();
        expect(sawTaskFailed, 'desktop path should not emit TASK_FAILED for simple reply').toBe(false);
        expect(sawUnsupportedProxyProtocol, 'runtime should not report UnsupportedProxyProtocol').toBe(false);
        expect(llmTimingPayload?.proxy?.before?.enabled, 'proxy should be enabled before normalization').toBe(true);
        expect(llmTimingPayload?.proxy?.after?.enabled, 'proxy should remain enabled after normalization').toBe(true);
        expect(llmTimingPayload?.proxy?.after?.endpoint).toBe(expectedEndpoint);
        expect(llmTimingPayload?.finishReason, 'stream should not finish in error state').not.toBe('error');
        expect((llmTimingPayload?.assistantChars ?? 0) > 0, 'assistant should emit visible text').toBe(true);
    });
});
