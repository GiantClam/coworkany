import { test, expect, type Locator } from './tauriFixtureRelease';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

const TASK_TIMEOUT_MS = 8 * 60 * 1000;
const MOCK_STORE_PORT = 18992;
const MOCK_SKILL_NAME = 'nanobanana-2-skill';
const PACKAGED_SIDECAR_STATE_DIR = path.resolve(
    process.cwd(),
    'src-tauri',
    'target',
    'x86_64-pc-windows-msvc',
    'release',
    'sidecar',
    '.coworkany',
);
const PACKAGED_SKILLS_JSON_PATH = path.join(PACKAGED_SIDECAR_STATE_DIR, 'skills.json');
const PACKAGED_SKILL_DIR = path.join(PACKAGED_SIDECAR_STATE_DIR, 'skills', MOCK_SKILL_NAME);

process.env.OPENCLAW_STORE_CLAWHUB_BASE_URL ??= `http://127.0.0.1:${MOCK_STORE_PORT}`;

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

type MockStoreServer = {
    close: () => Promise<void>;
    hits: string[];
};

let originalPackagedSkillsJson: string | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function prunePackagedNanobananaSkill(): void {
    originalPackagedSkillsJson = fs.existsSync(PACKAGED_SKILLS_JSON_PATH)
        ? fs.readFileSync(PACKAGED_SKILLS_JSON_PATH, 'utf-8')
        : null;

    if (originalPackagedSkillsJson) {
        const parsed = JSON.parse(originalPackagedSkillsJson) as Record<string, unknown>;
        delete parsed[MOCK_SKILL_NAME];
        fs.writeFileSync(PACKAGED_SKILLS_JSON_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
    }

    fs.rmSync(PACKAGED_SKILL_DIR, { recursive: true, force: true });
}

function restorePackagedSkillsJson(): void {
    if (originalPackagedSkillsJson === null) {
        fs.rmSync(PACKAGED_SKILLS_JSON_PATH, { force: true });
        return;
    }

    fs.mkdirSync(path.dirname(PACKAGED_SKILLS_JSON_PATH), { recursive: true });
    fs.writeFileSync(PACKAGED_SKILLS_JSON_PATH, originalPackagedSkillsJson, 'utf-8');
}

async function startMockStoreServer(port: number): Promise<MockStoreServer> {
    const hits: string[] = [];
    const host = `http://127.0.0.1:${port}`;

    const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url || '/', host);
        const key = `${req.method || 'GET'} ${requestUrl.pathname}${requestUrl.search}`;
        hits.push(key);

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
                        displayName: 'nanobanana 2',
                        description: 'Image generation skill that requires NANOBANANA_API_KEY before use.',
                        author: 'qa',
                        version: '1.0.0',
                        repoUrl: `${host}/repo/${MOCK_SKILL_NAME}`,
                        files: ['SKILL.md'],
                    },
                ],
            });
            return;
        }

        if (requestUrl.pathname === `/api/skills/${MOCK_SKILL_NAME}`) {
            sendJson(200, {
                name: MOCK_SKILL_NAME,
                slug: MOCK_SKILL_NAME,
                displayName: 'nanobanana 2',
                description: 'Image generation skill that requires NANOBANANA_API_KEY before use.',
                author: 'qa',
                version: '1.0.0',
                repoUrl: `${host}/repo/${MOCK_SKILL_NAME}`,
                files: ['SKILL.md'],
            });
            return;
        }

        if (requestUrl.pathname === `/repo/${MOCK_SKILL_NAME}/raw/main/SKILL.md`) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(`---
name: ${MOCK_SKILL_NAME}
description: nanobanana 2 image generation skill for desktop E2E
user-invocable: true
disable-model-invocation: false
requires:
  env:
    - NANOBANANA_API_KEY
triggers:
  - nanobanana 2
  - image generation
---

# ${MOCK_SKILL_NAME}

Use this skill whenever the user asks for nanobanana 2 image generation.

If NANOBANANA_API_KEY is missing:
1. Do not search the web.
2. Do not create another skill.
3. Reply with: "Please provide NANOBANANA_API_KEY in Settings before using nanobanana 2."
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

async function findChatInput(page: any, timeoutMs = 120_000): Promise<Locator | null> {
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

async function waitForSessionHeader(page: any): Promise<void> {
    const skillsButton = page.locator('button.chat-header-icon-button:has-text("SK")').first();
    await skillsButton.waitFor({ state: 'visible', timeout: 60_000 });
}

test.describe('Desktop GUI E2E - nanobanana 2 skill install and credential prompt', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test.beforeEach(() => {
        prunePackagedNanobananaSkill();
    });

    test.afterEach(() => {
        restorePackagedSkillsJson();
    });

    test('installs nanobanana 2 from ClawHub and prompts for API key instead of searching forever', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        const mockServer = await startMockStoreServer(MOCK_STORE_PORT);

        try {
            expect(page.isClosed(), 'desktop main window should remain open after fixture bootstrap').toBe(false);
            await page.waitForTimeout(12_000);

            const input = await findChatInput(page);
            expect(input, 'desktop UI should expose chat input').not.toBeNull();

            await waitForSessionHeader(page);
            await page.waitForTimeout(1_000);

            const skillsButton = page.locator('button.chat-header-icon-button:has-text("SK")').first();
            await skillsButton.click();

            const clawHubTab = page.getByRole('button', { name: 'ClawHub' });
            await expect(clawHubTab).toBeVisible({ timeout: 20_000 });
            await clawHubTab.click();

            const searchInput = page.getByPlaceholder('Search ClawHub skills');
            await searchInput.fill('nanobanana 2');
            await page.getByRole('button', { name: 'Search' }).first().click();

            tauriLogs.setBaseline();
            const installButton = page.getByRole('button', { name: 'Install' }).first();
            await expect(installButton).toBeVisible({ timeout: 30_000 });
            await installButton.click();

            const installStartedAt = Date.now();
            let installObserved = false;
            while (Date.now() - installStartedAt < 45_000) {
                await page.waitForTimeout(1000);
                const logs = tauriLogs.getRawSinceBaseline();
                installObserved =
                    logs.includes('"type":"install_openclaw_skill_response"') &&
                    logs.includes('"requiredEnv":["NANOBANANA_API_KEY"]');
                if (installObserved) {
                    break;
                }
            }
            expect(installObserved, 'install flow should return skill metadata with requiredEnv').toBe(true);

            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(2500);

            await expect(page.getByText('Configure nanobanana-2-skill to continue.').first()).toBeVisible({ timeout: 20_000 });
            await expect(page.getByText('NANOBANANA_API_KEY').first()).toBeVisible({ timeout: 20_000 });

            const composer = await findChatInput(page, 30_000);
            expect(composer, 'chat input should still be available after installing the skill').not.toBeNull();

            tauriLogs.setBaseline();
            await composer!.fill('Use nanobanana 2 to generate an image. I do not have NANOBANANA_API_KEY configured yet. If it is required, tell me exactly what to fill and stop.');
            await composer!.press('Enter');

            let askedForApiKey = false;
            let taskFailed = false;
            let searchedWeb = false;
            const startedAt = Date.now();

            while (Date.now() - startedAt < 90_000) {
                await page.waitForTimeout(3000);
                const logs = tauriLogs.getRawSinceBaseline();
                const pageText = await page.locator('body').innerText().catch(() => '');

                askedForApiKey =
                    askedForApiKey ||
                    logs.includes('NANOBANANA_API_KEY') ||
                    logs.includes('API key') ||
                    logs.includes('Set API key in environment or .coworkany/settings.json') ||
                    logs.includes('"type":"TASK_SUSPENDED"') ||
                    pageText.includes('NANOBANANA_API_KEY') ||
                    pageText.includes('Please provide NANOBANANA_API_KEY');
                taskFailed = taskFailed || logs.includes('"type":"TASK_FAILED"');
                searchedWeb = searchedWeb || logs.includes('"name":"search_web"');

                if (askedForApiKey || taskFailed) {
                    break;
                }
            }

            const joinedHits = mockServer.hits.join('\n');
            expect(joinedHits).toContain('/api/skills/search');
            expect(joinedHits).toContain(`/api/skills/${MOCK_SKILL_NAME}`);
            expect(joinedHits).toContain(`/repo/${MOCK_SKILL_NAME}/raw/main/SKILL.md`);

            const installLogs = tauriLogs.getRaw();
            expect(installLogs).toContain('install_openclaw_skill');
            expect(installLogs).toContain('list_claude_skills');

            expect(taskFailed, 'nanobanana skill prompt should not hard-fail').toBe(false);
            expect(askedForApiKey, 'agent should prompt for NANOBANANA_API_KEY when the skill requires credentials').toBe(true);
            expect(searchedWeb, 'agent should not fall back to search_web for missing nanobanana API credentials').toBe(false);
        } finally {
            await mockServer.close();
        }
    });
});
