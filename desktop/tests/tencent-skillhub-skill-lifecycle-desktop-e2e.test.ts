/**
 * Desktop GUI E2E: live SkillHub install -> enable -> use -> uninstall lifecycle
 *
 * Run:
 *   cd desktop && npx playwright test tests/tencent-skillhub-skill-lifecycle-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_TIMEOUT_MS = 8 * 60 * 1000;
const INSTALL_WAIT_TIMEOUT_MS = 90_000;
const USAGE_WAIT_TIMEOUT_MS = 120_000;
const LIVE_SKILL_NAME = process.env.TENCENT_SKILLHUB_E2E_SKILL_SLUG?.trim() || 'weather';
const LIVE_SKILL_DISPLAY_NAME = process.env.TENCENT_SKILLHUB_E2E_DISPLAY_NAME?.trim() || 'Weather';
const LIVE_SKILL_SEARCH_QUERY = process.env.TENCENT_SKILLHUB_E2E_SEARCH_QUERY?.trim() || LIVE_SKILL_NAME;
const WEATHER_LOCATION = process.env.TENCENT_SKILLHUB_E2E_WEATHER_LOCATION?.trim() || 'Beijing';
const POLICY_FILE = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'com.coworkany.desktop',
    'policy-config.json',
);
const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const SIDECAR_ROOT = path.resolve(__dirnameLocal, '../../sidecar');
const SIDECAR_WORKSPACE_ROOT = path.join(SIDECAR_ROOT, 'workspace');
const SKILLS_JSON_PATH = path.join(SIDECAR_ROOT, '.coworkany', 'skills.json');
const SKILL_DIR_PATH = path.join(SIDECAR_ROOT, '.coworkany', 'skills', LIVE_SKILL_NAME);
const BACKUP_SKILL_DIR = path.join(os.tmpdir(), `coworkany-${LIVE_SKILL_NAME}-backup-${Date.now()}`);
const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

let originalSkillsJson: string | null = null;
let backedUpOriginalSkillDir = false;
let originalPolicyConfig: string | null = null;

type PolicyConfig = {
    allowlists?: {
        commands?: string[];
        domains?: string[];
        paths?: string[];
    };
    blocklists?: {
        commands?: string[];
        domains?: string[];
        paths?: string[];
    };
    deniedEffects?: string[];
    defaultPolicies?: Record<string, string>;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneTencentSkillState(): void {
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
    delete parsed[LIVE_SKILL_NAME];

    fs.mkdirSync(path.dirname(SKILLS_JSON_PATH), { recursive: true });
    fs.writeFileSync(SKILLS_JSON_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
    fs.rmSync(SKILL_DIR_PATH, { recursive: true, force: true });
}

function restoreTencentSkillState(): void {
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

function readPolicyConfig(): PolicyConfig {
    if (!fs.existsSync(POLICY_FILE)) {
        return {
            allowlists: { commands: [], domains: [], paths: [] },
            blocklists: { commands: [], domains: [], paths: [] },
            deniedEffects: [],
            defaultPolicies: {},
        };
    }

    try {
        return JSON.parse(fs.readFileSync(POLICY_FILE, 'utf-8')) as PolicyConfig;
    } catch {
        return {
            allowlists: { commands: [], domains: [], paths: [] },
            blocklists: { commands: [], domains: [], paths: [] },
            deniedEffects: [],
            defaultPolicies: {},
        };
    }
}

function writePolicyConfig(config: PolicyConfig): void {
    fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
    fs.writeFileSync(POLICY_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function allowCommandForTest(commandBase: string): void {
    originalPolicyConfig = fs.existsSync(POLICY_FILE) ? fs.readFileSync(POLICY_FILE, 'utf-8') : null;
    const config = readPolicyConfig();
    const existing = Array.isArray(config.allowlists?.commands) ? config.allowlists!.commands : [];
    const commands = Array.from(new Set([...existing, commandBase]));

    writePolicyConfig({
        ...config,
        allowlists: {
            commands,
            domains: config.allowlists?.domains ?? [],
            paths: config.allowlists?.paths ?? [],
        },
        blocklists: {
            commands: config.blocklists?.commands ?? [],
            domains: config.blocklists?.domains ?? [],
            paths: config.blocklists?.paths ?? [],
        },
        deniedEffects: config.deniedEffects ?? [],
        defaultPolicies: config.defaultPolicies ?? {},
    });
}

function restorePolicyConfig(): void {
    if (originalPolicyConfig === null) {
        fs.rmSync(POLICY_FILE, { force: true });
        return;
    }

    fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
    fs.writeFileSync(POLICY_FILE, originalPolicyConfig, 'utf-8');
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

function parseInstalledSkillPath(rawLogs: string): string | null {
    const match = /"type":"install_openclaw_skill_response".*?"path":"((?:\\.|[^"\\])*)"/.exec(rawLogs);
    if (!match) {
        return null;
    }
    try {
        return JSON.parse(`"${match[1]}"`) as string;
    } catch {
        return null;
    }
}

function findInstalledSkillDirectory(skillName: string): string | null {
    const directPath = path.join(SIDECAR_ROOT, '.coworkany', 'skills', skillName);
    if (fs.existsSync(path.join(directPath, 'SKILL.md'))) {
        return directPath;
    }

    if (!fs.existsSync(SIDECAR_WORKSPACE_ROOT)) {
        return null;
    }

    for (const entry of fs.readdirSync(SIDECAR_WORKSPACE_ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const candidate = path.join(SIDECAR_WORKSPACE_ROOT, entry.name, '.coworkany', 'skills', skillName);
        if (fs.existsSync(path.join(candidate, 'SKILL.md'))) {
            return candidate;
        }
    }

    return null;
}

function extractAssistantText(rawLogs: string): string {
    const lines = rawLogs.split('\n');
    const chunks: string[] = [];

    for (const line of lines) {
        if (!line.includes('"type":"TEXT_DELTA"')) continue;
        const deltaMatch = line.match(/"delta":"([\s\S]*?)","role":"assistant"/);
        if (!deltaMatch) continue;

        try {
            chunks.push(JSON.parse(`"${deltaMatch[1]}"`) as string);
        } catch {
            chunks.push(deltaMatch[1]);
        }
    }

    return chunks.join('');
}

function looksLikeWeatherAnswer(assistantText: string): boolean {
    const normalized = assistantText.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.length < 8) {
        return false;
    }

    return (
        normalized.includes(WEATHER_LOCATION.toLowerCase())
        || normalized.includes('weather')
        || normalized.includes('temperature')
        || normalized.includes('sunny')
        || normalized.includes('cloud')
        || normalized.includes('rain')
        || /-?\d+\s?(c|f)\b/.test(normalized)
    );
}

async function createFreshSession(page: any): Promise<void> {
    const newSessionButton = page.locator('.chat-header-new-session').first();
    await expect(newSessionButton).toBeVisible({ timeout: 20_000 });
    await newSessionButton.click();
    await page.waitForTimeout(1000);
}

async function waitForSessionHeader(page: any): Promise<void> {
    const skillsButton = page.locator('button.chat-header-icon-button:has-text("SK")').first();
    await skillsButton.waitFor({ state: 'visible', timeout: 60_000 });
}

async function openSkillsPanel(page: any): Promise<void> {
    const skillsButton = page.locator('button.chat-header-icon-button:has-text("SK")').first();
    await skillsButton.waitFor({ state: 'visible', timeout: 60_000 });
    await skillsButton.click();
    await expect(page.getByRole('button', { name: 'SkillHub' }).first()).toBeVisible({ timeout: 20_000 });
}

async function closeSkillsPanel(page: any): Promise<void> {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
}

async function readEnabledSkillCount(page: any): Promise<number> {
    const countLocator = page.locator('button.chat-header-icon-button:has-text("SK") .chat-header-icon-button-count').first();
    await expect(countLocator).toBeVisible({ timeout: 20_000 });
    const text = (await countLocator.innerText()).trim();
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

test.describe('Desktop GUI E2E - SkillHub live skill lifecycle', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test.beforeAll(() => {
        delete process.env.OPENCLAW_STORE_TENCENT_SKILLHUB_BASE_URL;
        delete process.env.OPENCLAW_STORE_TENCENT_SKILLHUB_DATA_URL;
        delete process.env.OPENCLAW_STORE_TENCENT_SKILLHUB_DOWNLOAD_BASE_URL;
        pruneTencentSkillState();
        allowCommandForTest('curl');
    });

    test.afterAll(() => {
        restoreTencentSkillState();
        restorePolicyConfig();
    });

    test('installs from live SkillHub, stays enabled, handles a request, then uninstalls cleanly', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        expect(page.isClosed(), 'desktop main window should remain open after fixture bootstrap').toBe(false);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        const initialSkillCount = await readEnabledSkillCount(page);

        await submitMessage(page, 'hello');
        await waitForSessionHeader(page);
        await openSkillsPanel(page);

        const liveTab = page.getByRole('button', { name: 'SkillHub' }).first();
        await liveTab.click();

        const searchInput = page.getByPlaceholder('Search SkillHub skills');
        await expect(searchInput).toBeVisible({ timeout: 20_000 });
        await searchInput.fill(LIVE_SKILL_SEARCH_QUERY);
        await page.getByRole('button', { name: 'Search' }).first().click();
        await expect(page.getByText(LIVE_SKILL_DISPLAY_NAME).first()).toBeVisible({ timeout: 30_000 });

        tauriLogs.setBaseline();
        const skillTitle = page.locator('strong').filter({ hasText: new RegExp(`^${LIVE_SKILL_DISPLAY_NAME}$`) }).first();
        await expect(skillTitle).toBeVisible({ timeout: 20_000 });
        const skillCard = skillTitle.locator('xpath=ancestor::div[3]');
        const installButton = skillCard.getByRole('button', { name: 'Install' }).first();
        await expect(installButton).toBeVisible({ timeout: 20_000 });
        await installButton.click();

        await expect.poll(
            () => {
                const logs = tauriLogs.getRawSinceBaseline();
                const pathOnDisk = parseInstalledSkillPath(logs) || findInstalledSkillDirectory(LIVE_SKILL_NAME);
                return logs.includes('"type":"install_openclaw_skill_response"') && Boolean(pathOnDisk);
            },
            {
                timeout: INSTALL_WAIT_TIMEOUT_MS,
                intervals: [500, 1000, 2000],
                message: 'SkillHub install should emit a response and create the skill directory',
            },
        ).toBe(true);

        const installLogs = tauriLogs.getRawSinceBaseline();
        const installedSkillDirectory = parseInstalledSkillPath(installLogs) || findInstalledSkillDirectory(LIVE_SKILL_NAME);

        expect(installLogs).toContain('install_openclaw_skill');
        expect(installLogs).toContain('"store":"tencent_skillhub"');
        expect(installedSkillDirectory, 'installed SkillHub skill should be discoverable on disk').toBeTruthy();

        await expect.poll(
            () => fs.existsSync(path.join(installedSkillDirectory!, 'SKILL.md')),
            {
                timeout: INSTALL_WAIT_TIMEOUT_MS,
                intervals: [500, 1000, 2000],
                message: 'SkillHub skill should be written to disk with SKILL.md',
            },
        ).toBe(true);

        await expect.poll(
            () => Boolean(readInstalledSkillsJson()[LIVE_SKILL_NAME]),
            {
                timeout: INSTALL_WAIT_TIMEOUT_MS,
                intervals: [500, 1000, 2000],
                message: 'SkillHub skill should be recorded in skills.json',
            },
        ).toBe(true);

        await expect.poll(
            () => {
                const entry = readInstalledSkillsJson()[LIVE_SKILL_NAME] as Record<string, unknown> | undefined;
                return typeof entry?.enabled === 'boolean' ? entry.enabled : null;
            },
            {
                timeout: 30_000,
                intervals: [500, 1000, 2000],
                message: 'SkillHub skill should be enabled after installation',
            },
        ).toBe(true);

        await expect.poll(
            () => readEnabledSkillCount(page),
            {
                timeout: 30_000,
                intervals: [500, 1000, 2000],
                message: 'desktop header should reflect one more enabled skill after installation',
            },
        ).toBe(initialSkillCount + 1);
        await closeSkillsPanel(page);

        await createFreshSession(page);
        tauriLogs.setBaseline();
        await submitMessage(
            page,
            `Use the installed ${LIVE_SKILL_NAME} skill to get the current weather for ${WEATHER_LOCATION}. Return only the final result. Do not explain the steps and do not call search_web.`,
        );

        let usageFailed = false;
        let usageFinished = false;
        let searchedWeb = false;
        let usedCommandPath = false;
        let assistantText = '';
        const usageStartedAt = Date.now();
        while (Date.now() - usageStartedAt < USAGE_WAIT_TIMEOUT_MS) {
            await sleep(3000);
            const usageLogs = tauriLogs.getRawSinceBaseline();

            usageFailed = usageFailed || usageLogs.includes('"type":"TASK_FAILED"');
            usageFinished = usageFinished || usageLogs.includes('"type":"TASK_FINISHED"');
            searchedWeb = searchedWeb || usageLogs.includes('"name":"search_web"');
            usedCommandPath =
                usedCommandPath
                || usageLogs.includes('"name":"run_command"')
                || usageLogs.toLowerCase().includes('wttr.in')
                || usageLogs.toLowerCase().includes('open-meteo');
            assistantText = extractAssistantText(usageLogs);

            if (usageFailed || (usageFinished && assistantText.trim().length > 0) || (usedCommandPath && looksLikeWeatherAnswer(assistantText))) {
                break;
            }
        }

        expect(usageFailed, 'SkillHub skill invocation should not fail').toBe(false);
        expect(usageFinished, 'skill usage request should complete').toBe(true);
        expect(searchedWeb, 'weather request should not fall back to search_web').toBe(false);
        expect(usedCommandPath, 'weather skill usage should execute the skill command path instead of answering generically').toBe(true);
        expect(assistantText.trim().length, 'assistant should produce visible text when using the installed skill').toBeGreaterThan(8);
        expect(
            looksLikeWeatherAnswer(assistantText),
            `assistant response should look like a weather result, got: ${assistantText.slice(0, 240)}`,
        ).toBe(true);

        await openSkillsPanel(page);
        const removableSkillLabel = page.locator('span', { hasText: LIVE_SKILL_NAME }).first();
        await expect(removableSkillLabel).toBeVisible({ timeout: 20_000 });
        await removableSkillLabel.click();

        const uninstallButton = page.getByRole('button', { name: /^(Uninstall Skill|卸载技能)$/ }).first();
        await uninstallButton.scrollIntoViewIfNeeded().catch(() => {});
        await expect(uninstallButton).toBeVisible({ timeout: 20_000 });

        page.once('dialog', (dialog) => dialog.accept());
        tauriLogs.setBaseline();
        await uninstallButton.click();

        await expect.poll(
            () => {
                const uninstallLogs = tauriLogs.getRawSinceBaseline();
                const parsed = readInstalledSkillsJson();
                return uninstallLogs.includes('"type":"remove_claude_skill_response"') && !parsed[LIVE_SKILL_NAME];
            },
            {
                timeout: 30_000,
                intervals: [500, 1000, 2000],
                message: 'SkillHub skill uninstall should complete and clear skills.json',
            },
        ).toBe(true);

        await expect.poll(
            () => readEnabledSkillCount(page),
            {
                timeout: 30_000,
                intervals: [500, 1000, 2000],
                message: 'desktop header should restore enabled skill count after uninstall',
            },
        ).toBe(initialSkillCount);

        expect(fs.existsSync(installedSkillDirectory!), 'SkillHub skill directory should be removed after uninstall').toBe(false);
        expect(readInstalledSkillsJson()[LIVE_SKILL_NAME], 'SkillHub skill entry should be removed after uninstall').toBeUndefined();
    });
});
