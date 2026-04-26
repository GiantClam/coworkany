import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TASK_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
const QUERY = '请用一句中文回复：桌面回归可用。';
const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input textarea',
    '.chat-input input',
    'textarea[placeholder*="instructions"]',
    'textarea',
    'input[placeholder="New instructions..."]',
    'input[type="text"]',
];

function parseBooleanEnv(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function hasProviderEnv(): boolean {
    return [
        process.env.E2E_AIBERM_API_KEY,
        process.env.OPENAI_API_KEY,
        process.env.OPENROUTER_API_KEY,
        process.env.ANTHROPIC_API_KEY,
        process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    ].some((value) => Boolean(value?.trim()));
}

function hasConfiguredLlmProfile(): boolean {
    const candidates = [
        path.join(process.cwd(), '..', 'sidecar', 'llm-config.json'),
        path.join(os.homedir(), 'Library', 'Application Support', 'com.coworkany.desktop', 'llm-config.json'),
    ];
    for (const configPath of candidates) {
        if (!fs.existsSync(configPath)) {
            continue;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
            if (typeof parsed.provider === 'string' && parsed.provider.trim().length > 0) {
                return true;
            }
            if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
                return true;
            }
        } catch {
            // ignore invalid config files
        }
    }
    return false;
}

async function findChatInput(page: any): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible({ timeout: 1_200 }).catch(() => false);
        if (visible) {
            return candidate;
        }
    }
    return null;
}

function extractLatestTaskId(logs: string): string | null {
    const patterns = [
        /"type":"TASK_STARTED","taskId":"([^"]+)"/g,
        /"taskId":"([^"]+)","type":"TASK_STARTED"/g,
    ];
    let last: string | null = null;
    for (const pattern of patterns) {
        for (const match of logs.matchAll(pattern)) {
            if (match[1]) {
                last = match[1];
            }
        }
    }
    return last;
}

function extractAssistantText(logs: string, taskId: string | null): string {
    let text = '';
    for (const line of logs.split('\n')) {
        if (!line.includes('"type":"TEXT_DELTA"')) {
            continue;
        }
        if (taskId && !line.includes(`"taskId":"${taskId}"`)) {
            continue;
        }
        const match = line.match(/"delta":"((?:[^"\\]|\\.)*)"/);
        if (match?.[1]) {
            try {
                text += JSON.parse(`"${match[1]}"`) as string;
            } catch {
                text += match[1];
            }
        }
    }
    return text.trim();
}

test.describe('Desktop live model user input regression', () => {
    const strict = parseBooleanEnv(process.env.COWORKANY_REQUIRE_DESKTOP_LIVE_REGRESSION);
    const hasLiveConfig = hasProviderEnv() || hasConfiguredLlmProfile();
    test.skip(!strict && !hasLiveConfig, 'Requires live model env or llm-config.json; set COWORKANY_REQUIRE_DESKTOP_LIVE_REGRESSION=1 to fail instead of skip.');
    test.setTimeout(TASK_TIMEOUT_MS + 120_000);

    test('submits a user message through the desktop UI and receives assistant text', async ({ page, tauriLogs }) => {
        if (!hasLiveConfig) {
            throw new Error('Live desktop regression requires provider env or llm-config.json.');
        }

        const testResultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(testResultsDir, { recursive: true });

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(8_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        tauriLogs.setBaseline();
        await input!.fill(QUERY);
        await input!.press('Enter');
        await page.waitForTimeout(1_500);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1_000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3_000 }).catch(() => {});
                await page.waitForTimeout(1_500);
            }
        }

        let submitted = false;
        let taskId: string | null = null;
        let taskFinished = false;
        let taskFailed = false;
        let assistantText = '';
        const startedAt = Date.now();

        while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);
            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();
            submitted = submitted
                || lower.includes('send_task_message command received')
                || lower.includes('start_task command received')
                || lower.includes('"type":"start_task"');
            taskId = taskId ?? extractLatestTaskId(logs);
            assistantText = extractAssistantText(logs, taskId);
            if (taskId) {
                taskFinished = logs.includes(`"type":"TASK_FINISHED","taskId":"${taskId}"`);
                taskFailed = logs.includes(`"type":"TASK_FAILED","taskId":"${taskId}"`);
            } else {
                taskFinished = lower.includes('"type":"task_finished"');
                taskFailed = lower.includes('"type":"task_failed"');
            }
            if (taskFinished || taskFailed) {
                break;
            }
        }

        const summary = {
            query: QUERY,
            submitted,
            taskId,
            taskFinished,
            taskFailed,
            assistantChars: assistantText.length,
            assistantTextPreview: assistantText.slice(0, 200),
        };
        fs.writeFileSync(
            path.join(testResultsDir, 'live-model-desktop-user-input-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'live-model-desktop-user-input-logs.txt'),
            tauriLogs.getRawSinceBaseline(),
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'live-model-desktop-user-input-final.png'),
        }).catch(() => {});

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'task should not fail').toBe(false);
        expect(taskFinished, 'task should finish').toBe(true);
        expect(assistantText.length, 'assistant should emit visible text').toBeGreaterThan(0);
        expect(assistantText, 'live model response should not be a capability-query shortcut').not.toContain('当前可调用');
    });
});
