import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi']);
const ATTACHMENT_PATHS = [
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2025-10-17 22.01.27.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-06 15.34.56.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-04-06 21.01.29.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-04-03 09.25.43.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-17 11.30.46.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-17 11.30.35.png',
];
const QUERY = `[Resolved attachments] - ${ATTACHMENT_PATHS.join(' - ')} 把附件图片合并为一个视频，每张图片播放 5s`;
const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input textarea',
    '.chat-input input',
    'textarea[placeholder*="instructions"]',
    'textarea',
    'input[placeholder="New instructions..."]',
    'input[type="text"]',
];
const SEARCH_ROOTS = [
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace',
    '/Users/beihuang/Documents/github/coworkany/sidecar/.coworkany/test-workspace',
];

type VideoFileRecord = {
    path: string;
    size: number;
    mtimeMs: number;
};

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function assertAttachmentsExist(): void {
    const missing = ATTACHMENT_PATHS.filter((filePath) => !fs.existsSync(filePath));
    expect(missing, `missing attachments: ${missing.join(', ')}`).toEqual([]);
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

function extractLatestTaskId(logs: string): string | null {
    const matches = logs.matchAll(/"type":"TASK_STARTED","taskId":"([^"]+)"/g);
    let latest: string | null = null;
    for (const match of matches) {
        if (match[1]) {
            latest = match[1];
        }
    }
    return latest;
}

function collectRecentVideos(root: string, sinceMs: number, maxDepth: number): VideoFileRecord[] {
    if (!fs.existsSync(root)) {
        return [];
    }
    const results: VideoFileRecord[] = [];
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (queue.length > 0) {
        const current = queue.shift()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current.dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const absolutePath = path.join(current.dir, entry.name);
            if (entry.isDirectory()) {
                if (current.depth < maxDepth) {
                    queue.push({ dir: absolutePath, depth: current.depth + 1 });
                }
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (!VIDEO_EXTENSIONS.has(ext)) {
                continue;
            }
            let stats: fs.Stats;
            try {
                stats = fs.statSync(absolutePath);
            } catch {
                continue;
            }
            if (stats.mtimeMs < sinceMs || stats.size <= 0) {
                continue;
            }
            results.push({
                path: absolutePath,
                size: stats.size,
                mtimeMs: stats.mtimeMs,
            });
        }
    }
    return results;
}

test.describe('Desktop GUI E2E - user provided attachment video merge', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 120_000);

    test('submits user query and generates a non-empty video file', async ({ page, tauriLogs }) => {
        const testResultsDir = path.join(process.cwd(), 'test-results');
        ensureDir(testResultsDir);
        assertAttachmentsExist();

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(10_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        tauriLogs.setBaseline();
        const startedAt = Date.now();
        await input!.fill(QUERY);
        await input!.press('Enter');
        await page.waitForTimeout(1500);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(1500);
            }
        }

        let submitted = false;
        let taskFinished = false;
        let taskFailed = false;
        let taskId: string | null = null;
        let taskFailureSnippet = '';
        let workspaceExecuteCalled = false;
        let effectRequestedForTask = false;
        let approvalClicked = false;
        let reportEffectResultObserved = false;

        const startPoll = Date.now();
        while (Date.now() - startPoll < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);
            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();

            submitted =
                submitted
                || lower.includes('send_task_message command received')
                || lower.includes('start_task command received')
                || lower.includes('"type":"start_task"');

            if (!taskId) {
                taskId = extractLatestTaskId(logs);
            }
            const scopedLogs = taskId
                ? logs
                    .split('\n')
                    .filter((line) => line.includes(`"taskId":"${taskId}"`))
                    .join('\n')
                : logs;
            const scopedLower = scopedLogs.toLowerCase();

            workspaceExecuteCalled =
                workspaceExecuteCalled
                || scopedLogs.includes('"toolName":"mastra_workspace_execute_command"')
                || scopedLower.includes('ffmpeg');
            effectRequestedForTask =
                effectRequestedForTask
                || scopedLogs.includes('"type":"EFFECT_REQUESTED"');
            reportEffectResultObserved =
                reportEffectResultObserved
                || logs.includes('"type":"report_effect_result"');

            if (effectRequestedForTask && !approvalClicked) {
                const approveButton = page.getByRole('button', { name: /Approve|批准/ }).first();
                const visible = await approveButton.isVisible({ timeout: 600 }).catch(() => false);
                if (visible) {
                    await approveButton.click({ timeout: 3000 }).catch(() => {});
                    approvalClicked = true;
                    await page.waitForTimeout(1000);
                }
            }

            taskFinished =
                taskFinished
                || (taskId
                    ? scopedLogs.includes('"type":"TASK_FINISHED"')
                    : logs.includes('"type":"TASK_FINISHED"'));
            taskFailed =
                taskFailed
                || (taskId
                    ? scopedLogs.includes('"type":"TASK_FAILED"')
                    : logs.includes('"type":"TASK_FAILED"'));
            if (taskFailed) {
                taskFailureSnippet = scopedLogs.slice(-2500);
            }
            if (taskFinished || taskFailed) {
                break;
            }
        }

        const discoveredVideos = SEARCH_ROOTS
            .flatMap((root) => collectRecentVideos(root, startedAt - 2000, 6))
            .sort((left, right) => right.mtimeMs - left.mtimeMs);

        const summary = {
            query: QUERY,
            submitted,
            taskId,
            taskFinished,
            taskFailed,
            workspaceExecuteCalled,
            effectRequestedForTask,
            approvalClicked,
            reportEffectResultObserved,
            taskFailureSnippet,
            discoveredVideos,
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'tmp-attachment-video-merge-user-input-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'tmp-attachment-video-merge-user-input-logs.txt'),
            tauriLogs.getRawSinceBaseline(),
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'tmp-attachment-video-merge-user-input-final.png'),
        }).catch(() => {});

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(workspaceExecuteCalled, 'task should execute workspace command').toBe(true);
        if (effectRequestedForTask) {
            expect(approvalClicked, 'approval should be clicked when requested').toBe(true);
            expect(reportEffectResultObserved, 'approval should emit report_effect_result').toBe(true);
        }
        expect(taskFinished, 'task should finish successfully').toBe(true);
        expect(taskFailed, 'task should not fail').toBe(false);
        expect(discoveredVideos.length, 'should generate at least one recent non-empty video file').toBeGreaterThan(0);
    });
});

