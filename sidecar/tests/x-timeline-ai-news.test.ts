/**
 * E2E scenario: X timeline AI news digest.
 *
 * User query:
 *   "将我的 X 上别人发布的最新帖文里的 10 条 AI 新闻整理出来"
 *
 * Acceptance:
 * 1) Agent starts browser workflow (connect/open + navigate to X/Twitter)
 * 2) If login is required, task is suspended with login guidance
 * 3) If already logged in, agent summarizes latest AI-related posts and replies
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import {
    SidecarProcess,
    buildStartTaskCommand,
    printHeader,
    saveTestArtifacts,
} from './helpers/sidecar-harness';

const TASK_TIMEOUT_MS = 6 * 60 * 1000;
const USER_QUERY = '将我的 X 上别人发布的最新帖文里的 10 条 AI 新闻整理出来';

function buildSendTaskMessageCommand(taskId: string, content: string): string {
    return JSON.stringify({
        type: 'send_task_message',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            taskId,
            content,
        },
    });
}

describe('X timeline AI news digest', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('opens X, suspends on login or returns AI-news digest', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'X 时间线 AI 新闻整理',
            userQuery: USER_QUERY,
        }));

        // Wait up to 2 minutes for either suspension (login-required flow) or completion.
        const firstPhaseDeadline = Date.now() + 120_000;
        while (
            Date.now() < firstPhaseDeadline &&
            !sidecar.collector.taskFinished &&
            !sidecar.collector.taskFailed &&
            !sidecar.collector.events.some((e) => e.type === 'TASK_SUSPENDED')
        ) {
            await new Promise((r) => setTimeout(r, 1000));
        }

        // If suspended, simulate user collaboration input and verify resume trigger path.
        const sawSuspended = sidecar.collector.events.some((e) => e.type === 'TASK_SUSPENDED');
        if (sawSuspended) {
            sidecar.sendCommand(buildSendTaskMessageCommand(taskId, '我已完成登录，请继续执行任务'));

            const resumeDeadline = Date.now() + 45_000;
            while (
                Date.now() < resumeDeadline &&
                !sidecar.collector.events.some((e) => e.type === 'TASK_RESUMED')
            ) {
                await new Promise((r) => setTimeout(r, 1000));
            }
        }

        // Give the loop time to continue after potential resume.
        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        const browserCalls = c.toolCalls.filter((t) =>
            t.toolName.startsWith('browser_') || t.toolName === 'open_in_browser'
        );

        const xNavigation = c.toolCalls.some((t) => {
            const url = String(t.toolArgs?.url || '').toLowerCase();
            return (
                (t.toolName === 'browser_navigate' || t.toolName === 'open_in_browser') &&
                (url.includes('x.com') || url.includes('twitter.com'))
            );
        });

        const suspendedEvents = c.events.filter((e) => e.type === 'TASK_SUSPENDED');
        const resumedEvents = c.events.filter((e) => e.type === 'TASK_RESUMED');
        const text = c.textBuffer;

        printHeader('X timeline AI news digest report');
        console.log(`Task started: ${c.taskStarted}`);
        console.log(`Task finished: ${c.taskFinished}`);
        console.log(`Task failed: ${c.taskFailed}`);
        console.log(`Tool calls: ${c.toolCalls.map((t) => t.toolName).join(', ')}`);
        console.log(`Browser calls: ${browserCalls.map((t) => t.toolName).join(', ')}`);
        console.log(`X navigation detected: ${xNavigation}`);
        console.log(`TASK_SUSPENDED count: ${suspendedEvents.length}`);
        console.log(`TASK_RESUMED count: ${resumedEvents.length}`);
        console.log(`Text length: ${text.length}`);

        saveTestArtifacts('x-timeline-ai-news', {
            'output.txt': text,
            'events.json': JSON.stringify(c.events, null, 2),
            'tool-calls.json': JSON.stringify(c.toolCalls, null, 2),
            'tool-results.json': JSON.stringify(c.toolResults, null, 2),
        });

        // Core behavioral checks
        expect(c.taskStarted).toBe(true);
        expect(browserCalls.length).toBeGreaterThan(0);
        expect(xNavigation).toBe(true);

        // Two valid outcomes:
        // A) Login required -> task suspended waiting for user login
        // B) Already logged in -> task completes with digest response
        if (suspendedEvents.length > 0) {
            const suspendText = JSON.stringify(suspendedEvents[0].payload || {}).toLowerCase();
            expect(suspendText.includes('login') || suspendText.includes('登录')).toBe(true);
            // Collaboration path should support explicit user follow-up to trigger resume.
            expect(resumedEvents.length).toBeGreaterThan(0);
            return;
        }

        // Logged-in path assertions
        // NOTE: environment/browser startup issues can still cause task failure before
        // semantic completion; keep this strict to expose real regressions.
        expect(c.taskFailed).toBe(false);
        expect(text.length).toBeGreaterThan(120);

        const lowerText = text.toLowerCase();
        const hasAiKeywords =
            lowerText.includes('ai') ||
            lowerText.includes('人工智能') ||
            lowerText.includes('大模型') ||
            lowerText.includes('llm');
        expect(hasAiKeywords).toBe(true);

        // Soft check for "10 items" intent being honored.
        // Model output may vary in formatting; accept Arabic/Chinese mention.
        const mentionsTen = /\b10\b|10条|十条/.test(text);
        expect(mentionsTen).toBe(true);
    }, TASK_TIMEOUT_MS + 90_000);
});
