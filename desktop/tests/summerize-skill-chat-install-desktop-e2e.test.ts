/**
 * Desktop GUI E2E: chat-driven ClawHub summerize skill lifecycle
 *
 * Run:
 *   cd desktop && npx playwright test tests/summerize-skill-chat-install-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_TIMEOUT_MS = 8 * 60 * 1000;
const INSTALL_WAIT_TIMEOUT_MS = 120_000;
const USAGE_WAIT_TIMEOUT_MS = 90_000;
const MOCK_STORE_PORT = 18994;
const MOCK_SKILL_NAME = 'summerize';
const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const DESKTOP_ROOT = path.resolve(__dirnameLocal, '..');
const SIDECAR_ROOT = path.resolve(__dirnameLocal, '../../sidecar');
const SIDECAR_WORKSPACE_ROOT = path.join(SIDECAR_ROOT, 'workspace');
const SCANNER_CACHE_PATH = path.join(DESKTOP_ROOT, 'scanned-repos-cache.json');
const SKILLS_JSON_PATH = path.join(SIDECAR_ROOT, '.coworkany', 'skills.json');
const SKILL_DIR_PATH = path.join(SIDECAR_ROOT, '.coworkany', 'skills', MOCK_SKILL_NAME);
const BACKUP_SKILL_DIR = path.join(os.tmpdir(), `coworkany-${MOCK_SKILL_NAME}-backup-${Date.now()}`);
const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="指令"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

type ResolveSkillResult = {
    success: boolean;
    query: string;
    resolution: 'local' | 'installed_from_market' | 'create_new';
    should_create: boolean;
    skill?: {
        name: string;
        description?: string;
        source?: string;
        directory?: string;
    };
};

type MockStoreServer = {
    close: () => Promise<void>;
    hits: string[];
};

let originalSkillsJson: string | null = null;
let backedUpOriginalSkillDir = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedEmptyRepositoryScanCache(): void {
    fs.writeFileSync(
        SCANNER_CACHE_PATH,
        JSON.stringify({
            timestamp: Date.now(),
            data: {
                skills: [],
                mcpServers: [],
                errors: [],
            },
        }),
        'utf-8',
    );
}

function cleanupRepositoryScanCache(): void {
    fs.rmSync(SCANNER_CACHE_PATH, { force: true });
}

function pruneSummerizeSkillState(): void {
    originalSkillsJson = fs.existsSync(SKILLS_JSON_PATH)
        ? fs.readFileSync(SKILLS_JSON_PATH, 'utf-8')
        : null;

    if (fs.existsSync(SKILL_DIR_PATH)) {
        fs.rmSync(BACKUP_SKILL_DIR, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(BACKUP_SKILL_DIR), { recursive: true });
        fs.cpSync(SKILL_DIR_PATH, BACKUP_SKILL_DIR, { recursive: true });
        backedUpOriginalSkillDir = true;
    } else {
        backedUpOriginalSkillDir = false;
        fs.rmSync(BACKUP_SKILL_DIR, { recursive: true, force: true });
    }

    const parsed = originalSkillsJson ? (JSON.parse(originalSkillsJson) as Record<string, unknown>) : {};
    delete parsed[MOCK_SKILL_NAME];

    fs.mkdirSync(path.dirname(SKILLS_JSON_PATH), { recursive: true });
    fs.writeFileSync(SKILLS_JSON_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
    fs.rmSync(SKILL_DIR_PATH, { recursive: true, force: true });
}

function restoreSummerizeSkillState(): void {
    if (originalSkillsJson === null) {
        fs.rmSync(SKILLS_JSON_PATH, { force: true });
    } else {
        fs.mkdirSync(path.dirname(SKILLS_JSON_PATH), { recursive: true });
        fs.writeFileSync(SKILLS_JSON_PATH, originalSkillsJson, 'utf-8');
    }

    fs.rmSync(SKILL_DIR_PATH, { recursive: true, force: true });
    if (backedUpOriginalSkillDir && fs.existsSync(BACKUP_SKILL_DIR)) {
        fs.mkdirSync(path.dirname(SKILL_DIR_PATH), { recursive: true });
        fs.cpSync(BACKUP_SKILL_DIR, SKILL_DIR_PATH, { recursive: true });
    }
    fs.rmSync(BACKUP_SKILL_DIR, { recursive: true, force: true });
}

async function startMockStoreServer(port: number): Promise<MockStoreServer> {
    const hits: string[] = [];
    const host = `http://127.0.0.1:${port}`;

    const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url || '/', host);
        hits.push(`${req.method || 'GET'} ${requestUrl.pathname}${requestUrl.search}`);

        const sendJson = (status: number, payload: unknown) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        };

        if (requestUrl.pathname === '/api/skills/search') {
            sendJson(200, {
                skills: [
                    {
                        name: MOCK_SKILL_NAME,
                        slug: MOCK_SKILL_NAME,
                        displayName: 'summarize skills from clawhub',
                        description: 'summerize skill from ClawHub that summarizes long text into a concise Chinese digest.',
                        author: 'qa',
                        version: '1.0.0',
                        repoUrl: `${host}/repo/${MOCK_SKILL_NAME}`,
                        files: ['SKILL.md'],
                        tags: ['summerize', 'summarize', 'clawhub'],
                    },
                ],
            });
            return;
        }

        if (requestUrl.pathname === `/api/skills/${MOCK_SKILL_NAME}`) {
            sendJson(200, {
                name: MOCK_SKILL_NAME,
                slug: MOCK_SKILL_NAME,
                displayName: 'summarize skills from clawhub',
                description: 'summerize skill from ClawHub that summarizes long text into a concise Chinese digest.',
                author: 'qa',
                version: '1.0.0',
                repoUrl: `${host}/repo/${MOCK_SKILL_NAME}`,
                files: ['SKILL.md'],
                tags: ['summerize', 'summarize', 'clawhub'],
            });
            return;
        }

        if (requestUrl.pathname === `/repo/${MOCK_SKILL_NAME}/raw/main/SKILL.md`) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(`---
name: ${MOCK_SKILL_NAME}
description: Desktop E2E summarization skill installed from ClawHub.
user-invocable: true
disable-model-invocation: false
triggers:
  - summerize
  - summarize
  - 总结
---

# ${MOCK_SKILL_NAME}

Use this skill whenever the user explicitly asks to use summerize or asks for a concise summary.

When the user asks to summarize content with this skill:
1. Reply in Chinese.
2. Start the reply with "SUMMERIZE_SKILL_ACTIVE:".
3. Provide a concise summary in one short paragraph.
`);
            return;
        }

        sendJson(404, { error: 'not_found', path: requestUrl.pathname });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });

    return {
        hits,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

async function findChatInput(page: any, timeoutMs = 30_000): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = page.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
            const enabled = await candidate.isEnabled().catch(() => false);
            if (visible && enabled) {
                return candidate;
            }
        }
        await sleep(400);
    }
    return null;
}

async function submitMessage(page: any, text: string): Promise<void> {
    const input = await findChatInput(page, 90_000);
    expect(input, 'desktop UI should expose chat input').not.toBeNull();
    await input!.fill(text);
    await input!.press('Enter');
    await page.waitForTimeout(1500);
}

function parseToolCallNames(rawLogs: string): string[] {
    const names: string[] = [];
    const regex = /"type":"TOOL_CALL".*?"name":"([^"]+)"/g;
    let match: RegExpExecArray | null = regex.exec(rawLogs);
    while (match) {
        names.push(match[1]);
        match = regex.exec(rawLogs);
    }
    return names;
}

function parseResolveSkillResults(rawLogs: string): ResolveSkillResult[] {
    const results: ResolveSkillResult[] = [];
    const regex = /"type":"TOOL_RESULT".*?"name":"resolve_skill_request".*?"result":"((?:\\.|[^"\\])*)"/g;
    let match: RegExpExecArray | null = regex.exec(rawLogs);

    while (match) {
        try {
            const decoded = JSON.parse(`"${match[1]}"`) as string;
            results.push(JSON.parse(decoded) as ResolveSkillResult);
        } catch {
            // Ignore partial stream lines while logs are still flushing.
        }
        match = regex.exec(rawLogs);
    }

    return results;
}

function readInstalledSkillsJson(): Record<string, unknown> {
    if (!fs.existsSync(SKILLS_JSON_PATH)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(SKILLS_JSON_PATH, 'utf-8')) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function findNewestInstalledSkillDirectory(skillName: string): string | null {
    if (!fs.existsSync(SIDECAR_WORKSPACE_ROOT)) {
        return null;
    }

    let newestPath: string | null = null;
    let newestMtime = 0;

    for (const entry of fs.readdirSync(SIDECAR_WORKSPACE_ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const candidate = path.join(SIDECAR_WORKSPACE_ROOT, entry.name, '.coworkany', 'skills', skillName, 'SKILL.md');
        if (!fs.existsSync(candidate)) {
            continue;
        }

        const stat = fs.statSync(candidate);
        if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestPath = path.dirname(candidate);
        }
    }

    return newestPath;
}

async function waitForInstallFromChat(page: any, tauriLogs: any): Promise<{
    submitted: boolean;
    taskFailed: boolean;
    toolCallNames: string[];
    resolveResult: ResolveSkillResult | null;
}> {
    let submitted = false;
    let taskFailed = false;
    let toolCallNames: string[] = [];
    let resolveResult: ResolveSkillResult | null = null;

    const startedAt = Date.now();
    while (Date.now() - startedAt < INSTALL_WAIT_TIMEOUT_MS) {
        await sleep(3000);
        const rawLogs = tauriLogs.getRawSinceBaseline();

        submitted = submitted || rawLogs.includes('send_task_message command received');
        taskFailed = taskFailed || rawLogs.includes('"type":"TASK_FAILED"');
        toolCallNames = parseToolCallNames(rawLogs);
        resolveResult = parseResolveSkillResults(rawLogs).at(-1) ?? null;

        if (!submitted && !page.isClosed()) {
            const sendButton = page.locator('button[type="submit"], .send-button').first();
            const sendVisible = await sendButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (sendVisible) {
                await sendButton.click({ timeout: 3000 }).catch(() => {});
                await sleep(1500);
                continue;
            }
        }

        if (resolveResult || taskFailed) {
            break;
        }
    }

    return {
        submitted,
        taskFailed,
        toolCallNames,
        resolveResult,
    };
}

function expectResolveBeforeFallbackTools(toolCallNames: string[]): void {
    const resolveIndex = toolCallNames.indexOf('resolve_skill_request');
    const searchWebIndex = toolCallNames.indexOf('search_web');

    expect(resolveIndex, 'agent should call resolve_skill_request before deciding on skill installation').toBeGreaterThanOrEqual(0);

    if (searchWebIndex >= 0) {
        expect(searchWebIndex, 'search_web must not run before resolve_skill_request').toBeGreaterThan(resolveIndex);
    }
}

async function openSkillsPanel(page: any): Promise<void> {
    const skillsButton = page.locator('button.chat-header-icon-button:has-text("SK")').first();
    await skillsButton.waitFor({ state: 'visible', timeout: 60_000 });
    await skillsButton.click();
    await expect(page.getByRole('button', { name: 'ClawHub' }).first()).toBeVisible({ timeout: 20_000 });
}

async function closeSkillsPanel(page: any): Promise<void> {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
}

async function createFreshSession(page: any): Promise<void> {
    const newSessionButton = page.locator('.chat-header-new-session').first();
    await expect(newSessionButton).toBeVisible({ timeout: 20_000 });
    await newSessionButton.click();
    await page.waitForTimeout(1000);
}

test.describe('Desktop GUI E2E - chat install, use, and uninstall summerize skill', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test.beforeAll(() => {
        process.env.OPENCLAW_STORE_CLAWHUB_BASE_URL = `http://127.0.0.1:${MOCK_STORE_PORT}`;
        seedEmptyRepositoryScanCache();
        pruneSummerizeSkillState();
    });

    test.afterAll(() => {
        delete process.env.OPENCLAW_STORE_CLAWHUB_BASE_URL;
        cleanupRepositoryScanCache();
        restoreSummerizeSkillState();
    });

    test('installs summerize from chat, uses it in a fresh session, then uninstalls it cleanly from Installed skills', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        const mockServer = await startMockStoreServer(MOCK_STORE_PORT);

        try {
            expect(page.isClosed(), 'desktop main window should remain open after fixture bootstrap').toBe(false);
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(12_000);

            await createFreshSession(page);
            tauriLogs.setBaseline();
            await submitMessage(page, 'Install the summerize skill from ClawHub.');

            const { taskFailed, resolveResult } = await waitForInstallFromChat(page, tauriLogs);
            expect(taskFailed, 'summerize install request should not fail before routing').toBe(false);

            const installedSkillDirectory =
                resolveResult?.skill?.directory ?? findNewestInstalledSkillDirectory(MOCK_SKILL_NAME);

            if (resolveResult) {
                expect(resolveResult.resolution).toBe('installed_from_market');
                expect(resolveResult.should_create).toBe(false);
                expect(resolveResult.skill?.name).toBe(MOCK_SKILL_NAME);
            }
            expect(installedSkillDirectory, 'summerize skill should be discoverable on disk after chat install').toBeTruthy();

            await expect.poll(
                () => fs.existsSync(path.join(installedSkillDirectory!, 'SKILL.md')),
                {
                    timeout: 30_000,
                    intervals: [500, 1000, 2000],
                    message: 'summerize skill files should be installed on disk',
                },
            ).toBe(true);

            await expect.poll(
                () => Boolean(readInstalledSkillsJson()[MOCK_SKILL_NAME]),
                {
                    timeout: 30_000,
                    intervals: [500, 1000, 2000],
                    message: 'summerize should be recorded in skills.json after installation',
                },
            ).toBe(true);

            await createFreshSession(page);
            tauriLogs.setBaseline();
            await submitMessage(
                page,
                '请使用 summerize 总结下面这段文字，只返回最终摘要，不要做安装验证，也不要搜索网页：OpenAI、Anthropic、Google 和 Meta 正在加速多模态模型发布，企业需要平衡速度、成本和可靠性。',
            );

            let autoTriggered = false;
            let taskUsageFailed = false;
            let taskUsageFinished = false;
            let searchedWeb = false;
            let sawSkillResponse = false;
            const usageStartedAt = Date.now();
            while (Date.now() - usageStartedAt < USAGE_WAIT_TIMEOUT_MS) {
                await sleep(3000);
                const usageLogs = tauriLogs.getRawSinceBaseline();
                const pageText = await page.locator('body').innerText().catch(() => '');

                autoTriggered =
                    autoTriggered || usageLogs.includes(`[Skill] Auto-triggered skills: ${MOCK_SKILL_NAME}`);
                taskUsageFailed = taskUsageFailed || usageLogs.includes('"type":"TASK_FAILED"');
                taskUsageFinished = taskUsageFinished || usageLogs.includes('"type":"TASK_FINISHED"');
                searchedWeb = searchedWeb || usageLogs.includes('"name":"search_web"');
                sawSkillResponse =
                    sawSkillResponse ||
                    usageLogs.includes('SUMMERIZE_SKILL_ACTIVE:') ||
                    pageText.includes('SUMMERIZE_SKILL_ACTIVE:') ||
                    pageText.includes('多模态模型') ||
                    pageText.includes('速度、成本与可靠性');

                if (taskUsageFailed || sawSkillResponse || (autoTriggered && taskUsageFinished)) {
                    break;
                }
            }

            const joinedHits = mockServer.hits.join('\n');
            expect(joinedHits).toContain('/api/skills/search');
            expect(joinedHits).toContain(`/api/skills/${MOCK_SKILL_NAME}`);
            expect(joinedHits).toContain(`/repo/${MOCK_SKILL_NAME}/raw/main/SKILL.md`);
            expect(taskUsageFailed, 'summerize usage request should not fail').toBe(false);
            expect(autoTriggered, 'summerize should auto-trigger after installation').toBe(true);
            expect(sawSkillResponse, 'assistant should return a visible summary after summerize auto-triggers').toBe(true);
            expect(searchedWeb, 'summerize usage should not fall back to search_web').toBe(false);

            await openSkillsPanel(page);

            const skillListEntry = page.locator('span', { hasText: MOCK_SKILL_NAME }).first();
            await expect(skillListEntry).toBeVisible({ timeout: 20_000 });
            await skillListEntry.click();

            const uninstallButton = page.getByRole('button', { name: /^(Uninstall Skill|卸载技能)$/ }).first();
            await expect(page.getByText(MOCK_SKILL_NAME).first()).toBeVisible({ timeout: 20_000 });
            await uninstallButton.scrollIntoViewIfNeeded().catch(() => {});
            await expect(uninstallButton).toBeVisible({ timeout: 20_000 });

            page.once('dialog', (dialog) => dialog.accept());
            tauriLogs.setBaseline();
            await uninstallButton.click();

            await expect.poll(
                () => {
                    const uninstallLogs = tauriLogs.getRawSinceBaseline();
                    const parsed = readInstalledSkillsJson();
                    return uninstallLogs.includes('"type":"remove_claude_skill_response"') && !parsed[MOCK_SKILL_NAME];
                },
                {
                    timeout: 30_000,
                    intervals: [500, 1000, 2000],
                    message: 'summerize uninstall should complete and clear skills.json',
                },
            ).toBe(true);

            expect(fs.existsSync(installedSkillDirectory!), 'summerize skill directory should be removed after uninstall').toBe(false);
            expect(readInstalledSkillsJson()[MOCK_SKILL_NAME], 'summerize skill entry should be removed after uninstall').toBeUndefined();
            await expect(page.getByRole('button', { name: /^(Uninstall Skill|卸载技能)$/ })).toHaveCount(0);
        } finally {
            await mockServer.close();
        }
    });
});
