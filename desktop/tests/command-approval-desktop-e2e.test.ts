import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TEST_TIMEOUT_MS = 7 * 60 * 1000;
const COMMAND_BASE = 'schtasks';
const POLICY_FILE = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'com.coworkany.desktop', 'policy-config.json');

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

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
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPolicyConfig(): PolicyConfig {
    if (!fs.existsSync(POLICY_FILE)) {
        return {
            allowlists: { commands: [], domains: [], paths: [] },
            blocklists: { commands: [], domains: [], paths: [] },
            deniedEffects: [],
        };
    }

    try {
        return JSON.parse(fs.readFileSync(POLICY_FILE, 'utf-8')) as PolicyConfig;
    } catch {
        return {
            allowlists: { commands: [], domains: [], paths: [] },
            blocklists: { commands: [], domains: [], paths: [] },
            deniedEffects: [],
        };
    }
}

function writePolicyConfig(config: PolicyConfig): void {
    fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
    fs.writeFileSync(POLICY_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function removeCommandFromPersistentAllowlist(commandBase: string): void {
    const config = readPolicyConfig();
    const commands = Array.isArray(config.allowlists?.commands) ? config.allowlists!.commands : [];
    const normalized = commands.filter((entry) => entry.trim().toLowerCase() !== commandBase);

    writePolicyConfig({
        ...config,
        allowlists: {
            commands: normalized,
            domains: config.allowlists?.domains ?? [],
            paths: config.allowlists?.paths ?? [],
        },
        blocklists: {
            commands: config.blocklists?.commands ?? [],
            domains: config.blocklists?.domains ?? [],
            paths: config.blocklists?.paths ?? [],
        },
        deniedEffects: config.deniedEffects ?? [],
    });
}

function persistentAllowlistContains(commandBase: string): boolean {
    const commands = readPolicyConfig().allowlists?.commands ?? [];
    return commands.map((entry) => entry.trim().toLowerCase()).includes(commandBase);
}

async function ensureMainShell(page: any): Promise<void> {
    const workspaceAddButton = page.locator('.workspace-add-btn').first();
    const shellVisible = await workspaceAddButton.isVisible({ timeout: 6000 }).catch(() => false);
    if (shellVisible) {
        return;
    }

    await page.evaluate(() => {
        localStorage.setItem('coworkany:setupCompleted', JSON.stringify(true));
        window.location.reload();
    });

    await page.waitForLoadState('domcontentloaded');
    await expect(workspaceAddButton).toBeVisible({ timeout: 25000 });
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

async function submitMessage(page: any, text: string): Promise<void> {
    const input = await findChatInput(page, { requireEnabled: true, timeoutMs: 120000 });
    expect(input, 'desktop UI should expose an enabled chat input').not.toBeNull();
    await input!.fill(text);
    await input!.press('Enter');
    await page.waitForTimeout(1200);
}

async function waitForEnabledComposer(page: any, timeoutMs = 180000): Promise<void> {
    await expect
        .poll(async () => {
            const input = await findChatInput(page, { requireEnabled: true, timeoutMs: 1500 });
            return input !== null;
        }, {
            timeout: timeoutMs,
            message: 'chat composer should become enabled once the current task is idle',
        })
        .toBe(true);
}

async function waitForCommandAttempt(
    page: any,
    tauriLogs: { getRawSinceBaseline: () => string; grepSinceBaseline: (pattern: string) => string[] },
    options?: { expectDialog?: boolean; timeoutMs?: number }
): Promise<{ preflightSeen: boolean; runCommandSeen: boolean; dialogSeen: boolean; toolResultSeen: boolean; taskFailed: boolean }> {
    const dialog = page.getByTestId('effect-confirmation-dialog');
    const timeoutMs = options?.timeoutMs ?? 90000;
    let preflightSeen = false;
    let runCommandSeen = false;
    let dialogSeen = false;
    let toolResultSeen = false;
    let taskFailed = false;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (await dialog.isVisible().catch(() => false)) {
            dialogSeen = true;
        }

        const rawLogs = tauriLogs.getRawSinceBaseline();
        const lower = rawLogs.toLowerCase();
        preflightSeen = preflightSeen || (lower.includes('"type":"tool_call"') && lower.includes('"name":"command_preflight"') && lower.includes(COMMAND_BASE));
        runCommandSeen = runCommandSeen || (lower.includes('"type":"tool_call"') && lower.includes('"name":"run_command"') && lower.includes(COMMAND_BASE));
        taskFailed = taskFailed || lower.includes('"type":"task_failed"');

        const toolResultLines = tauriLogs.grepSinceBaseline('TOOL_RESULT');
        toolResultSeen =
            toolResultSeen ||
            toolResultLines.some((line) => line.toLowerCase().includes('"name":"run_command"'));

        if (runCommandSeen && (toolResultSeen || dialogSeen)) {
            break;
        }

        await sleep(1500);
    }

    if (options?.expectDialog) {
        expect(dialogSeen, 'approval dialog should appear for protected shell command').toBe(true);
    }

    return {
        preflightSeen,
        runCommandSeen,
        dialogSeen,
        toolResultSeen,
        taskFailed,
    };
}

const FIRST_PROMPT = 'Run the exact Windows command "schtasks /query". Stay on the direct CLI path. If the host approval dialog appears, wait for approval and then continue.';
const SECOND_PROMPT = 'Execute the exact Windows command "schtasks /query" again right now in this same task. Do not reuse or summarize the previous output without re-running the command. After it runs, summarize the fresh result in one sentence.';
const THIRD_PROMPT = 'After the allowlist change, execute the exact Windows command "schtasks /query" again right now. Do not reuse the previous output. After it runs, summarize the fresh result in one sentence.';

async function waitForReapprovalDialog(
    page: any,
    tauriLogs: { getRawSinceBaseline: () => string },
    timeoutMs = 180000
): Promise<{ preflightSeen: boolean; runCommandSeen: boolean; dialogSeen: boolean; taskFailed: boolean }> {
    const dialog = page.getByTestId('effect-confirmation-dialog');
    const start = Date.now();
    let preflightSeen = false;
    let runCommandSeen = false;
    let taskFailed = false;

    while (Date.now() - start < timeoutMs) {
        const rawLogs = tauriLogs.getRawSinceBaseline();
        const lower = rawLogs.toLowerCase();

        preflightSeen =
            preflightSeen ||
            (lower.includes('"type":"tool_call"') && lower.includes('"name":"command_preflight"') && lower.includes(COMMAND_BASE));
        runCommandSeen =
            runCommandSeen ||
            (lower.includes('"type":"tool_call"') && lower.includes('"name":"run_command"') && lower.includes(COMMAND_BASE));
        taskFailed = taskFailed || lower.includes('"type":"task_failed"');

        const dialogSeen = await dialog.isVisible().catch(() => false);
        const confirmationEventSeen = lower.includes('effect-confirmation-required') || lower.includes('"type":"request_effect"');

        if (dialogSeen || confirmationEventSeen) {
            return { preflightSeen, runCommandSeen, dialogSeen, taskFailed };
        }

        await sleep(1500);
    }

    return { preflightSeen, runCommandSeen, dialogSeen: false, taskFailed };
}

test.describe('Desktop GUI E2E - command approval scopes', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(TEST_TIMEOUT_MS);

    test.beforeEach(async () => {
        removeCommandFromPersistentAllowlist(COMMAND_BASE);
    });

    test.afterEach(async () => {
        removeCommandFromPersistentAllowlist(COMMAND_BASE);
    });

    test('session approval auto-allows the same command for the current app session only', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Current E2E scenario uses Windows schtasks.');

        await ensureMainShell(page);
        await page.waitForTimeout(12000);

        tauriLogs.setBaseline();
        await submitMessage(page, FIRST_PROMPT);

        const dialog = page.getByTestId('effect-confirmation-dialog');
        const firstApproval = await waitForReapprovalDialog(page, tauriLogs, 180000);
        expect(firstApproval.taskFailed, 'first schtasks request should not fail before approval').toBe(false);
        expect(firstApproval.preflightSeen || firstApproval.runCommandSeen, 'first request should enter the protected execution path before approval').toBe(true);
        await expect(dialog).toBeVisible({ timeout: 30000 });
        await page.getByTestId('approval-mode-session').click();
        await page.getByTestId('effect-approve').click();
        await expect(dialog).toBeHidden({ timeout: 15000 });

        const firstAttempt = await waitForCommandAttempt(page, tauriLogs, { timeoutMs: 120000 });
        expect(firstAttempt.taskFailed, 'first schtasks request should not fail').toBe(false);
        expect(firstAttempt.preflightSeen || firstAttempt.runCommandSeen, 'first request should stay on the protected command path').toBe(true);
        expect(firstAttempt.runCommandSeen, 'first request should call run_command').toBe(true);
        expect(firstAttempt.toolResultSeen, 'first request should produce a run_command result after approval').toBe(true);
        expect(persistentAllowlistContains(COMMAND_BASE), 'session approval should not persist command allowlist').toBe(false);

        tauriLogs.setBaseline();
        await submitMessage(page, SECOND_PROMPT);

        const secondAttempt = await waitForCommandAttempt(page, tauriLogs, { expectDialog: false, timeoutMs: 90000 });
        expect(secondAttempt.taskFailed, 'second schtasks request should not fail').toBe(false);
        expect(secondAttempt.runCommandSeen, 'second request should still execute run_command').toBe(true);
        expect(secondAttempt.toolResultSeen, 'second request should still return a run_command result').toBe(true);
        expect(secondAttempt.dialogSeen, 'session approval should suppress repeated confirmation for the same command').toBe(false);
        expect(persistentAllowlistContains(COMMAND_BASE), 'session approval must not create a persistent allowlist entry').toBe(false);
    });

    test('permanent approval persists into settings and can be removed from the allowlist', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Current E2E scenario uses Windows schtasks.');

        await ensureMainShell(page);
        await page.waitForTimeout(12000);

        tauriLogs.setBaseline();
        await submitMessage(page, FIRST_PROMPT);

        const dialog = page.getByTestId('effect-confirmation-dialog');
        const firstApproval = await waitForReapprovalDialog(page, tauriLogs, 180000);
        expect(firstApproval.taskFailed, 'permanent approval request should not fail before approval').toBe(false);
        expect(firstApproval.preflightSeen || firstApproval.runCommandSeen, 'permanent approval request should enter the protected execution path before approval').toBe(true);
        await expect(dialog).toBeVisible({ timeout: 30000 });
        await page.getByTestId('approval-mode-permanent').click();
        await page.getByTestId('effect-approve').click();
        await expect(dialog).toBeHidden({ timeout: 15000 });

        const firstAttempt = await waitForCommandAttempt(page, tauriLogs, { timeoutMs: 120000 });
        expect(firstAttempt.taskFailed, 'permanent approval request should not fail').toBe(false);
        expect(firstAttempt.preflightSeen || firstAttempt.runCommandSeen, 'permanent approval request should stay on the protected command path').toBe(true);
        expect(firstAttempt.runCommandSeen, 'permanent approval request should call run_command').toBe(true);
        expect(firstAttempt.toolResultSeen, 'permanent approval request should produce a run_command result').toBe(true);

        await expect
            .poll(() => persistentAllowlistContains(COMMAND_BASE), {
                timeout: 15000,
                message: 'permanent approval should persist the command into policy-config.json',
            })
            .toBe(true);

        tauriLogs.setBaseline();
        await submitMessage(page, SECOND_PROMPT);
        const secondAttempt = await waitForCommandAttempt(page, tauriLogs, { expectDialog: false, timeoutMs: 90000 });
        expect(secondAttempt.taskFailed, 'follow-up permanent request should not fail').toBe(false);
        expect(secondAttempt.runCommandSeen, 'follow-up permanent request should still execute run_command').toBe(true);
        expect(secondAttempt.dialogSeen, 'permanent approval should suppress repeated confirmation').toBe(false);

        await page.locator('.sidebar-settings-btn').click();
        const modal = page.locator('.modal-dialog-content').last();
        await expect(modal).toBeVisible({ timeout: 30000 });

        const approvalsSection = page.getByTestId('command-approval-settings');
        await expect(approvalsSection).toBeVisible({ timeout: 30000 });
        await expect(approvalsSection).toContainText('schtasks');

        await approvalsSection.locator('[data-command="schtasks"]').getByTestId('command-approval-remove').click();

        await expect
            .poll(() => persistentAllowlistContains(COMMAND_BASE), {
                timeout: 15000,
                message: 'removing the command from settings should update policy-config.json',
            })
            .toBe(false);

        await expect(approvalsSection).not.toContainText('schtasks', { timeout: 15000 });

        await modal.locator('.modal-close-btn').click();
        await expect(modal).toBeHidden({ timeout: 15000 });

        await waitForEnabledComposer(page);
        tauriLogs.setBaseline();
        await submitMessage(page, THIRD_PROMPT);

        const approvalDialog = page.getByTestId('effect-confirmation-dialog');
        const reapproval = await waitForReapprovalDialog(page, tauriLogs, 180000);
        expect(reapproval.taskFailed, 'after removing the allowlist, the follow-up request should not fail before approval').toBe(false);
        expect(reapproval.preflightSeen || reapproval.runCommandSeen, 'after removing the allowlist, the same command should re-enter the protected execution path before approval').toBe(true);
        await expect(approvalDialog).toBeVisible({ timeout: 30000 });
        await page.getByTestId('approval-mode-once').click();
        await page.getByTestId('effect-approve').click();
        await expect(approvalDialog).toBeHidden({ timeout: 15000 });

        const thirdAttempt = await waitForCommandAttempt(page, tauriLogs, { timeoutMs: 120000 });
        expect(thirdAttempt.taskFailed, 'after removing the allowlist, the same command should still run once the user re-approves it').toBe(false);
        expect(thirdAttempt.preflightSeen || thirdAttempt.runCommandSeen, 'after removal the command should still re-enter the protected execution path').toBe(true);
        expect(thirdAttempt.runCommandSeen, 'after removal the command should execute again once approved').toBe(true);
        expect(thirdAttempt.toolResultSeen, 'after removal the command should still produce a result after re-approval').toBe(true);
        expect(persistentAllowlistContains(COMMAND_BASE), 'approving once after removal must not silently recreate a permanent allowlist entry').toBe(false);
    });
});
