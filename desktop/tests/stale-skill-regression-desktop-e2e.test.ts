import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TEST_TIMEOUT_MS = 3 * 60 * 1000;
const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];
const STALE_SKILL_ID = 'codex-stale-nanobanana-e2e';
const SIDECAR_DIR = path.resolve(process.cwd(), '..', 'sidecar');
const SKILLS_JSON_PATH = path.join(SIDECAR_DIR, '.coworkany', 'skills.json');
const STALE_SKILL_DIR = path.join(SIDECAR_DIR, '.coworkany', 'skills', STALE_SKILL_ID);

let originalSkillsJson: string | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedStaleSkillRecord(): void {
    originalSkillsJson = fs.existsSync(SKILLS_JSON_PATH)
        ? fs.readFileSync(SKILLS_JSON_PATH, 'utf-8')
        : null;

    const parsed = originalSkillsJson ? (JSON.parse(originalSkillsJson) as Record<string, unknown>) : {};
    parsed[STALE_SKILL_ID] = {
        manifest: {
            name: STALE_SKILL_ID,
            version: '1.0.0',
            description: 'Stale nanobanana test skill for desktop regression.',
            directory: STALE_SKILL_DIR,
            triggers: ['nanobanana 2', 'image generation'],
        },
        enabled: true,
        installedAt: '2026-03-12T05:30:00.000Z',
    };

    fs.mkdirSync(path.dirname(SKILLS_JSON_PATH), { recursive: true });
    fs.writeFileSync(SKILLS_JSON_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
    fs.rmSync(STALE_SKILL_DIR, { recursive: true, force: true });
}

function restoreSkillsJson(): void {
    if (originalSkillsJson === null) {
        fs.rmSync(SKILLS_JSON_PATH, { force: true });
        return;
    }
    fs.writeFileSync(SKILLS_JSON_PATH, originalSkillsJson, 'utf-8');
}

async function findChatInput(page: any, options?: { requireEnabled?: boolean; timeoutMs?: number }): Promise<Locator | null> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = page.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
            if (!visible) {
                continue;
            }

            if (options?.requireEnabled) {
                const enabled = await candidate.isEnabled().catch(() => false);
                if (!enabled) {
                    continue;
                }
            }

            return candidate;
        }

        await sleep(400);
    }

    return null;
}

test.beforeAll(() => {
    seedStaleSkillRecord();
});

test.afterAll(() => {
    restoreSkillsJson();
});

test.describe('Desktop GUI E2E - stale skill regression', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('prunes stale installed skills and avoids missing-directory loops', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        expect(page.isClosed(), 'desktop main window should remain open after fixture bootstrap').toBe(false);
        await page.waitForTimeout(12_000);

        const startupLogs = tauriLogs.getRaw();
        expect(
            startupLogs.includes(`"id":"${STALE_SKILL_ID}"`),
            'stale skill should be pruned before desktop skill list renders',
        ).toBe(false);

        const input = await findChatInput(page, { requireEnabled: true, timeoutMs: 120000 });
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        tauriLogs.setBaseline();
        await input!.fill(
            `${STALE_SKILL_ID}: can this skill still work without an API key? If it is not really installed locally, explain directly.`,
        );
        await input!.press('Enter');

        let submitted = false;
        let assistantResponded = false;
        let taskFailed = false;
        let autoTriggeredStaleSkill = false;
        let missingDirectoryLoop = false;

        const startedAt = Date.now();
        while (Date.now() - startedAt < TEST_TIMEOUT_MS) {
            await page.waitForTimeout(3000);
            const logs = tauriLogs.getRawSinceBaseline();

            submitted = submitted || logs.includes('send_task_message command received');
            assistantResponded =
                assistantResponded ||
                logs.includes('"type":"TEXT_DELTA"') ||
                logs.includes('"type":"TASK_FINISHED"');
            taskFailed = taskFailed || logs.includes('"type":"TASK_FAILED"');
            autoTriggeredStaleSkill =
                autoTriggeredStaleSkill ||
                logs.includes(`[Skill] Auto-triggered skills: ${STALE_SKILL_ID}`);
            missingDirectoryLoop =
                missingDirectoryLoop ||
                logs.includes(
                    `Failed to list directory: ENOENT: no such file or directory, scandir '${STALE_SKILL_DIR.replace(/\\/g, '\\\\')}'`,
                ) ||
                logs.includes(`"path":"${STALE_SKILL_DIR.replace(/\\/g, '\\\\')}"`);

            if (assistantResponded || taskFailed) {
                break;
            }
        }

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'stale skill query should not fail').toBe(false);
        expect(assistantResponded, 'assistant should still respond to the stale skill question').toBe(true);
        expect(autoTriggeredStaleSkill, 'stale skill record must not auto-trigger after pruning').toBe(false);
        expect(missingDirectoryLoop, 'desktop must not hit missing skill directories after pruning').toBe(false);
    });
});
