/**
 * Desktop GUI E2E: Windows scheduled shutdown flow
 *
 * Scenario:
 * 1. Launch CoworkAny Desktop through real `tauri dev`
 * 2. Ask CoworkAny to schedule a shutdown and verify the state
 * 3. Verify it uses dedicated shutdown tools instead of raw run_command shutdown commands
 * 4. Ask CoworkAny to cancel the shutdown and verify the cleared state
 * 5. Always run `shutdown /a` in cleanup as a safety backstop
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';

const TEST_TIMEOUT_MS = 5 * 60 * 1000;

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

type ShutdownState = {
    active?: boolean;
    action?: string;
    delaySeconds?: number;
    scheduledAt?: string;
    command?: string;
    source?: string;
};

function runShutdownAbortSafely(): void {
    if (process.platform !== 'win32') {
        return;
    }

    try {
        childProcess.execSync('shutdown /a', { stdio: 'ignore' });
    } catch {
        // No pending shutdown is a valid cleanup result.
    }
}

function cleanupShutdownStateFiles(sidecarWorkspaceRoot: string): void {
    if (!fs.existsSync(sidecarWorkspaceRoot)) {
        return;
    }

    for (const entry of fs.readdirSync(sidecarWorkspaceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const statePath = path.join(sidecarWorkspaceRoot, entry.name, '.coworkany', 'system-shutdown.json');
        if (fs.existsSync(statePath)) {
            fs.rmSync(statePath, { force: true });
        }
    }
}

function findNewestShutdownStateFile(sidecarWorkspaceRoot: string, notBeforeMs: number): string | null {
    if (!fs.existsSync(sidecarWorkspaceRoot)) {
        return null;
    }

    let newestPath: string | null = null;
    let newestMtime = 0;
    for (const entry of fs.readdirSync(sidecarWorkspaceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const statePath = path.join(sidecarWorkspaceRoot, entry.name, '.coworkany', 'system-shutdown.json');
        if (!fs.existsSync(statePath)) continue;
        const stat = fs.statSync(statePath);
        if (stat.mtimeMs >= notBeforeMs && stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestPath = statePath;
        }
    }
    return newestPath;
}

function readShutdownState(statePath: string | null): ShutdownState | null {
    if (!statePath || !fs.existsSync(statePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as ShutdownState;
    } catch {
        return null;
    }
}

function parseWorkspacePath(rawLogs: string): string | null {
    const directMatch = rawLogs.match(/"workspacePath":"([^"]+)"/);
    return directMatch?.[1] ? directMatch[1].replace(/\\\\/g, '\\') : null;
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

test.describe('Desktop GUI E2E - scheduled shutdown flow', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('schedules shutdown, verifies status, then clears shutdown', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Shutdown E2E is Windows-only');

        const sidecarWorkspaceRoot = path.resolve(process.cwd(), '..', 'sidecar', 'workspace');
        const testResultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(testResultsDir, { recursive: true });

        runShutdownAbortSafely();
        cleanupShutdownStateFiles(sidecarWorkspaceRoot);

        let stateFilePath: string | null = null;

        try {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(12000);

            const schedulePrompt = [
                '请设置10分钟后定时关机，并立即检查设置是否成功。',
                '要求：1. 必须真正设置系统定时关机；2. 设置后必须检查当前状态；3. 不要取消；4. 不要使用 run_command 执行 shutdown /s 或 shutdown /a。',
            ].join('\n');

            tauriLogs.setBaseline();
            await submitMessage(page, schedulePrompt);

            let sawScheduleTool = false;
            let sawStatusTool = false;
            let sawCancelTool = false;
            let sawShutdownRunCommand = false;
            let sawFailure = false;
            let workspacePath: string | null = null;
            const scheduleStart = Date.now();

            while (Date.now() - scheduleStart < 120000) {
                await page.waitForTimeout(3000);
                const logs = tauriLogs.getRawSinceBaseline();
                const lower = logs.toLowerCase();
                workspacePath = workspacePath ?? parseWorkspacePath(logs);

                sawScheduleTool =
                    sawScheduleTool ||
                    lower.includes('"name":"system_shutdown_schedule"');
                sawStatusTool =
                    sawStatusTool ||
                    lower.includes('"name":"system_shutdown_status"');
                sawCancelTool =
                    sawCancelTool ||
                    lower.includes('"name":"system_shutdown_cancel"');
                sawShutdownRunCommand =
                    sawShutdownRunCommand ||
                    (lower.includes('"name":"run_command"') && lower.includes('shutdown /'));
                sawFailure =
                    sawFailure ||
                    lower.includes('"type":"task_failed"');

                stateFilePath = stateFilePath ?? findNewestShutdownStateFile(sidecarWorkspaceRoot, scheduleStart);
                const state = readShutdownState(stateFilePath);
                const stateLooksValid =
                    !!state &&
                    state.active === true &&
                    state.action === 'shutdown' &&
                    typeof state.delaySeconds === 'number' &&
                    state.delaySeconds > 0;

                if (sawScheduleTool && sawStatusTool && stateLooksValid) {
                    break;
                }
            }

            const scheduleLogs = tauriLogs.getRawSinceBaseline();
            const resolvedWorkspacePath =
                workspacePath ??
                parseWorkspacePath(scheduleLogs) ??
                (stateFilePath ? path.dirname(path.dirname(stateFilePath)) : null);
            const scheduleState = readShutdownState(stateFilePath);

            fs.writeFileSync(
                path.join(testResultsDir, 'system-shutdown-schedule-stage.log'),
                scheduleLogs,
                'utf-8'
            );

            expect(sawFailure, 'task should not fail while scheduling shutdown').toBe(false);
            expect(sawShutdownRunCommand, 'agent must not use raw run_command shutdown commands').toBe(false);
            expect(sawCancelTool, 'agent should not cancel shutdown during verification').toBe(false);
            expect(sawScheduleTool, 'agent should call system_shutdown_schedule').toBe(true);
            expect(sawStatusTool, 'agent should call system_shutdown_status after scheduling').toBe(true);
            expect(resolvedWorkspacePath, 'workspace path should be discoverable from logs').toBeTruthy();
            expect(scheduleState?.active, 'shutdown state file should record active scheduled shutdown').toBe(true);

            tauriLogs.setBaseline();
            await submitMessage(
                page,
                '现在取消刚才设置的定时关机，并再次检查当前没有待执行的关机任务。不要使用 run_command 执行 shutdown /a。'
            );

            let sawCancelAfterRequest = false;
            let sawStatusAfterCancel = false;
            let sawRunCommandAfterCancel = false;
            let cancelFailed = false;
            const cancelStart = Date.now();

            while (Date.now() - cancelStart < 120000) {
                await page.waitForTimeout(3000);
                const logs = tauriLogs.getRawSinceBaseline();
                const lower = logs.toLowerCase();

                sawCancelAfterRequest =
                    sawCancelAfterRequest ||
                    lower.includes('"name":"system_shutdown_cancel"');
                sawStatusAfterCancel =
                    sawStatusAfterCancel ||
                    lower.includes('"name":"system_shutdown_status"');
                sawRunCommandAfterCancel =
                    sawRunCommandAfterCancel ||
                    (lower.includes('"name":"run_command"') && lower.includes('shutdown /a'));
                cancelFailed =
                    cancelFailed ||
                    lower.includes('"type":"task_failed"');

                const state = readShutdownState(stateFilePath);
                const cleared = !state || state.active !== true;

                if (sawCancelAfterRequest && sawStatusAfterCancel && cleared) {
                    break;
                }
            }

            const cancelLogs = tauriLogs.getRawSinceBaseline();
            fs.writeFileSync(
                path.join(testResultsDir, 'system-shutdown-cancel-stage.log'),
                cancelLogs,
                'utf-8'
            );
            await page.screenshot({
                path: path.join(testResultsDir, 'system-shutdown-desktop-e2e-final.png'),
            }).catch(() => {});

            const finalState = readShutdownState(stateFilePath);
            expect(cancelFailed, 'task should not fail while cancelling shutdown').toBe(false);
            expect(sawRunCommandAfterCancel, 'agent must not use raw run_command shutdown cancellation').toBe(false);
            expect(sawCancelAfterRequest, 'agent should call system_shutdown_cancel').toBe(true);
            expect(sawStatusAfterCancel, 'agent should re-check status after cancellation').toBe(true);
            expect(finalState?.active === true, 'shutdown state file should be cleared after cancellation').toBe(false);
        } finally {
            runShutdownAbortSafely();
            cleanupShutdownStateFiles(sidecarWorkspaceRoot);
        }
    });
});
