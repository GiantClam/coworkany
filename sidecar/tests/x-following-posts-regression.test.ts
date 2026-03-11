import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import {
    SidecarProcess,
    buildStartTaskCommand,
    printHeader,
    saveTestArtifacts,
} from './helpers/sidecar-harness';

const TASK_TIMEOUT_MS = 5 * 60 * 1000;
const USER_QUERY = '查看我最新的X上关注人员的帖文，是否有AI相关的有价值的信息';

function getMaxObservationAlternation(toolNames: string[]): number {
    const observationTools = new Set(['browser_screenshot', 'browser_get_content']);
    let max = 0;
    let current = 0;

    for (let i = 0; i < toolNames.length; i++) {
        const name = toolNames[i];
        if (!observationTools.has(name)) {
            current = 0;
            continue;
        }

        if (i === 0 || !observationTools.has(toolNames[i - 1])) {
            current = 1;
        } else if (toolNames[i - 1] !== name) {
            current += 1;
        } else {
            current = 1;
        }

        if (current > max) {
            max = current;
        }
    }

    return max;
}

describe('X following posts regression', () => {
    let sidecar: SidecarProcess;

    afterAll(() => sidecar?.kill());

    test('suspends for login or completes without observation dead-loop', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'X Following Posts Regression',
            userQuery: USER_QUERY,
        }));

        const firstPhaseDeadline = Date.now() + 150_000;
        while (
            Date.now() < firstPhaseDeadline &&
            !sidecar.collector.taskFinished &&
            !sidecar.collector.taskFailed &&
            !sidecar.collector.events.some((e) => e.type === 'TASK_SUSPENDED')
        ) {
            await new Promise((r) => setTimeout(r, 1000));
        }

        if (
            !sidecar.collector.taskFinished &&
            !sidecar.collector.taskFailed &&
            !sidecar.collector.events.some((e) => e.type === 'TASK_SUSPENDED')
        ) {
            await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        }

        const c = sidecar.collector;
        const toolNames = c.toolCalls.map((t) => t.toolName);
        const browserCalls = c.toolCalls.filter((t) => t.toolName.startsWith('browser_'));
        const observationAlternation = getMaxObservationAlternation(toolNames);
        const disconnectCalls = c.getToolCalls('browser_disconnect').length;
        const stderr = sidecar.getAllStderr();
        const xNavigation = c.toolCalls.some((t) => {
            const url = String(t.toolArgs?.url || '').toLowerCase();
            return (
                (t.toolName === 'browser_navigate' || t.toolName === 'open_in_browser') &&
                (url.includes('x.com') || url.includes('twitter.com'))
            );
        });
        const autopilotXNavigation =
            stderr.includes('Navigating to inferred URL: https://x.com/home') ||
            stderr.includes('https://x.com/home');
        const suspendedEvents = c.events.filter((e) => e.type === 'TASK_SUSPENDED');
        const text = c.textBuffer;

        printHeader('X following posts regression report');
        console.log(`Task started: ${c.taskStarted}`);
        console.log(`Task finished: ${c.taskFinished}`);
        console.log(`Task failed: ${c.taskFailed}`);
        console.log(`Observation alternation max: ${observationAlternation}`);
        console.log(`browser_disconnect calls: ${disconnectCalls}`);
        console.log(`Tool calls: ${toolNames.join(', ')}`);
        console.log(`Suspended events: ${suspendedEvents.length}`);
        console.log(`Text length: ${text.length}`);

        saveTestArtifacts('x-following-posts-regression', {
            'output.txt': text,
            'events.json': JSON.stringify(c.events, null, 2),
            'tool-calls.json': JSON.stringify(c.toolCalls, null, 2),
            'tool-results.json': JSON.stringify(c.toolResults, null, 2),
            'stderr.txt': stderr,
        });

        expect(c.taskStarted).toBe(true);
        expect(browserCalls.length).toBeGreaterThan(0);
        expect(xNavigation || autopilotXNavigation || suspendedEvents.length > 0).toBe(true);
        expect(observationAlternation).toBeLessThanOrEqual(6);
        expect(disconnectCalls).toBeLessThanOrEqual(4);

        if (suspendedEvents.length > 0) {
            const suspendText = JSON.stringify(suspendedEvents[0].payload || {}).toLowerCase();
            expect(
                suspendText.includes('login') ||
                suspendText.includes('登录') ||
                suspendText.includes('x')
            ).toBe(true);
            return;
        }

        expect(c.taskFailed).toBe(false);
        expect(text.length).toBeGreaterThan(80);
        expect(/ai|人工智能|大模型|llm/i.test(text)).toBe(true);
    }, TASK_TIMEOUT_MS + 120_000);
});
