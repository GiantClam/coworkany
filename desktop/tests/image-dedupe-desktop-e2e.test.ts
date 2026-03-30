/**
 * Desktop GUI E2E: Similar image cleanup
 *
 * This test must trigger task execution from CoworkAny Desktop chat input
 * (not direct sidecar unit tests), then verify real filesystem cleanup result.
 *
 * Run:
 *   cd desktop && npx playwright test tests/image-dedupe-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const TASK_TIMEOUT_MS = 8 * 60 * 1000;

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

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function countImageFiles(folder: string): number {
    return fs.readdirSync(folder).filter((name) => /\.(png|jpg|jpeg|webp|bmp)$/i.test(name)).length;
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

test.describe('Desktop GUI E2E - similar image cleanup', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('send message via desktop chat and actually remove duplicate images', async ({ page, tauriLogs }) => {
        const sidecarDir = path.resolve(process.cwd(), '..', 'sidecar');
        const scenarioRoot = path.join(os.tmpdir(), `desktop-image-dedupe-${Date.now()}`);
        const imageFolder = path.join(scenarioRoot, 'images');
        const dedupeScript = path.join(scenarioRoot, 'remove_similar_images.mjs');
        const dedupeScriptSource = path.join(sidecarDir, 'remove_similar_images.mjs');
        const testResultsDir = path.join(process.cwd(), 'test-results');
        const nodeCommand = process.execPath || 'node';
        ensureDir(scenarioRoot);
        ensureDir(imageFolder);
        ensureDir(testResultsDir);
        fs.copyFileSync(dedupeScriptSource, dedupeScript);

        const onePixelPng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR42mP4DwABAQEAG7XkVQAAAABJRU5ErkJggg==',
            'base64',
        );
        fs.writeFileSync(path.join(imageFolder, 'img_a.png'), onePixelPng);
        fs.writeFileSync(path.join(imageFolder, 'img_b.png'), onePixelPng);
        fs.writeFileSync(path.join(imageFolder, 'img_c.png'), onePixelPng);
        const beforeCount = countImageFiles(imageFolder);

        const uninstall = spawnSync(nodeCommand, ['--version'], {
            cwd: sidecarDir,
            encoding: 'utf-8',
        });
        console.log(`[Test] node probe exitCode=${uninstall.status}`);
        if (uninstall.stdout?.trim()) console.log(`[Test] node probe stdout: ${uninstall.stdout.trim()}`);
        if (uninstall.stderr?.trim()) console.log(`[Test] node probe stderr: ${uninstall.stderr.trim()}`);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        const taskQuery = [
            `Clean duplicate images in folder: ${imageFolder}.`,
            `Execute this exact command first and do not install skills: ${nodeCommand} "${dedupeScript}" "${imageFolder}" --delete --threshold 0`,
            'Do not call marketplace or skill installation tools.',
            'Finish only after command output contains DEDUPE_DONE.',
        ].join('\n');

        tauriLogs.setBaseline();
        await input!.fill(taskQuery);
        await input!.press('Enter');
        await page.waitForTimeout(2000);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(2000);
            }
        }

        let submitted = false;
        let executionToolDetected = false;
        let scriptInvoked = false;
        let dedupeDone = false;
        let taskFinished = false;
        let taskFailed = false;

        let dedupeSeenAt = 0;
        let prevLogLen = 0;
        let idleAfterDedupeMs = 0;

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(4000);
            const elapsed = Math.round((Date.now() - start) / 1000);
            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();

            submitted =
                submitted ||
                lower.includes('send_task_message command received') ||
                lower.includes('start_task command received') ||
                lower.includes('"type":"start_task"');

            executionToolDetected =
                executionToolDetected ||
                lower.includes('"name":"run_command"') ||
                lower.includes('"name":"execute_python"') ||
                (lower.includes('tool_call') && (lower.includes('run_command') || lower.includes('execute_python')));

            scriptInvoked = scriptInvoked || lower.includes('remove_similar_images.mjs');

            if (!dedupeDone && lower.includes('dedupe_done')) {
                dedupeDone = true;
                dedupeSeenAt = Date.now();
                console.log(`[${elapsed}s] detected DEDUPE_DONE marker`);
            }

            taskFinished = taskFinished || lower.includes('task_finished');
            taskFailed = taskFailed || lower.includes('task_failed');

            if (taskFinished || taskFailed) {
                break;
            }

            if (dedupeDone) {
                const currentLen = logs.length;
                if (currentLen === prevLogLen) {
                    idleAfterDedupeMs += 4000;
                } else {
                    idleAfterDedupeMs = 0;
                }
                prevLogLen = currentLen;

                if (idleAfterDedupeMs >= 20_000 || (Date.now() - dedupeSeenAt > 30_000)) {
                    break;
                }
            }
        }

        const afterCount = countImageFiles(imageFolder);
        const finalLogs = tauriLogs.getRawSinceBaseline();

        const summary = {
            imageFolder,
            dedupeScript,
            beforeCount,
            afterCount,
            submitted,
            executionToolDetected,
            scriptInvoked,
            dedupeDone,
            taskFinished,
            taskFailed,
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'image-dedupe-desktop-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'image-dedupe-desktop-logs.txt'),
            finalLogs,
            'utf-8',
        );
        await page.screenshot({ path: path.join(testResultsDir, 'image-dedupe-desktop-final.png') }).catch(() => {});

        console.log('[Test] summary:', summary);

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(executionToolDetected, 'agent should use an execution tool (run_command/execute_python)').toBe(true);
        expect(scriptInvoked, 'should invoke remove_similar_images.mjs').toBe(true);
        expect(taskFailed, 'task should not fail').toBe(false);
        expect(dedupeDone, 'script output should contain DEDUPE_DONE').toBe(true);
        expect(afterCount, 'image count should be reduced').toBeLessThan(beforeCount);
        expect(afterCount, 'at least one representative image should remain').toBeGreaterThanOrEqual(1);
    });
});
