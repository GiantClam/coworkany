import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const APP_DATA_DIR = path.join(process.env.HOME || '', 'Library', 'Application Support', 'com.coworkany.desktop');
const SESSIONS_PATH = path.join(APP_DATA_DIR, 'sessions.json');
const LEGACY_DEGRADED_SUMMARY = '本轮任务已完成所需工具调用并拿到有效结果，但上游没有按协议返回终止事件';

const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input textarea',
    '.chat-input input',
    'textarea',
    'input[type="text"]',
];

type LatestSession = {
    taskId: string;
    title: string;
    activeTaskId: string | null;
    latestUserMessage: string;
};

type SessionSnapshot = {
    sessions: Array<Record<string, unknown>>;
    activeTaskId: string | null;
};

function readSessionSnapshot(): SessionSnapshot {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8')) as {
        sessions?: Array<Record<string, unknown>>;
        activeTaskId?: string | null;
    };
    return {
        sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
        activeTaskId: typeof raw.activeTaskId === 'string' ? raw.activeTaskId : null,
    };
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readLatestSession(snapshot: SessionSnapshot): LatestSession {
    const raw = snapshot;
    const sessions = raw.sessions;
    if (sessions.length === 0) {
        throw new Error('No sessions found in sessions.json');
    }
    const latest = [...sessions].sort((a, b) => (
        String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''))
    )).at(-1);
    if (!latest) {
        throw new Error('Failed to resolve latest session');
    }
    const taskId = String(latest.taskId ?? '').trim();
    if (!taskId) {
        throw new Error('Latest session has empty taskId');
    }
    const title = String(latest.title ?? '');
    const messages = Array.isArray(latest.messages) ? latest.messages : [];
    const latestUserMessage = [...messages]
        .reverse()
        .find((message) => (
            message
            && typeof message === 'object'
            && (message as Record<string, unknown>).role === 'user'
            && String((message as Record<string, unknown>).content ?? '').trim().length > 0
        ));
    return {
        taskId,
        title,
        activeTaskId: raw.activeTaskId ?? null,
        latestUserMessage: String((latestUserMessage as Record<string, unknown> | undefined)?.content ?? '').trim(),
    };
}

async function findChatInput(page: any): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible({ timeout: 1000 }).catch(() => false);
        if (visible) {
            return candidate;
        }
    }
    return null;
}

async function openLatestSessionInTaskList(page: any, title: string): Promise<void> {
    if (!title.trim()) return;
    const titlePrefix = title.trim().slice(0, 24);
    const taskButton = page
        .getByRole('button', { name: new RegExp(escapeRegExp(titlePrefix)) })
        .first();
    await taskButton.click({ timeout: 20_000 });
    await page.waitForTimeout(1200);
}

async function triggerRetryOnCurrentSession(
    page: any,
    taskId: string,
    latestUserMessage: string,
): Promise<'invoke' | 'resend'> {
    if (!latestUserMessage) {
        throw new Error('Latest user message is empty');
    }

    const invokeResult = await page.evaluate(async (payload) => {
        const invoke = (window as Window & {
            __codexInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
        }).__codexInvoke;
        if (!invoke) {
            return { ok: false };
        }
        const response = await invoke('send_task_message', {
            input: {
                taskId: payload.taskId,
                content: payload.content,
            },
        }) as { success?: boolean; taskId?: string; error?: string };
        return {
            ok: Boolean(response?.success),
            error: typeof response?.error === 'string' ? response.error : null,
            taskId: typeof response?.taskId === 'string' ? response.taskId : null,
        };
    }, {
        taskId,
        content: latestUserMessage,
    });

    if (invokeResult?.ok) {
        return 'invoke';
    }

    const input = await findChatInput(page);
    if (!input) {
        throw new Error(`send_task_message invoke failed and chat input is unavailable: ${String(invokeResult?.error ?? '')}`);
    }
    await input.fill(latestUserMessage);
    await input.press('Enter');
    return 'resend';
}

