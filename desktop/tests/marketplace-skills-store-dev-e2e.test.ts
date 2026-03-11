/**
 * Marketplace Skills Store Dev E2E
 *
 * Manual integration checklist automation:
 * 1) Start Tauri dev app
 * 2) Open Skills modal
 * 3) Verify new tab: ClawHub
 * 4) Search in ClawHub tab
 * 5) Install a skill from ClawHub
 * 6) Verify refresh happened (Installed state + backend list call)
 *
 * Run (PowerShell):
 *   $env:OPENCLAW_STORE_CLAWHUB_BASE_URL='http://127.0.0.1:18990'
 *   npx playwright test tests/marketplace-skills-store-dev-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as http from 'http';
import { URL } from 'url';

const MOCK_STORE_PORT = 18990;
const MOCK_SKILL_NAME = 'mock-openclaw-skill';
const TASK_TIMEOUT_MS = 6 * 60 * 1000;

// Ensure sidecar in tauri dev always targets the local mock stores for this test.
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

async function startMockStoreServer(port: number): Promise<MockStoreServer> {
    const hits: string[] = [];
    const host = `http://127.0.0.1:${port}`;

    const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url || '/', host);
        const key = `${req.method || 'GET'} ${reqUrl.pathname}${reqUrl.search}`;
        hits.push(key);

        const sendJson = (status: number, payload: unknown) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        };

        if (reqUrl.pathname === '/api/skills/search') {
            const q = reqUrl.searchParams.get('q') ?? '';
            sendJson(200, {
                skills: [
                    {
                        name: MOCK_SKILL_NAME,
                        description: `Mock result for ${q || 'all'}`,
                        author: 'qa',
                        version: '1.0.0',
                        repoUrl: `${host}/repo/${MOCK_SKILL_NAME}`,
                        files: ['SKILL.md'],
                    },
                ],
            });
            return;
        }

        if (reqUrl.pathname === `/api/skills/${encodeURIComponent(MOCK_SKILL_NAME)}` || reqUrl.pathname === `/api/skills/${MOCK_SKILL_NAME}`) {
            sendJson(200, {
                name: MOCK_SKILL_NAME,
                description: 'Mock skill detail',
                author: 'qa',
                version: '1.0.0',
                repoUrl: `${host}/repo/${MOCK_SKILL_NAME}`,
                files: ['SKILL.md'],
            });
            return;
        }

        if (reqUrl.pathname === `/repo/${MOCK_SKILL_NAME}/raw/main/SKILL.md`) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(`---
name: ${MOCK_SKILL_NAME}
description: Mock OpenClaw skill for E2E
user-invocable: true
disable-model-invocation: false
metadata:
  openclaw:
    emoji: "🦀"
---

This is a mock skill used by desktop dev E2E tests.
`);
            return;
        }

        sendJson(404, { error: 'not_found', path: reqUrl.pathname });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });

    return {
        hits,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
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

test.describe('Marketplace Skills Store - Dev manual checklist', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('validate tabs/search/install/refresh flow under tauri dev', async ({ page, tauriLogs }) => {
        const mockServer = await startMockStoreServer(MOCK_STORE_PORT);
        try {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(10_000);

            const input = await findChatInput(page);
            expect(input, 'chat input should be visible').not.toBeNull();

            // Create an active session so Header actions (SK/MCP/MODEL/Clear) are visible.
            await input!.fill('create a quick session');
            await input!.press('Enter');

            const skillsButton = page.locator('button.chat-header-icon-button:has-text("SK")').first();
            await skillsButton.waitFor({ state: 'visible', timeout: 45_000 });
            await skillsButton.click();

            // 1) Verify ClawHub tab visible
            const clawHubTab = page.getByRole('button', { name: 'ClawHub' });
            await expect(clawHubTab).toBeVisible();

            // 2) ClawHub search
            await clawHubTab.click();
            const clawHubSearchInput = page.getByPlaceholder('Search ClawHub skills');
            await clawHubSearchInput.fill('mock');
            await page.getByRole('button', { name: 'Search' }).first().click();
            await expect(page.getByText(MOCK_SKILL_NAME)).toBeVisible({ timeout: 20_000 });

            // 3) Install from ClawHub and assert refresh
            tauriLogs.setBaseline();
            const skillCard = page.locator(`div:has-text("${MOCK_SKILL_NAME}")`).first();
            const installButton = skillCard.getByRole('button', { name: 'Install' }).first();
            await installButton.click();

            // "Installed" label indicates installedSkillIds was refreshed by list_claude_skills.
            await expect(skillCard.getByRole('button', { name: 'Installed' })).toBeVisible({ timeout: 30_000 });

            const postInstallLogs = tauriLogs.getRawSinceBaseline();
            expect(postInstallLogs).toContain('install_openclaw_skill');
            expect(postInstallLogs).toContain('list_claude_skills');

            // 4) Backend hit assertions (search/detail/download all happened)
            const joinedHits = mockServer.hits.join('\n');
            expect(joinedHits).toContain('/api/skills/search');
            expect(joinedHits).toContain(`/api/skills/${MOCK_SKILL_NAME}`);
            expect(joinedHits).toContain(`/repo/${MOCK_SKILL_NAME}/raw/main/SKILL.md`);
        } finally {
            await mockServer.close();
        }
    });
});
