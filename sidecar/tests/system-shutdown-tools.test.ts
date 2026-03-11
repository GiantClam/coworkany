import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { systemShutdownCancelTool, systemShutdownScheduleTool, systemShutdownStatusTool } from '../src/tools/core/systemShutdown';
import { STANDARD_TOOLS } from '../src/tools/standard';

const isWindows = process.platform === 'win32';
const runCommandTool = STANDARD_TOOLS.find((tool) => tool.name === 'run_command');

function makeWorkspacePath(): string {
    const workspacePath = path.join(os.tmpdir(), `coworkany-shutdown-test-${randomUUID()}`);
    fs.mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
}

function cleanupWorkspace(workspacePath: string): void {
    fs.rmSync(workspacePath, { recursive: true, force: true });
}

async function cleanupScheduledShutdown(workspacePath: string): Promise<void> {
    if (!isWindows) return;
    await systemShutdownCancelTool.handler({}, { taskId: 'cleanup', workspacePath }).catch(() => {});
}

describe('system shutdown tools', () => {
    let lastWorkspacePath: string | null = null;

    afterEach(async () => {
        if (lastWorkspacePath) {
            await cleanupScheduledShutdown(lastWorkspacePath);
            cleanupWorkspace(lastWorkspacePath);
            lastWorkspacePath = null;
        }
    });

    test('run_command blocks direct Windows shutdown scheduling and cancellation', async () => {
        expect(runCommandTool).toBeTruthy();
        if (!runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;

        const scheduleResult = await runCommandTool.handler(
            { command: 'shutdown /s /t 600' },
            { taskId: 'shutdown-block-test', workspacePath }
        ) as Record<string, unknown>;
        expect(scheduleResult.error_type).toBe('use_dedicated_tool');
        expect(scheduleResult.suggested_tool).toBe('system_shutdown_schedule');

        const cancelResult = await runCommandTool.handler(
            { command: 'shutdown /a' },
            { taskId: 'shutdown-block-test', workspacePath }
        ) as Record<string, unknown>;
        expect(cancelResult.error_type).toBe('use_dedicated_tool');
        expect(cancelResult.suggested_tool).toBe('system_shutdown_cancel');
    });

    test('schedules shutdown, reports status, and cancels successfully', async () => {
        if (!isWindows) {
            return;
        }
        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;

        const scheduleResult = await systemShutdownScheduleTool.handler(
            { delaySeconds: 600, reason: 'Sidecar regression test' },
            { taskId: 'shutdown-schedule-test', workspacePath }
        ) as Record<string, unknown>;

        expect(scheduleResult.success).toBe(true);
        expect(scheduleResult.scheduled).toBe(true);
        expect(typeof scheduleResult.scheduledAt).toBe('string');

        const statusAfterSchedule = await systemShutdownStatusTool.handler(
            {},
            { taskId: 'shutdown-schedule-test', workspacePath }
        ) as Record<string, unknown>;

        expect(statusAfterSchedule.success).toBe(true);
        expect(statusAfterSchedule.scheduled).toBe(true);
        expect(statusAfterSchedule.status).toBe('scheduled');

        const cancelResult = await systemShutdownCancelTool.handler(
            {},
            { taskId: 'shutdown-schedule-test', workspacePath }
        ) as Record<string, unknown>;

        expect(cancelResult.success).toBe(true);
        expect(cancelResult.status).toBe('cancelled');

        const statusAfterCancel = await systemShutdownStatusTool.handler(
            {},
            { taskId: 'shutdown-schedule-test', workspacePath }
        ) as Record<string, unknown>;

        expect(statusAfterCancel.success).toBe(true);
        expect(statusAfterCancel.scheduled).toBe(false);
        expect(statusAfterCancel.status).toBe('none');
    });
});
