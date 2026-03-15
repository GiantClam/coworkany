/**
 * Desktop GUI E2E: enabled-skill prompt routing
 *
 * Verifies that when multiple local skills are enabled, the chat pipeline only
 * routes the relevant skill body for the current user request.
 *
 * Run:
 *   cd desktop && npx playwright test tests/skill-prompt-routing-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_TIMEOUT_MS = 6 * 60 * 1000;
const ROUTE_WAIT_TIMEOUT_MS = 180_000;
const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const SIDECAR_ROOT = path.resolve(__dirnameLocal, '../../sidecar');
const SKILLS_ROOT = path.join(SIDECAR_ROOT, '.coworkany', 'skills');
const SKILLS_JSON_PATH = path.join(SIDECAR_ROOT, '.coworkany', 'skills.json');

const WEATHER_SKILL_NAME = 'codex-e2e-weather-routing';
const STOCK_SKILL_NAME = 'codex-e2e-stock-routing';
const TEST_SKILL_NAMES = [WEATHER_SKILL_NAME, STOCK_SKILL_NAME];
const BACKUP_ROOT = path.join(os.tmpdir(), `coworkany-skill-routing-backup-${Date.now()}`);

let originalSkillsJson: string | null = null;
const backedUpSkillDirs = new Map<string, string>();

type StoredSkillRecord = {
    manifest: {
        name: string;
        version: string;
        description: string;
        directory: string;
        tags?: string[];
        triggers?: string[];
    };
    enabled: boolean;
    installedAt: string;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureSeededRoutingSkills(): void {
    fs.mkdirSync(SKILLS_ROOT, { recursive: true });
    fs.mkdirSync(BACKUP_ROOT, { recursive: true });

    originalSkillsJson = fs.existsSync(SKILLS_JSON_PATH)
        ? fs.readFileSync(SKILLS_JSON_PATH, 'utf-8')
        : null;

    for (const skillName of TEST_SKILL_NAMES) {
        const skillDir = path.join(SKILLS_ROOT, skillName);
        if (fs.existsSync(skillDir)) {
            const backupDir = path.join(BACKUP_ROOT, skillName);
            fs.rmSync(backupDir, { recursive: true, force: true });
            fs.cpSync(skillDir, backupDir, { recursive: true });
            backedUpSkillDirs.set(skillName, backupDir);
            fs.rmSync(skillDir, { recursive: true, force: true });
        }
    }

    writeSkillFixture({
        name: WEATHER_SKILL_NAME,
        description: 'Weather forecasting helper used for desktop routing E2E.',
        triggers: ['weather', 'forecast', 'umbrella'],
        tags: ['weather', 'forecast'],
        body: 'Use this skill for weather and forecast requests only.',
    });
    writeSkillFixture({
        name: STOCK_SKILL_NAME,
        description: 'Stock research helper used for desktop routing E2E.',
        triggers: ['stock', 'earnings', 'valuation'],
        tags: ['stocks', 'finance'],
        body: 'Use this skill for stock and earnings requests only.',
    });

    const existing = originalSkillsJson
        ? (JSON.parse(originalSkillsJson) as Record<string, StoredSkillRecord>)
        : {};

    const next = { ...existing };
    next[WEATHER_SKILL_NAME] = createStoredSkillRecord(
        WEATHER_SKILL_NAME,
        'Weather forecasting helper used for desktop routing E2E.',
        ['weather', 'forecast'],
        ['weather', 'forecast', 'umbrella']
    );
    next[STOCK_SKILL_NAME] = createStoredSkillRecord(
        STOCK_SKILL_NAME,
        'Stock research helper used for desktop routing E2E.',
        ['stocks', 'finance'],
        ['stock', 'earnings', 'valuation']
    );

    fs.mkdirSync(path.dirname(SKILLS_JSON_PATH), { recursive: true });
    fs.writeFileSync(SKILLS_JSON_PATH, JSON.stringify(next, null, 2), 'utf-8');
}

function restoreSeededRoutingSkills(): void {
    for (const skillName of TEST_SKILL_NAMES) {
        fs.rmSync(path.join(SKILLS_ROOT, skillName), { recursive: true, force: true });
    }

    for (const [skillName, backupDir] of backedUpSkillDirs.entries()) {
        if (fs.existsSync(backupDir)) {
            fs.cpSync(backupDir, path.join(SKILLS_ROOT, skillName), { recursive: true });
        }
    }

    if (originalSkillsJson === null) {
        fs.rmSync(SKILLS_JSON_PATH, { force: true });
    } else {
        fs.mkdirSync(path.dirname(SKILLS_JSON_PATH), { recursive: true });
        fs.writeFileSync(SKILLS_JSON_PATH, originalSkillsJson, 'utf-8');
    }

    fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
    backedUpSkillDirs.clear();
}

function writeSkillFixture(skill: {
    name: string;
    description: string;
    tags: string[];
    triggers: string[];
    body: string;
}): void {
    const skillDir = path.join(SKILLS_ROOT, skill.name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---
name: ${skill.name}
description: ${skill.description}
version: 0.1.0
tags:
  - ${skill.tags.join('\n  - ')}
triggers:
  - ${skill.triggers.join('\n  - ')}
---

# ${skill.name}

${skill.body}
`,
        'utf-8'
    );
}

function createStoredSkillRecord(
    name: string,
    description: string,
    tags: string[],
    triggers: string[]
): StoredSkillRecord {
    return {
        manifest: {
            name,
            version: '0.1.0',
            description,
            directory: path.join(SKILLS_ROOT, name),
            tags,
            triggers,
        },
        enabled: true,
        installedAt: new Date().toISOString(),
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

function parseRoutedPromptSkills(rawLogs: string): string[][] {
    const normalizedLogs = rawLogs
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/\\x1b\[[0-9;]*m/g, '')
        .replace(/\\u001b\[[0-9;]*m/g, '');
    const routes: string[][] = [];
    const regex = /\[Skill\] Routed prompt skills: ([^\r\n]+)/g;
    let match = regex.exec(normalizedLogs);
    while (match) {
        routes.push(
            match[1]
                .split(',')
                .map((part) =>
                    part
                        .replace(/\x1b\[[0-9;]*m/g, '')
                        .replace(/\\x1b\[[0-9;]*m/g, '')
                        .replace(/\\u001b\[[0-9;]*m/g, '')
                        .trim()
                )
                .filter(Boolean)
        );
        match = regex.exec(normalizedLogs);
    }
    return routes;
}

async function waitForTaskOutcome(tauriLogs: any): Promise<{ finished: boolean; failed: boolean; rawLogs: string }> {
    const startedAt = Date.now();
    let rawLogs = '';

    while (Date.now() - startedAt < ROUTE_WAIT_TIMEOUT_MS) {
        await sleep(3000);
        rawLogs = tauriLogs.getRawSinceBaseline();

        const finished =
            rawLogs.includes('"type":"TASK_FINISHED"') ||
            /"type":"TASK_STATUS","payload":\{"status":"(?:finished|completed)"\}/.test(rawLogs);
        const failed = rawLogs.includes('"type":"TASK_FAILED"');
        if (finished || failed) {
            return { finished, failed, rawLogs };
        }
    }

    return {
        finished:
            rawLogs.includes('"type":"TASK_FINISHED"') ||
            /"type":"TASK_STATUS","payload":\{"status":"(?:finished|completed)"\}/.test(rawLogs),
        failed: rawLogs.includes('"type":"TASK_FAILED"'),
        rawLogs,
    };
}

test.beforeAll(async () => {
    ensureSeededRoutingSkills();
});

test.afterAll(async () => {
    restoreSeededRoutingSkills();
});

test.describe('Desktop GUI E2E - enabled skill prompt routing', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('routes only the weather skill for weather questions, only the stock skill for stock questions, and no custom skill for small talk', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        tauriLogs.setBaseline();
        await submitMessage(page, 'Use the weather skill to answer in one short sentence whether I should carry an umbrella in Beijing tonight.');
        let outcome = await waitForTaskOutcome(tauriLogs);
        expect(outcome.failed, 'weather skill routing request should not fail').toBe(false);
        expect(outcome.finished, 'weather skill routing request should finish').toBe(true);

        const weatherRoutes = parseRoutedPromptSkills(outcome.rawLogs);
        expect(weatherRoutes.length, 'weather request should emit a routed prompt skills log').toBeGreaterThan(0);
        const finalWeatherRoute = weatherRoutes.at(-1) ?? [];
        expect(finalWeatherRoute, 'weather request should route the weather skill').toContain(
            WEATHER_SKILL_NAME
        );
        expect(finalWeatherRoute, 'weather request should not route the stock skill').not.toContain(
            STOCK_SKILL_NAME
        );

        tauriLogs.setBaseline();
        await submitMessage(page, 'Use the stock skill to explain in one short sentence what earnings mean for NVDA stock investors. Do not browse the web and do not create files.');
        outcome = await waitForTaskOutcome(tauriLogs);
        expect(outcome.failed, 'stock skill routing request should not fail').toBe(false);
        expect(outcome.finished, 'stock skill routing request should finish').toBe(true);

        const stockRoutes = parseRoutedPromptSkills(outcome.rawLogs);
        expect(stockRoutes.length, 'stock request should emit a routed prompt skills log').toBeGreaterThan(0);
        const finalStockRoute = stockRoutes.at(-1) ?? [];
        expect(finalStockRoute, 'stock request should route the stock skill').toContain(STOCK_SKILL_NAME);
        expect(finalStockRoute, 'stock request should not route the weather skill').not.toContain(
            WEATHER_SKILL_NAME
        );

        tauriLogs.setBaseline();
        await submitMessage(page, 'Say hello in one short sentence.');
        outcome = await waitForTaskOutcome(tauriLogs);
        expect(outcome.failed, 'small-talk request should not fail').toBe(false);
        expect(outcome.finished, 'small-talk request should finish').toBe(true);

        const smallTalkRoutes = parseRoutedPromptSkills(outcome.rawLogs);
        const customRoutes = smallTalkRoutes.filter((route) =>
            route.some((name) => TEST_SKILL_NAMES.includes(name))
        );
        expect(customRoutes, 'small-talk request should not route custom local skills').toEqual([]);
    });
});