test.describe.skip('tmp retry latest session scenario', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 60_000);

    test('retry latest existing session without creating new session', async ({ page, tauriLogs }) => {
        const snapshot = readSessionSnapshot();
        const latest = readLatestSession(snapshot);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        await page.evaluate(async (payload) => {
            const invoke = (window as Window & {
                __codexInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
            }).__codexInvoke;
            if (!invoke) {
                throw new Error('missing __codexInvoke bridge');
            }
            await invoke('save_sessions', { input: payload });
        }, snapshot);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        if (latest.title.trim().length > 0) {
            await expect(page.getByText(new RegExp(latest.title.slice(0, 20))).first()).toBeVisible({ timeout: 45_000 });
        }
        await openLatestSessionInTaskList(page, latest.title);

        tauriLogs.setBaseline();
        const triggerMode = await triggerRetryOnCurrentSession(page, latest.taskId, latest.latestUserMessage);

        let effectRequested = false;
        let approvalClicked = false;
        let taskStarted = false;
        let taskFinished = false;
        let taskFailed = false;
        let finishedSummary = '';
        let failedPayload = '';

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);
            const logs = tauriLogs.getRawSinceBaseline();
            const taskScopedLogs = logs
                .split('\n')
                .filter((line) => line.includes(`"taskId":"${latest.taskId}"`))
                .join('\n');
            const scopedLower = taskScopedLogs.toLowerCase();

            taskStarted = taskStarted
                || taskScopedLogs.includes('"type":"TASK_STARTED"')
                || taskScopedLogs.includes('"type":"TASK_RESUMED"')
                || taskScopedLogs.includes('"type":"CHAT_MESSAGE"');
            effectRequested = effectRequested || taskScopedLogs.includes('"type":"EFFECT_REQUESTED"');

            if (effectRequested && !approvalClicked) {
                const approveButton = page.getByRole('button', { name: /Approve|批准/ }).first();
                const canApprove = await approveButton.isVisible({ timeout: 700 }).catch(() => false);
                if (canApprove) {
                    await approveButton.click({ timeout: 3000 }).catch(() => {});
                    approvalClicked = true;
                }
            }

            taskFinished = taskFinished || taskScopedLogs.includes('"type":"TASK_FINISHED"');
            taskFailed = taskFailed || taskScopedLogs.includes('"type":"TASK_FAILED"');

            if (taskFinished) {
                const lines = taskScopedLogs.split('\n').filter((line) => line.includes('"type":"TASK_FINISHED"'));
                finishedSummary = lines.at(-1) ?? '';
            }
            if (taskFailed) {
                const lines = taskScopedLogs.split('\n').filter((line) => line.includes('"type":"TASK_FAILED"'));
                failedPayload = lines.at(-1) ?? '';
            }

            if (taskFinished || taskFailed) {
                fs.writeFileSync(
                    path.join(process.cwd(), 'test-results', 'tmp-retry-latest-session-summary.json'),
                    JSON.stringify({
                        taskId: latest.taskId,
                        activeTaskId: latest.activeTaskId,
                        triggerMode,
                        taskStarted,
                        effectRequested,
                        approvalClicked,
                        taskFinished,
                        taskFailed,
                        finishedSummary,
                        failedPayload,
                        containsLegacyDegradedSummary: taskScopedLogs.includes(LEGACY_DEGRADED_SUMMARY),
                        hasNoSnapshotError: scopedLower.includes('no snapshot found for this workflow run'),
                    }, null, 2),
                );
                break;
            }
        }

        const logs = tauriLogs.getRawSinceBaseline();
        const taskScopedLogs = logs
            .split('\n')
            .filter((line) => line.includes(`"taskId":"${latest.taskId}"`))
            .join('\n');

        expect(taskStarted, 'retry should produce new events on the latest existing task').toBe(true);
        expect(taskFinished || taskFailed, 'retried run should reach terminal state').toBe(true);
        expect(
            taskScopedLogs.includes(LEGACY_DEGRADED_SUMMARY),
            'retried run should not return the old degraded explanatory summary',
        ).toBe(false);
    });
});
