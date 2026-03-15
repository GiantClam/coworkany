import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_TIMEOUT_MS = 6 * 60 * 1000;
const TOOL_WAIT_TIMEOUT_MS = 120_000;
const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const SIDECAR_SKILLS_ROOT = path.resolve(__dirnameLocal, '../../sidecar/.coworkany/skills');
const DESKTOP_ROOT = path.resolve(__dirnameLocal, '..');
const MOCK_LOCAL_SKILL_NAME = 'codex-e2e-nanobanana-local';
const MOCK_LOCAL_SKILL_DIR = path.join(SIDECAR_SKILLS_ROOT, MOCK_LOCAL_SKILL_NAME);
const MISSING_SKILL_QUERY = 'zzqxjv-florp-bnask-skill-20260312';
const MOCK_STORE_PORT = 18991;
const SCANNER_CACHE_PATH = path.join(DESKTOP_ROOT, 'scanned-repos-cache.json');

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
    };
};

type MockStoreServer = {
    close: () => Promise<void>;
};

function ensureMockLocalSkill(): void {
    fs.mkdirSync(MOCK_LOCAL_SKILL_DIR, { recursive: true });
    fs.writeFileSync(
        path.join(MOCK_LOCAL_SKILL_DIR, 'SKILL.md'),
        `---
name: ${MOCK_LOCAL_SKILL_NAME}
description: Local nanobanana 2 image generation skill used by desktop E2E.
tags:
  - nanobanana
  - image-generation
  - e2e
triggers:
  - nanobanana 2
  - image generation
---

# ${MOCK_LOCAL_SKILL_NAME}

Use this skill when the user needs nanobanana 2 image generation.
`,
        'utf-8',
    );
}

function cleanupMockLocalSkill(): void {
    fs.rmSync(MOCK_LOCAL_SKILL_DIR, { recursive: true, force: true });
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

async function startEmptyClawHubStore(port: number): Promise<MockStoreServer> {
    const server = http.createServer((req, res) => {
        if ((req.url || '').startsWith('/api/skills/search')) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ skills: [] }));
            return;
        }

        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });

    return {
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
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

async function submitMessage(page: any, text: string): Promise<void> {
    const input = await findChatInput(page);
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
            // Ignore malformed partial lines while stream is still flushing.
        }
        match = regex.exec(rawLogs);
    }

    return results;
}

async function waitForResolvePhase(page: any, tauriLogs: any): Promise<{
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
    while (Date.now() - startedAt < TOOL_WAIT_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
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
                await new Promise((resolve) => setTimeout(resolve, 1500));
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
    const triggerLearningIndex = toolCallNames.indexOf('trigger_learning');

    expect(resolveIndex, 'agent should call resolve_skill_request for skill creation requests').toBeGreaterThanOrEqual(0);

    if (searchWebIndex >= 0) {
        expect(searchWebIndex, 'search_web must not run before resolve_skill_request').toBeGreaterThan(resolveIndex);
    }

    if (triggerLearningIndex >= 0) {
        expect(triggerLearningIndex, 'trigger_learning must not run before resolve_skill_request').toBeGreaterThan(resolveIndex);
    }
}

let mockStoreServer: MockStoreServer | null = null;

test.beforeAll(async () => {
    process.env.OPENCLAW_STORE_CLAWHUB_BASE_URL = `http://127.0.0.1:${MOCK_STORE_PORT}`;
    ensureMockLocalSkill();
    seedEmptyRepositoryScanCache();
    mockStoreServer = await startEmptyClawHubStore(MOCK_STORE_PORT);
});

test.afterAll(async () => {
    if (mockStoreServer) {
        await mockStoreServer.close();
        mockStoreServer = null;
    }
    delete process.env.OPENCLAW_STORE_CLAWHUB_BASE_URL;
    cleanupRepositoryScanCache();
    cleanupMockLocalSkill();
});

test.describe('Desktop GUI E2E - skill resolution flow', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('reuses an installed local skill before considering creation', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        tauriLogs.setBaseline();
        await submitMessage(
            page,
            'Create a skill for using nanobanana 2 to generate images.'
        );

        const { submitted, taskFailed, toolCallNames, resolveResult } = await waitForResolvePhase(page, tauriLogs);

        expect(submitted, 'desktop should submit the skill request into the task pipeline').toBe(true);
        expect(taskFailed, 'skill-resolution request should not fail before routing').toBe(false);
        expectResolveBeforeFallbackTools(toolCallNames);
        expect(resolveResult, 'resolve_skill_request should produce a result').not.toBeNull();
        expect(resolveResult!.resolution).toBe('local');
        expect(resolveResult!.should_create).toBe(false);
        expect(resolveResult!.skill?.name).toBe(MOCK_LOCAL_SKILL_NAME);
    });

    test('falls back to create_new when no local or marketplace skill matches', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        tauriLogs.setBaseline();
        await submitMessage(
            page,
            `Create a skill for ${MISSING_SKILL_QUERY}.`
        );

        const { submitted, taskFailed, toolCallNames, resolveResult } = await waitForResolvePhase(page, tauriLogs);

        expect(submitted, 'desktop should submit the missing-skill request into the task pipeline').toBe(true);
        expect(taskFailed, 'missing-skill request should not fail before routing').toBe(false);
        expectResolveBeforeFallbackTools(toolCallNames);
        expect(resolveResult, 'resolve_skill_request should produce a result').not.toBeNull();
        expect(resolveResult!.resolution).toBe('create_new');
        expect(resolveResult!.should_create).toBe(true);
    });
});
